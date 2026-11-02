# HippoWiki Architecture

The scope of the project is defined in [Goals and Non-Goals](goals.md). See also [Testing Strategy](testing.md) and
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
           ┌───────────────────┐    ┌──────────────────┐
           │ Service layer     │───►│ Markdown (later) │
           └─────────┬─────────┘    └──────────────────┘
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
access.

Key idea: **MCP and REST are thin adapters** over the same service layer. All domain rules (domain validation,
permissions, versioning) live in exactly one place, so both interfaces always behave identically. The adapters only
check the shape of the input.

## Technology Stack

| Area                 | Choice                                                                                                                   | Why                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Language / tooling   | Python 3.13, uv, black, ruff, mypy, mdformat, pytest                                                                     | Already set up in this repo                                                                            |
| Web framework        | **FastAPI** + **Uvicorn**                                                                                                | Async, ASGI, automatic OpenAPI docs, Pydantic integration                                              |
| Schemas / validation | **Pydantic v2**                                                                                                          | Shared request/response models for REST and MCP tool inputs; they check shape and types only           |
| Configuration        | **pydantic-settings**                                                                                                    | Typed config from environment variables / `.env`                                                       |
| MCP                  | Official **`mcp` Python SDK** 2.x (`MCPServer` API)                                                                      | Reference implementation; streamable HTTP transport; can be mounted into FastAPI                       |
| Database             | **PostgreSQL 16+**                                                                                                       | Robust, transactional, enforces the table constraints                                                  |
| ORM / DB access      | **SQLAlchemy 2.0** (async, fully typed) + **asyncpg**                                                                    | Works well with strict mypy, mature                                                                    |
| Migrations           | **Alembic**                                                                                                              | Standard for SQLAlchemy                                                                                |
| Markdown             | **markdown-it-py**                                                                                                       | Later, for import and export: CommonMark-compliant parser, token stream for extracting headings        |
| Frontmatter          | **PyYAML**                                                                                                               | Later, for import and export: optional YAML frontmatter. A dev dependency for the pin tests until then |
| Tests                | **pytest-asyncio**, **httpx** (`AsyncClient`), **testcontainers** (PostgreSQL)                                           | Fakes for most tests, a real Postgres for integration tests                                            |
| Packaging / deploy   | Container image (`Containerfile`) built with uv and **Podman**, `compose.yaml` run via `podman compose` (app + Postgres) | Simple self-hosting                                                                                    |

All chosen libraries have type hints, which matters because `make check` runs mypy in strict mode. PyYAML and
asyncpg do not ship their own, so they use the dev dependencies `types-pyyaml` and `asyncpg-stubs`.

## Layered Architecture and Package Layout

```text
src/hippowiki/
├── __init__.py
├── app.py               # ASGI composition: create_app(unit-of-work factory, credential check), services, FastAPI app + mounted MCP app
│                        # create_production_app(): real factory and credential check, lifespan (DB engine)
├── cli.py               # CLI: hippowiki migrate, hippowiki init
├── config.py            # Settings (pydantic-settings)
├── problem.py           # RFC 9457 problem+json helper, used by auth/middleware.py and api/errors.py
├── db/
│   ├── engine.py        # async engine (server_settings={"timezone": "UTC"}) + session factory
│   ├── models.py        # SQLAlchemy ORM models
│   └── migrations/      # Alembic env.py, script.py.mako and versions/, shipped inside the package
├── schemas/             # Pydantic request/response models shared by REST and MCP tool inputs
│   └── time.py          # UtcDatetime
├── repositories/        # DB access only, no business rules
│   ├── interfaces.py    # one typing.Protocol per repository, UnitOfWork Protocol, DuplicateNameError
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
│   ├── search.py        # SearchService, later, see Goals
│   └── users.py         # UserService
├── markdown/            # later, for import and export: pure functions, no I/O
│   ├── parse.py         # title extraction, headings, sections
│   └── frontmatter.py   # split / join YAML frontmatter
├── auth/
│   ├── credentials.py   # credential check: looks up the user through the unit-of-work factory, not a service
│   ├── middleware.py    # ASGI middleware: rejects with 401, 413 or 503, or stores the principal in the scope
│   └── principal.py     # Principal abstraction (user / admin)
├── api/                 # REST adapter
│   ├── routers/
│   ├── deps.py          # FastAPI dependencies (principal from the scope, services)
│   └── errors.py        # domain exceptions, request validation errors and framework errors → RFC 9457 problem+json
└── mcp/                 # MCP adapter
    ├── server.py        # MCPServer factory (takes the services and the principal resolver), stateless transport setup
    └── tools.py         # tool definitions wrapping services, shared wrapper: forbids unknown arguments, raises ToolError
```

### Layer rules

- The auth middleware rejects unauthenticated requests on every non-public route before they reach `api/` or `mcp/`.
- `api/` and `mcp/` call **only** `services/` for behaviour and may import the models from `schemas/`. They never touch
  the DB, sessions or repositories directly.
- `api/` and `mcp/` make exactly one service call per request or tool call.
- `schemas/` imports no other HippoWiki package, which keeps validators free of lookups.
- `services/` receive a `Principal` on every call and enforce access rules. There are two exceptions, because no principal
  exists yet:
  - `UserService.create_root_admin` at system initialization. Only `hippowiki init` calls it, and no adapter exposes it.
  - The credential check in `auth/credentials.py`, which produces the principal. It is not a service, and reads users
    through the unit-of-work factory and the repository Protocol.
- `services/` use repositories only through the Protocols in `repositories/interfaces.py`, and reach them through a
  unit of work.
- `services/` are stateless and get the unit-of-work factory when they are built.
  - Each public method opens one unit of work and commits it before returning, so a failed commit becomes an error
    response.
  - Leaving a unit of work without a commit rolls it back, also when a domain error passes through.
  - Public service methods do not call each other inside a transaction. Shared steps take the open unit of work as a
    parameter.
- `repositories/` do DB access only; they contain no permission or business logic. They get their session from the unit
  of work.
- Name conflicts: repositories flush after each write, so a unique violation surfaces inside the repository, and they
  translate it into `DuplicateNameError`. Services turn that into `NameConflictError`. Services do not check for
  duplicates up front, so concurrent requests get the same answer. PostgreSQL has then aborted the transaction, so the
  service does not continue in it. The names `""` and `admin` are fixed rules instead, see
  [Tables, Entities and Rules](entities.md), because they would hit a check constraint.
- `markdown/` is pure and side-effect free, therefore easy to unit test, once it exists.
- Domain errors (`NotFoundError`, `ForbiddenError`, `NameConflictError`, `VersionConflictError`,
  `DomainValidationError`) are defined in `services/errors.py` and translated by each adapter (HTTP status codes for REST,
  tool errors for MCP).

## Cross-Cutting Concerns

- **Configuration**: environment variables via pydantic-settings (`HIPPOWIKI_DATABASE_URL`, …).
- **Composition**: `create_app()` takes the unit-of-work factory and the credential check, because FastAPI dependencies
  do not reach the mounted MCP app. It builds the services once and passes them to both adapters. It knows nothing about
  the engine, so tests pass fakes and need no database, see [Testing Strategy](testing.md). `create_production_app()`
  builds the engine from the settings, passes the real factory and credential check, and disposes of the engine in the
  lifespan.
- **Transactions**: one DB session/transaction per public service method, and so per request or tool call. A document
  update and its revision rows are written atomically, and so are a new folder and its default tab. The credential lookup
  in the auth middleware uses its own short unit of work, separate from the transaction of the service call.
- **Logging**: stdlib `logging`, structured (JSON) in production; log who changed what.
- **Validation**: two kinds, in the order defined in [API](api.md).
  - Schema validation in the adapters: shape and types through the Pydantic models, without database access.
  - Domain validation in the services: folder and md_document name rules (lowercase `a-z0-9-`, at least one character),
    maximum document size.
- **Time**: UTC everywhere, see [Time](time.md).
- **Auth**: authentication and folder-level rights, see [Auth Concept](auth-concept.md).
  - Authentication is one pure ASGI middleware, not `BaseHTTPMiddleware`, because MCP streams its responses.
  - It wraps REST and the mounted MCP app, since FastAPI dependencies do not reach mounted apps.
  - It stores the principal in the ASGI scope, and the OpenAPI security scheme is declared separately.
  - After authentication it rejects a request body over the limit with 413, before anything parses it, see [API](api.md).
  - The credential check returns a principal or nothing. An exception means the lookup failed, and the middleware fails
    closed, see [API](api.md).
  - MCP tools get the principal through a resolver passed to the server factory. The production resolver reads it from
    the ASGI scope of the HTTP request in the tool context and fails closed if there is none.
  - The MCP app runs with `stateless_http=True`. The SDK compares session owners only if the scope holds its own
    `AuthenticatedUser`, so with our principal in the scope any authenticated user holding a session ID would pass. MCP is
    tools only for now, so nothing needs a session, see [Known Limitations](known-limitations.md).
  - Public routes are the only ones the middleware lets through without authentication, as allowed by
    [Goals](goals.md):
    - health: liveness only, with a fixed status body, no database access and no version or configuration details
    - whatever the login method needs, see [Known Limitations](known-limitations.md)
  - Everything else stays behind authentication, including MCP and the OpenAPI docs.
- **Errors**: domain exceptions in the service layer, mapped per adapter, see [API](api.md).
