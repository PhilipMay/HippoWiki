# Authentication

This document defines how the auth middleware authenticates and rejects requests. How clients log in is in
[Connectors](connectors.md), and how users are linked to Keycloak accounts is in [User Linking](users.md#user-linking).

## Roles

- [Keycloak](https://www.keycloak.org/) is the authorization server. It runs as a separate service with its own realm
  `hippowiki`, and handles login pages, passwords, tokens and sessions, see [Deployment](deployment.md).
- HippoWiki is the protected resource. It checks tokens and owns users and rights, and has no login routes, passwords or
  stored tokens.
- The Keycloak console admin lives in Keycloak's `master` realm and is separate from the HippoWiki admin. It administers
  Keycloak and has no rights in HippoWiki.

## Token Check

`auth/tokens.py` verifies the token, and `auth/credentials.py` looks up the user. A request passes when all of this
holds:

- The token is a Bearer JWT signed with an allowlisted asymmetric algorithm, currently only RS256. This rules out
  `alg=none` and a token signed with the public key as an HMAC secret.
- The signature matches a signing key of Keycloak, and the issuer equals `HIPPOWIKI_OAUTH_ISSUER`.
- The audience contains `HIPPOWIKI_OAUTH_AUDIENCE`, which also rejects an ID token issued for a client.
- The token has an `exp` claim and has not expired, and an `iat` claim, if it has one, is not in the future. These
  compare with the app host clock, which [Time](time.md) allows because nothing is persisted, with a fixed
  [leeway](limits.md#token-check-values), so a small clock difference does not reject fresh tokens.
- A `sub` claim exists, and a user has this `auth_subject` and is not deactivated.

Only `sub` is used. Rights are read from the database on every request, so a token carries no rights, and a revoked
right takes effect on the next request.

Signing keys are cached in memory, with the values in [Token Check Values](limits.md#token-check-values):

- A successful fetch from `HIPPOWIKI_OAUTH_JWKS_URL` replaces the whole set, so a key removed from Keycloak stops
  working.
- A request that finds the set older than the maximum age refreshes it first, and an unknown `kid` causes a refetch.
- Fetches run one at a time and at a limited rate, so invalid tokens can not flood Keycloak. A failed fetch counts
  against the rate.
- A key that is still unknown gets 401 if the last fetch succeeded. If it failed, the lookup failed, see
  [Failed Credential Lookup](#failed-credential-lookup). This also holds when the rate allows no new fetch, so a client
  does not discard valid credentials while Keycloak is down.
- A failed refresh keeps the old set, so a cached key keeps working while Keycloak is down, and existing access tokens
  work until they expire. New logins and token refreshes need Keycloak.

## Token Lifecycle

- Access tokens last 5 minutes.
- Refresh tokens rotate, and the `offline_access` scope keeps connectors logged in between sessions. The exact session
  lifetimes are set during the [Connector Test](roadmap.md#connector-test).
- A client requests `offline_access` itself, when the metadata of Keycloak lists it. HippoWiki can not make it: the
  [MCP draft specification](https://modelcontextprotocol.io/specification/draft/basic/authorization) says a server
  should not name this scope in its protected resource metadata or in `WWW-Authenticate`.
- Keycloak stores and revokes refresh tokens and sessions. HippoWiki stores no tokens, so it needs no token hashing.
- Removing the link of a user, or deactivating them, blocks them on the next request. Disabling them only in Keycloak
  takes effect when their access token expires, so after up to 5 minutes and the leeway.

## Login Protection and Audit

- Keycloak handles password hashing, so HippoWiki has no password code.
- The realm has brute-force detection and login events switched on, and self-registration and username editing switched
  off.
- HippoWiki logs changes of rights and of `auth_subject`, including `hippowiki link-admin`, and logs when a user is
  deactivated or reactivated. Keycloak records the logins.

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
  `authorization_servers` lists the Keycloak issuer, and its `resource` equals the MCP URL as a user enters it in a
  client

There are no login routes, because the login pages are on Keycloak.

A public route matches on the exact path and on `GET`, so a trailing slash, a path below it or another method is not
public and gets 401. The middleware never reads the body of a public route, so an anonymous client can not make it hold
a body in memory.

The `resource_metadata` value of the [401](errors.md#rest-error-format) is the URL of the form for the MCP path. The
composition root builds it from `HIPPOWIKI_OAUTH_AUDIENCE`, by putting `/.well-known/oauth-protected-resource` in front
of its path, so it needs no setting of its own.

Everything else stays behind authentication, including MCP and `/openapi.json`. Swagger UI and ReDoc are turned off,
because a browser can not load `/openapi.json` for them without extra setup and they load their assets from a CDN.

## Admin Account on MCP

The rule is in [MCP](mcp.md#admin-account). The middleware enforces it right after authentication, so neither the body,
the SDK nor a tool is reached:

- A request to the MCP path whose principal has `is_admin` gets 403 problem+json from the
  [shared helper](errors.md#rest-error-format), whatever its method.
- The path matches exactly, like a [public route](#public-routes), and every other path is unaffected.
- The response is not a 401 and has no `WWW-Authenticate` header, because both tell an MCP client to log in again. That
  can not help, since the login is valid and the account itself is not allowed.

## Failed Credential Lookup

When the credential lookup fails, for example because the database is down or a needed signing key can not be fetched
from Keycloak, the middleware can not tell whether the credentials are valid, so it fails closed:

- the response is 503 problem+json from the [shared helper](errors.md#rest-error-format) and contains no exception
  details
- it is never a 401, because the credentials may be valid and a client must not discard them
- the request does not go on without a principal, so it reaches neither adapter
- MCP clients get the same HTTP 503, because the middleware runs before the MCP routes
- the health route does no lookup, so it still answers

An outage that starts after the lookup, during the service call, gets the 500 of the
[check order](request-checks.md#check-order). This is intended: only the lookup has to protect credentials from being
discarded, and any later failure is unexpected.
