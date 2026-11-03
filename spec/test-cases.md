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

## User and Linking Cases

- `POST /users` with `is_admin` gets 422 and creates no user, for either value.
- A `PATCH` with `is_admin` gets 422 and changes nothing, for either value and also for an unchanged value.
- A deactivated user gets the same 401 as a token with no linked user, on the next request, on REST and MCP.
- The subject of a deactivated user gets `SubjectConflictError` for a new user, and can be linked once the admin removes
  it from the deactivated user.
- An `auth_subject` of 256 characters gets `DomainValidationError`.
- After the admin removes or changes the link of a user, the old subject gets 401 on the next request.
- `hippowiki link-admin` run twice with the same subject changes nothing, a new subject replaces the link, and a subject
  that another user has is rejected.

## Public Route Cases

- Without credentials and with a unit-of-work factory that fails when called, health returns its fixed body.
- The same holds for the protected resource metadata routes, with the body built from the settings.
- The protected resource metadata lists the configured issuer in `authorization_servers`, and its `resource` equals the
  configured audience.
- Under the same conditions, every route except health and the protected resource metadata gets 401, including MCP and
  `/openapi.json`.
- A public path with a trailing slash or a path below it gets 401.
- `/docs` and `/redoc` get 404 when authenticated.

## Token Check Cases

- These tokens each get 401: expired, wrong issuer, wrong audience, bad signature, `alg=none`, HS256 signed with the
  public key as the secret, no `sub`, and a valid token with no linked user.
- A token that fails with an unknown `kid` gets 401 after one refetch, and further unknown `kid`s within the rate limit
  cause no further fetch.
- An unreachable key source gets 503 when a key is needed, and a cached key keeps working while the key source is down.
- A 401 for a presented token carries `error="invalid_token"`, and a 401 without a token does not.

## Middleware and Error Format Cases

- `lifespan` passes through the middleware, so startup and shutdown still run.
- A `websocket` scope is closed without reaching the app.
- The 401, the 403 for the admin on MCP, the 404 for an unknown route, the 405, the 413, the 422 from schema validation,
  the 422 for an unparsable body, the 500 and the 503 are problem+json, each with its
  [code](errors.md#rest-error-format).
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
- `hippowiki migrate` followed by `hippowiki init` twice leaves one admin, and it stays unlinked until
  `hippowiki link-admin` runs.
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
