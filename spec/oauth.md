# HippoWiki – OAuth for MCP Clients

OAuth as built: HippoWiki is an OAuth 2.1 authorization server for the MCP server (see `mcp.md`), so that a connector,
such as the ones of claude.ai and ChatGPT, gets access to the wiki on behalf of a user without ever seeing a
password or an API token. The user logs in, approves the connector on a consent page and can revoke it on `/account`
at any time. All clients are public: none has a secret, and each proves itself with PKCE.

Code: `src/features/oauth/` (`schema.ts` with the rules, `secret.ts` for codes and tokens, `service.ts` with the code
flow, `issuer.ts`, `public-address.ts` and `metadata-fetch.ts` for the metadata documents of clients, `http.ts` with
the adapters of the public endpoints, `queries.ts`, `actions.ts`, `forms.ts` and `components/` for the consent page),
the routes under `src/app/.well-known/` and `src/app/oauth/`, and the exceptions for them in `src/proxy.ts`. The
models are `OAuthClient`, `OAuthCode`, `OAuthRegistrationWindow` and the grant columns of `ApiToken` in
`prisma/schema.prisma`.

Tests: `e2e/oauth.spec.ts`, `e2e/account.spec.ts`, `integration/oauth-service.test.ts`,
`integration/oauth-metadata.test.ts`, and the unit tests next to the code, such as
`src/features/oauth/service.test.ts` and `src/features/oauth/metadata-fetch.test.ts`. The helpers of the end-to-end
tests are in `e2e/support/oauth.ts`.

## Switching it on

- OAuth is on when `HIPPOWIKI_PUBLIC_URL` is set, the public address of the wiki (see "Configuration" in
  `container-image.md`). The issuer of the authorization server is exactly that address.
- Without the variable every endpoint of OAuth answers 404, the consent page is not found, and `/mcp` accepts only
  API tokens.

## Discovery

- A connector starts at the 401 of `/mcp`, whose `WWW-Authenticate` header names the metadata of the protected
  resource.
- `/.well-known/oauth-protected-resource` and the same address followed by `/mcp` (RFC 9728) name the address of
  `/mcp` as the resource and the wiki as its only authorization server.
- `/.well-known/oauth-authorization-server` (RFC 8414) names the issuer, the endpoints under `/oauth/`, the response
  type `code`, the grant types `authorization_code` and `refresh_token`, PKCE with `S256`, public clients only
  (`none`), the scope `read`, and that client id metadata documents and the `iss` parameter are supported.
- Both are public and need no token.

## Clients

A client identifies itself in one of two ways:

- By the URL of its metadata document (Client ID Metadata Document), which is its `client_id`: an `https` URL with a
  path, on port 443, without user name, password or fragment, written the way a URL parser writes it.
  - The document must be JSON with a `client_id` that is exactly its URL, a `client_name` and `redirect_uris`, and
    must not ask for anything but a public client.
  - The document is kept and fetched again when it is older than the cache time of its response: its
    `Cache-Control: max-age`, but at least 5 minutes and at most 24 hours, and 1 hour without one.
  - A fetch that fails and a document that is not valid refuse the authorization request without a redirect; the
    reason is logged with the URL. A document that was kept before stays, and so do its grants.
- By registering (dynamic client registration, RFC 7591) at `/oauth/register`, which answers with a generated
  `client_id`. Anyone can register without a login. Whatever a client asks for, it is registered as a public client.
  - At most 20 clients are registered per client address group and hour; a further registration answers 429 with
    `Retry-After`. The group comes from `clientAddressGroup()` and `HIPPOWIKI_TRUSTED_PROXIES`, as for the logins
    (see "Failed logins" in `users-and-login.md`); with `0` all registrations are in one group.
  - A client that no grant and no code names is deleted a day after it was created.

What holds for both:

- A client has 1 to 10 redirect addresses of at most 2048 characters each. A redirect address is `https`, `http` on
  a loopback address, or the own scheme of a native app; never `javascript`, `data`, `file` and the like, and it has
  no fragment and no user name or password.
- The name of a client is trimmed and cut to 50 characters; a registered client without a name is called
  "Connected app". The name is chosen by the client and proves nothing.

The fetch of a metadata document must not be a way to make the server ask an address of its own network:

- `https` only, port 443 only, no redirects followed, no credentials in the URL.
- The host is resolved first and refused when any of its addresses is loopback, private, link-local, unique-local,
  multicast or otherwise not public. The connection then goes to the address that was checked, so a host name that
  resolves to another address a moment later cannot change it.
- A timeout of 5 seconds for everything, at most 10 KB of response body, and only `application/json`.

## The authorization request and the consent page

- `/oauth/authorize` is the consent page. It is behind the login: a user without a session logs in first, changes
  the first password if it is still pending, and comes back with the whole request (see "The way back after a login"
  in `users-and-login.md`).
- If the client is unknown or the redirect address is not one of its own, the page says so and sends the browser
  nowhere. A redirect address must be the same text as one of the client's; only for `http` on a loopback address
  the port is ignored, because a native client listens on whatever port is free.
- Every other error goes back to the client at its redirect address: `response_type` must be `code`, PKCE must be
  `S256` with a valid challenge, and a `resource` that is sent must be the address of `/mcp` (RFC 8707). Scopes are
  not checked: unknown ones are ignored, and the grant is always `read`.
- A valid request shows the host of the redirect address more prominently than the name of the client, the
  logged-in user, what `read` allows, and the lifetime of the grant: 30, 90 or 365 days, with 90 chosen.
- "Approve" sends the client a code; "Deny" sends it `access_denied`. Both check the request again from the
  submitted values. Every answer to the client carries its `state` and `iss`, the issuer (RFC 9207).
- Every connect asks again; no consent is remembered.
- A user who already holds 20 tokens, not counting the grants this one would replace, is asked to revoke a token
  first and cannot approve.
- The page needs JavaScript to send the answer to the client, because the Content Security Policy keeps forms on
  this site (`form-action 'self'`, see "Security headers" in `architecture.md`). Without JavaScript it says so.

## Codes

- A code works once and for 10 minutes. It is deleted as it is read, so it also works only once when two exchanges
  arrive at the same time, and an exchange that fails a check uses it up.
- The exchange at `/oauth/token` must name the client and the redirect address of the authorization request and
  show the PKCE verifier of its challenge.
- A user who still has the first password gets no grant.

## Grants

- A grant is what a code is exchanged for: a row of `ApiToken` with a client, named after the client, with the
  scope `read` and the lifetime the user chose. It is listed on `/account` as a connected app, counted in the limit
  of 20 tokens per user and revoked like every other token (see `api-tokens.md`).
- A new grant replaces the user's older grants to the same client: the same client row, or for a registered client
  the same name and the same redirect addresses, because some connectors register again on every connect. The
  limit counts the new grant without the replaced ones.
- The client holds an access token that works for 1 hour, and never longer than its grant, and a refresh token.
  Only `/mcp` accepts the access token.
- Revoking the grant, deleting its user or deleting its client ends both tokens at once.
- A grant past its lifetime cannot be refreshed; it stays in the list, marked as expired, until it is revoked.

## Refresh

- A refresh at `/oauth/token` gives a new access token and a new refresh token. The previous access token and the
  previous refresh token stop working at once.
- A refresh token that is used a second time revokes the grant: the client used it twice or someone stole it, and
  nobody can tell which. The user connects again. The revocation is logged as a warning with the id of the grant.
- Of two refreshes at the same time only one succeeds. The other is refused, and the grant stays.
- A refresh by another client, of a grant past its lifetime and of a user who still has the first password is
  refused without revoking the grant.

## The token endpoint

- `/oauth/token` takes `application/x-www-form-urlencoded`, as RFC 6749 asks, and JSON, with the grant types
  `authorization_code` and `refresh_token`.
- Errors have the shape of RFC 6749, with status 400; a request that names no client answers `invalid_client` with 401. A client that is not the one of the code or of the grant is `invalid_grant`.
- Every answer of the token endpoint and of the registration has `Cache-Control: no-store`.

## Secrets

- A code, an access token and a refresh token are 256 random bits behind a prefix of their own (`hwc_`, `hwa_`,
  `hwr_`), so that none is taken for another or for an API token (`hw_`). A refresh token also names its grant.
- Only their SHA-256 hashes are stored. A code, a token and their hashes are never logged.

## Routes

- `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` and what follows it,
  `/oauth/register` and `/oauth/token`: public, because a client calls them before it has a token.
- `/oauth/authorize`: the consent page, for a logged-in user only. Its search parameters are the parameters of the
  authorization request; it has no actions and no views.

## Decisions

- A grant is a row of `ApiToken` and not a table of its own, so that the user sees and revokes everything that acts
  for them in one list, and one limit covers both.
- Access tokens are random values that are looked up by their hash, not signed tokens (JWT): revoking a grant ends
  its access token at once, and there are no keys to manage or to publish.
- The refresh rule is strict, without a grace period for a refresh token that is used again: a grace period is a
  time in which a stolen token works. The price is that a client which loses the answer to a refresh has to be
  connected again.
- A refresh that loses the conditional swap of the hashes is refused without revoking the grant: it showed the
  token that was current when it was read, so it is not a reuse.
- A code is deleted before it is checked, so that a failed check cannot be repeated with other values.
- Clients are public only. A connector that runs on the machine of a user or in the cloud of a provider cannot keep
  a secret of this wiki in a way the wiki could check, and PKCE protects the code without one.
- Both ways to identify a client are supported: claude.ai, ChatGPT and Claude Code identify themselves by the URL of
  their metadata document, and the registration is the fallback for clients that do not.
- The registration is open, because a connector registers before any user is involved. The limit per client address
  group and the deletion of unused clients keep the table small.
- The consent page shows where the code goes, the host of the redirect address, more prominently than the name of
  the client: the address is what was checked, the name is whatever the client calls itself.
- The actions of the consent page return the address of the client, and the form opens it, instead of redirecting:
  Next.js passes the address of a redirect to another site in a header that it splits at `;`, which a redirect
  address may contain.
- The metadata fetch is a module of its own (`src/features/oauth/metadata-fetch.ts`), so that the tests of the
  service can replace it and its own tests can stand in for the network.
- `offline_access` is not among the scopes: every grant can be refreshed until it ends.

## Current limits

- only the scope `read`; no `write` for grants, which waits for the write tools of the MCP server (see `roadmap.md`)
- public clients only: no client secrets, no `private_key_jwt`, no client credentials grant
- no OpenID Connect: no ID tokens, no `userinfo`, no `/.well-known/openid-configuration`
- no JWT access tokens and no JWKS
- no token revocation and no introspection endpoint; a user revokes a grant on `/account`
- no CORS: a client that runs in a browser on another origin cannot call the endpoints
- no grace period for a refresh token that is used again
- no remembered consent: every connect asks again
- the consent page does not work without JavaScript
- no admin view of clients and grants, and the admin cannot revoke the grants of other users
- no limit on token requests; the registration is the only endpoint with one
- a way back after the login is kept only for an address of up to 2048 characters; a longer authorization request
  leads to the folders after the login
- the checks on a public deployment are still to come (see "Things to Check" in `roadmap.md`)
