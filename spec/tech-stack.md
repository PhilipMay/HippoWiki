# Technology Stack

| Area                 | Choice                                                                                                                   | Why                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Language / tooling   | Python 3.13, uv, black, ruff, mypy, mdformat, pytest                                                                     | Already set up in this repo                                                                  |
| Web framework        | **FastAPI** + **Uvicorn**                                                                                                | Async, ASGI, automatic OpenAPI docs, Pydantic integration                                    |
| Schemas / validation | **Pydantic v2**                                                                                                          | Shared request/response models for REST and MCP tool inputs; they check shape and types only |
| Configuration        | **pydantic-settings**                                                                                                    | Typed config from environment variables / `.env`                                             |
| MCP                  | Official **`mcp` Python SDK** 2.x (`MCPServer` API)                                                                      | Reference implementation; streamable HTTP transport; can be mounted into FastAPI             |
| Database             | **PostgreSQL 16+**                                                                                                       | Robust, transactional, enforces the table constraints                                        |
| ORM / DB access      | **SQLAlchemy 2.0** (async, fully typed) + **asyncpg**                                                                    | Works well with strict mypy, mature                                                          |
| Migrations           | **Alembic**                                                                                                              | Standard for SQLAlchemy                                                                      |
| Frontmatter          | **PyYAML**                                                                                                               | A dev dependency for the pin tests for now                                                   |
| Tests                | **pytest-asyncio**, **httpx** (`AsyncClient`), **testcontainers** (PostgreSQL)                                           | Fakes for most tests, a real Postgres for integration tests                                  |
| Packaging / deploy   | Container image (`Containerfile`) built with uv and **Podman**, `compose.yaml` run via `podman compose` (app + Postgres) | Simple self-hosting                                                                          |

All chosen libraries have type hints, which matters because `make check` runs mypy in strict mode. PyYAML and
asyncpg do not ship their own, so they use the dev dependencies `types-pyyaml` and `asyncpg-stubs`.
