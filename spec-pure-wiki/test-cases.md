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
- A chunked body over the limit, so with no declared length, gets the same 413 on a REST route and on an unknown route.
  A test with a declared length would pass with the wrong implementation.
- A body under the limit reaches the route unchanged after the replay.
- A body of exactly the limit reaches the route, and one byte more gets the problem+json 413 of the middleware.
- `6 * MAX_CONTENT_MD_BYTES < MAX_REQUEST_BODY_BYTES` holds, so a change on either side gets noticed.
- A body with invalid UTF-8 and a deeply nested JSON array get the same 422 as ordinary malformed JSON.
- A string field with NUL or a lone surrogate gets 422, including `content_md`.

## Name Cases

- Each entity with a [name rule](content.md#names) gets `DomainValidationError` for a name that is too long, and accepts
  one of exactly 100 characters.
- `-`, `--`, `a--b`, `-a`, `a-` and `Admin` get `DomainValidationError` for folders, tabs, md_documents and users.

## Document Size Cases

- A `content_md` of exactly 262,144 bytes is accepted and one byte more gets `DomainValidationError`, on create and
  update.
- The [size](limits.md#document-size) counts bytes: 131,073 `ä` are rejected, although that is fewer characters than the
  limit.
- The worst case fits: a largest document made only of U+0001, sent escaped together with the longest name, passes the
  body check.
- A user without the required right who sends a `content_md` over the limit gets 403.
- A rename, move, restore and revert of a md_document whose stored `content_md` is over the limit succeed.

## Hidden and Deleted Item Cases

- A hidden and a missing item give an identical response, comparing the full 404 body.
- A deleted md_document, tab and folder each give the same full 404 body as a missing one, on read, update, rename, move
  and a second delete.
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
- A cursor with bad base64, a wrong shape or a NUL gets 422, not a 500. It gets the same response for a hidden, a
  missing and a readable folder.
- A `limit` of 0 and of 101 get 422, and 1 and 100 are accepted.
- Paging goes on when the row named by the cursor is deleted between two pages.
- Names that repeat, among deleted rows and across the tabs of a folder, are neither skipped nor repeated between pages.
- A folder revert with more changed items than `limit` returns all of them across pages.

## Own Account Cases

- A non-admin gets 403 on every `/users` route, also for their own ID.

## Combined Update Cases

- A user with `write` and `name` or `tab_id` in the update gets 403, also for an unchanged value, and with only
  `content_md` gets through.

## User and Password Cases

- `POST /users` with `is_admin` gets 422 and creates no user, for either value.
- `PATCH /users/{user_id}` gets 405 for the admin.
- A deactivated user gets the same 401 as an unknown token, on the next request.
- After reactivating a user, their old tokens stay invalid.
- The response of `POST /users` holds a one-time password, and no other route or log does.
- A password reset ends the sessions of the user on the next request. Resetting the admin gets 403 and changes nothing.
- `hippowiki set-admin-password` run twice works, also with one value, ends the sessions of the admin, and clears a wait
  after failed logins.
- `hippowiki set-admin-password` refuses a password that is too short, too long or equal to the name, and fails with a
  clear message before `hippowiki init`.
- No response and no log holds a `password_hash`.
- `POST /users` and a password reset over the limit of hashes get 503 and change nothing.
- With the limit of hashes reached, `POST /users` still gets the 403 and 422 of the checks that come before Hash limit
  in the [check order](request-checks.md#check-order).

## Public Route Cases

- Without credentials and with a unit-of-work factory that fails when called, health returns its fixed body.
- Under the same conditions, every route except the public ones gets 401, including `/openapi.json`.
- A public path with a trailing slash, a path below it or another method gets 401. This also holds for `POST /health`
  with a chunked body, which is not read, and for `GET /api/v1/auth/login`.
- An authenticated request to `/health/` or `/api/v1/folders/` gets 404 problem+json with no `Location`.
- `/docs` and `/redoc` get 404 when authenticated.

## Login Cases

- A wrong password, an unknown name, a user with no password, a deactivated user and an account in its wait get an
  identical response, and each of them runs a hash.
- A password over the length limit gets this identical response and runs no hash.
- A login with a stale `Authorization` header gets the same response as one without it, and its 401 has no
  `error="invalid_token"`.
- The 401, 403, 413, 422 and 503 of the login are problem+json with their `code`, and the 401 carries
  `WWW-Authenticate: Bearer`.
- Another content type than JSON gets 422.
- A successful login holds a token and `expires_at`, with `Cache-Control: no-store`, and the token works on the next
  request.
- A row in `sessions` holds no token, and a copied row hash does not work as a bearer token.
- A body over the login limit gets 413, also when it is chunked, and the chunked case is not held in memory.
- A body with unknown fields, a NUL, a lone surrogate or invalid UTF-8 gets 422, and the 422 does not hold the password.
- A one-time password with no new password gets 403 `password_change_required`, gets no token and leaves the password as
  it was. With a new one it gets a token, and the one-time password stops working.
- A new password that is too short, too long, equal to the name or equal to the current password gets 422, gets no token
  and changes nothing.
- A wrong one-time password with an invalid new password gets the normal 401, so the rule is not reported.
- A correct normal password with a `new_password` gets 422 and changes nothing, also for the admin.
- A password reset or a deactivation between the two units of work of a login makes that login lose the race, get the
  normal 401 and create no session, and the counter stays as it was.
- A password reset or a deactivation that runs during the second unit of work of a login leaves no session behind, and a
  session does not come back on reactivation (`podman`).
- A failing database during a login gets 503, never a 401.
- A successful login upgrades a hash with old parameters and leaves `changed_at` alone, and skips the upgrade when no
  hash slot is free. A login that gets 403 or 422 upgrades nothing.
- No token and no password appears in a log.

## Login Protection Cases

- The failure after the free attempts starts the wait, and the right password during the wait fails with the same
  answer. Refused attempts during the wait neither count nor extend it.
- A successful login resets the counter, also against concurrent failures (`podman`).
- Over the limit of hashes, a login gets 503, and other requests go on answering while hashes run.
- Every row of the [counter table](authentication.md#login-protection) holds.
- A correct password in a parallel burst that started a wait loses the race and gets the normal 401 (`podman`).

## Session Cases

- Logout deletes the session of the request and answers 204, the token then gets 401, and another session of the user
  keeps working.
- Two concurrent logouts of one session both answer 204.
- An expired session gets 401 and a new login works, in separate committed transactions (`podman`).
- A successful login deletes the expired rows of its user and leaves the others (`podman`).

## Token Check Cases

- These each get 401: an unknown token, an expired token, and a token of a deactivated user.
- A value of the wrong shape gets 401 with a unit-of-work factory that fails when called, so it causes no lookup.
- A valid token gets 503 when the lookup fails, never 401.
- A 401 for a presented token carries `error="invalid_token"`, and a 401 without a token does not.

## Password Change Cases

- A correct change answers 204 and ends all sessions of the user, including the one that sent it, and the new password
  works.
- A wrong current password gets 403, not 401, the token keeps working, and the failure counts toward the wait.
- The right current password during a wait gets 403 and changes nothing.
- The admin gets 403 and the password stays, also with a correct current password.
- A new password that breaks a rule gets 422 and changes nothing, and only after the current password was correct.
- A password reset between the two units of work gets 403, the password from the reset stays, and the counter stays as
  it was.
- A `current_password` over the length limit gets 403, runs no hash and does not count.
- Over the limit of hashes, the change gets 503 and changes nothing.

## Middleware and Error Format Cases

- `lifespan` passes through the middleware, so startup and shutdown still run.
- A `websocket` scope is closed without reaching the app.
- A route that needs a principal and finds none in the scope gets 500 and calls no service.
- The 401, the 404 for an unknown route, the 405, the 413, the 422 from schema validation, the 422 for an unparsable
  body, the 500 and the 503 are problem+json, each with its
  [code, title, status and detail](errors.md#rest-error-format).
- A 422 from schema validation, from domain validation and for an unparsable body has `errors` with `field` and
  `reason`. The body does not hold the input value, also for a rejected `content_md`.
- A credential check that raises gets 503 problem+json without exception details. No adapter is reached, and health
  still answers.

## Time Cases

- `UtcDatetime` writes UTC with `Z` and six fractional digits, also when the microseconds are exactly zero.

## Integration Cases (`podman`)

- Table constraints hold.
- Writes are atomic, such as a folder with its default tab.
- A unique violation surfaces inside the repository call.
- Time-dependent behaviour works in separate committed transactions.
- `hippowiki migrate` followed by `hippowiki init` twice leaves one admin, who can not log in until
  `hippowiki set-admin-password` runs.
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
- In the production composition test, after `hippowiki migrate`, `hippowiki init` and setting the admin password, the
  admin logs in and creates a folder on REST. A user with a right logs in and reads it, and a user with no right gets
  the full 404 body.
