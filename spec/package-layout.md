# Package Layout

The rules between these packages are the [layer rules](architecture.md#layer-rules).

```text
src/hippowiki/
├── __init__.py
├── app.py               # ASGI composition: create_app(unit-of-work factory, credential check), services, FastAPI app + MCP routes,
│                        # lifespan (MCP session manager)
│                        # create_production_app(): real factory and credential check, lifespan (DB engine)
├── cli.py               # CLI: hippowiki migrate, hippowiki init, hippowiki link-root-admin
├── config.py            # Settings (pydantic-settings)
├── domain.py            # frozen dataclasses exchanged by repositories, services and adapters
├── logs.py              # JSON log formatter and logging setup, also for Uvicorn's loggers
├── problem.py           # RFC 9457 problem+json helper, used by auth/middleware.py, api/errors.py and mcp/server.py
├── db/
│   ├── engine.py        # async engine (server_settings={"timezone": "UTC"}) + session factory (expire_on_commit=False)
│   ├── models.py        # SQLAlchemy ORM models
│   └── migrations/      # Alembic env.py, script.py.mako and versions/, shipped inside the package
├── schemas/             # Pydantic request and response models for REST, response models and field types shared with MCP
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
