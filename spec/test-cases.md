# Test Cases

Every check and rule in [Request Checks](request-checks.md) needs a test, on REST and, where it applies, on MCP. This
document lists the combinations that are easy to miss, and the cases of other documents. The test kinds are defined in
[Testing Strategy](testing.md).

## Check Order

- Unauthenticated malformed JSON gets 401.
- An unauthenticated request to an unknown route or with a wrong method gets 401.
- An authenticated request to an unknown route gets 404, and one with a wrong method gets 405, also with an invalid body.
- On MCP, an unknown tool gets a tool error.
- An invalid body gets the same 422 for a hidden, a missing and a readable folder.
- On MCP, malformed JSON gets a protocol error and invalid tool arguments get a tool error.
- A non-admin on an admin operation with no existing folder as its target gets 422 with an invalid body and 403 with a
  valid one.
- A non-admin on a folder operation gets 422 with an invalid body, 404 with no right on the folder and 403 with a right.
- A user without the required right and with an invalid name gets 403.
- A user without the required right who names a missing target gets 403.
- A target tab in another folder gets the same 404 as a missing one, whatever the rights of the user on its folder.
- Each row of [Rejected Operations](request-checks.md#rejected-operations) gets its response.
- A name conflict is reported only after domain validation.
- An authenticated request with a body over the limit gets 413, and an unauthenticated one gets 401.
- A chunked body over the limit, so with no declared length, gets the same 413 on a REST route, on MCP and on an unknown
  route. A test with a declared length would pass with the wrong implementation.
- A body under the limit reaches the route unchanged after the replay.
- A body with invalid UTF-8 and a deeply nested JSON array get the same 422 as ordinary malformed JSON.
- A string field or tool argument with NUL or a lone surrogate gets 422 on REST and a tool error on MCP, including
  `content_md`.

## Names

- Each entity with a [name rule](entity-rules.md#names) gets `DomainValidationError` for a name that is too long, and accepts
  one of exactly 100 characters.
- `-`, `--`, `a--b`, `-a`, `a-` and `Admin` get `DomainValidationError` for folders, md_documents and users.
- A tab name of only spaces, with a control character or with leading or trailing whitespace gets `DomainValidationError`.

## Visibility

The rules from [Request Checks](request-checks.md) and [Auth Concept](auth-concept.md) on what a user can see are tested on
REST and MCP, including:

- A hidden and a missing item give an identical response, comparing the full 404 body on REST and the full tool error text
  on MCP.
- A matrix of operations against `read`, `write`, `manage`, admin and no right shows which operation each right allows. On
  MCP it has no admin, because admins are rejected there.

## Rights Lists

- An admin's own rights show `manage` on every folder and ignore their stored rows.
- The rights of a folder and all rights show the stored rows, including rows with no effect.
- Every rights list leaves out deleted folders, and the rights of a folder and all rights leave out a stray row of a deleted
  user.

## Delete and Restore

The rules are in [Entity Rules](entity-rules.md#deleting-and-restoring-content) and
[Deleted Items](request-checks.md#deleted-items).

- A deleted md_document, tab and folder each give the same full 404 body as a missing one on REST, and the same full tool
  error text on MCP, on read, update, rename, move and a second delete.
- An item inside a deleted tab or folder gives the same response, by ID and in lists.
- An admin gets the same 404 for a deleted folder, on every operation except restore.
- A deleted tab as the target of a move or a create gets the same 404 as a missing tab.
- Restoring a tab or folder brings back its content, and an item deleted before it stays deleted.
- A deleted name can be used again, and restoring the old item then gets `NameConflictError`.
- Restoring an item that is not deleted gets 404, and restoring a md_document whose tab is deleted gets 404 until the tab is
  restored.
- The rights on a deleted folder apply again after its restore, and until then a user with such a right gets 404.
- The matrix under [Visibility](#visibility) covers deleting md_documents and tabs, the deleted list and restore: `manage`
  and admin pass, `read` and `write` get 403, and no right gets 404.
- The deleted list holds items with their own `deleted_at` under a live parent, and has no `content_md`.
- A non-admin who lists deleted folders or restores a folder gets 403, also for a folder that does not exist.
- A non-admin who deletes a folder gets 404 with no right on it and 403 with a right, and the tool list on MCP has no such
  tool.

## Deactivating and Deleting Users

The rules are in [Entity Rules](entity-rules.md#deactivating-and-deleting-users).

- A deactivated user gets the same 401 as a token with no linked user, on the next request, on REST and MCP.
- A reactivated user gets through again, with the same rights and without a new link.
- Deactivating twice keeps the first `deactivated_at`, and reactivating an active user changes nothing.
- A deleted user gets 401 for the old subject, and that subject can be linked to a new user.
- Deleting a user removes their folder right rows, and the rights they assigned to others stay.
- The content of a deleted user keeps its `created_by`, and the user stays in the list of all users with both timestamps.
- Changing `is_admin` or `auth_subject`, deactivating, reactivating or deleting a deleted user, and assigning a right to one,
  all get 404.
- An admin can assign a right to a deactivated user and change their link.

## Public Routes

- Without credentials and with a unit-of-work factory that fails when called, health returns its fixed body.
- The same holds for the protected resource metadata routes, with the body built from the settings.
- The protected resource metadata lists the configured issuer in `authorization_servers`, and its `resource` equals the
  configured audience.
- Under the same conditions, every route except health and the protected resource metadata gets 401, including MCP and
  `/openapi.json`.
- A public path with a trailing slash or a path below it gets 401.
- `/docs` and `/redoc` get 404 when authenticated.

## Token Check

The rules are in [Authentication](authentication.md#token-check).

- A valid token of a linked user gives the principal of that user.
- These tokens each get 401: expired, wrong issuer, wrong audience, bad signature, `alg=none`, HS256 signed with the public
  key as the secret, no `sub`, and a valid token with no linked user.
- A token that fails with an unknown `kid` gets 401 after one refetch, and further unknown `kid`s within the rate limit
  cause no further fetch.
- An unreachable key source gets 503 when a key is needed, and a cached key keeps working while the key source is down.
- A 401 for a presented token carries `error="invalid_token"`, and a 401 without a token does not.

## User Linking

- Creating a user without `auth_subject` gets 422, and an `auth_subject` of "" or of 256 characters gets
  `DomainValidationError`.
- A duplicate `auth_subject` gets `SubjectConflictError`, on create and on change.
- After an admin removes or changes the link of a user, the old subject gets 401 on the next request.
- `hippowiki link-root-admin` run twice with the same subject changes nothing, a new subject replaces the link, and a
  subject that another user has is rejected.

## Other ASGI Scopes

- `lifespan` passes through the middleware, so startup and shutdown still run.
- A `websocket` scope is closed without reaching the app.

## Error Format

- The 401, the 403 for an admin on MCP, the 404 for an unknown route, the 405, the 413, the 422 from schema validation, the
  422 for an unparsable body, the 500 and the 503 are problem+json.
- Each of them carries the `code` from [REST Error Format](request-checks.md#rest-error-format), and a name conflict, a
  subject conflict and a version conflict can be told apart by it.
- A 404 body has no `instance` and no ID.
- The 401 carries `WWW-Authenticate` with `resource_metadata` and the 405 carries `Allow`.

## Failed Credential Lookup

- A credential check that raises gets 503 problem+json without exception details on REST and an HTTP 503 on the MCP
  transport.
- No adapter is reached, and health still answers.

## MCP Tools and Transport

- In the tool tests, an unknown argument gets a tool error from the shared wrapper, which pins how it uses the SDK.
- In the tool tests, the advertised `input_schema` has `additionalProperties: false`.
- In the tool tests, invalid arguments give `schema_validation`, and the text has no `input_value` and no pydantic.dev link.
- In the tool tests, each domain error a tool can raise gives its stable code.
- In the tool tests, the tool list has no [admin operation](auth-concept.md#admin-rights).
- On the transport, an admin, including the root admin, gets 403 problem+json with the code `forbidden` and no
  `WWW-Authenticate` on `POST /mcp` and `GET /mcp`, on both protocol paths, and no tool runs.
- On the transport, an admin with a body over the limit gets 403, not 413.
- The same admin token works on REST.
- A user who becomes an admin gets 403 on the next MCP request, and one who is no longer an admin gets through again.
- `/mcp/` as an admin does not reach a tool.
- On the transport, responses carry no `Mcp-Session-Id`, on both protocol paths from
  [Serving the MCP App](mcp.md#serving-the-mcp-app).
- On the transport, each user's tool calls run under their own principal, on both protocol paths.
- On the transport, `POST /mcp` answers without a redirect.
- On the transport, an authenticated `GET /mcp` gets 405 with `Allow: POST` and an unauthenticated one gets 401.
- On the transport, a foreign `Host` gets 421 and a foreign `Origin` gets 403, and the configured ones are accepted.

## Time

- `UtcDatetime` accepts the strict profile from [Time](time.md) and converts to UTC.
- `0001-01-01T00:00:00+14:00` and `9999-12-31T23:59:59-14:00` get 422, not a 500.
- `2026-10-30t14:05:09z`, `2026-10-30 14:05:09Z`, `2026-10-30T14:05Z`, `2026-10-30T14:05:09.123456789Z` and Unix timestamps
  get 422.

## Integration (`podman`)

- Table constraints hold.
- Writes are atomic, such as a folder with its default tab.
- A unique violation surfaces inside the repository call.
- Time-dependent behaviour works in separate committed transactions.
- `hippowiki migrate` followed by `hippowiki init` twice leaves one root admin, and it stays unlinked until
  `hippowiki link-root-admin` runs.
- Creating or renaming anything to the name `""` gets `DomainValidationError` and creating a user named `admin` gets
  `NameConflictError`, not a check violation.
- Assigning a right twice updates `assigned_by` and `assigned_at`, also in separate committed transactions.
- A service result can be read after the commit, which fails without `expire_on_commit=False` if an ORM object reaches it.
- `SafeText` is needed: writing NUL or a lone surrogate through SQLAlchemy and asyncpg raises `DBAPIError`, so a change in
  this behaviour shows up.
- The checks reject a deleted default tab, a deactivated or deleted root admin and a deleted user with an `auth_subject`.
- A name can be used again after a delete, and restoring the old item gets `NameConflictError`, against the real partial
  unique indexes. The name of a deleted user stays taken.
- Two concurrent deletes of one item give one success and one 404, and an update racing a delete gets 404.
- A md_document created in a tab while it is being deleted is hidden, and comes back when the tab is restored.
- Deleting a user sets `deleted_at`, clears `auth_subject` and removes the rights in one transaction, and nothing is left
  changed after a rollback.
