# Package Layout

This document defines the code structure and which layer may use which.

```text
src/hippowiki/
├── __init__.py
├── app.py               # ASGI composition: create_app(unit-of-work factory, credential check, client document source, public URL),
│                        # services, FastAPI app + MCP routes,
│                        # lifespan (MCP session manager)
│                        # create_production_app(): real factory and credential check, lifespan (DB engine)
├── cli.py               # CLI: hippowiki migrate, init, set-admin-password, client add, client list, client remove
├── connector_test_app.py # temporary composition of the Connector Test: stand-in content services, test data from a
│                        # JSON file, and a command that creates the test users
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
│   ├── interfaces.py    # one typing.Protocol per repository, UnitOfWork Protocol, DuplicateNameError
│   ├── unit_of_work.py  # UnitOfWork over one DB session, gives access to the repositories on that session
│   ├── folders.py
│   ├── tabs.py
│   ├── md_documents.py
│   ├── revisions.py
│   ├── folder_rights.py
│   ├── users.py
│   ├── user_passwords.py
│   └── oauth.py         # own clients, codes and tokens
├── services/            # business logic + access checks, used by REST and MCP
│   ├── errors.py        # domain errors
│   ├── folders.py       # FolderService
│   ├── tabs.py          # TabService
│   ├── md_documents.py  # MdDocumentService
│   ├── folder_rights.py # FolderRightService
│   ├── users.py         # UserService
│   └── oauth.py         # OAuthService: authorization requests, login, codes, tokens, own clients
├── auth/
│   ├── tokens.py        # generates opaque tokens and turns a bearer value into its hash
│   ├── passwords.py     # Argon2id hashing in a worker thread, with the limit on running and waiting hashes
│   ├── client_documents.py # fetches, validates and caches the documents of the trusted clients
│   ├── login_limiter.py # counts failed logins per client address, in memory
│   ├── credentials.py   # credential check: looks up the token and user through the unit-of-work factory, not a service
│   ├── middleware.py    # ASGI middleware: rejects with 401, 403 (admin on MCP), 413 or 503, buffers the body, or stores the principal in the scope
│   └── principal.py     # Principal abstraction (user / admin)
├── api/                 # REST adapter
│   ├── routers/
│   │   └── public.py    # the public routes: health and protected resource metadata, gets the issuer and MCP URL as parameters
│   ├── deps.py          # FastAPI dependencies (principal from the scope, services)
│   └── errors.py        # domain exceptions, request validation errors and framework errors → RFC 9457 problem+json
├── oauth/               # OAuth adapter: the routes of the OAuth server
│   ├── routes.py        # metadata, authorize, token and revoke routes, bounded form reader, CSRF and browser headers
│   └── templates/       # the login page and the error page, with Jinja2 autoescaping
└── mcp/                 # MCP adapter
    ├── server.py        # MCPServer factory (takes the services and the principal resolver), stateless transport setup,
    │                    # routes for app.py, 405 for everything except POST,
    │                    # small Protocols with the service methods the tools call
    └── tools.py         # tool definitions wrapping services, shared wrapper: forbids unknown arguments, raises ToolError
```

## Layer Rules

`make check` enforces these with [import-linter](https://import-linter.readthedocs.io/), with its contracts in
`pyproject.toml`, because nothing else would catch a violation.

- **Adapters** (`api/`, `mcp/`, `oauth/`):
  - The [auth middleware](authentication.md#request-handling) runs before them.
  - They call **only** `services/` for behaviour, and make exactly one service call per request or tool call.
  - Apart from that they may import `schemas/`, `domain.py`, `services/errors.py`, `auth/principal.py` and `problem.py`.
    They never touch the DB, sessions or repositories directly.
  - The health and metadata [public routes](authentication.md#public-routes) are the exception: they make no service
    call, and get what they need as parameters, because adapters do not import `config.py`.
  - `oauth/routes.py` turns service results into pages, redirects and JSON, and holds no protocol rule. It runs without
    a principal, because its routes are public.
  - `mcp/server.py` types the services with its Protocols, so that the stand-ins of the
    [Connector Test App](roadmap.md#connector-test-app) and the real services both pass strict mypy.
  - Its factory takes one argument per service. Until the [Services step](roadmap.md#next-steps), each is optional and
    the factory registers only the tools of the services it gets, so `create_app()` advertises no tool that can not
    work.
- **Composition roots**: `app.py`, `cli.py` and, until the [Services step](roadmap.md#next-steps),
  `connector_test_app.py` may import anything, and nothing imports them.
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
  - They receive a `Principal` on every call and enforce access rules. There are these exceptions, because no principal
    exists yet:
    - `UserService.create_admin` at system initialization. Only `hippowiki init` calls it, and no adapter exposes it.
    - `UserService.set_admin_password`, which gives the admin its login. Only `hippowiki set-admin-password` calls it,
      and no adapter exposes it.
    - `OAuthService`, whose request methods are what produce a login, and whose client methods only `hippowiki client`
      calls.
    - The credential check in `auth/credentials.py`, which produces the principal. It is not a service, and reads tokens
      and users through the unit-of-work factory and the repository Protocol.
  - They may import `auth/tokens.py` and `auth/passwords.py`. `services/oauth.py` gets the source of client documents
    and the login limiter as Protocols, which `auth/client_documents.py` and `auth/login_limiter.py` implement, so the
    service itself stays stateless.
- **Repositories** (`repositories/`):
  - They do DB access only, with no permission or business logic, and get their session from the unit of work.
  - Their methods return only live rows, unless a method is named for deleted ones, so a service can not forget the
    filter. See [Deleting and Restoring Content](content.md#deleting-and-restoring-content).
- **`auth/`**:
  - `auth/principal.py` imports only `domain.py`, and the adapters, the services and the rest of `auth/` may import it.
  - `auth/tokens.py`, `auth/passwords.py`, `auth/client_documents.py` and `auth/login_limiter.py` import no other
    HippoWiki package, and get their settings as parameters.
  - `auth/credentials.py` uses only `repositories/interfaces.py`, `auth/principal.py` and `auth/tokens.py`.
  - `auth/middleware.py` uses only `auth/principal.py` and `problem.py`, and gets the credential check, the MCP path,
    the [public routes](authentication.md#public-routes), the metadata URL for `WWW-Authenticate` and the
    [request body limit](limits.md#request-body-limit) as parameters.
- **Conflicts**:
  - Repositories flush after each write, so a unique violation surfaces inside the repository. It becomes
    `DuplicateNameError`, and the service turns this into `NameConflictError`.
  - Services do not check for duplicates up front, so concurrent requests get the same answer. PostgreSQL has then
    aborted the transaction, so the service does not continue in it.
  - The names `""` and `admin` are fixed rules instead, see [Names](content.md#names), because they would hit a check
    constraint.
- **Domain errors** (`NotFoundError`, `ForbiddenError`, `NameConflictError`, `VersionConflictError`,
  `DomainValidationError`) are defined in `services/errors.py` and translated by each adapter (HTTP status codes for
  REST, tool errors for MCP). `OAuthService` returns its own results instead, because OAuth errors are not domain
  errors.
