# Package Layout

The rules between these packages are the [layer rules](architecture.md#layer-rules).

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
│   └── users.py         # UserService
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
