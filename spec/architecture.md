# HippoWiki Architecture

The scope of the project is defined in [Goals and Non-Goals](goals.md). See also [Technology Stack](tech-stack.md),
[Package Layout](package-layout.md), [Testing Strategy](testing.md) and [Deployment](deployment.md).

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
access.

Key idea: **MCP and REST are thin adapters** over the same service layer. All domain rules (domain validation,
permissions, versioning) live in exactly one place, so both interfaces always behave identically. The adapters only
check the shape of the input.

## Layer Rules

- The [auth middleware](auth-middleware.md) runs before `api/` and `mcp/`.
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
- `repositories/` do DB access only; they contain no permission or business logic. They get their session from the unit
  of work.
- Name conflicts: repositories flush after each write, so a unique violation surfaces inside the repository, and they
  translate it into `DuplicateNameError`. Services turn that into `NameConflictError`. Services do not check for
  duplicates up front, so concurrent requests get the same answer. PostgreSQL has then aborted the transaction, so the
  service does not continue in it. The names `""` and `admin` are fixed rules instead, see
  [Entity Rules](entity-rules.md#names), because they would hit a check constraint.
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
- **Transactions**: one unit of work, over one DB session and transaction, per public service method, and so per request
  or tool call.
  - Each public method opens it and commits it before returning, so a failed commit becomes an error response.
  - Leaving a unit of work without a commit rolls it back, also when a domain error passes through.
  - Public service methods do not call each other inside a transaction. Shared steps take the open unit of work as a
    parameter.
  - A document update and its revision rows are written atomically, and so are a new folder and its default tab.
  - The credential lookup in the auth middleware uses its own short unit of work, separate from the transaction of the
    service call.
- **Logging**: stdlib `logging`, structured (JSON) in production; log who changed what.
- **Validation and errors**: see [Request Checks](request-checks.md).
- **Time**: UTC everywhere, see [Time](time.md).
- **Auth**: see [Auth Concept](auth-concept.md) for rights and [Auth Middleware](auth-middleware.md) for authentication.
- **MCP adapter**: see [MCP](mcp.md).
