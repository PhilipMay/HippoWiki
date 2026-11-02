# Review Findings

Review of all documents in `spec/`, checked against each other, the Makefile, `pyproject.toml`, the CI workflows, the
tests and the source of the `mcp` SDK 2.3.0. Everything already listed in [Known Limitations](known-limitations.md) is
left out. The core rules on rights, check order and rejected operations are largely consistent, see
[Checked Without Findings](#checked-without-findings). Most findings sit in the architecture and at the seams to MCP.

## Important

These affect the design or would break the implementation as specified.

- **Repositories and transactions do not fit together** (`architecture.md:67`, `:75`, `:98`, `:109`, `:113`, `:125-127`,
  `testing.md:3`)
  - `create_app()` receives the repositories once at startup, but real repositories need the session of the current
    request or tool call, because there is one transaction per request.
  - `api/deps.py` provides the session, although `api/` must "never touch the DB". With fakes there is no engine or
    session to provide, and `make test` needs no database.
  - Services use only the repository Protocols, and `interfaces.py` has one per repository. Nothing lets a service or
    adapter define a transaction, although creating a folder with its default tab has to be atomic (`entities.md:128`).
  - The MCP adapter needs the same mechanism, since FastAPI dependencies do not reach it, but the server factory is only
    described as taking the principal resolver (`architecture.md:101`).
  - Repositories can only translate a unique violation into `DuplicateNameError` (`architecture.md:115`) if they flush
    explicitly. Otherwise SQLAlchemy raises it later, outside the repository.
  - Suggestion: add a unit-of-work Protocol and pass `create_app()` a factory for it. Each adapter opens one per request
    or tool call, and the fakes implement it too.
- **The shared Pydantic models have no shared place** (`architecture.md:48`, `:97`, `:109`, `time.md:30`)
  - The models are described as shared between REST and MCP tool inputs, but they live in `api/schemas.py`, the REST
    adapter. `mcp/tools.py` would have to import from another adapter, while the layer rules say adapters call only
    `services/`.
  - `UtcDatetime` is shared too and has no module at all.
  - Suggestion: add a top-level `schemas/` package and allow both adapters to use it in the layer rules.

## Medium

These are contradictions or undefined behaviour that an implementer would have to guess.

- **Error mapping covers MCP tools only, but the layout has MCP resources** (`architecture.md:103`, `api.md:69-82`,
  `auth-concept.md:13`, `testing.md:20`)
  - Every MCP row says "tool error", but a failed resource read is a protocol error in the SDK
    (`mcpserver/server.py:469-475`).
  - The identical 404 and the no-leaks rule are not defined for resources, and no test kind covers them.
  - Suggestion: remove `resources.py` for now or define its errors and tests.
- **Failure of the credential lookup is undefined** (`architecture.md:128`, `api.md:86-89`, `testing.md:41`)
  - When the database is down, the lookup in the middleware fails on every request. The spec does not say whether that
    is a 500 or a 503, whether the body is problem+json, or what MCP clients see.
  - It should be stated that this fails closed, and it should get a test, since `api.md` itself points out that the
    middleware runs outside the exception handlers.
- **Unknown routes and wrong methods are missing from the check order** (`api.md:7-18`, `:88`, `testing.md:40-41`)
  - The order says it applies to every request to a non-public route, but 404 for an unknown route and 405 are not part
    of it. From `architecture.md:146` an unauthenticated request to an unknown route gets 401.
  - Suggestion: add a routing step between authentication and schema validation.
- **Deleting a right that does not exist is undefined** (`entities.md:113`, `api.md:15`)
  - Target lookup lists only a missing tab, md_document or user. Both 404 and an idempotent success are plausible.
- **What an admin sees as their rights is undefined** (`auth-concept.md:39`, `:53-54`, `entities.md:115-116`)
  - "All users can see their own full rights", but an admin's implicit `update` is not stored, and their stored rows have
    no effect while `is_admin` is true.
  - Own rights, the rights of a folder and all rights could therefore return rows that have no effect and leave out the
    right that does. Define whether these operations return stored rows or effective rights.
- **The package layout misses files the text relies on** (`architecture.md:64-104`, `:118`, `deployment.md:3`, `:7`)
  - Alembic configuration and migration scripts have no location. The slim runtime image needs them for
    `hippowiki migrate`, so they have to be part of the package or be copied explicitly.
  - Domain errors are "defined in the service layer", but `services/` has no module for them.
- **Contract tests can not guarantee what is claimed** (`testing.md:7`, `:10-11`, `:13-14`, `:43`)
  - "So the fakes can not drift" does not hold: the real side of the suite does not run in CI, and the fakes
    intentionally differ on foreign keys and check constraints. The suite can not assert these on both sides.
  - Suggestion: phrase it as "drift shows up when `make test-podman` runs".

## Minor

These are small contradictions and loose ends.

- **Wrong wording on user names** (`api.md:39-40`): "only admins ... change folder and user names" contradicts "users can
  not be renamed" (`entities.md:74`). Conflicts come from creating folders and users and from renaming folders.
- **`id` tie-breaker does not fit every table** (`time.md:17`): `folder_rights` has no `id`, only the composite key
  (`entities.md:86`), and "list all rights of all folders" is such a list.
- **Infrastructure wording** (`goals.md:13`, `architecture.md:36`, `deployment.md:10`)
  - A reverse proxy is required for remote MCP, while PostgreSQL is called the only infrastructure dependency and
    everything between clients and PostgreSQL is said to run in one process.
  - "Pure Python" also does not hold for dependencies such as asyncpg and pydantic-core, which are compiled.
- **Second access path without a principal** (`architecture.md:110-112`, `:128`): `create_root_admin` is called "the one
  exception", but the credential lookup also runs without a principal. The layer rules do not say which layer it uses.
- **Generic 401 header** (`api.md:86`): RFC 9110 requires `WWW-Authenticate` on a 401, and MCP clients use it to find the
  login method. The spec only defines the body.
- **ID generation is undefined** (`entities.md:20`, `:49`, `:60`, `:64`)
  - The spec does not say whether the app or the database generates IDs, or which UUID version they use. PostgreSQL 16
    and Python 3.13 have no built-in UUIDv7.
  - The root admin refers to itself in `created_by`, so its ID must be known at insert.
- **Replacing a right and `created_at`** (`entities.md:112`, `time.md:10-14`): `DEFAULT now()` does not fire on
  `ON CONFLICT DO UPDATE`, so an upsert keeps the old time unless it sets the column. `created_at` also has a different
  meaning here than "entered this system".
- **Read right and the folder itself** (`auth-concept.md:20-22`, `api.md:7`, `:41`): `read` lists tabs and md_documents,
  but not listing or reading the folder, although that is how a user finds it.
- **Browser clients** (`goals.md:8`, `architecture.md:142-146`): REST is meant for web clients, but CORS is not mentioned.
  A preflight `OPTIONS` carries no credentials, so the middleware would reject it with 401.
- **User deletion is promised but not tracked** (`auth-concept.md:8`, `:63`, `known-limitations.md:8-9`)
  - Deleting and deactivating users "will change later", but the open question on deletion names only md_documents, tabs
    and folders, and no column supports deactivation.
  - "Disabled" and "deactivated" are used for the same thing.
- **Components without a specified use** (`architecture.md:51`, `:54-55`, `:90-91`, `time.md:17-18`, `time.md:39-40`)
  - `parse.py` extracts titles and sections, but no entity has a title and no specified operation uses sections.
  - Frontmatter is only needed for import and export, which are not planned yet.
  - `time.md` refers to "sync", which appears nowhere else.
- **Overstated asyncpg rule** (`time.md:27`): "asyncpg returns aware UTC datetimes" has an exception that a test pins:
  `infinity` comes back naive (`tests/test_time_asyncpg.py:70-71`). A sentence that such values are not allowed would
  close this.
- **Token assumption in the time rules** (`time.md:13`, `:34`): they assume host clock token validation and JWT claims,
  while the login method is still open (`known-limitations.md:28`). A stored token with a persisted expiry would fall
  under the database clock rule instead.
- **Owner of the UTC setting** (`time.md:8`): server and connection time zone are "set to UTC", but neither
  `deployment.md` nor the engine description says where.

## Terminology and Typos

- **`write` versus `update`**: the `write` right "can update the content" (`auth-concept.md:26`), while the `update` right
  covers renaming and moving (`auth-concept.md:28-33`). The names invite mistakes, and something like `manage` would be
  clearer for the top level. The values appear in `entities.md:82` and `:87`.
- **`md_document` versus `document`**: the code layout and validation text use `document` (`DocumentService`,
  `documents.py`, `architecture.md:78`, `:85`, `:127`, `:133`), while all other documents use `md_document`.
- **Redundant name rule** (`architecture.md:133`): `a-z0-9-` already excludes `/`.
- **`known-limitations.md`**
  - Typos: "contraints" (`:5`), "plannning" (`:13`), "seperately" (`:37`).
  - `:5` and `:10` both cover name rules, and `:7` repeats itself.
- **`CLAUDE.md`**: typo "kown limitations" in the document list.

## Checked Without Findings

- The rejected operations in `api.md` match the service rules in `entities.md`, and the check order tests in `testing.md`
  match the check order in `api.md`.
- The check constraints do what `entities.md` says, including at most one default tab per folder and one root admin.
- The "four unique constraints" in `testing.md` are correct, and `RIGHT` is a reserved word in PostgreSQL.
- Links and anchors between the documents resolve.
- The Makefile and the CI workflows match `testing.md`.
- `mcp` 2.x exists on PyPI with the `MCPServer` API.
- The library behaviour in `time.md` matches the tests. `make test` passes, but `make test-podman` was not run, so the
  asyncpg claims were compared with the tests only and not run against PostgreSQL.
