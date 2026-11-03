# Authentication

This document defines the login method and how the middleware authenticates and rejects requests. The rights themselves
are in [Users and Rights](users-and-rights.md).

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
- The token has not expired. This compares the `exp` claim with the app host clock, which [Time](time.md) allows because
  nothing is persisted.
- A `sub` claim exists, and a user has this `auth_subject` and is not deactivated. A deleted user has no `auth_subject`,
  so it needs no check of its own.

Only `sub` is used. Rights are read from the database on every request, so a token carries no rights, and a revoked
right takes effect on the next request.

Signing keys are cached in memory:

- An unknown `kid` causes one refetch from `HIPPOWIKI_OAUTH_JWKS_URL`, at a limited rate, so invalid tokens can not
  flood Keycloak.
- A key that is still unknown after the refetch gets 401.
- When a needed key can not be fetched, the lookup failed, see [Failed Credential Lookup](#failed-credential-lookup).
- A cached key keeps working while Keycloak is down, so existing access tokens work until they expire. New logins and
  token refreshes need Keycloak.

## Token Lifecycle

- Access tokens last 5 minutes.
- Refresh tokens rotate, and the `offline_access` scope keeps connectors logged in between sessions. The exact session
  lifetimes are set during the [Connector Test](roadmap.md#connector-test).
- Keycloak stores and revokes refresh tokens and sessions. HippoWiki stores no tokens, so it needs no token hashing.
- Removing the link of a user, or deactivating or deleting them, blocks them on the next request. Disabling them only in
  Keycloak takes effect when their access token expires, so after up to 5 minutes.

## User Linking

Keycloak accounts and HippoWiki users are connected only through `users.auth_subject`, which holds the `sub` claim of
the Keycloak account. The rules are in [Users and Rights](users-and-rights.md#user-linking).

- Keycloak usernames and HippoWiki names are not compared, because a match by name would break when a username changes
  or is reused.
- A valid token with no linked user gets 401, and so does a valid token of a deactivated user.

## AI Agents

An AI agent acts as the account it logged in with. There are no tokens with fewer rights than their user.

- A person can log a connector in with their own account, unless it is the admin account.
- The admin account can log in at Keycloak, but [MCP rejects it](mcp.md#admin-account). The person who is the admin uses
  a separate account for connectors.
- A separate account, such as `alice-claude`, is a normal user: it gets its own folder rights, such as read-only, and
  shows up separately in the revision history.

## Scripts and Web Clients

REST accepts the same OAuth tokens as MCP, and there are no API tokens for now.

- Each script gets its own Keycloak client with a service account, and uses the client credentials grant.
- The service account is linked to a HippoWiki user like any other account.
- A script that administers the system has to use the one [admin](users-and-rights.md#admin) account, which has one
  link.

## Client Registration

Each product gets one confidential client, created by hand in Keycloak, with S256 PKCE required. Its client ID and
secret are entered in the connector dialog of the product.

- ChatGPT: the redirect URI comes from the management page, see [Why OAuth](#why-oauth).
- Claude: the redirect URI is `https://claude.ai/api/mcp/auth_callback`, and the connector uses the option "Use your own
  OAuth client".
- The audience of the tokens comes from a fixed Audience mapper set to the MCP URL, on a default client scope. One
  audience covers both MCP and REST.

These stay off:

- Client ID Metadata Documents (the `cimd` feature): experimental in Keycloak, and Keycloak rejects the document of
  ChatGPT ([Keycloak: MCP](https://www.keycloak.org/securing-apps/mcp-authz-server)).
- Anonymous dynamic client registration: the MCP specification is deprecating it, it would let anyone on the internet
  create clients, and Claude would register a new client on every fresh connection.
- Resource indicators (the `resource-indicators` feature): experimental in Keycloak. Without it Keycloak does not
  recognize the `resource` parameter that ChatGPT sends, so the audience comes from the mapper instead.

Accepted trade-off: everyone who adds a connector themselves uses the same client secret, and replacing it means
entering it again. The secret only identifies the product, and each person still has to log in.

Whether this works with the real clients is not shown yet, see [Connector Test](roadmap.md#connector-test).

## Why OAuth

Hosted MCP connectors log in with OAuth 2.1 and PKCE, because the clients named in [Goals](goals.md) need it.

- ChatGPT needs OAuth for an authenticated server: protected resource metadata, an authorization server with discovery
  metadata, and the authorization code flow with PKCE and S256. It can not present API keys or customer mTLS
  certificates, and does not support machine-to-machine grants
  ([OpenAI: Authentication](https://developers.openai.com/plugins/build/auth)). The tools declare `securitySchemes`, and
  the `resource` parameter sets the audience of the tokens
  ([OpenAI: full documentation](https://developers.openai.com/plugins/llms-full.txt)).
- The redirect URI of ChatGPT depends on the authorization server:
  `https://chatgpt.com/connector_platform_oauth_redirect` with RFC 9207 issuer identification, otherwise
  `https://chatgpt.com/connector/oauth/{callback_id}`. Copy the exact value from the management page when setting this
  up ([OpenAI: Authentication](https://developers.openai.com/plugins/build/auth)).
- Claude documents OAuth with discovery from a 401 carrying `WWW-Authenticate: Bearer resource_metadata=...`
  ([Claude: connector authentication](https://claude.com/docs/connectors/building/authentication.md),
  [Claude: custom connectors](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)).
  It also lists authless servers, which [Goals](goals.md) rules out, and `static_headers` (beta), an API key or bearer
  token sent on every call, which HippoWiki does not use.

## Login Protection and Audit

- Keycloak handles password hashing, so HippoWiki has no password code.
- The realm has brute-force detection and login events switched on, and self-registration and username editing switched
  off.
- HippoWiki logs changes of rights and of `auth_subject`, including `hippowiki link-admin`, and logs when a user is
  deactivated, reactivated or deleted. Keycloak records the logins.

## Request Handling

- Authentication is one pure ASGI middleware, not `BaseHTTPMiddleware`, because MCP streams its responses.
- It wraps REST and the MCP routes, since FastAPI dependencies do not reach the MCP routes.
- It rejects unauthenticated requests before the request body is read or parsed and before they reach the adapters or
  services, on both REST and MCP, on every route except the public ones.
- It stores the principal in the ASGI scope, and the OpenAPI security scheme is declared separately.
- The credential check returns a principal or nothing. An exception means the lookup failed.
- Other ASGI scopes: `lifespan` passes through unchanged, and `websocket` fails closed, because no route uses it.

## Public Routes

Public routes are the only ones the middleware lets through without authentication:

- health: `GET /health`, liveness only, with a fixed status body, no database access and no version or configuration
  details
- protected resource metadata (RFC 9728): `/.well-known/oauth-protected-resource` and its form for the MCP path,
  `/.well-known/oauth-protected-resource/mcp`, with a body built from the settings and no database access. Its
  `authorization_servers` lists the Keycloak issuer, and its `resource` equals the MCP URL as a user enters it in a
  client

There are no login routes, because the login pages are on Keycloak.

A public route matches on the exact path, so a trailing slash or a path below it is not public.

Everything else stays behind authentication, including MCP and `/openapi.json`. Swagger UI and ReDoc are turned off,
because a browser can not load `/openapi.json` for them without extra setup and they load their assets from a CDN.

## Admin Account on MCP

The rule is in [MCP](mcp.md#admin-account). The middleware enforces it right after authentication, so neither the body,
the SDK nor a tool is reached:

- A request to the MCP path whose principal has `is_admin` gets 403 problem+json from the
  [shared helper](request-checks.md#rest-error-format), whatever its method.
- The path matches exactly, like a [public route](#public-routes), and every other path is unaffected.
- The response is not a 401 and has no `WWW-Authenticate` header, because both tell an MCP client to log in again. That
  can not help, since the login is valid and the account itself is not allowed.

## Request Body Limit

After authentication and before anything parses the body, the middleware rejects a request body over the limit with 413.
It checks this on the declared length and while reading, whatever the route. The limit is 2 MiB (2,097,152 bytes), and a
body of exactly this size passes.

The limit is separate from the [maximum document size](entities.md#document-size) of 256 KiB, but has to leave room for
it. JSON escaping can grow one UTF-8 byte to six, because U+0001 becomes `\u0001` and `SafeText` allows it, so the
largest document can need 1.5 MiB. The other 512 KiB covers the name, the IDs and the JSON-RPC envelope.

The value is fixed in the code and not a setting. `app.py` holds it as `MAX_REQUEST_BODY_BYTES` and passes it to the
middleware, while `services/md_documents.py` holds `MAX_CONTENT_MD_BYTES`. The [reverse proxy](deployment.md) needs a
matching limit.

The middleware reads the body up to the limit before it calls the app, and then replays it. Memory is bounded by the
limit, and after the replay `receive` goes to the original one again, so the app still gets `http.disconnect`.

## Failed Credential Lookup

When the credential lookup fails, for example because the database is down or a needed signing key can not be fetched
from Keycloak, the middleware can not tell whether the credentials are valid, so it fails closed:

- the response is 503 problem+json from the [shared helper](request-checks.md#rest-error-format) and contains no
  exception details
- it is never a 401, because the credentials may be valid and a client must not discard them
- the request does not go on without a principal, so it reaches neither adapter
- MCP clients get the same HTTP 503, because the middleware runs before the MCP routes
- the health route does no lookup, so it still answers

An outage that starts after the lookup, during the service call, gets the 500 of the
[check order](request-checks.md#check-order). This is intended: only the lookup has to protect credentials from being
discarded, and any later failure is unexpected.

## Implementation Notes

- Raising from a wrapped `receive` does not work for the body limit. FastAPI turns any exception during body parsing
  into a 400, and a route that reads no body would answer 404, although the Body size check comes before Routing in the
  [check order](request-checks.md#check-order). So the body is read up front and replayed.
- The SDK's `RequestBodyLimitMiddleware` (`transport_security.py:126`) works the same way.
- The SDK limits MCP bodies to 4 MiB by itself (`transport_security.py:15`) and answers with a plain text 413. Our limit
  is lower, so the middleware always answers first and `max_request_body_size` stays unset. The line numbers refer to
  `mcp` 2.3.0.
