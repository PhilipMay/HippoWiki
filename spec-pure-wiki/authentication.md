# Authentication

This document defines how a user logs in, how a session works, and how the auth middleware authenticates and rejects
requests. Accounts and the rules for passwords are in [Users](users.md).

## Overview

A user sends their name and password to the login route and gets a token. Every further request carries this token as
`Authorization: Bearer <token>`. A web client and a script log in in the same way.

- HippoWiki has no public registration, see [Admin Operations](users.md#admin-operations).
- The token is an opaque random value, and the database holds only its hash.
- It is not a JWT. Rights and deactivation are read from the database on every request anyway, so a JWT would save no
  lookup, and it could not end at logout or at a password reset without extra state.

## Login

`POST /api/v1/auth/login` takes JSON with `name`, `password` and an optional `new_password`.

| Case                                                                                     | Response                                                  |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Correct password                                                                         | 200 with the [login result](rest.md#response-fields)      |
| Wrong password, unknown name, deactivated user, or an account in its wait                | one identical 401 `invalid_credentials`                   |
| Correct one-time password, no `new_password`                                             | 403 `password_change_required`, no token, nothing changes |
| Correct one-time password, valid `new_password`                                          | 200, and the new password replaces the one-time password  |
| Correct one-time password, `new_password` breaks a [rule](users.md#passwords)            | 422 `domain_validation`, no token, nothing changes        |
| Correct normal password, any `new_password`, because `PUT /me/password` is the way to it | 422 `domain_validation`, no token, nothing changes        |
| A body with the wrong shape                                                              | 422 `schema_validation`, before any hash                  |
| A body over the [login body limit](limits.md#login-values)                               | 413 `body_too_large`, before any hash                     |
| Over the [limit of hashes](limits.md#login-values)                                       | 503 `service_unavailable`                                 |

- The rules for `new_password` are checked only after the password was correct, so they tell an attacker nothing.
- The admin never has a one-time password, because `hippowiki set-admin-password` sets a normal one.
- A login response carries `Cache-Control: no-store`.
- Any other failure, such as a database outage during the login, gets the 500 of the
  [check order](request-checks.md#check-order), and never a 401, so a client does not report a wrong password.
- The route reads its own body with a bounded reader, also when it is chunked, because the middleware never reads the
  body of a public route. This is why it validates the body itself, with the same request model rules as other routes.

## Changing a Password

`PUT /api/v1/me/password` takes `current_password` and `new_password`, and answers 204. It runs these checks after the
ones of the [check order](request-checks.md#check-order) up to schema validation, and the first that fails decides:

1. The admin gets 403 `forbidden`, because [only the command changes the password](users.md#admin).
2. A wrong `current_password` gets 403 `forbidden`. It is never a 401, because the token is valid and a client must not
   discard it. It counts as a failed login, and the wait of [Login Protection](#login-protection) applies to it.
3. A `new_password` that breaks a [rule](users.md#passwords) gets 422 `domain_validation`.

A successful change ends all sessions of the user, also the one that sent the request, so the client logs in again. It
uses the same [two units of work](#login-protection) as a login.

## Sessions

- A successful login creates one row in the [session table](database.md#session-table), with a random token of
  [256 bits](limits.md#login-values). The response holds the token once.
- A session lasts [8 hours](limits.md#login-values) from its login, and can not be extended, so the user logs in again
  after that. A later version can add a longer lifetime without changing the token check.
- A user can have several sessions at once, such as a browser and a script.
- `POST /api/v1/auth/logout` deletes the session of the request and answers 204. The principal carries the hash of its
  token for this.
- These end all sessions of a user, by deleting their rows in the same transaction as the change: a password change, a
  password reset, `hippowiki set-admin-password` and deactivating.
- A successful login also deletes all expired rows, so the table does not grow without limit. A row that has expired
  does not pass the token check, whether it was deleted yet or not.

## Token Check

`auth/tokens.py` turns the bearer value into a hash, and `auth/credentials.py` looks it up. A request passes when all of
this holds:

- The request has a `Bearer` token of the expected shape, which is 43 base64url characters. Any other value gets 401
  without a database lookup, so invalid values cause no load.
- The SHA-256 hash of the token is the hash of a session.
- The session has not expired, compared by the database clock, see [Time](time.md).
- Its user exists and is not deactivated.

This is one indexed query that joins the session and the user. Rights are read from the database on every request, so a
token carries no rights, and a revoked right takes effect on the next request.

## Login Protection

- **Hashing**: Argon2id through `argon2-cffi` with its default parameters, and a hash is upgraded at the next login when
  the parameters have changed.
- **Event loop**: hashing runs in a worker thread with a [limit on running and waiting hashes](limits.md#login-values).
  Over the limit the route answers 503, and so do the REST routes that generate a
  [one-time password](users.md#passwords), so logins can not block other requests or exhaust memory and CPU.
- **Transactions**: hashing runs outside a transaction, so it holds no connection, see
  [Transactions](architecture.md#transactions). The failure counter is updated atomically. The second unit of work
  compares `changed_at` with the value the first one read, and reads the user again. If a password changed in between or
  the user was deactivated, the login counts as wrong, so it can not create a session after these have ended the
  sessions of the user.
- **Per account**: after the free attempts, each failure doubles the time an account must wait. During this time the
  login is refused even with the right password, with the same answer as a wrong one. A refused attempt neither counts
  nor extends the wait. `hippowiki set-admin-password` and a password reset clear this.
- Accepted trade-off: one wrong password per wait keeps a known account from logging in, and the name `admin` is known.
  Sessions that exist keep working. A wait per account and address would end this, but allows slow guessing from many
  addresses, which is the worse risk for a password login.
- Accepted trade-off: there is no limit per client address, so one password tried against many names is not slowed down.
  This also means the app needs no trusted forwarded address. A limit per address is [for later](roadmap.md#later).
- **Enumeration**: an unknown name, a deactivated user and an account in its wait still run a hash, against a fixed
  dummy value where there is no password to check, and get the same answer as a wrong password. A password over the
  [length limit](limits.md#limits-at-a-glance) gets this answer without a hash.
- **Accounts**: there is no self-registration and no way to rename a user.
- **Logging**: a login, a failure and the start of a wait are logged. The name is logged only when it belongs to a user,
  because people type passwords into the name field. Logs never hold a password or a token.

Multi-factor login and a reset without the admin are [for later](roadmap.md#later).

## Audit

HippoWiki logs logins, see [Login Protection](#login-protection). It also logs changes of rights and passwords,
including `hippowiki set-admin-password`, and when a user is deactivated or reactivated.

## Request Handling

- Authentication is one pure ASGI middleware, not a FastAPI dependency, because it has to answer before the body is read
  and also on unknown routes, see [Leaks](request-checks.md#leaks).
- It rejects unauthenticated requests before the request body is read or parsed and before they reach the adapter or
  services, on every route except the public ones.
- It stores the principal in the ASGI scope, and the OpenAPI security scheme is declared separately.
- The credential check returns a principal or nothing. An exception means the lookup failed.
- It also enforces the [request body limit](limits.md#request-body-limit).
- Other ASGI scopes: `lifespan` passes through unchanged, and `websocket` fails closed, because no route uses it.

## Public Routes

Public routes are the only ones the middleware lets through without authentication:

- health: `GET /health`, liveness only, with a fixed status body, no database access and no version or configuration
  details
- login: `POST /api/v1/auth/login`, see [Login](#login)

A public route matches on the exact path and method, so a trailing slash, a path below it or another method is not
public and gets 401. The middleware never reads the body of a public route, so an anonymous client can not make it hold
a body in memory.

Everything else stays behind authentication, including `/openapi.json`. Swagger UI and ReDoc are turned off, because a
browser can not load `/openapi.json` for them without extra setup and they load their assets from a CDN.

## Failed Credential Lookup

When the credential lookup fails, for example because the database is down, the middleware can not tell whether the
credentials are valid, so it fails closed:

- the response is 503 problem+json from the [shared helper](errors.md#rest-error-format) and contains no exception
  details
- it is never a 401, because the credentials may be valid and a client must not discard them
- the request does not go on without a principal, so it does not reach the adapter
- the health route does no lookup, so it still answers

An outage that starts after the lookup, during the service call, gets the 500 of the
[check order](request-checks.md#check-order). This is intended: only the lookup has to protect credentials from being
discarded, and any later failure is unexpected.
