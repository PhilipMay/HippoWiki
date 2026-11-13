# MCP Server and OAuth – Steps

## Goal

AI assistants read the wiki through the Model Context Protocol (MCP), acting as a user with that user's rights. Tools
that can send a header, such as Claude Code, Cursor and VS Code, use an API token; the connectors of claude.ai and
ChatGPT connect through OAuth: the user logs in, approves the connector on a consent page and can revoke it on
`/account` at any time.

## Scope

- In:
  - The optional setting `HIPPOWIKI_PUBLIC_URL`, the public address of the wiki; without it there is no OAuth
  - Login with a way back: the login, and the forced password change after it, return to the page that asked for it
  - The MCP endpoint `/mcp` with the official MCP SDK (`@modelcontextprotocol/server`, v2): stateless Streamable HTTP
    with JSON responses, no SSE
  - Read tools: list the folders, list the tabs and pages of a folder, read a page
  - `/mcp` accepts API tokens with the scope `read`, and OAuth access tokens once OAuth is on
  - HippoWiki as an OAuth 2.1 authorization server for public clients (PKCE `S256`, no client secrets):
    - Discovery: authorization server metadata (RFC 8414) and protected resource metadata (RFC 9728)
    - Clients by Client ID Metadata Document (CIMD), fetched safely, and by open dynamic client registration (DCR,
      RFC 7591) as fallback, limited to 20 registrations per client address group and hour
    - The authorization code flow with a consent page, `iss` in every authorization response (RFC 9207), and the
      `resource` parameter (RFC 8707) checked when it is sent
    - The token endpoint: code exchange and refresh with rotation; a refresh token used a second time revokes the
      grant
  - A grant is a row of `ApiToken`: listed and revoked on `/account`, counted in the limit of 20 tokens; a new grant
    replaces the user's older grants of the same client
  - Grants give only the scope `read`; their lifetime is 30, 90 or 365 days, chosen on the consent page
- Not in:
  - Write tools and the scope `write` for grants (they wait for page history and optimistic locking, see
    `roadmap.md`), and a search tool (it waits for full-text search)
  - Confidential clients, client secrets, `private_key_jwt`, the client credentials grant
  - OpenID Connect (ID tokens, `userinfo`, `/.well-known/openid-configuration`), JWT access tokens, JWKS
  - The token revocation and introspection endpoints, CORS, SSE and sessions of the MCP protocol
  - A grace period for a refresh token that is used again
  - An admin view of clients and grants; the admin revoking the grants of others
  - Remembered consent: every connect asks again
  - A consent page that works without JavaScript
  - Rate limits of MCP requests

## Checklist

- [x] Public URL and login with a way back
- [x] MCP endpoint with read tools
- [x] OAuth clients, codes and grants
- [x] Client ID Metadata Documents
- [ ] Discovery, registration and token endpoints
- [ ] Consent page
- [ ] Grants on `/account`
- [ ] Wrap-up

## Public URL and login with a way back

### Goal

The wiki knows its public address, and a login returns to the page that asked for it. Both are needed by the consent
page and the OAuth metadata.

### Build

- `HIPPOWIKI_PUBLIC_URL` in `src/lib/env.ts`: optional; an `https` URL, or `http` only for `localhost`, `127.0.0.1`
  and `[::1]`; no user name or password, no path other than `/`, no query and no fragment; any other value stops the
  server with a message. It is kept as the origin without a trailing slash. Unset means OAuth is off.
- `.env.example` (commented out, with an explanation), `README.md` and `playwright.config.ts`
  (`HIPPOWIKI_PUBLIC_URL=http://localhost:3100` for the test server).
- `src/proxy.ts`: a `GET` or `HEAD` without a session cookie goes to `/login?next=<path and query>`; other requests
  and Server Actions keep going to `/login` without `next`.
- A helper in `src/lib/addresses.ts` that accepts `next` only as a path on this site: it starts with exactly one `/`,
  does not start with `//` or `/\`, has no control characters and is at most 2048 characters long; anything else gives
  `/folders`. `loginPath(next?)` and `changePasswordPath(next?)` take it.
- The login page passes `next` to the login form as a hidden field; the login action checks it again and redirects
  there, or to the forced password change with `next`, which redirects there after the change. A logged-in user who
  opens `/login?next=…` is sent to `next`. `next` is not counted as an action or a view.

### Test

- Unit: the env schema (valid and invalid values of `HIPPOWIKI_PUBLIC_URL`, unset), the `next` helper with the cases
  of an open redirect (`//evil.example`, `/\evil.example`, `https://evil.example`, encoded variants, control
  characters, too long), the login action and the password change action with `next`, the proxy with and without
  `next`.
- End-to-end: the complete suite, because `src/proxy.ts` changes. New cases in `e2e/login.spec.ts`: a deep link
  opened without a login leads back to it after the login; a crafted `next` to another site leads to `/folders`; a
  user with the first password reaches the deep link after the password change (`e2e/change-password.spec.ts`).

## MCP endpoint with read tools

### Goal

An MCP client with an API token can list and read the wiki. This works without `HIPPOWIKI_PUBLIC_URL`.

### Build

- Add `@modelcontextprotocol/server` (latest stable v2). Check first that its web-standard transport runs in a
  Next.js route handler, stateless and with JSON responses. If it does not, stop and ask the user (scope change: the
  protocol would be written by hand).
- The handler of the SDK (`createMcpHandler`) answers clients of the protocol of 2025 as an SSE stream. The adapter
  therefore routes them itself (`isLegacyRequest()`) to a transport of the SDK with JSON responses, in front of a
  handler that serves only the current protocol, with JSON responses and no subscriptions.
- `src/features/mcp/`: the tools and the adapter between the route and the services; the route
  `src/app/mcp/route.ts` only hands the request to it. The adapter calls the services of the folders and pages, like
  `queries.ts` does for the GUI; it is the place where the actor comes from the bearer token instead of the session.
- Every request: `authenticateToken(headers, "read")`.
  - `missing-token` and `invalid-token` answer 401 with `WWW-Authenticate: Bearer`.
  - `insufficient-scope` answers 403 with `WWW-Authenticate` naming `error="insufficient_scope"` and `scope="read"`.
  - `failed` answers 500.
  - A request with an `Origin` header that is not the origin of the wiki is refused with 403 (against DNS
    rebinding). `GET` and `DELETE` answer 405.
- Tools, all read only, each with a Zod input schema and a description for the model:
  - `list_folders`: the folders with name, address and last change
  - `list_folder`: the tabs and pages of a folder, pages placed directly in the folder first, each with name, title,
    tab, address and last change
  - `read_page`: a page by folder, tab (optional) and page name: title, Markdown content, address, last change and
    last editor
  - An address is the path of the page; with `HIPPOWIKI_PUBLIC_URL` it is the full URL. Deleted pages are never
    listed or read. A missing folder or page is a tool error with a clear message, not a protocol error.
- The server `instructions` of `initialize` say in one paragraph how the wiki is organised (folders, tabs, pages).
- `src/proxy.ts`: `/mcp` is a public address (the route checks the token itself); `architecture.md` names the new
  exception.
- `src/features/services.test.ts` loads the MCP tools as well.

### Test

- Unit: the adapter (the status codes and headers of each token outcome, the `Origin` check, 405), each tool with a
  mocked service (found, missing, malformed names).
- End-to-end: the complete suite (proxy change). `e2e/mcp.spec.ts` with `request` and a token from
  `createApiToken()`: 401 without a token and with a bad one, 403 without the scope `read`, `initialize`,
  `tools/list` and every tool on pages created with `createPage()`, a deleted page that is not found.
- Manual: Claude Code with `claude mcp add --transport http` and an `Authorization: Bearer hw_…` header lists and
  reads pages; the MCP Inspector shows the tools.

## OAuth clients, codes and grants

### Goal

The rules of the authorization code flow, in a service that knows nothing about HTTP and is tested on its own.

### Build

- Prisma, with a migration:
  - `OAuthClient`: a registered client (DCR) or a client from a metadata document (CIMD, with its unique URL and
    the time it was fetched); name, redirect addresses, creation time.
  - `OAuthCode`: the hash of the code, client, user, redirect address, PKCE challenge, scopes, chosen lifetime,
    expiry; deleted with its client or user.
  - `ApiToken` gets a client (deleted with it), the hash of the current refresh token, the hash of the current access
    token (unique) and its expiry. `tokenHash` becomes optional; a check constraint in the migration requires either
    a `tokenHash` or a client.
  - New unique constraints get constants in `src/lib/db-errors.ts` and cases in `integration/db-errors.test.ts`.
- `src/features/oauth/`: `schema.ts` (the parameters, the error codes of RFC 6749), `secret.ts` (codes and tokens
  with the existing generator: access tokens `hwa_…`, refresh tokens `hwr_<grant id>.<secret>`; only SHA-256 hashes
  are stored, compared in constant time) and `service.ts`:
  - Register a client (DCR): 1 to 10 redirect addresses; each is `https`, `http` on a loopback address, or the own
    scheme of a native app, never `javascript`, `data`, `file` and the like, no fragment, at most 2048 characters. The
    name is trimmed and cut to 50 characters, "Connected app" when empty. The client is public, whatever it asked for.
  - Check an authorization request: the client must exist and the redirect address must be one of its own (exact
    match; for `http` on a loopback address the port is ignored, because native clients pick a free port). If either
    is wrong, the answer must not redirect. Otherwise the errors go back to the client: `response_type` must be
    `code`, PKCE must be `S256` with a valid challenge, a `resource` that is sent must be the `/mcp` address. Unknown
    scopes are ignored; the grant is always `read`.
  - Create a code for an approved request: valid 10 minutes.
  - Exchange a code: the code is deleted as it is read, so it works once, also when two exchanges race, and a failed
    check uses it up. Client, redirect address and PKCE verifier must match. The user must not have the first
    password. In one transaction the grant is created (an `ApiToken` row named after the client, scope `read`, expiry
    after the chosen lifetime) and the user's older grants of the same client are deleted: the same client row, or
    for a registered client the same name and the same redirect addresses. The limit of 20 tokens counts the new
    grant without the replaced ones.
  - Refresh: the refresh token names its grant; a secret that is not the current one revokes the grant (logged as a
    warning with the grant id). The swap of the hashes is conditional, so two refreshes at the same time cannot both
    succeed; the one that loses is refused without revoking the grant, because it showed the token that was current
    when it was read. A grant past its expiry or of a user with the first password is refused. Each refresh gives a new access
    token (1 hour) and a new refresh token; the previous access token stops working.
  - Clean up on write, since there is no job scheduler: expired codes, and clients older than 24 hours that no grant
    and no code names, when a client is registered or a code is created.
- `authenticateToken()` gets an option to accept OAuth access tokens, off by default, so that only `/mcp` accepts them;
  an access token is looked up by its hash and refused when it or its grant has expired.
- `src/features/services.test.ts` loads the OAuth service.

### Test

- Unit: `schema.ts` and the redirect address rules (all schemes, loopback ports, fragments, lengths), PKCE, the error
  codes, what is logged (never a code, token or hash).
- Integration (`integration/oauth-service.test.ts`, clock set with fake timers): registration, the checks of an
  authorization request, one-time codes also under `Promise.all`, expiry of codes, access tokens and grants, refresh
  rotation, reuse revoking the grant, two refreshes at the same time, replacement of older grants of the same client
  and not of other clients or users, the limit, deletion with client and user, the clean-up, `authenticateToken()`
  with and without the option.

## Client ID Metadata Documents

### Goal

claude.ai, ChatGPT and Claude Code identify themselves by the URL of their metadata document instead of registering.

### Build

- A `client_id` that is an `https` URL with a path is a CIMD client. The service fetches the document and keeps it
  as an `OAuthClient` row; the row is fetched again when it is older than the cache time of the response
  (`Cache-Control: max-age`, at least 5 minutes, at most 24 hours, 1 hour without one).
- The fetch, in a module of its own that the tests can replace:
  - `https` only, port 443 only, no redirects followed, no credentials in the URL
  - the host is resolved first and refused when any address is loopback, private, link-local, unique-local,
    multicast or otherwise not public; the connection uses the checked address, so DNS rebinding cannot change it
  - a timeout of 5 seconds and at most 10 KB of response body; only `application/json`
- The document must be JSON with `client_id` exactly equal to its URL, a `client_name` and `redirect_uris`, and must
  not ask for anything but a public client (`token_endpoint_auth_method` `none` or missing). The redirect addresses
  follow the rules of registered clients.
- A failed fetch or an invalid document refuses the authorization request without a redirect; the reason is logged
  with the URL.

### Test

- Unit: the address checks (IPv4 and IPv6 ranges, IPv4-mapped IPv6), the document checks, the cache time.
- Integration: an authorization request with a CIMD client, with the fetch replaced: first fetch, cached row, fetch
  again after the cache time, invalid document, failed fetch.

## Discovery, registration and token endpoints

### Goal

A connector finds the authorization server from a 401 of `/mcp`, registers if it has to and exchanges codes for
tokens.

### Build

- Route handlers, each answering 404 while `HIPPOWIKI_PUBLIC_URL` is not set; they call an adapter in
  `src/features/oauth/`:
  - `src/app/.well-known/oauth-authorization-server/route.ts`: `issuer` is exactly `HIPPOWIKI_PUBLIC_URL`; the
    authorization, token and registration endpoints under `/oauth/`; `response_types_supported` `code`;
    `grant_types_supported` `authorization_code` and `refresh_token`; `code_challenge_methods_supported` `S256`;
    `token_endpoint_auth_methods_supported` `none`; `scopes_supported` `read` (not `offline_access`);
    `client_id_metadata_document_supported` and `authorization_response_iss_parameter_supported` `true`.
  - `src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts`: for `/` and `/mcp`; `resource` is the `/mcp`
    address, `authorization_servers` only the issuer, `scopes_supported` `read`, `bearer_methods_supported`
    `header`.
  - `src/app/oauth/register/route.ts`: DCR, JSON in, 201 with the client as RFC 7591 describes it, as a public client.
    Limited to 20 registrations per client address group and hour (a table like `LoginWindow`); over the limit 429
    with `Retry-After`. The group comes from `clientAddressGroup()` and `HIPPOWIKI_TRUSTED_PROXIES`.
  - `src/app/oauth/token/route.ts`: `application/x-www-form-urlencoded`, and JSON as well; `authorization_code` and
    `refresh_token`; errors in the shape of RFC 6749 with status 400 (`invalid_client` 401).
  - Every answer of the register and token endpoints has `Cache-Control: no-store`.
- `/mcp` with OAuth on: its 401 adds `resource_metadata="<public URL>/.well-known/oauth-protected-resource/mcp"` and
  `scope="read"`, and it accepts OAuth access tokens.
- `src/proxy.ts`: the two `/.well-known/` addresses, `/oauth/register` and `/oauth/token` are public;
  `/oauth/authorize` is not. `architecture.md` names the exceptions, including the second reader of forwarding
  headers.

### Test

- Unit: each adapter with a mocked service: 404 without the public URL, the metadata fields, the status codes, the
  error shape, `no-store`, the rate limit answer.
- Integration: the registration limit per group and hour, also for registrations at the same time.
- End-to-end: the complete suite (proxy change). `e2e/oauth.spec.ts` with `request`: the metadata documents, the 401
  of `/mcp` with `resource_metadata`, a registration, refused registrations, refused token requests.

## Consent page

### Goal

A logged-in user approves or denies a connector, and the connector receives a code.

### Build

- `src/app/oauth/authorize/page.tsx`, behind the login: `requireUser()` first, so a user without a session comes back
  here after the login with the whole query. It checks the request with the service:
  - client or redirect address wrong: a page with the reason, no redirect
  - other errors: redirect to the client with `error`, `error_description`, `state` and `iss`
  - valid: the client's name, the host of its redirect address shown more prominently than the name (the name is
    chosen by the client), the logged-in user, what `read` allows, the lifetime (30, 90 or 365 days, 90 chosen), and
    Approve and Deny
  - the limit of 20 tokens already reached (not counting grants this one would replace): a message to revoke a token
    first, and no Approve
- `architecture.md`: the OAuth parameters are an exception to the rule that an address carries only `action` and
  `view`.
- Server Actions in `src/features/oauth/actions.ts`: both check the request again from the submitted values. Approve
  creates the code and redirects to the client with `code`, `state` and `iss`; Deny redirects with `access_denied`.
- The redirect to the connector works only with JavaScript, because `form-action 'self'` stays; without JavaScript
  the page says that it needs JavaScript.
- `e2e/hydration.spec.ts` gets a case for the new form.

### Test

- Unit: the actions (approve, deny, request no longer valid, limit), the page's decisions with a mocked service.
- End-to-end: `e2e/oauth.spec.ts`, the whole flow with a client registered by DCR whose redirect address is on a
  loopback address and intercepted with `page.route()`: logged out → login → consent → approve → code → token →
  `/mcp` `tools/call` with the access token → refresh → the old refresh token revokes the grant. Also: deny, a wrong
  redirect address (no redirect), a user with the first password, the limit reached, connecting the same client
  again replaces the grant.

## Grants on `/account`

### Goal

The user sees the connected apps among the tokens and can revoke them.

### Build

- The token list marks a grant as a connected app, with the client's name, its scopes, expiry and last use; there is
  no token to show for it. Revoking works as for every token and ends the access token and the refresh token at once.
- `TokenSummary` says whether a token is a grant.

### Test

- Unit: the list component and the service read with grants.
- End-to-end: `e2e/account.spec.ts`: a grant created through the flow is listed as a connected app; revoking it makes
  `/mcp` answer 401 for its access token and the token endpoint refuse its refresh token.
- Manual (by the user), on a public HTTPS deployment, after the open checks of "Things to Check" in `roadmap.md`
  and only then with `HIPPOWIKI_PUBLIC_URL` set: add the wiki as a custom connector in claude.ai and in ChatGPT,
  approve, list and read pages, revoke on `/account`; Claude Code with OAuth (`claude mcp add --transport http` without
  a header).

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/mcp.md` (the endpoint, the tools, the tokens it accepts) and `spec/oauth.md`
   (clients, codes, grants, consent, refresh, decisions such as the strict refresh rule and the grace period that was
   left out, limits). Extend `api-tokens.md` (grants, the option of `authenticateToken()`, "no OAuth" leaves
   "Current limits"), `users-and-login.md` (the way back after a login; "no HTTP API" leaves "Current limits"),
   `container-image.md` (`HIPPOWIKI_PUBLIC_URL`, the open deployment checks before it is set, reachable over HTTPS
   from the internet for the connectors), `architecture.md` (the new public addresses, the adapters of `/mcp` and the
   OAuth endpoints, the exceptions to the address rule and to the readers of forwarding headers), `testing.md` (the
   replaced fetch of metadata documents, the new specs) and `tech.md` (the MCP SDK).
2. Remove "OAuth for clients" from `roadmap.md`; change the entry "MCP server" to the MCP write tools (after page
   history and optimistic locking) and a search tool (after full-text search).
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file.

### Test

- The commands in "When a step is done" in `spec/workflow.md` pass.
