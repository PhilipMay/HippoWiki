# Review Findings

Review of all documents in `spec/`, checked against each other, the Makefile, `pyproject.toml`, the CI workflows, the
tests and the source of the `mcp` SDK 2.3.0. Last re-checked on 2026-11-02. Everything already listed in
[Known Limitations](known-limitations.md) is left out, unless a finding adds a consequence to an item there. The core
rules on rights, check order and rejected operations are largely consistent, see
[Checked Without Findings](#checked-without-findings). The findings under [Important](#important) affect behaviour or
security and should be fixed first, the others are small.

Each finding ends with a recommended fix. None of the fixes has been applied to the other documents yet.

## Important

These would cause wrong behaviour or leave a central rule unprotected.

- **Check constraints are reachable from normal input** (`entities.md:42`, `:68`, `:108`, `architecture.md:130-131`,
  `testing.md:9`)
  - An admin creating a user named `admin` inserts `is_root = false`. PostgreSQL runs check constraints before unique
    indexes, so this is a check violation, not `DuplicateNameError`, and becomes a 500 instead of a 409. Creating a tab
    named `''` or renaming a tab to it fails the same way.
  - Observed on PostgreSQL 16 with the constraints from `entities.md`. A second `hippowiki init` is not affected, because
    it inserts `is_root = true`, passes the check and hits the unique constraint as `entities.md:120` says.
  - `known-limitations.md:10` leaves the name rules open, but not this failure. The fakes do not reproduce check
    constraints, so `make test` can not notice it.
  - Fix: the name rules state that `''` for a tab gets `DomainValidationError` (422) and that `admin` for a new user gets
    `NameConflictError` (409), because the root admin exists whenever someone can authenticate. This is a fixed rule and
    not an up-front duplicate check, so it does not conflict with `architecture.md:131`. Add both cases to the integration
    tests.
- **MCP sessions are not bound to a user** (`architecture.md:159`, `:162-163`)
  - The SDK compares session owners only if `scope["user"]` is its own `AuthenticatedUser`
    (`streamable_http_manager.py:266-272`). The spec stores its own principal in the scope, so both sides are `None` and
    any authenticated user holding a session ID passes. Tool calls stay correct because the principal is read per request,
    but the session itself, including its GET stream, is shared.
  - Fix: set `stateless_http=True`. MCP is tools only for now (`api.md:87`), so nothing needs a session. Document it next
    to the mounting items in `known-limitations.md:26-34` and add a transport test.
- **The central visibility rules have no listed test** (`testing.md:30-46`)
  - Not covered: identical status and message for hidden and missing items (`api.md:32-35`, `:86`), hidden items left out
    of lists (`api.md:44`, `auth-concept.md:13`), a malformed ID getting 422 (`api.md:39`), naming a missing user getting
    404 (`api.md:52`), and which operation each right allows (`auth-concept.md:20-33`).
  - Fix: add these to `testing.md`, comparing the full 404 body on REST and the full tool error text on MCP, plus a matrix
    of operations against `read`, `write`, `update`, admin and no right.

## Minor

These are small contradictions and loose ends.

- **Wrong wording on user names** (`api.md:42-43`): "only admins ... change folder and user names" contradicts "users can
  not be renamed" (`entities.md:74`). Conflicts come from creating folders and users and from renaming folders.
  - Fix: `api.md:43` becomes "only admins, who see everything, create folders and users and rename folders".
- **`id` tie-breaker does not fit every table** (`time.md:17`): `folder_rights` has no `id`, only the composite key
  (`entities.md:86`), and "list all rights of all folders" is such a list.
  - Fix: `time.md:17` becomes "sorted lists use the primary key as a tie-breaker".
- **Infrastructure wording** (`goals.md:13`, `architecture.md:36`, `deployment.md:12`)
  - A reverse proxy is required for remote MCP, while PostgreSQL is called the only infrastructure dependency and
    everything between clients and PostgreSQL is said to run in one process.
  - "Pure Python" also does not hold for dependencies such as asyncpg and pydantic-core, which are compiled.
  - Fix: `goals.md:13` becomes "implemented in Python, with PostgreSQL as the only data store". `architecture.md:36`
    becomes "All application code between the clients and PostgreSQL runs in a single ASGI process, behind a reverse proxy
    for remote access".
- **Second access path without a principal** (`architecture.md:117-119`, `:148-149`): `create_root_admin` is called "the one
  exception", but the credential lookup also runs without a principal. The layer rules do not say which layer it uses.
  - Fix: say "two exceptions". The credential check lives in a new `auth/credentials.py`, reads users through the
    unit-of-work factory and the repository Protocol, and is not a service. Also drop the unclear "placeholder resolution"
    at `architecture.md:100`.
- **Required headers on 401 and 405** (`api.md:92`, `:95`, `testing.md:51`): RFC 9110 requires `WWW-Authenticate` on a 401,
  and MCP clients use it to find the login method. It also requires `Allow` on a 405. The spec only defines the bodies, and a
  handler that rebuilds the response loses the header the framework set.
  - Fix: `api.md` states that the 401 carries `WWW-Authenticate`, with its scheme set by the login method, and that the
    framework error handler keeps `exc.headers`. Add both headers to the error format tests.
- **ID generation is undefined** (`entities.md:20`, `:49`, `:60`, `:64`)
  - The spec does not say whether the app or the database generates IDs, or which UUID version they use. PostgreSQL 16
    and Python 3.13 have no built-in UUIDv7.
  - The root admin refers to itself in `created_by`, so its ID must be known at insert.
  - Fix: the app generates UUIDv4 with `uuid.uuid4()`. This needs no new dependency, sets the `id` and `created_by` of the
    root admin to the same value and reveals nothing. A UUIDv7 would put the host clock into stored data, against
    `time.md:10`. A random ID is fine as a tie-breaker, which only needs to be stable.
- **Replacing a right and `created_at`** (`entities.md:112`, `time.md:10-14`): `DEFAULT now()` does not fire on
  `ON CONFLICT DO UPDATE`, so an upsert keeps the old time unless it sets the column. Observed on PostgreSQL 16. `created_at`
  also has a different meaning here than "entered this system".
  - Fix: rename the columns to `assigned_by` and `assigned_at`, which also touches `entities.md:83-84` and
    `auth-concept.md:41`. Specify `ON CONFLICT DO UPDATE SET access_right, assigned_by, assigned_at = now()`. Delete and
    insert is not an alternative, because two concurrent first assignments would then hit the primary key. Add an
    integration test, since the fakes do not reproduce `now()`.
- **Read right and the folder itself** (`auth-concept.md:20-22`, `api.md:7`, `:44`): `read` lists tabs and md_documents,
  but not listing or reading the folder, although that is how a user finds it.
  - Fix: add to `read` in `auth-concept.md`: "can see the folder (ID and name) and find it in the folder list".
- **Browser clients** (`goals.md:8`, `architecture.md:164-168`): REST is meant for web clients, but CORS is not mentioned.
  A preflight `OPTIONS` carries no credentials, so the middleware would reject it with 401.
  - Fix: add to `known-limitations.md`: same origin only for now. If origins get allowed, CORS wraps outside the auth
    middleware and is configured by an allowlist that is empty by default, with a preflight test.
- **User deletion is promised but not tracked** (`auth-concept.md:8`, `:65`, `known-limitations.md:8-9`)
  - Deleting and deactivating users "will change later", but the open question on deletion names only md_documents, tabs
    and folders, and no column supports deactivation.
  - "Disabled" and "deactivated" are used for the same thing.
  - Fix: add users and deactivation to `known-limitations.md:8`, including that the credential check must reject deactivated
    users. Use "deactivated" at `auth-concept.md:8`.
- **Components without a specified use** (`architecture.md:51`, `:54-55`, `:93`, `:96-97`, `goals.md:19`, `time.md:17-18`,
  `time.md:39-40`)
  - `parse.py` extracts titles and sections, but no entity has a title and no specified operation uses sections.
  - Frontmatter is only needed for import and export, which are not planned yet.
  - The PostgreSQL row and `services/search.py` name search features, while search is a non-goal.
  - `time.md` refers to "sync", which appears nowhere else.
  - Fix: mark `markdown/`, markdown-it-py, `services/search.py` and the Markdown box in the diagram as later, tied to import
    and export. Drop the search features from the PostgreSQL row and "sync" from `time.md:17`. Keep the PyYAML rule in
    `time.md:39-40` and its pin tests, and move `pyyaml` to the dev group, since `src/` does not use it.
- **Overstated asyncpg rule** (`time.md:27`): "asyncpg returns aware UTC datetimes" has an exception that a test pins:
  `infinity` comes back naive (`tests/test_time_asyncpg.py:70-71`).
  - Fix: add to `time.md:27` "`infinity` comes back naive, so it is not a valid value". Columns only get `now()`, and
    Pydantic's `AwareDatetime` rejects it on input.
- **Token assumption in the time rules** (`time.md:13`, `:34`): they assume host clock token validation and JWT claims,
  while the login method is still open (`known-limitations.md:45`). A stored token with a persisted expiry would fall
  under the database clock rule instead.
  - Fix: `time.md:13` names only log lines and adds that an expiry stored in the database is compared with `now()`.
    `time.md:34` becomes "JWT claims, if the login method uses them".
- **Owner of the UTC setting** (`time.md:8`): server and connection time zone are "set to UTC", but neither
  `deployment.md` nor the engine description says where.
  - Fix: `db/engine.py` passes `server_settings={"timezone": "UTC"}`, as `tests/test_time_asyncpg.py:35` does, and
    `compose.yaml` sets `timezone=UTC` on the server. asyncpg returns UTC whatever the session time zone
    (`tests/test_time_asyncpg.py:46-54`), so this only affects `psql` and text casts in SQL.
- **MCP tool error format is undefined** (`api.md:73-86`)
  - Tool errors are plain text (`mcpserver/server.py:456`), so "tell the domain errors apart" has no defined mechanism.
  - An untranslated domain error is masked as `Error executing tool <name>` (`mcpserver/tools/base.py:211-213`).
  - The mapping table has no row for unexpected errors.
  - Fix: define a stable code per domain error at the start of the message, have `mcp/tools.py` raise `ToolError` with it,
    and add an "Unexpected" row to the table (REST 500, MCP a generic tool error without details). The SDK puts
    `Error executing tool <name>: ` in front of that message (`mcpserver/tools/base.py:208-210`), so clients have to find the
    code after this text.
- **Test list gaps outside visibility** (`testing.md:51`, `time.md:21`, `:27`)
  - The error format tests omit the 422, although `api.md:94` singles it out as needing a replaced body.
  - `testing.md` does not list `UtcDatetime` tests, the naive column test or the pin tests in `tests/test_time_*.py`.
  - Fix: add the 422, and add a test kind for time and for pinned library behaviour.
- **Rejected operations depend on unknown fields, and MCP drops them** (`api.md:67`, `known-limitations.md:35-41`)
  - On MCP, a call with `name` on a user or `folder_id` on a tab reports success without doing it. The known limitation only
    describes misspelled optional arguments, so this is a stronger reason to decide.
  - Fix: extend that limitation, and enforce `extra="forbid"` on the argument model through a shared wrapper instead of
    accepting the difference.
- **No limit before the body is parsed** (`api.md:12`, `:18`, `architecture.md:153`, `known-limitations.md:20`): the maximum
  document size is a domain check, so the whole body of an authenticated client is read and parsed first. 413 does not
  appear in the error table.
  - Fix: extend `known-limitations.md:20` with a request body limit in the middleware and the reverse proxy, separate from
    the document size, and add 413 to `api.md`.

## Terminology and Typos

- **`write` versus `update`**: the `write` right "can update the content" (`auth-concept.md:26`), while the `update` right
  covers renaming and moving (`auth-concept.md:28-33`). The names invite mistakes. The values appear in `entities.md:82` and
  `:87`.
  - Fix: rename the top level to `manage`, so the rights are `read`, `write` and `manage`. This also touches
    `auth-concept.md`, `entities.md:111`, `:114`, `api.md:45` and `testing.md:47`, and is cheap now, since nothing is
    implemented.
- **`md_document` versus `document`**: the code layout and validation text use `document` (`DocumentService`,
  `documents.py`, `architecture.md:83`, `:91`, `:147`, `:153`), and so do `entities.md:23` and `known-limitations.md:10`,
  `:11`, `:20`, `:55-56`. The other documents use `md_document`.
  - Fix: keep `md_document` in identifiers (`MdDocumentService`, `md_documents.py`). Prose may say "document" once the term
    is introduced.
- **Redundant name rule** (`architecture.md:153`): `a-z0-9-` already excludes `/`.
  - Fix: delete "no `/`", and state that a name has at least one character.
- **`known-limitations.md`**
  - Typos: "contraints" (`:5`), "plannning" (`:13`), "seperately" (`:54`).
  - `:5` and `:10` both cover name rules, `:7` repeats itself and `:6` is unclear.
  - Fix: correct the typos, merge `:5` into `:10`, shorten `:7` to "optimistic locking via `version`", and spell out `:6`.
- **`CLAUDE.md`**: typo "kown limitations" in the document list.
  - Fix: "known limitations".

## Checked Without Findings

- The rejected operations in `api.md` match the service rules in `entities.md`, and the check order tests in `testing.md`
  match the order in `api.md`. What those tests leave out is a finding under [Important](#important).
- The check constraints do what `entities.md` says, including at most one default tab per folder and one root admin.
- The "four unique constraints" in `testing.md` are correct, and `RIGHT` is a reserved word in PostgreSQL.
- Links and anchors between the documents resolve.
- The Makefile and the CI workflows match `testing.md`. A small leftover: `check.yml` and `test.yml` set the variables `src`
  and `other_src`, which nothing reads.
- `mcp` 2.x exists on PyPI with the `MCPServer` API, and the SDK references in `known-limitations.md:26-34` are correct.
- The MCP column of the error mapping in `api.md` holds against the 2.3.0 source: an unknown tool and invalid arguments give
  tool errors, an unknown method gives a protocol error, and unexpected exceptions are returned without details. This was
  read in the source, not run.
- The library behaviour in `time.md` matches the tests. `make test` passes with 29 tests and `make test-podman` with 7, so
  the asyncpg claims were also run against PostgreSQL 16.
