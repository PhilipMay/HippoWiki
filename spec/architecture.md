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
access. Clients log in at Keycloak, a separate service that issues the tokens, see [Authentication](authentication.md).

Key idea: **MCP and REST are thin adapters** over the same service layer. All domain rules (domain validation,
permissions, versioning) live in exactly one place, so both interfaces always behave identically. The adapters only
check the shape of the input. The one exception is access: admins can use only REST, and admin operations exist only on
REST, see [Auth Concept](auth-concept.md#rules).

## Layer Rules

- The [auth middleware](auth-middleware.md) runs before `api/` and `mcp/`.
- `api/` and `mcp/` call **only** `services/` for behaviour. Apart from that they may import `schemas/`, `domain.py`,
  `services/errors.py`, `auth/principal.py` and `problem.py`. They never touch the DB, sessions or repositories directly.
- `api/` and `mcp/` make exactly one service call per request or tool call.
- `app.py` and `cli.py` are the composition roots and may import anything. Nothing imports them.
- `schemas/` imports no other HippoWiki package, which keeps validators free of lookups. `domain.py`, `problem.py` and
  `config.py` import no other HippoWiki package either.
- Data between the layers: repositories and services exchange the small frozen dataclasses from `domain.py`, and the
  adapters map them to `schemas/`. ORM models stay inside `db/` and `repositories/`, so they never reach a service or an
  adapter, the fakes need no SQLAlchemy objects, and `schemas/` stays free of domain types. The dataclasses are not next
  to the Protocols, because the adapters would then have to import from `repositories/`.
- `services/` never import `schemas/`, and take plain arguments.
- `auth/`:
  - `auth/principal.py` imports only `domain.py`, and the adapters, the services and the rest of `auth/` may import it.
  - `auth/tokens.py` imports no other HippoWiki package, and gets its settings as parameters.
  - `auth/credentials.py` uses only `repositories/interfaces.py`, `auth/principal.py` and `auth/tokens.py`.
  - `auth/middleware.py` uses only `auth/principal.py` and `problem.py`, and gets the credential check and the MCP path as
    parameters.
- `services/` receive a `Principal` on every call and enforce access rules. There are three exceptions, because no principal
  exists yet:
  - `UserService.create_root_admin` at system initialization. Only `hippowiki init` calls it, and no adapter exposes it.
  - `UserService.link_root_admin`, which gives the root admin its login. Only `hippowiki link-root-admin` calls it, and no
    adapter exposes it.
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
- Subject conflicts work the same way: a unique violation of `auth_subject` becomes `DuplicateSubjectError` in the
  repository and `SubjectConflictError` in the service.
- Domain errors (`NotFoundError`, `ForbiddenError`, `NameConflictError`, `SubjectConflictError`, `VersionConflictError`,
  `DomainValidationError`) are defined in `services/errors.py` and translated by each adapter (HTTP status codes for REST,
  tool errors for MCP).
- Enforcement: `make check` runs [import-linter](https://import-linter.readthedocs.io/), with its contracts in
  `pyproject.toml`, because nothing else would catch a violation of these rules.

## Cross-Cutting Concerns

- **Configuration**: environment variables via pydantic-settings (`HIPPOWIKI_DATABASE_URL`, …).
- **Composition**: `create_app()` takes the unit-of-work factory and the credential check, because FastAPI dependencies
  do not reach the MCP routes. It builds the services once and passes them to both adapters, adds the MCP routes to the
  FastAPI router and runs the MCP session manager in the lifespan, see [MCP](mcp.md#serving-the-mcp-app). It knows nothing
  about the engine, so tests pass fakes and need no database, see [Testing Strategy](testing.md).
  `create_production_app()` builds the engine from the settings, passes the real factory and credential check, and
  disposes of the engine in the lifespan.
- **Transactions**: one unit of work, over one DB session and transaction, per public service method, and so per request
  or tool call.
  - Each public method opens it and commits it before returning, so a failed commit becomes an error response.
  - Leaving a unit of work without a commit rolls it back, also when a domain error passes through.
  - Public service methods do not call each other inside a transaction. Shared steps take the open unit of work as a
    parameter.
  - A document update and its revision rows are written atomically, and so are a new folder and its default tab.
  - The credential lookup in the auth middleware uses its own short unit of work, separate from the transaction of the
    service call.
  - Stale principal: the principal's `is_admin` is a snapshot from that lookup, so a request already running when an admin
    is demoted can still finish as admin. This is accepted, because it ends with that request. Services read folder rights
    inside their own transaction.
- **Logging**: stdlib `logging`, structured (JSON) in production; log who changed what. `logs.py` has a small JSON
  formatter, so no new dependency is needed, and Uvicorn's loggers go through the same handler, so all output has one
  format.
- **Validation and errors**: see [Request Checks](request-checks.md).
- **Time**: UTC everywhere, see [Time](time.md).
- **Auth**: see [Auth Concept](auth-concept.md) for rights, [Authentication](authentication.md) for the login method and
  [Auth Middleware](auth-middleware.md) for rejecting requests.
- **MCP adapter**: see [MCP](mcp.md).
