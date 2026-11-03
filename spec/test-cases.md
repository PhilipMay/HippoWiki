# Test Cases

Every rule in this specification needs a test, see [What Needs a Test](testing.md#what-needs-a-test). This document
lists only the cases that are easy to miss: combinations of rules, races, exact input values and transport behaviour.

## Check Order Cases

- Unauthenticated malformed JSON gets 401.
- An unauthenticated request to an unknown route or with a wrong method gets 401.
- An authenticated request to an unknown route gets 404, and one with a wrong method gets 405, also with an invalid
  body.
- An invalid body gets the same 422 for a hidden, a missing and a readable folder.
- A non-admin on an admin operation with no existing folder as its target gets 422 with an invalid body and 403 with a
  valid one, also for a folder that does not exist.
- A non-admin on a folder operation gets 422 with an invalid body, 404 with no right on the folder and 403 with a right.
- A user without the required right and with an invalid name gets 403.
- A user without the required right who names a missing target gets 403.
- A target tab in another folder gets the same 404 as a missing one, whatever the rights of the user on its folder.
- A name conflict is reported only after domain validation.
- A stale version together with a name that is taken gets `VersionConflictError`.
- An authenticated request with a body over the limit gets 413, and an unauthenticated one gets 401.
- A chunked body over the limit, so with no declared length, gets the same 413 on a REST route, on MCP and on an unknown
  route. A test with a declared length would pass with the wrong implementation.
- A body under the limit reaches the route unchanged after the replay.
- A body of exactly the limit reaches the route on REST and MCP, and one byte more gets the problem+json 413 of the
  middleware, also on MCP.
- `6 * MAX_CONTENT_MD_BYTES < MAX_REQUEST_BODY_BYTES <= DEFAULT_MAX_REQUEST_BODY_SIZE` holds, so a change on either side
  or in the SDK gets noticed.
- A body with invalid UTF-8 and a deeply nested JSON array get the same 422 as ordinary malformed JSON.
- A string field or tool argument with NUL or a lone surrogate gets 422 on REST and a tool error on MCP, including
  `content_md`.

## Name Cases

- Each entity with a [name rule](content.md#names) gets `DomainValidationError` for a name that is too long, and accepts
  one of exactly 100 characters.
- `-`, `--`, `a--b`, `-a`, `a-` and `Admin` get `DomainValidationError` for folders, tabs, md_documents and users.

## Document Size Cases

- A `content_md` of exactly 262,144 bytes is accepted and one byte more gets `DomainValidationError`, on create and
  update, on REST and MCP.
- The [size](limits.md#document-size) counts bytes: 131,073 `ä` are rejected, although that is fewer characters than the
  limit.
- The worst case fits: a largest document made only of U+0001, sent escaped together with the longest name, passes the
  body check on REST and MCP.
- A user without the required right who sends a `content_md` over the limit gets 403.
- A rename, move, restore and revert of a md_document whose stored `content_md` is over the limit succeed.

## Hidden and Deleted Item Cases

- A hidden and a missing item give an identical response, comparing the full 404 body on REST and the full tool error
  text on MCP.
- A deleted md_document, tab and folder each give the same full 404 body as a missing one on REST, and the same full
  tool error text on MCP, on read, update, rename, move and a second delete.
- Assigning a right to the admin gets 403 and stores no row.
- The admin finds every live folder in the folder list and can read it, and gets the same full 404 body as a missing
  item on every route inside it, including history and revert.

## History and Revert Cases

- A write that would change nothing gets `VersionConflictError` with a stale version, and adds no revision with the
  current one.
- A folder revert soft deletes newer items, restores items deleted later and keeps items deleted at the target deleted.
  It keeps the current folder name and the rights, and the rename stays in the history.
- A folder revert on an item deleted both at the target and now, whose name or content changed in between, writes the
  fields of the target with a revision and keeps it deleted, and a later restore shows that state.

## List Cases

- Paging through a whole list returns each row once and in order, on the fakes and on the real repositories.
- A list with exactly `limit` rows gets a null `next_cursor`, with no empty page after it.
- Hidden and deleted rows neither reduce a page nor appear, also behind a crafted cursor.
- A cursor with bad base64, a wrong shape or a NUL gets 422 on REST and a tool error on MCP, not a 500. It gets the same
  response for a hidden, a missing and a readable folder.
- A `limit` of 0 and of 101 get 422, and 1 and 100 are accepted.
- Paging goes on when the row named by the cursor is deleted between two pages.
- Names that repeat, among deleted rows and across the tabs of a folder, are neither skipped nor repeated between pages.
- A folder revert with more changed items than `limit` returns all of them across pages.

## Own Account Cases

- A non-admin gets 403 on every `/users` route, also for their own ID.

## Combined Update Cases

- A user with `write` and `name` or `tab_id` in the update gets 403, also for an unchanged value, and with only
  `content_md` gets through.
- In the tool tests, `update_md_document` treats a `null` argument as not given, so `null` for `name` needs only
  `write`.

## User and Password Cases

- `POST /users` with `is_admin` gets 422 and creates no user, for either value.
- `PATCH /users/{user_id}` gets 405 for the admin.
- A deactivated user gets the same 401 as an unknown token, on the next request, on REST and MCP.
- After reactivating a user, their old access and refresh tokens stay invalid.
- The response of `POST /users` holds a one-time password, and no other route or log does.
- A password reset ends the tokens of the user on the next request. Resetting the admin gets 403 and changes nothing.
- `hippowiki set-admin-password` run twice works, ends the tokens of the admin, and clears a wait after failed logins.
- No response and no log holds a `password_hash`.

## Public Route Cases

- Without credentials and with a unit-of-work factory that fails when called, health returns its fixed body.
- The same holds for the protected resource metadata routes, with the body built from the settings.
- The same holds for the metadata of the OAuth server.
- The protected resource metadata lists the issuer in `authorization_servers`, and its `resource` equals the MCP URL.
- Under the same conditions, every route except the public ones gets 401, including MCP and `/openapi.json`.
- A public path with a trailing slash, a path below it or another method gets 401. This also holds for `POST /health`
  with a chunked body, which is not read, and for `GET /oauth/token`.
- The `resource_metadata` value of a 401 is the URL of the metadata route for the MCP path, on REST and MCP, and a `GET`
  on that URL returns the MCP URL as `resource`.
- A request with a foreign `Host` gets metadata with the configured URLs.
- An authenticated request to `/health/`, `/api/v1/folders/` or `/mcp/` gets 404 problem+json with no `Location`.
- `/docs` and `/redoc` get 404 when authenticated.

## Token Check Cases

- These each get 401: an unknown token, an expired token, a refresh token, an authorization code, and a token of a
  deactivated user.
- A value of the wrong shape gets 401 with a unit-of-work factory that fails when called, so it causes no lookup.
- A valid token gets 503 when the lookup fails, never 401.
- A 401 for a presented token carries `error="invalid_token"`, and a 401 without a token does not.

## OAuth Server Cases

Authorization request:

- An unknown client, a URL not on the allowlist and a redirect URI of another client get the error page, and never a
  redirect, on `GET` and `POST`. No fetch happens for a URL that is not on the allowlist.
- A redirect URI that differs in any way gets the error page: a path below it, a query, a trailing slash, another case
  in the path, or `http` instead of `https`. A loopback URI with another port passes, and another host or path does not.
- `http://localhost.example.org/callback` is not a loopback URI.
- A missing `code_challenge`, the method `plain`, another `response_type` and a foreign `resource` go back as a redirect
  with the right `error`, the `state` and `iss`.
- Every redirect carries `iss`, including errors and deny.
- A `state` with HTML in it comes back unchanged in the redirect and is escaped in the page.
- `POST` with parameters changed from those of the `GET` is validated again, such as another redirect URI.
- A NUL, a lone surrogate and invalid UTF-8 in any parameter, also in `name` and `client_id`, never give a 500.
- A `code_challenge` that is not 43 base64url characters is rejected.
- A `HIPPOWIKI_PUBLIC_URL` with `http` stops the app from starting, and a loopback host is allowed.

Trusted clients:

- The current documents of Claude, Claude Code and ChatGPT are accepted, including the `jwt-bearer` grant of Claude and
  the `private_key_jwt` preference of ChatGPT.
- A document with another `client_id`, without `none`, without redirect URIs, or over the size limit is rejected, and a
  redirect from the URL is not followed.
- A failed fetch keeps the last good document. With an empty cache it gives the error page, and a later success works.
- Requests over the rate cause no extra fetch.
- A refresh works while the fetch of its document fails, and is rejected when the URL leaves the allowlist.

Login page:

- A wrong password, an unknown name, a deactivated user and an account in its wait get an identical response, and each
  of them runs a hash, apart from an address over its limit.
- A `POST` without the cookie, with a form field that differs, or with a foreign or missing `Origin` issues no code, and
  the page comes back with a new cookie and field.
- A second `GET` reuses a cookie it finds, so a form from an earlier `GET` still works.
- The admin with a correct password on a trusted client, or on an own client without `--admin-allowed`, gets no code,
  and with a wrong password gets the normal answer. An own client with `--admin-allowed` works.
- The admin with a correct password and a filled new password field gets no code, on any client, and the password stays.
- A one-time password with no new password issues no code and leaves the password as it was. With a new one it issues a
  code, and the one-time password stops working.
- A new password that is too short, too long, equal to the name or equal to the current password issues no code and
  changes nothing.
- Changing a password ends the older tokens of the user, and the new code works.
- A password reset between the two units of work of a login makes that login count as wrong, and issues no code.
- An approval answers 303, never 307, and the page has the [browser headers](oauth-server.md#browser-protection), with
  the origin of the redirect URI in `form-action`.
- The page shows the host of the `client_id` for every client, and the warning for a loopback redirect URI only.
- Deny needs no password, issues no code and gets `access_denied`.
- The page holds no password after a failed attempt.

Login protection:

- The failure after the free attempts starts the wait, and the right password during the wait fails with the same
  answer. Refused attempts during the wait neither count nor extend it.
- A successful login resets the counter, also against concurrent failures (`podman`).
- Over the limit of hashes, a login gets 503, and other requests go on answering while hashes run.
- Over the limit of failures for one address, a login runs no hash, and another address still can log in.
- `X-Forwarded-For` from an untrusted address does not change the address that is counted.
- Two IPv6 addresses in one /64 count as one address, and the oldest entry goes when the table is full.
- `POST /users` and a password reset over the limit of hashes get 503 and change nothing.
- A password over the limit runs no hash.

Token endpoint:

- A wrong `code_verifier`, a `client_id` or `redirect_uri` other than that of the code, and a foreign `resource` get
  `invalid_grant` or `invalid_target`, and the code can not be used afterwards.
- A verifier of the wrong length is rejected, and PKCE is also needed for a confidential client.
- An expired code gets `invalid_grant`, in separate committed transactions (`podman`).
- Two concurrent exchanges of one code give one success (`podman`).
- A second use of a code gets `invalid_grant` and ends the tokens from the first use.
- A code of one client can not be redeemed by another, and a refresh token of one client can not be used by another.
- A confidential client with a wrong or no secret gets 401 `invalid_client` with `WWW-Authenticate: Basic`, and an
  unknown `client_id` gets 401 `invalid_client`.
- A script client gets only the client credentials grant, with no refresh token, and a login client using it gets
  `unauthorized_client`. An unknown grant gets `unsupported_grant_type`.
- The code row stays after the code expires, so a second use after that still ends the tokens from the first use, and
  the cleanup deletes it only after its retention time.
- A failing database gets 503 on a code and a refresh, never `invalid_grant`, and the refresh token still works
  afterwards.
- A token response leaves out `scope` when nothing was granted.
- A body over the form limit, another content type and a repeated parameter get `invalid_request`, and the chunked case
  is not held in memory.
- A token response has `Cache-Control: no-store`, and no token appears in a log.

Refresh rotation:

- A refresh returns a new refresh token, and the new one works.
- Two concurrent refreshes of one token both succeed and leave the family valid (`podman`).
- A replaced token inside the grace window works, and after it gets `invalid_grant` and ends the family, while another
  family of the user keeps working (`podman`).
- A refresh sets a new idle time, so a token used regularly outlives the idle limit (`podman`).
- A foreign `resource` on a refresh gets `invalid_target`.
- After a reuse inside the grace window, a normal refresh of one chain marks the other as replaced, so its next refresh
  after the window gets `invalid_grant` and ends the family (`podman`).
- A reuse inside the grace window marks no other token as replaced, so a client that keeps either response goes on
  working.

Revocation and clients:

- Revoking a token ends its family. An unknown token gets 200, and a token of another client gets `invalid_grant`, and
  neither changes anything.
- The metadata has `revocation_endpoint_auth_methods_supported` with `none`.
- `hippowiki client remove` ends the tokens of the client, and a client added with `--user` acts as that user.
- A script client whose user is deactivated gets `invalid_client`.
- A row in `oauth_tokens` holds no token, and a copied row hash does not work as a bearer token.

## Middleware and Error Format Cases

- `lifespan` passes through the middleware, so startup and shutdown still run.
- A `websocket` scope is closed without reaching the app.
- The 401, the 403 for the admin on MCP, the 404 for an unknown route, the 405, the 413, the 422 from schema validation,
  the 422 for an unparsable body, the 500 and the 503 are problem+json, each with its
  [code, title, status and detail](errors.md#rest-error-format).
- A 422 from schema validation, from domain validation and for an unparsable body has `errors` with `field` and
  `reason`. The body does not hold the input value, also for a rejected `content_md`.
- A credential check that raises gets 503 problem+json without exception details on REST and an HTTP 503 on the MCP
  transport. No adapter is reached, and health still answers.

## MCP Tool and Transport Cases

- In the tool tests, an unknown argument gets a tool error from the shared wrapper, which pins how it uses the SDK.
- In the tool tests, the advertised `input_schema` has `additionalProperties: false`.
- In the tool tests, invalid arguments give `schema_validation`, and the text has no `input_value` and no pydantic.dev
  link.
- In the tool tests, each domain error a tool can raise gives its stable code.
- In the tool tests, the tool list has no [admin operation](users.md#admin-operations), no history and no revert tool.
- In the tool tests, a result has one text block and no `structured_content`, and the tool description has no output
  schema.
- On the transport, the admin gets 403 problem+json with the code `forbidden` and no `WWW-Authenticate` on `POST /mcp`
  and `GET /mcp`, on both protocol paths, and no tool runs.
- On the transport, the admin with a body over the limit gets 403, not 413.
- The same admin token works on REST.
- `/mcp/` as the admin does not reach a tool.
- On the transport, responses carry no `Mcp-Session-Id`, on both protocol paths from the
  [MCP SDK notes](implementation-notes.md#mcp-sdk-notes).
- On the transport, each user's tool calls run under their own principal, on both protocol paths.
- On the transport, `POST /mcp` answers without a redirect.
- On the transport, an authenticated `GET /mcp` gets 405 with `Allow: POST` and an unauthenticated one gets 401.
- On the transport, a foreign `Host` gets 421 and a foreign `Origin` gets 403, and the configured ones are accepted.
- On the transport, an unauthenticated request with a foreign `Host` gets 401, and an authenticated one with an invalid
  body and a foreign `Host` gets 421.

## Time Cases

- `UtcDatetime` accepts the strict profile from [Time](time.md) and converts to UTC.
- `0001-01-01T00:00:00+14:00` and `9999-12-31T23:59:59-14:00` get 422, not a 500.
- `2026-10-30t14:05:09z`, `2026-10-30 14:05:09Z`, `2026-10-30T14:05Z`, `2026-10-30T14:05:09.123456789Z` and Unix
  timestamps get 422.

## Integration Cases (`podman`)

- Table constraints hold.
- Writes are atomic, such as a folder with its default tab.
- A unique violation surfaces inside the repository call.
- Time-dependent behaviour works in separate committed transactions.
- `hippowiki migrate` followed by `hippowiki init` twice leaves one admin, who can not log in until
  `hippowiki set-admin-password` runs.
- The check constraint of `oauth_clients` rejects a client that is neither a login client nor a script client.
- Creating or renaming anything to the name `""` gets `DomainValidationError` and creating a user named `admin` gets
  `NameConflictError`, not a check violation.
- Assigning a right twice updates `assigned_by` and `assigned_at`, also in separate committed transactions.
- A service result can be read after the commit, which fails without `expire_on_commit=False` if an ORM object reaches
  it.
- `SafeText` is needed: writing NUL or a lone surrogate through SQLAlchemy and asyncpg raises `DBAPIError`, so a change
  in this behaviour shows up.
- The checks reject a deleted default tab and a deactivated admin.
- A name can be used again after a delete, and restoring the old item gets `NameConflictError`, against the real partial
  unique indexes. The name of a deactivated user stays taken.
- Two concurrent deletes of one item give one success and one 404, and an update racing a delete gets 404.
- A md_document created in a tab while it is being deleted waits for the lock on the folder row: it gets 404 when the
  delete commits first, and otherwise it is hidden and comes back when the tab is restored.
- A folder revert that swaps the names of two tabs or two md_documents succeeds against the real partial unique indexes.
- A folder revert that fails leaves nothing changed after the rollback, and the revision counter stays as it was.
- Concurrent changes in one folder get consecutive revision numbers, and a folder revert racing a change gets
  `VersionConflictError`.
- An update racing a folder revert ends without a deadlock, and two updates racing with one version give one success and
  one `VersionConflictError`.
- In the production composition test, after `hippowiki migrate`, `hippowiki init` and
  `hippowiki client add --name admin-script --user admin`, the admin creates a folder on REST with a token from its
  script client. A user with a right logs in through the login page and reads it on REST and MCP, and a user with no
  right gets the full 404 body.
