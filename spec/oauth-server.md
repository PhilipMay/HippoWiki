# OAuth Server

This document defines the authorization server inside HippoWiki: its routes, clients, login page, tokens and login
protection. How a token is checked on a request is in [Authentication](authentication.md), how products, people and
scripts connect is in [Connectors](connectors.md), and accounts are in [Users](users.md).

Whether this works with the real clients is not shown yet, see [Connector Test](roadmap.md#connector-test).

## Why It Is Built In

- The server is one small part of the app, so HippoWiki runs as one service with one database, and has no second service
  to install, configure, back up and upgrade.
- It implements only what the [named clients](#what-the-clients-need) use, so most of OAuth stays out.
- No library is used for the protocol. These were checked on 3 November 2026:
  - Authlib has server integrations for Flask and Django only, its grant and storage calls are synchronous while the
    repositories are async, and its documentation lists neither RFC 8707 nor Client ID Metadata Documents.
  - oauthlib has no Starlette or FastAPI integration, and calls its own documentation sparse.
  - The MCP SDK describes itself as a resource server, and calls its embedded `auth_server_provider` option legacy, not
    for new servers.
- Tested building blocks do the rest, see [Tech Stack](tech-stack.md): `argon2-cffi` for passwords, `secrets` and
  `hashlib` for tokens, `httpx` to fetch client documents, and Jinja2 with autoescaping for the login page.

Accepted trade-off: this is security-critical code that HippoWiki owns, including login protection. It gets an
independent [security review](roadmap.md#next-steps) before production.

## What the Clients Need

Client ID Metadata Documents (CIMD) let a client use the URL of a document as its `client_id`, so nobody has to create a
client or enter a secret. These values come from the live documents and the vendor pages listed under
[Sources](#sources).

| Client      | `client_id`                                           | Redirect URI                                             | Token endpoint auth         |
| ----------- | ----------------------------------------------------- | -------------------------------------------------------- | --------------------------- |
| Claude      | `https://claude.ai/oauth/mcp-oauth-client-metadata`   | `https://claude.ai/api/mcp/auth_callback`                | `none`                      |
| Claude Code | `https://claude.ai/oauth/claude-code-client-metadata` | `http://localhost/callback`, `http://127.0.0.1/callback` | `none`                      |
| ChatGPT     | `https://chatgpt.com/oauth/client.json`               | `https://chatgpt.com/connector_platform_oauth_redirect`  | `none` or `private_key_jwt` |

- Claude uses CIMD only when the metadata has `client_id_metadata_document_supported: true` and `none` in
  `token_endpoint_auth_methods_supported`.
- Claude Code uses any port on its redirect URIs, so a port is ignored when comparing them.
- ChatGPT uses the `client_id` and redirect URI above only when the server meets its RFC 9207 requirements. Otherwise
  both contain a callback ID.
- ChatGPT must be sent only a method both sides support. The server advertises `none` and not `private_key_jwt`, so
  ChatGPT runs as a public client, and the server needs no client assertions.
- ChatGPT Enterprise is documented as needing the `openid` and `email` scopes and a UserInfo endpoint with a verified
  email. HippoWiki has neither, see [Open Risks](#open-risks).

## Settings

- `HIPPOWIKI_PUBLIC_URL` is the public URL of the app, without a trailing slash, such as `https://wiki.example.org`. The
  issuer is exactly this value, and the MCP URL is this value plus `/mcp`.
- `HIPPOWIKI_OAUTH_TRUSTED_CLIENT_URLS` is the [allowlist](#trusted-clients), a JSON list with the three URLs above as
  its default.
- Every URL in a response is built from these settings and never from the `Host` header.

## Routes

These are [public routes](authentication.md#public-routes), each with an exact path and method. The login page and the
token endpoint are not part of REST, so they have no `/api/v1` prefix and do not use problem+json.

| Route                                         | Purpose                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata, built from the settings, with no database access    |
| `GET /oauth/authorize`                        | shows the login page                                                   |
| `POST /oauth/authorize`                       | submits the login page                                                 |
| `POST /oauth/token`                           | authorization code, refresh token and client credentials grants        |
| `POST /oauth/revoke`                          | RFC 7009 revocation, with the client authentication of the token route |

The `POST` routes read their own body, because the middleware never reads the body of a public route.

- The reader stops at the [form limit](limits.md#oauth-values), so an anonymous client can not make the app hold a large
  body in memory.
- Only `application/x-www-form-urlencoded` is accepted.
- A repeated parameter is rejected, as RFC 6749 asks for.

### Metadata

The metadata holds:

- `issuer`, `authorization_endpoint`, `token_endpoint` and `revocation_endpoint`
- `response_types_supported`: `["code"]`
- `grant_types_supported`: `["authorization_code", "refresh_token", "client_credentials"]`
- `code_challenge_methods_supported`: `["S256"]`
- `token_endpoint_auth_methods_supported`: `["none", "client_secret_basic"]`
- `client_id_metadata_document_supported`: `true`
- `authorization_response_iss_parameter_supported`: `true`
- `scopes_supported`: `["offline_access"]`

It has no `registration_endpoint`, see [Clients](#clients). The
[protected resource metadata](authentication.md#public-routes) lists the issuer in `authorization_servers`.

## Clients

There are two kinds of client, and no others. Dynamic client registration is not offered: the MCP specification
deprecates it, it would let anyone on the internet create clients, and Claude would register a new client on every fresh
connection.

### Trusted Clients

A trusted client is a product that logs in through CIMD with a URL from the allowlist.

- Only the URLs on the allowlist are ever fetched, so an authorization request can not make the server fetch an address
  of its choosing, which rules out server-side request forgery. Any other `client_id` that is a URL gets the error page.
- A fetch uses `https`, follows no redirects, and is limited in [time and size](limits.md#oauth-values). The fetches of
  one URL run one at a time and at a limited rate, so anonymous requests can not flood the vendor.
- A document is accepted when all of this holds:
  - it is a JSON object
  - its `client_id` equals the URL exactly
  - it has a `client_name` and at least one entry in `redirect_uris`
  - `grant_types` holds `authorization_code`
  - `none` is allowed: `token_endpoint_auth_methods_supported` holds it, or, without that field,
    `token_endpoint_auth_method` is `none`
- Other fields and grant types are ignored, such as `jwks_uri` and the `jwt-bearer` grant in the document of Claude.
- A document is cached in memory. A failed fetch or a rejected document keeps the last good copy. With no good copy, the
  login page shows the error page, and answers again once a fetch succeeds.
- The token and revoke routes need no document: they check that the `client_id` is on the allowlist and belongs to the
  code or token. So logged-in clients keep working while a vendor is down, and removing a URL from the allowlist stops
  its refreshes.

A trusted client is a public client, so it authenticates with PKCE only.

### Own Clients

An own client is a row in [`oauth_clients`](database.md#oauth-tables), for what belongs to the operator of the server.
The operator manages them on the server, with `hippowiki client add`, `hippowiki client list` and
`hippowiki client remove`.

- `add` creates one of these, and prints the generated ID and any secret once:
  - **login client**, with one or more redirect URIs, such as the server part of the Web GUI. It is confidential unless
    `--public` is given, and only `--admin-allowed` lets the admin approve it, see [Admin](#admin).
  - **script client**, with `--user <name>`, which acts as that user through the client credentials grant, see
    [Scripts](connectors.md#scripts). It has no redirect URIs.
- A confidential client authenticates with `client_secret_basic`. The secret is a random value of 256 bits, so it is
  stored as SHA-256 and needs no slow hash, and it is compared in constant time.
- `remove` deletes the client and all its codes and tokens, in one transaction. To replace a secret, remove the client
  and add a new one.

### Redirect URIs

- A redirect URI matches an entry of the client as an exact string.
- The one exception is a loopback entry: for `http://localhost`, `http://127.0.0.1` and `http://[::1]`, the port is
  ignored and everything else has to match, as RFC 8252 asks for.
- An own client can register only `https` URIs and these loopback URIs.

## Authorization Request

A request first has to name a known client and a redirect URI of that client. If not, the response is an error page and
never a redirect, because the server can not trust the target.

After that, an error goes back to the client as a redirect with `error`, `state` and `iss`:

- `response_type` has to be `code`, otherwise `unsupported_response_type`.
- `code_challenge` is required, and `code_challenge_method` has to be `S256`, otherwise `invalid_request`. PKCE is also
  required for confidential clients, and `plain` is rejected.
- `resource`, when given, has to equal the MCP URL, otherwise `invalid_target`. A missing one is accepted, because the
  page of Claude does not say that it sends it. There is one resource, so a token always gets the MCP URL, and
  [one token covers MCP and REST](connectors.md#people).
- `scope` is optional, and an unknown scope is dropped instead of rejected. Scopes carry no rights, and `offline_access`
  changes nothing, because a refresh token is always issued to a client that lists the grant. The MCP specification lets
  the server decide this, and the response names the scope it granted.
- `state` is sent back unchanged, and the length of each parameter is [limited](limits.md#oauth-values).

Every response of the authorization endpoint that goes back to the client carries `iss`, including errors, because
[RFC 9207](https://www.rfc-editor.org/rfc/rfc9207) and ChatGPT ask for it.

## Login Page

One form on one page, which also asks for consent. It shows the name of the client and the host of its redirect URI, and
asks for the name and password, with optional fields for a new password. It has an approve and a deny button.

- **No login session**: there is no session or single sign-on cookie, so each authorization needs the password, and a
  client can never log in silently through an open browser session. The page is the consent screen for every client.
- **Stateless**: `POST` carries the parameters in hidden fields and validates all of them again, so nothing from the
  first request is trusted. Jinja2 autoescaping covers these values.
- **Approve**: after the checks below, the response is a 303 to the redirect URI with `code`, `state` and `iss`. A 307
  would send the password on to the client.
- **Deny**: needs no password, and gets a 303 with `error=access_denied`, `state` and `iss`.
- **Wrong credentials**: the page comes back with one fixed text, and with no password in it. See
  [Login Protection](#login-protection).
- **One-time password**: a correct [one-time password](users.md#passwords) without a new password brings the page back
  with a request to set one, so no state is needed between the two submits. A new password replaces it, and the login
  goes on.
- **Changing a password**: the same fields work for any account, and this is the way to change a password until the Web
  GUI exists.

### Browser Protection

- **CSRF**: a `POST` needs an `Origin` equal to the public URL, and a form field equal to a random `__Host-` cookie that
  is `Secure`, `HttpOnly` and `SameSite=Strict`. This cookie holds no login, REST and MCP ignore it, and
  [REST stays bearer only](connectors.md#people).
- **Headers on every page**:
  - `Content-Security-Policy` with `default-src 'none'`, the hash of the fixed inline stylesheet,
    `frame-ancestors 'none'` and `base-uri 'none'`
  - `form-action` with the app itself and the origin of the validated redirect URI, because Chrome also applies it to
    the redirect after the form
  - `Cache-Control: no-store`
  - `Referrer-Policy: same-origin`, because `no-referrer` makes a browser send `Origin: null` on the form
- **No scripts**: the page has no JavaScript.

### Admin

The admin can approve only an own client with `--admin-allowed`. On any other client the page, after a correct password,
shows that this account can not be used with this client, and no code is issued. So the admin can not leave a token with
a product, and the [403 on MCP](authentication.md#admin-account-on-mcp) stays as a second check. A wrong password gets
the normal answer, so the page does not show who is the admin.

## Tokens

Authorization codes, access tokens and refresh tokens are random values of 256 bits, opaque to the client. They carry
nothing, so there are no signing keys, no key rotation and no algorithm to get wrong.

- Only their SHA-256 hash is stored, so a copy of the database holds no usable token. They have enough entropy, so they
  need no slow hash.
- Times are set and compared by the database clock, see [Time](time.md), so there is no clock difference to allow for.
  The lifetimes are in [OAuth Values](limits.md#oauth-values).
- Rows are in the [OAuth tables](database.md#oauth-tables). Each login starts a new family, the set of tokens that came
  from one authorization code.
- Expired rows are deleted when new tokens are issued, so the tables do not grow without a cleanup job.

### Token Request

The form-encoded token endpoint answers JSON with `Cache-Control: no-store`. An error uses the format of RFC 6749, with
`error` and `error_description`, and fixed texts. A confidential client with a wrong secret gets 401 `invalid_client`
with `WWW-Authenticate: Basic`.

Grants:

- **Authorization code**: the code, client, `redirect_uri`, optional `resource` and `code_verifier` have to match, and
  the code must not be expired or used. The verifier is compared in constant time. The code is consumed under a row lock
  in the same transaction, so two requests can not both use it. The response has `access_token`, `token_type`,
  `expires_in`, `scope` and, when the client lists the grant, `refresh_token`.
- **Refresh token**: see [Refresh Rotation](#refresh-rotation).
- **Client credentials**: a script client only, with an active user. It gets an access token and no refresh token.

Everything else is rejected:

- An exchange that fails on any check still consumes the code, so a verifier can not be guessed.
- A code that was already used gets `invalid_grant` and deletes its family, because one of the two users has stolen it.
- An expired or unknown code or token gets `invalid_grant`.
- A deactivated user gets `invalid_grant`. A deactivated user of a script client gets `invalid_client`.

### Refresh Rotation

Every refresh replaces the refresh token, and the response holds the new one. A refresh row is locked for the exchange,
so parallel requests run one after another.

- A token that is not replaced yet gets a new refresh token and access token, and is marked as replaced.
- A replaced token inside the [grace window](limits.md#oauth-values) gets the same result. Claude can refresh in
  parallel and may retry a lost response, and either would log it out otherwise.
- A replaced token after the grace window deletes its family and gets `invalid_grant`, because a token thief and the
  real client are both using it.
- Accepted trade-off: a stolen token used inside the grace window is not detected at that moment. Both then hold valid
  tokens until one of them reuses a replaced token.

A family has an idle limit and no absolute limit, so a connector in regular use stays logged in. A user can end it by
changing the password, and the admin by resetting it.

### Ending Tokens

These delete all codes and tokens of a user, in the same transaction as the change, so they end on the next request:

- changing or resetting a password
- deactivating the user, so a [reactivated user](users.md#deactivating-users) has to log in again and a stolen token
  does not come back to life

`POST /oauth/revoke` deletes the family of a token that belongs to the authenticated client, and answers 200 for any
other token, as RFC 7009 asks for.

## Login Protection

- **Hashing**: Argon2id through `argon2-cffi` with its default parameters, and a hash is upgraded at the next login when
  the parameters have changed.
- **Event loop**: hashing runs in a worker thread with a [limit on running and waiting hashes](limits.md#oauth-values).
  Over the limit the page answers 503, so logins can not block other requests or exhaust memory and CPU.
- **Transactions**: hashing runs outside a transaction, so it holds no connection, see
  [Transactions](architecture.md#transactions). The failure counter is updated atomically.
- **Per account**: after the free attempts, each failure doubles the time an account must wait. During this time the
  login is refused even with the right password, with the same answer as a wrong one. `hippowiki set-admin-password` and
  a password reset clear this. An attacker can delay the login of a known name, but tokens that exist keep working.
- **Per address**: failures per client address are counted in memory, which works because the app is one process. Over
  the limit the page refuses the login without hashing, which slows down one password tried against many names. The
  address comes from `X-Forwarded-For` only when the [proxy is trusted](deployment.md#reverse-proxy-setup).
- **Enumeration**: an unknown name and a deactivated user still run a hash against a fixed dummy value, and get the same
  answer as a wrong password.
- **Accounts**: there is no self-registration and no way to rename a user.
- **Logging**: a login, a failure and a lockout are logged with the client and the address. The name is logged only when
  it belongs to a user, because people type passwords into the name field. Logs never hold a password, token, code or
  secret.

Multi-factor login and a reset without the admin are [for later](roadmap.md#later).

## Open Risks

- **ChatGPT Enterprise**: HippoWiki stores no email, so it can not offer the UserInfo endpoint the documentation names.
  The [Connector Test](roadmap.md#connector-test) shows whether the plan in use needs it.
- **Vendor documents change**: the page of Keycloak says the document of ChatGPT has no `token_endpoint_auth_method`,
  and the live document has one. So the checks accept either field, and a change in a document shows up in the log.
- **New client URLs**: a product that moves to another URL stops working until the allowlist changes. This is the price
  of never fetching an unknown address.
- **Lost passwords**: there is no email, so a person goes to the admin, and the admin to the shell.
- **Own code**: nothing but review and tests stands behind this code, see [Why It Is Built In](#why-it-is-built-in).

## Sources

Read on 3 November 2026:

- [MCP: authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization) and
  [client registration](https://modelcontextprotocol.io/specification/draft/basic/authorization/client-registration.md)
- [OpenAI: authentication](https://developers.openai.com/plugins/build/auth)
- [Claude: connector authentication](https://claude.com/docs/connectors/building/authentication.md)
- [Claude Code: MCP](https://code.claude.com/docs/en/mcp), of which the authentication part was read only as a summary
- The metadata documents of [Claude](https://claude.ai/oauth/mcp-oauth-client-metadata),
  [Claude Code](https://claude.ai/oauth/claude-code-client-metadata) and
  [ChatGPT](https://chatgpt.com/oauth/client.json)
- [Keycloak: MCP](https://www.keycloak.org/securing-apps/mcp-authz-server), for its note on the document of ChatGPT
- [Authlib](https://docs.authlib.org/en/latest/oauth2/authorization-server/index.html),
  [oauthlib](https://pypi.org/project/oauthlib/) and
  [MCP SDK: authorization](https://py.sdk.modelcontextprotocol.io/run/authorization/)
