# Auth Middleware

This document covers how requests are authenticated. The rights themselves are in [Auth Concept](auth-concept.md), and the
login method is still open, see [Known Limitations](known-limitations.md#still-missing-authentication).

- Authentication is one pure ASGI middleware, not `BaseHTTPMiddleware`, because MCP streams its responses.
- It wraps REST and the mounted MCP app, since FastAPI dependencies do not reach mounted apps.
- It rejects unauthenticated requests before the request body is read or parsed and before they reach the adapters or
  services, on both REST and MCP, on every route except the public ones.
- It stores the principal in the ASGI scope, and the OpenAPI security scheme is declared separately.
- The credential check returns a principal or nothing. An exception means the lookup failed, see
  [Failed Credential Lookup](#failed-credential-lookup).

## Public Routes

Public routes are the only ones the middleware lets through without authentication, as allowed by [Goals](goals.md):

- health: liveness only, with a fixed status body, no database access and no version or configuration details
- whatever the login method needs, see [Known Limitations](known-limitations.md#still-missing-authentication)

Everything else stays behind authentication, including MCP and the OpenAPI docs.

## Request Body Limit

After authentication and before anything parses the body, the middleware rejects a request body over the limit with 413.
It checks this on the declared length and while reading, whatever the route. This limit is separate from the maximum
document size, and its value is still open, see [Known Limitations](known-limitations.md).

## Failed Credential Lookup

When the credential lookup fails, for example because the database is down, the middleware can not tell whether the
credentials are valid, so it fails closed:

- the response is 503 problem+json from the shared helper and contains no exception details
- it is never a 401, because the credentials may be valid and a client must not discard them
- the request does not go on without a principal, so it reaches neither adapter
- MCP clients get the same HTTP 503, because the middleware runs before the MCP app
- the health route does no lookup, so it still answers
