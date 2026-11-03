# Authentication

This document defines how the auth middleware authenticates and rejects requests. Issuing tokens is in
[OAuth Server](oauth-server.md), how clients log in is in [Connectors](connectors.md), and accounts are in
[Users](users.md).

## Roles

- HippoWiki is both the authorization server and the protected resource, in one process and on one hostname. The
  [OAuth Server](oauth-server.md) handles the login page, passwords and tokens.
- The auth middleware is the protected resource side. It knows nothing about passwords and clients, and passes every
  token it gets to the credential check.

## Token Check

`auth/tokens.py` turns the bearer value into a hash, and `auth/credentials.py` looks it up. A request passes when all of
this holds:

- The request has a `Bearer` token of the expected shape. Any other value gets 401 without a database lookup, so invalid
  values cause no load.
- The SHA-256 hash of the token is the hash of an access token. A refresh token or authorization code does not pass.
- The token has not expired, compared by the database clock, see [Time](time.md).
- Its user exists and is not deactivated.

This is one indexed query that joins the token and the user. Rights are read from the database on every request, so a
token carries no rights, and a revoked right takes effect on the next request.

## Audit

HippoWiki logs logins, see [Login Protection](oauth-server.md#login-protection). It also logs changes of rights and
passwords, including `hippowiki set-admin-password`, changes of clients, and when a user is deactivated or reactivated.

## Request Handling

- Authentication is one pure ASGI middleware, not `BaseHTTPMiddleware`, because MCP streams its responses.
- It wraps REST and the MCP routes, since FastAPI dependencies do not reach the MCP routes.
- It rejects unauthenticated requests before the request body is read or parsed and before they reach the adapters or
  services, on both REST and MCP, on every route except the public ones.
- It stores the principal in the ASGI scope, and the OpenAPI security scheme is declared separately.
- The credential check returns a principal or nothing. An exception means the lookup failed.
- It also enforces the [request body limit](limits.md#request-body-limit).
- Other ASGI scopes: `lifespan` passes through unchanged, and `websocket` fails closed, because no route uses it.

## Public Routes

Public routes are the only ones the middleware lets through without authentication:

- health: `GET /health`, liveness only, with a fixed status body, no database access and no version or configuration
  details
- protected resource metadata (RFC 9728): `GET /.well-known/oauth-protected-resource` and its form for the MCP path,
  `GET /.well-known/oauth-protected-resource/mcp`, with a body built from the settings and no database access. Its
  `authorization_servers` lists the issuer of the [OAuth Server](oauth-server.md), and its `resource` equals the MCP URL
  as a user enters it in a client
- the [routes of the OAuth Server](oauth-server.md#routes): its metadata, `GET` and `POST /oauth/authorize`,
  `POST /oauth/token` and `POST /oauth/revoke`

A public route matches on the exact path and method, so a trailing slash, a path below it or another method is not
public and gets 401. The middleware never reads the body of a public route, so an anonymous client can not make it hold
a body in memory. The `POST` routes of the OAuth Server read their own body up to a
[small limit](limits.md#oauth-values).

The `resource_metadata` value of the [401](errors.md#rest-error-format) is the URL of the form for the MCP path. The
composition root builds it from `HIPPOWIKI_PUBLIC_URL`, so it needs no setting of its own.

Everything else stays behind authentication, including MCP and `/openapi.json`. Swagger UI and ReDoc are turned off,
because a browser can not load `/openapi.json` for them without extra setup and they load their assets from a CDN.

## Admin Account on MCP

The rule is in [MCP](mcp.md#admin-account). The admin can not get a token for a product, see
[Admin](oauth-server.md#admin), but a script client of the admin has one, so the middleware enforces the rule right
after authentication, and neither the body, the SDK nor a tool is reached:

- A request to the MCP path whose principal has `is_admin` gets 403 problem+json from the
  [shared helper](errors.md#rest-error-format), whatever its method.
- The path matches exactly, like a [public route](#public-routes), and every other path is unaffected.
- The response is not a 401 and has no `WWW-Authenticate` header, because both tell an MCP client to log in again. That
  can not help, since the login is valid and the account itself is not allowed.

## Failed Credential Lookup

When the credential lookup fails, for example because the database is down, the middleware can not tell whether the
credentials are valid, so it fails closed:

- the response is 503 problem+json from the [shared helper](errors.md#rest-error-format) and contains no exception
  details
- it is never a 401, because the credentials may be valid and a client must not discard them
- the request does not go on without a principal, so it reaches neither adapter
- MCP clients get the same HTTP 503, because the middleware runs before the MCP routes
- the health route does no lookup, so it still answers

An outage that starts after the lookup, during the service call, gets the 500 of the
[check order](request-checks.md#check-order). This is intended: only the lookup has to protect credentials from being
discarded, and any later failure is unexpected.
