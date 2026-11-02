# Review Findings

Review of all documents in this folder. Topics already listed in [Known Limitations](known-limitations.md) are left out,
unless the finding is a contradiction that the listed topic does not cover. References are `file:line`.

## High

Findings that block implementation or would lead to wrong behaviour.

### Search is both a goal and a non-goal

- Where: `goals.md:7-8` against `goals.md:19`
- Problem: the goals say that MCP and REST can "list, search, read and write", the non-goals say "No search". Other
  documents assume search exists: `SearchService` in `architecture.md:81`, search snippets in `auth-concept.md:13`, search
  filters in `time.md:35`. Known Limitations only says search still has to be designed, not whether it is in scope.
- Proposal: remove "search" from `goals.md:7` and mark the other mentions as later

### Conflicts have no domain error and no response

- Where: `api.md:14`, `api.md:30`, `api.md:47-53`, `architecture.md:107`, `entities.md:27`, `entities.md:41`
- Problem: the check order reports "name or version conflict" in its last step, but the error table has no row for it, and
  no status code such as 409 is defined anywhere. `VersionConflictError` has no mapping, and a name conflict has no domain
  error at all, although four unique constraints can cause one. The table also has no "Request state" row for a missing
  tab or md_document, and its check names do not match the check order.
- Proposal: add a `NameConflictError` or a general `ConflictError`, and table rows for conflicts and for missing items.

### In-memory MCP tests can not test authentication or rights

- Where: `testing.md:8` against `testing.md:9-10`, `testing.md:14-15`, `architecture.md:123-125`
- Problem: MCP tests use an in-memory client session, which has no HTTP layer. It bypasses the auth middleware, and that
  middleware is the only place where the principal enters the ASGI scope. So these tests can neither see a 401 nor call a
  tool as a specific user, which the check order tests need on MCP.
- Proposal: run the auth and check order tests over streamable HTTP against the ASGI app, and keep the in-memory session
  for tool behaviour only. Define how the in-memory tests get a principal.

### The testing strategy does not say where most tests get their data

- Where: `testing.md:4-5`, `testing.md:7-13`, `testing.md:16-18`
- Problem: only integration tests are said to carry the `podman` marker. REST, MCP and check order tests also need
  folders, users and rights: hidden against readable folder, too low right. If they use the real database they need the
  marker, and then CI skips them, because CI runs only `make test`. The access rules and the table constraints would never
  run in CI. If they use fakes, the fakes are not specified, and repository fakes would not enforce the constraints.
- Proposal: decide between fakes for `make test` and running `make test-podman` in CI, and state which test kinds carry
  the marker.

## Medium

Contradictions and gaps that have a local fix.

### The package layout has no place for tabs and folder rights

- Where: `architecture.md:73-82` against `entities.md:8`, `entities.md:11`, `auth-concept.md:27`, `auth-concept.md:51-53`
- Problem: `repositories/` and `services/` have modules for folders, documents and users, but none for tabs or folder
  rights, although both are entities with their own operations.
- Proposal: add `tabs.py` and `folder_rights.py`

### Targets in the request body are not covered by the visibility rules

- Where: `api.md:25-28` against `auth-concept.md:33`, `entities.md:127`, `entities.md:129`
- Problem: the rule "resolving by ID" covers one addressed item and one folder. Moving a md_document, or creating one with
  an explicit tab, names a second item. The response for a target tab in another folder is undefined. An error like "tab is
  in another folder" next to a 404 for a missing tab would reveal that the tab exists, which breaks the identical 404 of
  `api.md:25`.
- Proposal: a target tab that is not in the folder of the operation gets the same 404 as a missing tab, whatever the rights
  of the user on its folder.

### Most rejected operations have no defined response

- Where: `entities.md:125-133` against `api.md:40-41`
- Problem: the API only defines the response for the two `is_admin` rules. Renaming a default tab, moving a tab, moving a
  md_document to another folder and renaming a user are "rejected" without a domain error or status. The two defined 403s
  also do not fit the check order: they depend on the target, so they come after step 4, and the response for a target user
  that does not exist is not stated.
- Proposal: assign each rule a domain error, and place the target-dependent rules in the check order.

### Listing the rights of a folder falls between two rules

- Where: `api.md:35-39` against `auth-concept.md:53`, `entities.md:88`
- Problem: for non-admins, operations "on an existing folder" get 404 or 403, and all other admin operations get 403.
  Listing the rights of a folder is in neither list, so a user with no right could get either response.
- Proposal: add it to the first list. A list of all rights of all folders belongs in the second one.

### The public route test contradicts the public routes

- Where: `testing.md:14-15` against `goals.md:11`, `architecture.md:126-129`
- Problem: the test says "every other route gets 401", but the routes the login method needs are public too. The test
  fails as soon as these routes exist.
- Proposal: write "every route except health and the login routes".

### The admin operation test contradicts the check order

- Where: `testing.md:12` against `api.md:35-36`
- Problem: the test expects 403 with a valid body for a non-admin on an admin operation. For a folder operation, such as
  renaming a folder, a user with no right on it gets 404.
- Proposal: limit the test to the operations of `api.md:37`, and add a separate case for folder operations.

### "Every REST error" is problem+json, but only two kinds have a home

- Where: `api.md:58-59` against `architecture.md:87`, `architecture.md:93`
- Problem: `api/errors.py` covers domain and request validation errors. The 401 is written by the middleware in `auth/`,
  which runs outside FastAPI's exception handlers. The framework's own 404 for unknown routes, 405 and 500 are not
  mentioned and return a different body by default.
- Proposal: name a shared problem+json helper usable by the middleware, and add a handler for framework errors.

### Malformed JSON on MCP is not a tool error

- Where: `api.md:11`, `api.md:50`
- Problem: the table says schema validation failures are tool errors on MCP. That holds for invalid tool arguments. A body
  that is not JSON never reaches a tool, so it is a protocol or transport error.
- Proposal: split the MCP cell into malformed JSON (protocol error) and invalid arguments (tool error).

### System initialization is not specified

- Where: `entities.md:116`, `auth-concept.md:7`, `deployment.md:6`, `architecture.md:104`
- Problem: no document says what triggers the creation of the root admin, or whether it is idempotent. Known Limitations
  only covers its credential. It also breaks a layer rule, because services receive a `Principal` on every call and no
  principal exists yet. Related: `deployment.md:6` leaves open whether migrations run "on startup or via
  `hippowiki migrate`".
- Proposal: define the trigger, for example a step of the migration or an explicit CLI command, and how it passes the
  service layer. Decide how migrations run.

### No entity has the `updated_at` that the time rules describe

- Where: `time.md:7`, `time.md:10`, `time.md:25` against `entities.md:18-25`, `entities.md:32-39`, `entities.md:47-52`,
  `entities.md:58-65`
- Problem: the time rules specify how `updated_at` is set, and content, names and `is_admin` can change, but all tables
  only have `created_at`. Known Limitations lists versioning, which may or may not replace this column.
- Proposal: add this to `known-limitations.md`

## Low

Smaller inaccuracies and wording.

- A read-only user writing to a missing md_document gets different responses depending on the addressing: 404 by ID, since
  there is no folder to resolve (`api.md:27-28`), and 403 through its folder (`api.md:13-14`). This leaks nothing, but the
  404 for an ID that can not be resolved should be stated.
- `time.md:27` says asyncpg returns aware UTC datetimes, and `time.md:19-20` calls a naive `datetime` a bug. The test
  `test_infinity_is_returned_naive` in `tests/test_time_asyncpg.py:70` pins an exception: `infinity` comes back naive. State
  that `infinity` is not used, or how it is handled.
- `auth-concept.md:39` says all users can see their own full rights, while the rights of an admin are implicit
  (`entities.md:113-115`). It is undefined whether an admin sees `update` on all folders, the stored rows without effect, or
  both.
- `goals.md:13` calls PostgreSQL the only infrastructure dependency, while `deployment.md:7` requires a reverse proxy for
  remote MCP connectors.
- Some parts have no user in the specs: title extraction in `architecture.md:84`, since md_documents have no title column,
  and split and join of frontmatter in `architecture.md:85`, since `time.md:39` keeps frontmatter verbatim in `content_md`.
  "placeholder resolution" in `architecture.md:88` is not explained.
- The session manager of the MCP SDK may need to run in the lifespan of the parent app, because Starlette does not run the
  lifespan of mounted apps. `architecture.md:67` only names the DB engine. This was not checked against the SDK 2.x.
- Terminology:
  - `md_document` in `entities.md` against `document` in `architecture.md:75`, `architecture.md:80`, `architecture.md:119`
  - "disabled" in `auth-concept.md:8` against "deactivated" in `entities.md:117`
  - the `write` right "can update the content" (`auth-concept.md:26`), but the `update` right is the one for renaming and
    moving (`auth-concept.md:28-33`), which invites mistakes
- Spelling: "contraints" (`known-limitations.md:5`), "plannning" (`known-limitations.md:12`), "seperately"
  (`known-limitations.md:36`), "an other" (`auth-concept.md:40-41`).

## Checked Without Findings

- The table constraints do what `entities.md` claims, including the NOT NULL that the check on `is_default` relies on, the
  root admin rules and the index coverage. `RIGHT` is a reserved word in PostgreSQL.
- All links between the documents resolve.
- The Pydantic, PyYAML, asyncpg and `now()` claims in `time.md` match what the tests in `tests/` assert. The tests were
  read, not run, for this review.
- `testing.md` matches the Makefile and the two CI workflows. The dev dependencies in `architecture.md:60` match
  `pyproject.toml`.
- The `mcp` SDK has 2.x releases on PyPI (latest 2.3.0). The `MCPServer` API name itself was not checked.
