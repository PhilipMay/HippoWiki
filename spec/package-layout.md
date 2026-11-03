# Package Layout

This document defines the code structure and which layer may use which.

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
    filter. See [Deleting and Restoring Content](content.md#deleting-and-restoring-content).
- **`auth/`**:
  - `auth/principal.py` imports only `domain.py`, and the adapters, the services and the rest of `auth/` may import it.
  - `auth/tokens.py` imports no other HippoWiki package, and gets its settings as parameters.
  - `auth/credentials.py` uses only `repositories/interfaces.py`, `auth/principal.py` and `auth/tokens.py`.
  - `auth/middleware.py` uses only `auth/principal.py` and `problem.py`, and gets the credential check, the MCP path and
    the [request body limit](limits.md#request-body-limit) as parameters.
- **Conflicts**:
  - Repositories flush after each write, so a unique violation surfaces inside the repository. It becomes
    `DuplicateNameError` or, for `auth_subject`, `DuplicateSubjectError`, and the service turns these into
    `NameConflictError` and `SubjectConflictError`.
  - Services do not check for duplicates up front, so concurrent requests get the same answer. PostgreSQL has then
    aborted the transaction, so the service does not continue in it.
  - The names `""` and `admin` are fixed rules instead, see [Names](content.md#names), because they would hit a check
    constraint.
- **Domain errors** (`NotFoundError`, `ForbiddenError`, `NameConflictError`, `SubjectConflictError`,
  `VersionConflictError`, `DomainValidationError`) are defined in `services/errors.py` and translated by each adapter
  (HTTP status codes for REST, tool errors for MCP).
