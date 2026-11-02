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
           ┌───────────────────┐    ┌──────────┐
           │ Service layer     │───►│ Markdown │
           └─────────┬─────────┘    └──────────┘
                     ▼
           ┌───────────────────┐
           │ Repositories      │
           └─────────┬─────────┘
                     ▼
           ┌───────────────────┐
           │ PostgreSQL        │
           └───────────────────┘
```

Everything between the clients and PostgreSQL runs in a single ASGI process.

Key idea: **MCP and REST are thin adapters** over the same service layer. All domain rules (domain validation,
permissions, versioning) live in exactly one place, so both interfaces always behave identically. The adapters only
check the shape of the input.

## Technology Stack

| Area                 | Choice                                                                                                                   | Why                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Language / tooling   | Python 3.13, uv, black, ruff, mypy, mdformat, pytest                                                                     | Already set up in this repo                                                                  |
| Web framework        | **FastAPI** + **Uvicorn**                                                                                                | Async, ASGI, automatic OpenAPI docs, Pydantic integration                                    |
| Schemas / validation | **Pydantic v2**                                                                                                          | Shared request/response models for REST and MCP tool inputs; they check shape and types only |
| Configuration        | **pydantic-settings**                                                                                                    | Typed config from environment variables / `.env`                                             |
| MCP                  | Official **`mcp` Python SDK** 2.x (`MCPServer` API)                                                                      | Reference implementation; streamable HTTP transport; can be mounted into FastAPI             |
| Database             | **PostgreSQL 16+**                                                                                                       | Robust, JSONB, built-in full-text search, `pg_trgm`, later `pgvector`                        |
| ORM / DB access      | **SQLAlchemy 2.0** (async, fully typed) + **asyncpg**                                                                    | Works well with strict mypy, mature                                                          |
| Migrations           | **Alembic**                                                                                                              | Standard for SQLAlchemy                                                                      |
| Markdown             | **markdown-it-py**                                                                                                       | CommonMark-compliant parser, token stream for extracting headings                            |
| Frontmatter          | **PyYAML**                                                                                                               | Optional YAML frontmatter on import/export                                                   |
| Tests                | **pytest-asyncio**, **httpx** (`AsyncClient`), **testcontainers** (PostgreSQL)                                           | Realistic tests against a real Postgres                                                      |
| Packaging / deploy   | Container image (`Containerfile`) built with uv and **Podman**, `compose.yaml` run via `podman compose` (app + Postgres) | Simple self-hosting                                                                          |

All chosen libraries have type hints, which matters because `make check` runs mypy in strict mode. PyYAML and
asyncpg do not ship their own, so they use the dev dependencies `types-pyyaml` and `asyncpg-stubs`.

## Layered Architecture and Package Layout

```text
src/hippowiki/
├── __init__.py
├── app.py               # ASGI composition: FastAPI app + mounted MCP app, lifespan (DB engine)
├── cli.py               # CLI
├── config.py            # Settings (pydantic-settings)
├── db/
│   ├── engine.py        # async engine + session factory
│   └── models.py        # SQLAlchemy ORM models
├── repositories/        # DB access only, no business rules
│   ├── folders.py
│   ├── documents.py
│   ├── revisions.py
│   └── users.py
├── services/            # business logic + access checks, used by REST and MCP
│   ├── folders.py       # FolderService
│   ├── documents.py     # DocumentService
│   ├── search.py        # SearchService
│   └── users.py         # UserService
├── markdown/            # pure functions, no I/O
│   ├── parse.py         # title extraction, headings, sections
│   └── frontmatter.py   # split / join YAML frontmatter
├── auth/
│   ├── middleware.py    # ASGI middleware: rejects with 401 or stores the principal in the scope
│   └── principal.py     # Principal abstraction (user / admin), placeholder resolution
├── api/                 # REST adapter
│   ├── routers/
│   ├── schemas.py       # Pydantic request/response models
│   ├── deps.py          # FastAPI dependencies (session, principal from the scope, services)
│   └── errors.py        # domain exceptions and request validation errors → RFC 9457 problem+json
└── mcp/                 # MCP adapter
    ├── server.py        # MCPServer instance, transport setup
    ├── tools.py         # tool definitions wrapping services
    └── resources.py
```

### Layer rules

- The auth middleware rejects unauthenticated requests on every non-public route before they reach `api/` or `mcp/`.
- `api/` and `mcp/` call **only** `services/`. They never touch the DB or repositories directly.
- `services/` receive a `Principal` on every call and enforce access rules.
- `repositories/` do DB access only; they contain no permission or business logic.
- `markdown/` is pure and side-effect free, therefore easy to unit test.
- Domain errors (`NotFoundError`, `ForbiddenError`, `VersionConflictError`, `DomainValidationError`) are defined in the
  service layer and translated by each adapter (HTTP status codes for REST, tool errors for MCP).

## Cross-Cutting Concerns

- **Configuration**: environment variables via pydantic-settings (`HIPPOWIKI_DATABASE_URL`, …).
- **Transactions**: one DB session/transaction per request or tool call; a document update and its revision rows are
  written atomically. The credential lookup in the auth middleware uses its own short session, separate from this
  transaction.
- **Logging**: stdlib `logging`, structured (JSON) in production; log who changed what.
- **Validation**: two kinds, in the order defined in [API](api.md).
  - Schema validation in the adapters: shape and types through the Pydantic models, without database access.
  - Domain validation in the services: folder and document name rules (lowercase `a-z0-9-`, no `/`), maximum document
    size.
- **Time**: UTC everywhere, see [Time](time.md).
- **Auth**: authentication and folder-level rights, see [Auth Concept](auth-concept.md).
  - Authentication is one pure ASGI middleware, not `BaseHTTPMiddleware`, because MCP streams its responses.
  - It wraps REST and the mounted MCP app, since FastAPI dependencies do not reach mounted apps.
  - It stores the principal in the ASGI scope, and the OpenAPI security scheme is declared separately.
  - Public routes are the only ones the middleware lets through without authentication, as allowed by
    [Goals](goals.md):
    - health: liveness only, with a fixed status body, no database access and no version or configuration details
    - whatever the login method needs, see [Known Limitations](known-limitations.md)
  - Everything else stays behind authentication, including MCP and the OpenAPI docs.
- **Errors**: domain exceptions in the service layer, mapped per adapter, see [API](api.md).
