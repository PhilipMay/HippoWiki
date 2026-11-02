# Authentication

This document defines the login method. How requests are rejected is in [Auth Middleware](auth-middleware.md), and the rights themselves are in [Auth Concept](auth-concept.md).

## Roles

- [Keycloak](https://www.keycloak.org/) is the authorization server. It runs as a separate service with its own realm `hippowiki`, and handles login pages, passwords, tokens and sessions, see [Deployment](deployment.md).
- HippoWiki is the protected resource. It checks tokens and owns users and rights, and has no login routes, passwords or stored tokens.
- The Keycloak console admin lives in Keycloak's `master` realm and is separate from the HippoWiki root admin. It administers Keycloak and has no rights in HippoWiki.

## Why OAuth

Hosted MCP connectors log in with OAuth 2.1 and PKCE, because the clients named in [Goals](goals.md) need it.

- ChatGPT needs OAuth for an authenticated server: protected resource metadata, an authorization server with discovery metadata, and the authorization code flow with PKCE and S256. It can not present API keys or customer mTLS certificates, and does not support machine-to-machine grants ([OpenAI: Authentication](https://developers.openai.com/plugins/build/auth)). The tools declare `securitySchemes`, and the `resource` parameter sets the audience of the tokens ([OpenAI: full documentation](https://developers.openai.com/plugins/llms-full.txt)).
- The redirect URI of ChatGPT depends on the authorization server: `https://chatgpt.com/connector_platform_oauth_redirect` with RFC 9207 issuer identification, otherwise `https://chatgpt.com/connector/oauth/{callback_id}`. Copy the exact value from the management page when setting this up ([OpenAI: Authentication](https://developers.openai.com/plugins/build/auth)).
- Claude documents OAuth with discovery from a 401 carrying `WWW-Authenticate: Bearer resource_metadata=...` ([Claude: connector authentication](https://claude.com/docs/connectors/building/authentication.md), [Claude: custom connectors](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)). It also lists authless servers, which [Goals](goals.md) rules out, and `static_headers` (beta), an API key or bearer token sent on every call, which HippoWiki does not use.

## Client Registration

Each product gets one confidential client, created by hand in Keycloak, with S256 PKCE required. Its client ID and secret are entered in the connector dialog of the product.

- ChatGPT: the redirect URI comes from the management page, see [Why OAuth](#why-oauth).
- Claude: the redirect URI is `https://claude.ai/api/mcp/auth_callback`, and the connector uses the option "Use your own OAuth client".
- The audience of the tokens comes from a fixed Audience mapper set to the MCP URL, on a default client scope. One audience covers both MCP and REST.

These stay off:

- Client ID Metadata Documents (the `cimd` feature): experimental in Keycloak, and Keycloak rejects the document of ChatGPT ([Keycloak: MCP](https://www.keycloak.org/securing-apps/mcp-authz-server)).
- Anonymous dynamic client registration: the MCP specification is deprecating it, it would let anyone on the internet create clients, and Claude would register a new client on every fresh connection.
- Resource indicators (the `resource-indicators` feature): experimental in Keycloak. Without it Keycloak does not recognize the `resource` parameter that ChatGPT sends, so the audience comes from the mapper instead.

Accepted trade-off: everyone who adds a connector themselves uses the same client secret, and replacing it means entering it again. The secret only identifies the product, and each person still has to log in.

Whether this works with the real clients is not shown yet, see [Connector Test](known-limitations.md#connector-test).

## Scripts and Web Clients

REST accepts the same OAuth tokens as MCP, and there are no API tokens for now.

- Each script gets its own Keycloak client with a service account, and uses the client credentials grant.
- The service account is linked to a HippoWiki user like any other account, see [User Linking](#user-linking).

## User Linking

Keycloak accounts and HippoWiki users are connected only through `users.auth_subject`, which holds the `sub` claim of the Keycloak account, see [Tables and Entities](entities.md#user).

- An admin creates the account in Keycloak first, then creates the HippoWiki user with the ID of that account. The rules are in [Entity Rules](entity-rules.md#user-linking).
- Keycloak usernames and HippoWiki names are not compared, because a match by name would break when a username changes or is reused.
- A valid token with no linked user gets 401.

## AI Agents

An AI agent acts as the account it logged in with. There are no tokens with fewer rights than their user.

- A person can log a connector in with their own account, unless it is an admin account.
- An admin account can log in at Keycloak, but MCP then rejects it with 403, see [MCP](mcp.md#admin-accounts). A person who is an admin uses a separate account for connectors.
- A separate account, such as `alice-claude`, is a normal user: it gets its own folder rights, such as read-only, and shows up separately in the revision history.

## Token Check

`auth/tokens.py` verifies the token, and `auth/credentials.py` looks up the user. A request passes when all of this holds:

- The token is a Bearer JWT signed with an allowlisted asymmetric algorithm, currently only RS256. This rules out `alg=none` and a token signed with the public key as an HMAC secret.
- The signature matches a signing key of Keycloak, and the issuer equals `HIPPOWIKI_OAUTH_ISSUER`.
- The audience contains `HIPPOWIKI_OAUTH_AUDIENCE`, which also rejects an ID token issued for a client.
- The token has not expired. This compares the `exp` claim with the app host clock, which [Time](time.md) allows because nothing is persisted.
- A `sub` claim exists, and a user has this `auth_subject`.

Only `sub` is used. Rights are read from the database on every request, so a token carries no rights, and a revoked right takes effect on the next request.

Signing keys are cached in memory:

- An unknown `kid` causes one refetch from `HIPPOWIKI_OAUTH_JWKS_URL`, at a limited rate, so invalid tokens can not flood Keycloak.
- A key that is still unknown after the refetch gets 401.
- When a needed key can not be fetched, the lookup failed, and the answer is 503, see [Failed Credential Lookup](auth-middleware.md#failed-credential-lookup).
- A cached key keeps working while Keycloak is down, so existing access tokens work until they expire. New logins and token refreshes need Keycloak.

## Token Lifecycle

- Access tokens last 5 minutes.
- Refresh tokens rotate, and the `offline_access` scope keeps connectors logged in between sessions. The exact session lifetimes are set during the [Connector Test](known-limitations.md#connector-test).
- Keycloak stores and revokes refresh tokens and sessions. HippoWiki stores no tokens, so it needs no token hashing.
- Removing the link of a user blocks them on the next request. Disabling them only in Keycloak takes effect when their access token expires, so after up to 5 minutes.

## Root Admin Credential

- `hippowiki init` still creates the root admin unlinked, because it runs before anyone can log in.
- `hippowiki link-root-admin <subject>` sets the link. It is the only way to change this link, and it needs shell access to the server.
- A lost password is reset in the Keycloak console.
- Credential changes can not lock the root admin out for good: if its account is disabled, deleted or lost in Keycloak, the operator enables it or links another account with the same command.

## Login Protection and Audit

- Keycloak handles password hashing, so HippoWiki has no password code.
- The realm has brute-force detection and login events switched on, and self-registration and username editing switched off.
- HippoWiki logs changes of rights, of `is_admin` and of `auth_subject`, including `hippowiki link-root-admin`. Keycloak records the logins.
