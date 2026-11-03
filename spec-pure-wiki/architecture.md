# Architecture

This document gives the big picture. The code structure is in [Package Layout](package-layout.md) and the technologies
are in [Tech Stack](tech-stack.md).

## Overview

```text
     Web client, scripts
              │
              ▼
    ┌───────────────────┐
    │ Auth → Principal  │
    └─────────┬─────────┘
              ▼
    ┌───────────────────┐
    │ REST /api/v1      │
    └─────────┬─────────┘
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
access. Clients log in at a [public route](authentication.md#public-routes) of the same process, which issues the
tokens.

Key idea: **REST is a thin adapter** over the service layer. All domain rules (domain validation, permissions,
versioning) live in the services, so a later second adapter can reuse them unchanged. The adapter only checks the shape
of the input.

## Composition

`create_app()` takes the unit-of-work factory and the credential check. It builds the services once, passes them to the
adapter and adds the [auth middleware](authentication.md#request-handling). It knows nothing about the engine, so tests
pass fakes and need no database, see [Testing](testing.md).

`create_production_app()` builds the engine from the settings, passes the real factory and credential check, and
disposes of the engine in the lifespan.

## Transactions

One unit of work, over one DB session and transaction, runs per public service method, and so per request.

- Each public method opens it and commits it before returning, so a failed commit becomes an error response.
- Leaving a unit of work without a commit rolls it back, also when a domain error passes through.
- Public service methods do not call each other inside a transaction. Shared steps take the open unit of work as a
  parameter.
- A method that checks a password is the one exception to one unit of work per method: it reads the hash in one, runs
  the slow password hash outside any transaction, and writes the result in another, so it holds no database connection
  while hashing, see [Login Protection](authentication.md#login-protection).
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
