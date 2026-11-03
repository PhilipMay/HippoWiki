# Architecture

The scope of the project is defined in [Goals and Non-Goals](goals.md). See also [Testing](testing.md) and
[Deployment](deployment.md).

## Overview

```text
 Claude, ChatGPT         Web clients, scripts
        │                         │
        └────────────┬────────────┘
                     ▼
           ┌───────────────────┐
           │ Auth → Principal  │
           └─────────┬─────────┘
        ┌────────────┴────────────┐
        ▼                         ▼
 ┌─────────────┐          ┌───────────────┐
 │ MCP  /mcp   │          │ REST /api/v1  │
 └──────┬──────┘          └───────┬───────┘
        └────────────┬────────────┘
                     ▼
           ┌───────────────────┐
           │ Service layer     │
           └─────────┬─────────┘
                     ▼
           ┌───────────────────┐
           │ Repositories      │
           └─────────┬─────────┘
                     ▼
           ┌───────────────────┐
           │ PostgreSQL        │
           └───────────────────┘
```

All application code between the clients and PostgreSQL runs in a single ASGI process, behind a reverse proxy for remote
access. Clients log in at Keycloak, a separate service that issues the tokens, see [Authentication](authentication.md).

Key idea: **MCP and REST are thin adapters** over the same service layer. All domain rules (domain validation,
permissions, versioning) live in exactly one place, so both interfaces always behave identically. The adapters only
check the shape of the input. The one exception is that some things exist only on REST: the admin, admin operations,
history and revert, see [Admin Account](mcp.md#admin-account) and [History and Revert](mcp.md#history-and-revert).

## Technology Stack

| Area                 | Choice                                                                                                                              | Why                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Language / tooling   | Python 3.13, uv, black, ruff, mypy, import-linter, mdformat, pytest                                                                 | Already set up in this repo                                                                                                              |
| Web framework        | **FastAPI** + **Uvicorn**                                                                                                           | Async, ASGI, automatic OpenAPI description, Pydantic integration                                                                         |
| Schemas / validation | **Pydantic v2**                                                                                                                     | Request models for REST, response models and field types shared with [MCP tools](mcp.md#tool-arguments); they check shape and types only |
| Configuration        | **pydantic-settings**                                                                                                               | Typed config from environment variables / `.env`                                                                                         |
| MCP                  | Official **`mcp` Python SDK** 2.3 (`MCPServer` API)                                                                                 | Reference implementation; streamable HTTP transport; its routes can be added to the FastAPI app                                          |
| Database             | **PostgreSQL 16+**                                                                                                                  | Robust, transactional, enforces the table constraints                                                                                    |
| ORM / DB access      | **SQLAlchemy 2.1** (`sqlalchemy[asyncio]`, async, fully typed) + **asyncpg**                                                        | Works well with strict mypy, mature; greenlet is only in the `asyncio` extra                                                             |
| Migrations           | **Alembic**                                                                                                                         | Standard for SQLAlchemy                                                                                                                  |
| Login                | **Keycloak** 26.8.1, pinned to this exact version                                                                                   | Login pages, passwords and tokens without HippoWiki code                                                                                 |
| Token check          | **PyJWT** with **cryptography**, **httpx** to fetch the signing keys                                                                | Verifies RS256 tokens; PyJWT's own key client blocks the event loop, so httpx is a runtime dependency as well                            |
| Frontmatter          | **PyYAML**                                                                                                                          | A dev dependency for the pin tests for now                                                                                               |
| Tests                | **pytest-asyncio**, **httpx** (`AsyncClient`), **testcontainers** (PostgreSQL)                                                      | Fakes for most tests, a real Postgres for integration tests                                                                              |
| Packaging / deploy   | Container image (`Containerfile`) built with uv and **Podman**, `compose.yaml` run via `podman compose` (app + Postgres + Keycloak) | Simple self-hosting                                                                                                                      |

All chosen libraries have type hints, which matters because `make check` runs mypy in strict mode. PyYAML and asyncpg do
not ship their own, so they use the dev dependencies `types-pyyaml` and `asyncpg-stubs`.

## Package Layout

```text
src/hippowiki/
├── __init__.py
├── app.py               # ASGI composition: create_app(unit-of-work factory, credential check), services, FastAPI app + MCP routes,
│                        # lifespan (MCP session manager)
│                        # create_production_app(): real factory and credential check, lifespan (DB engine)
├── cli.py               # CLI: hippowiki migrate, hippowiki init, hippowiki link-admin
├── config.py            # Settings (pydantic-settings)
├── domain.py            # frozen dataclasses exchanged by repositories, services and adapters, including Page and UserRef
├── logs.py              # JSON log formatter and logging setup, also for Uvicorn's loggers
├── problem.py           # RFC 9457 problem+json helper, used by auth/middleware.py, api/errors.py and mcp/server.py
├── db/
│   ├── engine.py        # async engine (server_settings={"timezone": "UTC"}) + session factory (expire_on_commit=False)
│   ├── models.py        # SQLAlchemy ORM models
│   └── migrations/      # Alembic env.py, script.py.mako and versions/, shipped inside the package
├── schemas/             # Pydantic request and response models for REST, response models and field types shared with MCP
│   ├── paging.py        # types for limit and the cursors of lists
│   ├── text.py          # SafeText
│   └── time.py          # UtcDatetime
├── repositories/        # DB access only, no business rules
│   ├── interfaces.py    # one typing.Protocol per repository, UnitOfWork Protocol, DuplicateNameError, DuplicateSubjectError
│   ├── unit_of_work.py  # UnitOfWork over one DB session, gives access to the repositories on that session
│   ├── folders.py
│   ├── tabs.py
│   ├── md_documents.py
│   ├── revisions.py
│   ├── folder_rights.py
│   └── users.py
├── services/            # business logic + access checks, used by REST and MCP
│   ├── errors.py        # domain errors
│   ├── folders.py       # FolderService
│   ├── tabs.py          # TabService
│   ├── md_documents.py  # MdDocumentService
│   ├── folder_rights.py # FolderRightService
│   └── users.py         # UserService
├── auth/
│   ├── tokens.py        # token check: verifies the JWT and returns its subject, caches the signing keys of Keycloak
│   ├── credentials.py   # credential check: looks up the user through the unit-of-work factory, not a service
│   ├── middleware.py    # ASGI middleware: rejects with 401, 403 (admin on MCP), 413 or 503, buffers the body, or stores the principal in the scope
│   └── principal.py     # Principal abstraction (user / admin)
├── api/                 # REST adapter
│   ├── routers/
│   ├── deps.py          # FastAPI dependencies (principal from the scope, services)
│   └── errors.py        # domain exceptions, request validation errors and framework errors → RFC 9457 problem+json
└── mcp/                 # MCP adapter
    ├── server.py        # MCPServer factory (takes the services and the principal resolver), stateless transport setup,
    │                    # routes for app.py, 405 for everything except POST
    └── tools.py         # tool definitions wrapping services, shared wrapper: forbids unknown arguments, raises ToolError
```

## Layer Rules

`make check` enforces these with [import-linter](https://import-linter.readthedocs.io/), with its contracts in
`pyproject.toml`, because nothing else would catch a violation.

- **Adapters** (`api/`, `mcp/`):
  - The [auth middleware](authentication.md#request-handling) runs before them.
  - They call **only** `services/` for behaviour, and make exactly one service call per request or tool call.
  - Apart from that they may import `schemas/`, `domain.py`, `services/errors.py`, `auth/principal.py` and `problem.py`.
    They never touch the DB, sessions or repositories directly.
- **Composition roots**: `app.py` and `cli.py` may import anything, and nothing imports them.
- **Pure modules**: `schemas/` imports no other HippoWiki package, which keeps validators free of lookups. `domain.py`,
  `problem.py` and `config.py` import no other HippoWiki package either.
- **Data between the layers**: repositories and services exchange the small frozen dataclasses from `domain.py`, and the
  adapters map them to `schemas/`. ORM models stay inside `db/` and `repositories/`, so they never reach a service or an
  adapter, the fakes need no SQLAlchemy objects, and `schemas/` stays free of domain types. The dataclasses are not next
  to the Protocols, because the adapters would then have to import from `repositories/`.
- **Services** (`services/`):
  - They never import `schemas/`, and take plain arguments.
  - They use repositories only through the Protocols in `repositories/interfaces.py`, and reach them through a unit of
    work.
  - They are stateless and get the unit-of-work factory when they are built.
  - They receive a `Principal` on every call and enforce access rules. There are three exceptions, because no principal
    exists yet:
    - `UserService.create_admin` at system initialization. Only `hippowiki init` calls it, and no adapter exposes it.
    - `UserService.link_admin`, which gives the admin its login. Only `hippowiki link-admin` calls it, and no adapter
      exposes it.
    - The credential check in `auth/credentials.py`, which produces the principal. It is not a service, and reads users
      through the unit-of-work factory and the repository Protocol.
- **Repositories** (`repositories/`):
  - They do DB access only, with no permission or business logic, and get their session from the unit of work.
  - Their methods return only live rows, unless a method is named for deleted ones, so a service can not forget the
    filter. See [Deleting and Restoring Content](entities.md#deleting-and-restoring-content).
- **`auth/`**:
  - `auth/principal.py` imports only `domain.py`, and the adapters, the services and the rest of `auth/` may import it.
  - `auth/tokens.py` imports no other HippoWiki package, and gets its settings as parameters.
  - `auth/credentials.py` uses only `repositories/interfaces.py`, `auth/principal.py` and `auth/tokens.py`.
  - `auth/middleware.py` uses only `auth/principal.py` and `problem.py`, and gets the credential check, the MCP path and
    the [request body limit](authentication.md#request-body-limit) as parameters.
- **Conflicts**:
  - Repositories flush after each write, so a unique violation surfaces inside the repository. It becomes
    `DuplicateNameError` or, for `auth_subject`, `DuplicateSubjectError`, and the service turns these into
    `NameConflictError` and `SubjectConflictError`.
  - Services do not check for duplicates up front, so concurrent requests get the same answer. PostgreSQL has then
    aborted the transaction, so the service does not continue in it.
  - The names `""` and `admin` are fixed rules instead, see [Names](entities.md#names), because they would hit a check
    constraint.
- **Domain errors** (`NotFoundError`, `ForbiddenError`, `NameConflictError`, `SubjectConflictError`,
  `VersionConflictError`, `DomainValidationError`) are defined in `services/errors.py` and translated by each adapter
  (HTTP status codes for REST, tool errors for MCP).

## Cross-Cutting Concerns

- **Configuration**: environment variables via pydantic-settings (`HIPPOWIKI_DATABASE_URL`, …).
- **Composition**: `create_app()` takes the unit-of-work factory and the credential check, because FastAPI dependencies
  do not reach the MCP routes. It builds the services once and passes them to both adapters, adds the MCP routes to the
  FastAPI router and runs the MCP session manager in the lifespan, see [MCP](mcp.md#serving-the-mcp-app). It knows
  nothing about the engine, so tests pass fakes and need no database, see [Testing](testing.md).
  `create_production_app()` builds the engine from the settings, passes the real factory and credential check, and
  disposes of the engine in the lifespan.
- **Transactions**: one unit of work, over one DB session and transaction, per public service method, and so per request
  or tool call.
  - Each public method opens it and commits it before returning, so a failed commit becomes an error response.
  - Leaving a unit of work without a commit rolls it back, also when a domain error passes through.
  - Public service methods do not call each other inside a transaction. Shared steps take the open unit of work as a
    parameter.
  - These are written atomically: a document update and its revision rows, a delete or restore and its revision, a new
    folder and its default tab, and a deleted user and the removal of their rights.
  - The credential lookup in the auth middleware uses its own short unit of work, separate from the transaction of the
    service call.
  - Stale principal: the principal is a snapshot from that lookup, so a request already running when a user is
    deactivated or deleted can still finish as that user. This is accepted, because it ends with that request. Services
    read folder rights inside their own transaction.
- **Logging**: stdlib `logging`, structured (JSON) in production; log who changed what. `logs.py` has a small JSON
  formatter, so no new dependency is needed, and Uvicorn's loggers go through the same handler, so all output has one
  format.
- **Validation and errors**: see [Request Checks](request-checks.md).
- **Time**: UTC everywhere, see [Time](time.md).
- **Auth**: see [Users and Rights](users-and-rights.md) and [Authentication](authentication.md).
- **REST adapter and lists**: see [REST](rest.md).
- **MCP adapter**: see [MCP](mcp.md).
