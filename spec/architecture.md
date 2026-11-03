# Architecture

This document gives the big picture. The code structure is in [Package Layout](package-layout.md) and the technologies
are in [Tech Stack](tech-stack.md).

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

## Composition

`create_app()` takes the unit-of-work factory and the credential check, because FastAPI dependencies do not reach the
MCP routes. It builds the services once and passes them to both adapters, adds the MCP routes to the FastAPI router and
runs the MCP session manager in the lifespan, see [Serving the MCP App](mcp.md#serving-the-mcp-app). It knows nothing
about the engine, so tests pass fakes and need no database, see [Testing](testing.md).

`create_production_app()` builds the engine from the settings, passes the real factory and credential check, and
disposes of the engine in the lifespan.

## Transactions

One unit of work, over one DB session and transaction, runs per public service method, and so per request or tool call.

- Each public method opens it and commits it before returning, so a failed commit becomes an error response.
- Leaving a unit of work without a commit rolls it back, also when a domain error passes through.
- Public service methods do not call each other inside a transaction. Shared steps take the open unit of work as a
  parameter.
- These are written atomically: a document update and its revision rows, a delete or restore and its revision, and a new
  folder and its default tab.
- The credential lookup in the auth middleware uses its own short unit of work, separate from the transaction of the
  service call.
- Stale principal: the principal is a snapshot from that lookup, so a request already running when a user is deactivated
  can still finish as that user. This is accepted, because it ends with that request. Services read folder rights inside
  their own transaction.

## Configuration and Logging

- **Configuration**: environment variables via pydantic-settings (`HIPPOWIKI_DATABASE_URL`, …).
- **Logging**: stdlib `logging`, structured (JSON) in production; log who changed what. `logs.py` has a small JSON
  formatter, so no new dependency is needed, and Uvicorn's loggers go through the same handler, so all output has one
  format.
