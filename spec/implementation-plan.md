# Implementation Plan

This document sets the order of the first implementation steps. The decisions that are still open are in
[Known Limitations](known-limitations.md).

Coding does not have to wait for all of them. `create_app()` takes the credential check as a parameter, see
[Architecture](architecture.md#cross-cutting-concerns), so everything except the production credential check can be built
and tested with a fake one.

## Steps

Each step ends with `make format`, `make check` and `make test` green, and `make test-podman` where it touches the
database.

1. **Project setup**: add the [technology stack](tech-stack.md), including `sqlalchemy[asyncio]`, and apply the
   [setup items](#setup-items).
2. **Database and repositories**: `domain.py`, the ORM models and first migration for the [tables](entities.md),
   `db/engine.py`, the repositories, the unit of work, the fakes, the contract tests, `hippowiki migrate` and
   `hippowiki init`. Decide here whether CI runs the PostgreSQL tests, see [Testing Strategy](testing.md).
3. **Services**: the domain errors, the [name rules](entity-rules.md#names), and the create, read, list, rename, move and
   rights operations that need no revisions, with the matrix of rights tested on the fakes.
4. **ASGI shell**: `problem.py`, `logs.py`, the [auth middleware](auth-middleware.md) with a fake credential check, the
   health and protected resource metadata routes, the error handlers and `/openapi.json`.
5. **First slice through both adapters**: one read and one create operation on REST and on MCP, with `SafeText`,
   `UtcDatetime`, the shared tool wrapper, the MCP routes and the transport tests. This needs only these operations from
   the REST and MCP planning.
6. **Real connector test**: run the slice behind TLS with a test identity provider, and connect Claude and ChatGPT. This
   checks discovery from the 401, the 405 on `GET /mcp`, the host check and how the tool arguments and errors reach AI
   clients, none of which the local tests can show. The result feeds the decision on the authorization server.
7. **The remaining decisions**: implement what the [Next Steps](known-limitations.md#next-steps) decide, as far as each
   is settled.

## What Waits for What

| Open decision                 | What has to wait                                                           |
| ----------------------------- | -------------------------------------------------------------------------- |
| Authorization server          | The production credential check, the root admin credential                 |
| Revisions, optimistic locking | Updating md_document content, because every update has to write a revision |
| Delete and deactivate         | The delete and deactivate operations                                       |
| Size limits                   | The production value of the body limit, which is a setting until then      |
| REST and MCP planning         | All endpoints and tools beyond the first slice                             |

## Setup Items

These come with the first real code in step 1:

- Remove `demo.py` and `test_demo.py`, its `T201` entry in `pyproject.toml`, and point `[project.scripts]` to `cli.py`.
- Add `asyncio_mode` for pytest-asyncio, and `--import-mode=importlib`, because `tests/` is not a package and test files in
  subfolders with the same name would collide.
- Add the mypy Pydantic plugin.
- Measure coverage, because [Test Cases](test-cases.md) asks for every check and rule to be tested.

## Import Contracts

The layers contract in `pyproject.toml` already covers the direction of the layers, and its layers are optional until their
packages exist. A layer may import any layer below it, so the stricter [layer rules](architecture.md#layer-rules) need
`forbidden` contracts, which import-linter refuses for a module that does not exist. Add each one with its package:

- `api` and `mcp` import neither `repositories` nor `db`.
- `services` imports neither `schemas` nor `db`, and of `repositories` only `repositories.interfaces`.
- `schemas`, `domain`, `problem` and `config` import no other HippoWiki package.
- `auth.principal` imports only `domain`.
- `auth.credentials` imports of `repositories` only `repositories.interfaces`.
- `auth.middleware` imports only `auth.principal` and `problem`.
