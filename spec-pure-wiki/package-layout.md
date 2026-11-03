# Package Layout

This document defines the code structure and which layer may use which.

```text
src/hippowiki/
├── __init__.py
├── app.py               # ASGI composition: create_app(unit-of-work factory, credential check), services, FastAPI app
│                        # create_production_app(): real factory and credential check, lifespan (DB engine)
├── cli.py               # CLI: hippowiki migrate, init, set-admin-password
├── config.py            # Settings (pydantic-settings)
├── domain.py            # frozen dataclasses exchanged by repositories, services and adapter, including Page and UserRef
├── logs.py              # JSON log formatter and logging setup, also for Uvicorn's loggers
├── problem.py           # RFC 9457 problem+json helper, used by auth/middleware.py and api/errors.py
├── db/
│   ├── engine.py        # async engine (server_settings={"timezone": "UTC"}) + session factory (expire_on_commit=False)
│   ├── models.py        # SQLAlchemy ORM models
│   └── migrations/      # Alembic env.py, script.py.mako and versions/, shipped inside the package
├── schemas/             # Pydantic request and response models for REST and their field types
│   ├── paging.py        # types for limit and the cursors of lists
│   ├── text.py          # SafeText
│   └── time.py          # UtcDatetime
├── repositories/        # DB access only, no business rules
│   ├── interfaces.py    # one typing.Protocol per repository, UnitOfWork Protocol, DuplicateNameError
│   ├── unit_of_work.py  # UnitOfWork over one DB session, gives access to the repositories on that session
│   ├── folders.py
│   ├── tabs.py
│   ├── md_documents.py
│   ├── revisions.py
│   ├── folder_rights.py
│   ├── users.py
│   ├── user_passwords.py
│   └── sessions.py
├── services/            # business logic + access checks, used by REST
│   ├── errors.py        # domain errors
│   ├── folders.py       # FolderService
│   ├── tabs.py          # TabService
│   ├── md_documents.py  # MdDocumentService
│   ├── folder_rights.py # FolderRightService
│   ├── users.py         # UserService
│   └── auth.py          # AuthService: login, logout, change of the own password
├── auth/
│   ├── tokens.py        # generates opaque tokens and turns a bearer value into its hash
│   ├── passwords.py     # Argon2id hashing in a worker thread, with the limit on running and waiting hashes
│   ├── credentials.py   # credential check: looks up the session and user through the unit-of-work factory, not a service
│   ├── middleware.py    # ASGI middleware: rejects with 401, 413 or 503, buffers the body, or stores the principal in the scope
│   └── principal.py     # Principal abstraction (user / admin), with the hash of the token of the session
└── api/                 # REST adapter
    ├── routers/
    │   ├── public.py    # the health route
    │   └── auth.py      # login with its bounded body reader, logout, change of the own password
    ├── deps.py          # FastAPI dependencies (principal from the scope, services)
    └── errors.py        # domain exceptions, request validation errors and framework errors → RFC 9457 problem+json
```

## Layer Rules

`make check` enforces these with [import-linter](https://import-linter.readthedocs.io/), with its contracts in
`pyproject.toml`, because nothing else would catch a violation.

- **Adapter** (`api/`):
  - The [auth middleware](authentication.md#request-handling) runs before it.
  - It calls **only** `services/` for behaviour, and makes exactly one service call per request.
  - Apart from that it may import `schemas/`, `domain.py`, `services/errors.py`, `auth/principal.py` and `problem.py`.
    It never touches the DB, sessions or repositories directly.
  - The health route is the exception: it makes no service call.
- **Composition roots**: `app.py` and `cli.py` may import anything, and nothing imports them.
- **Pure modules**: `schemas/` imports no other HippoWiki package, which keeps validators free of lookups. `domain.py`,
  `problem.py` and `config.py` import no other HippoWiki package either.
- **Data between the layers**: repositories and services exchange the small frozen dataclasses from `domain.py`, and the
  adapter maps them to `schemas/`. ORM models stay inside `db/` and `repositories/`, so they never reach a service or
  the adapter, the fakes need no SQLAlchemy objects, and `schemas/` stays free of domain types. The dataclasses are not
  next to the Protocols, because the adapter would then have to import from `repositories/`.
- **Services** (`services/`):
  - They never import `schemas/`, and take plain arguments.
  - They use repositories only through the Protocols in `repositories/interfaces.py`, and reach them through a unit of
    work.
  - They are stateless and get the unit-of-work factory when they are built.
  - They receive a `Principal` on every call and enforce access rules. There are these exceptions, because no principal
    exists yet:
    - `UserService.create_admin` at system initialization. Only `hippowiki init` calls it, and no adapter exposes it.
    - `UserService.set_admin_password`, which gives the admin its login. Only `hippowiki set-admin-password` calls it,
      and no adapter exposes it.
    - `AuthService.login`, which is what produces a login.
    - The credential check in `auth/credentials.py`, which produces the principal. It is not a service, and reads
      sessions and users through the unit-of-work factory and the repository Protocol.
  - They may import `auth/tokens.py` and `auth/passwords.py`.
- **Repositories** (`repositories/`):
  - They do DB access only, with no permission or business logic, and get their session from the unit of work.
  - Their methods return only live rows, unless a method is named for deleted ones, so a service can not forget the
    filter. See [Deleting and Restoring Content](content.md#deleting-and-restoring-content).
- **`auth/`**:
  - `auth/principal.py` imports only `domain.py`, and the adapter, the services and the rest of `auth/` may import it.
  - `auth/tokens.py` and `auth/passwords.py` import no other HippoWiki package, and get their settings as parameters.
  - `auth/credentials.py` uses only `repositories/interfaces.py`, `auth/principal.py` and `auth/tokens.py`.
  - `auth/middleware.py` uses only `auth/principal.py` and `problem.py`, and gets the credential check, the
    [public routes](authentication.md#public-routes) and the [request body limit](limits.md#request-body-limit) as
    parameters.
- **Conflicts**:
  - Repositories flush after each write, so a unique violation surfaces inside the repository. It becomes
    `DuplicateNameError`, and the service turns this into `NameConflictError`.
  - Services do not check for duplicates up front, so concurrent requests get the same answer. PostgreSQL has then
    aborted the transaction, so the service does not continue in it.
  - The names `""` and `admin` are fixed rules instead, see [Names](content.md#names), because they would hit a check
    constraint.
- **Domain errors** (`NotFoundError`, `ForbiddenError`, `NameConflictError`, `VersionConflictError`,
  `DomainValidationError`) are defined in `services/errors.py` and translated by the adapter to HTTP status codes.
  `AuthService.login` returns its own results for a wrong password and a needed password change, because the adapter
  answers these with their [own codes](errors.md#rest-error-format).
