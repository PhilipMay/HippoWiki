# Auth Middleware

This document covers how requests are authenticated. The rights themselves are in [Auth Concept](auth-concept.md), and the
login method is described in [Known Limitations](known-limitations.md#authentication).

- Authentication is one pure ASGI middleware, not `BaseHTTPMiddleware`, because MCP streams its responses.
- It wraps REST and the MCP routes, since FastAPI dependencies do not reach the MCP routes.
- It rejects unauthenticated requests before the request body is read or parsed and before they reach the adapters or
  services, on both REST and MCP, on every route except the public ones.
- It stores the principal in the ASGI scope, and the OpenAPI security scheme is declared separately.
- The credential check returns a principal or nothing. An exception means the lookup failed, see
  [Failed Credential Lookup](#failed-credential-lookup).
- Other ASGI scopes: `lifespan` passes through unchanged, and `websocket` fails closed, because no route uses it.

## Public Routes

Public routes are the only ones the middleware lets through without authentication, as allowed by [Goals](goals.md):

- health: liveness only, with a fixed status body, no database access and no version or configuration details
- protected resource metadata (RFC 9728): `/.well-known/oauth-protected-resource` and its form for the MCP path,
  `/.well-known/oauth-protected-resource/mcp`, with a body built from the settings and no database access
- whatever else the login method needs, see [Known Limitations](known-limitations.md#authentication)

A public route matches on the exact path, so a trailing slash or a path below it is not public.

Everything else stays behind authentication, including MCP and `/openapi.json`. Swagger UI and ReDoc are turned off,
because a browser can not load `/openapi.json` for them without extra setup and they load their assets from a CDN.

## Request Body Limit

After authentication and before anything parses the body, the middleware rejects a request body over the limit with 413.
It checks this on the declared length and while reading, whatever the route. This limit is separate from the maximum
document size, and its value is still open, see [Known Limitations](known-limitations.md).

The middleware reads the body up to the limit before it calls the app, and then replays it:

- Raising from a wrapped `receive` does not work. FastAPI turns any exception during body parsing into a 400, and a route
  that reads no body would answer 404, although the Body size check comes before Routing in the
  [check order](request-checks.md#check-order).
- Memory is bounded by the limit. The SDK's `RequestBodyLimitMiddleware` (`transport_security.py:126`) works the same way.
- After the replay, `receive` goes to the original one again, so the app still gets `http.disconnect`.

## Failed Credential Lookup

When the credential lookup fails, for example because the database is down, the middleware can not tell whether the
credentials are valid, so it fails closed:

- the response is 503 problem+json from the [shared helper](request-checks.md#rest-error-format) and contains no exception details
- it is never a 401, because the credentials may be valid and a client must not discard them
- the request does not go on without a principal, so it reaches neither adapter
- MCP clients get the same HTTP 503, because the middleware runs before the MCP routes
- the health route does no lookup, so it still answers

An outage that starts after the lookup, during the service call, gets the 500 of the [check order](request-checks.md#check-order).
This is intended: only the lookup has to protect credentials from being discarded, and any later failure is unexpected.
