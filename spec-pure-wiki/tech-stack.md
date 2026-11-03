# Tech Stack

This document names the chosen technologies and why they were chosen. The technology of the web client is open, see
[Web Client](roadmap.md#web-client).

| Area                 | Choice                                                                                                          | Why                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Language / tooling   | Python 3.13, uv, black, ruff, mypy, import-linter, mdformat, pytest                                             | Already set up in this repo                                                  |
| Web framework        | **FastAPI** + **Uvicorn**                                                                                       | Async, ASGI, automatic OpenAPI description, Pydantic integration             |
| Schemas / validation | **Pydantic v2**                                                                                                 | Request and response models for REST; they check shape and types only        |
| Configuration        | **pydantic-settings**                                                                                           | Typed config from environment variables / `.env`                             |
| Database             | **PostgreSQL 16+**                                                                                              | Robust, transactional, enforces the table constraints                        |
| ORM / DB access      | **SQLAlchemy 2.1** (`sqlalchemy[asyncio]`, async, fully typed) + **asyncpg**                                    | Works well with strict mypy, mature; greenlet is only in the `asyncio` extra |
| Migrations           | **Alembic**                                                                                                     | Standard for SQLAlchemy                                                      |
| Passwords            | **argon2-cffi**                                                                                                 | Argon2id, tested and widely used                                             |
| Tokens               | Python's **secrets** and **hashlib**                                                                            | Random opaque tokens stored as hashes, so no new dependency                  |
| Reverse proxy        | **Traefik**, tested with 3.7.17                                                                                 | TLS and the route of the hostname                                            |
| Tests                | **pytest-asyncio**, **httpx** (`AsyncClient`), **testcontainers** (PostgreSQL)                                  | Fakes for most tests, a real Postgres for integration tests                  |
| Packaging / deploy   | Container image (`Containerfile`) built with uv, run with **Podman** or Docker, `compose.yaml` (app + Postgres) | NixOS in production, compose for development and simple self-hosting         |

All chosen libraries have type hints, which matters because `make check` runs mypy in strict mode. asyncpg does not ship
its own, so it uses the dev dependency `asyncpg-stubs`.
