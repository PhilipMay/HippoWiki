# HippoWiki – OAuth for MCP Clients

OAuth as built: HippoWiki is an OAuth 2.1 authorization server for the MCP server (see `mcp.md`), so that a connector,
such as the ones of claude.ai and ChatGPT, gets access to one MCP address of a folder on behalf of a user without ever
seeing a password. The user logs in, approves the connector for the folder and the role of that address on a consent
page and can revoke it on `/account` at any time. There are no scopes: the address says what a connection may do. Only accounts of the type user connect apps; an admin is refused. All clients are public: none has a secret, and each proves itself with PKCE.

Code: `src/features/oauth/` (`schema.ts` with the rules, `secret.ts` for codes and tokens, `service.ts` with the code
flow, `issuer.ts`, `public-address.ts` and `metadata-fetch.ts` for the metadata documents of clients, `http.ts` with
the adapters of the public endpoints, `queries.ts`, `actions.ts`, `forms.ts` and `components/` for the consent page),
the routes under `src/app/.well-known/` and `src/app/oauth/`, and the exceptions for them in `src/proxy.ts`. The
models are `OAuthClient`, `OAuthCode`, `OAuthRegistrationWindow` and `OAuthGrant` in `prisma/schema.prisma`.

Tests: `e2e/oauth.spec.ts`, `e2e/account.spec.ts`, `integration/oauth-service.test.ts`,
`integration/oauth-metadata.test.ts`, and the unit tests next to the code, such as
`src/features/oauth/service.test.ts` and `src/features/oauth/metadata-fetch.test.ts`. The helpers of the end-to-end
tests are in `e2e/support/oauth.ts`.

## Switching it on

- OAuth is on when `HIPPOWIKI_PUBLIC_URL` is set, the public address of the wiki (see "Configuration" in
  `container-image.md`). The issuer of the authorization server is exactly that address.
- Without the variable every endpoint of OAuth answers 404, the consent page is not found, and every address below
  `/mcp` answers 404 as well: there is no MCP server without OAuth (see `mcp.md`).

## Discovery

- A connector starts at the 401 of a folder address, whose `WWW-Authenticate` header names the metadata of the
  protected resource at that address.
- `/.well-known/oauth-protected-resource/mcp/<folder-uuid>/<reader|writer>` (RFC 9728) names the full folder address
  as the resource and the wiki as its only authorization server, for every folder address, whether a folder of that id
  exists or not. `/.well-known/oauth-protected-resource` alone, the one followed by `/mcp` and every other path answer
  404, because there is no resource at `/mcp`.
- `/.well-known/oauth-authorization-server` (RFC 8414) names the issuer, the endpoints under `/oauth/`, the response
  type `code`, the grant types `authorization_code` and `refresh_token`, PKCE with `S256`, public clients only
  (`none`), and that client id metadata documents and the `iss` parameter are supported.
- Neither lists scopes. Both are public and need no token.

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
- Every other error is shown on the page with a link "Return to <host>", which carries the error to the redirect
  address of the client; the browser goes there only when the user clicks the link. These checks are, in this order:
  `response_type` must be `code`; PKCE must be `S256` with a valid challenge; `resource` (RFC 8707) must be exactly
  the full MCP address of a folder, `<HIPPOWIKI_PUBLIC_URL>/mcp/<folder-uuid>/<reader|writer>`, otherwise
  `invalid_target` (a missing `resource`, the plain `/mcp`, the roles Owner and Manager and anything else); then the
  admin refusal (below); then the folder must exist and the user's current role on it must include the role of the
  address. A missing folder, a folder without a role of the user and a role too low are refused alike, with
  `access_denied` and one message that no app can be connected to this address, so that the page tells nothing about
  which folders exist.
- A `scope` that a client sends is ignored and not carried by the consent form.
- A valid request shows the host of the redirect address more prominently than the name of the client, the
  logged-in user, the name of the folder and the role of the address, what that role allows through MCP, and the
  lifetime of the grant: 30, 90 or 365 days, with 90 chosen.
- "Approve" sends the client a code; "Deny" sends it `access_denied`. Both check the request again from the
  submitted values. Every answer to the client carries its `state` and `iss`, the issuer (RFC 9207).
- Every connect asks again; no consent is remembered.
- An admin connects no apps (see "No apps for admins" in `connected-apps.md`). For an otherwise valid request the page
  tells an admin that admin accounts cannot connect apps, instead of the consent form, with the link "Return to
  <host>" that carries `access_denied`, `state` and `iss` to the client, like the other errors of the page. No code
  and no grant is created: the service refuses a code for an admin as well. An unknown client or a foreign redirect
  address is answered as for every user, without sending the browser anywhere.
- A user who already holds 50 connected apps, not counting the grants this one would replace, is asked to revoke an app
  first and cannot approve.
- "Approve" and "Deny" need JavaScript to send the answer to the client, because the Content Security Policy keeps
  forms on this site (`form-action 'self'`, see "Security headers" in `architecture.md`). Without JavaScript the page
  says so. The link back of a refused request is a plain link and works without JavaScript.

## Codes

- A code works once and for 10 minutes. It is deleted as it is read, so it also works only once when two exchanges
  arrive at the same time, and an exchange that fails a check uses it up.
- A code keeps the folder and the role of the address of its request.
- The exchange at `/oauth/token` must name the client and the redirect address of the authorization request and
  show the PKCE verifier of its challenge. A `resource` that is sent must be the address of the code; another one is
  `invalid_target`.
- A user who still has the first password gets no grant.

## Grants

- A grant is what a code is exchanged for: a row of `OAuthGrant`, named after the client, with the folder and the role
  of the address of the code and the lifetime the user chose. It is listed on `/account` as a connected app, counted
  in the limit of 50 connected apps per user and revoked there (see `connected-apps.md`).
- A new grant replaces only the user's older grants to the same client at the same address: the same client row, or
  for a registered client the same name and the same redirect addresses, because some connectors register again on
  every connect. The grants of that client at other addresses stay. The limit counts the new grant without the
  replaced ones.
- The client holds an access token that works for 1 hour, and never longer than its grant, and a refresh token.
  Only the MCP address of the grant accepts the access token.
- Revoking the grant, deleting its user, its client or its folder ends both tokens at once.
- A grant past its lifetime cannot be refreshed; it stays in the list, marked as expired, until it is revoked.

## Refresh

- A refresh at `/oauth/token` gives a new access token and a new refresh token. The previous access token and the
  previous refresh token stop working at once.
- A refresh token that is used a second time revokes the grant: the client used it twice or someone stole it, and
  nobody can tell which. The user connects again. The revocation is logged as a warning with the id of the grant.
- Of two refreshes at the same time only one succeeds. The other is refused, and the grant stays.
- A refresh by another client, of a grant past its lifetime and of a user who still has the first password is
  refused without revoking the grant, and so is one whose `resource` is not the address of the grant
  (`invalid_target`).
- A refresh does not check the user's role on the folder; the MCP server checks it on every request (see `mcp.md`).

## The token endpoint

- `/oauth/token` takes `application/x-www-form-urlencoded`, as RFC 6749 asks, and JSON, with the grant types
  `authorization_code` and `refresh_token`.
- Errors have the shape of RFC 6749, with status 400; a request that names no client answers `invalid_client` with 401. A client that is not the one of the code or of the grant is `invalid_grant`.
- Every answer of the token endpoint and of the registration has `Cache-Control: no-store`.

## Secrets

- A code, an access token and a refresh token are 256 random bits behind a prefix of their own (`hwc_`, `hwa_`,
  `hwr_`), so that none is taken for another. A refresh token also names its grant.
- Only their SHA-256 hashes are stored. A code, a token and their hashes are never logged.

## Routes

- `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` and what follows it,
  `/oauth/register` and `/oauth/token`: public, because a client calls them before it has a token.
- `/oauth/authorize`: the consent page, for a logged-in user only. Its search parameters are the parameters of the
  authorization request; it has no actions and no views.

## Decisions

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
- A request that fails a check after the client and the redirect address does not send the browser to the client by
  itself, but shows the error and a link back: the registration is open and a metadata document can be at any public
  address, so the redirect address is chosen by whoever sends the link. Going there without a click, right after a
  real login on the wiki, would make the wiki an open redirect for phishing. RFC 9700 section 4.11.2 allows informing
  the user instead, and the MCP specification asks the authorization server to prevent open redirects. "Deny" is a
  click of the user and answers the client at once.
- The actions of the consent page return the address of the client, and the form opens it, instead of redirecting:
  Next.js passes the address of a redirect to another site in a header that it splits at `;`, which a redirect
  address may contain.
- The metadata fetch is a module of its own (`src/features/oauth/metadata-fetch.ts`), so that the tests of the
  service can replace it and its own tests can stand in for the network.
- There are no scopes: the address of the grant says what a connection may do, and every grant can be refreshed until
  it ends. Rejected: scopes next to the address, which could say something else than the address.
- An authorization request without `resource` is refused, so that every grant knows its address; the MCP
  specification asks clients to send it. Rejected: picking a folder and a role on the consent page.
- A new grant replaces only the older grants of the same app at the same address, so that reconnecting does not pile
  up entries while connections to other addresses stay. Rejected: never replacing.
- The limit of connected apps is 50, because a user holds one connection per folder, role and app. Rejected: 20.
- The grants and codes that named the plain `/mcp` before the folder addresses were removed by the migration that
  brought the folder addresses, because none of them names a folder; their users connect again. Rejected: keeping them
  on `/account`, marked as no longer usable.
- Deleting a folder deletes its grants and codes, like those of a user and of a client: a grant is no content.
- The consent page tells an admin why no app can be connected and leads back to the app with a refusal, so that the
  connector does not wait for an answer that never comes. Rejected: the not-found page.

## Current limits

- public clients only: no client secrets, no `private_key_jwt`, no client credentials grant
- no OpenID Connect: no ID tokens, no `userinfo`, no `/.well-known/openid-configuration`
- no JWT access tokens and no JWKS
- no token revocation and no introspection endpoint; a user revokes a grant on `/account`
- no CORS: a client that runs in a browser on another origin cannot call the endpoints
- no grace period for a refresh token that is used again
- no remembered consent: every connect asks again
- the consent page does not work without JavaScript
- no admin view of clients and grants, and an admin cannot revoke the grants of users
- no limit on token requests; the registration is the only endpoint with one
- a way back after the login is kept only for an address of up to 2048 characters; a longer authorization request
  leads to the folders after the login
- the checks on a public deployment are still to come (see "Things to Check" in `roadmap.md`)
