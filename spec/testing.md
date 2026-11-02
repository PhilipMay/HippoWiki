# Testing Strategy

The cases these tests must cover are in [Test Cases](test-cases.md).

- **Test data**: `make test` uses in-memory repository fakes from `tests/` behind a fake unit-of-work factory, injected
  through `create_app()` together with a fake credential check, see [Architecture](architecture.md).
  - The fakes implement the same Protocols as the real repositories, and raise `DuplicateNameError` for the four unique
    name constraints and `DuplicateSubjectError` for `auth_subject`.
  - The fake unit of work restores a snapshot of the in-memory data when it exits without a commit, so a forgotten commit
    also fails in `make test`.
  - They do not reproduce check constraints, foreign keys, isolation between concurrent transactions or `now()`.
- **Marker**: only tests against a real PostgreSQL carry the `podman` marker. These are the integration tests and the real
  side of the contract tests. All other test kinds below run in `make test`.
- **Accepted trade-off**: table constraints, atomic writes, migrations and real SQL run only in `make test-podman`, which
  CI does not run, so it has to be run locally after such changes. Reconsider this when the repositories arrive, because
  reading after commit and text PostgreSQL rejects only show up there. `DOCKER_HOST` can already be overridden, so CI would
  not need the `podman machine` call in the `Makefile`.
- **Unit tests**: pure code, such as `UtcDatetime`.
- **Token tests**: `auth/tokens.py` against locally generated keys and a fake key source, so `make test` needs no Keycloak.
  Most other tests keep the fake credential check. The real Keycloak is covered by the
  [Connector Test](known-limitations.md#connector-test).
- **Time and pinned library tests**: `UtcDatetime` on input and output, a test that fails on any naive datetime column, and
  the tests in `tests/test_time_*.py` that pin the library behaviour [Time](time.md) relies on. The asyncpg ones carry the
  `podman` marker.
- **Contract tests**: one suite runs against the fakes and against the real repositories (`podman`), so drift between them
  shows up when `make test-podman` runs. The suite covers only what both sides implement: returned data,
  `DuplicateNameError`, `DuplicateSubjectError`, commit and rollback. Foreign keys and check constraints are covered only by the integration tests.
- **Integration tests**: services and repositories against a real PostgreSQL (testcontainers). `make test-podman` runs
  these tests and sets `DOCKER_HOST` to the Podman socket and `TESTCONTAINERS_RYUK_DISABLED=true`; both can be overridden
  from the environment.
- **REST tests**: `httpx.AsyncClient` against the FastAPI app with fakes.
- **MCP tool tests**: in-memory client session from the `mcp` SDK calling the tools, for tool behaviour only. It has no
  HTTP layer, so it bypasses the auth middleware, and these tests pass the server factory a principal resolver that
  returns a fixed principal.
- **MCP transport tests**: an MCP client over streamable HTTP against the full ASGI app with the auth middleware, served
  by Uvicorn on a local port, because `httpx.ASGITransport` buffers responses and can not stream. All authentication and
  check order tests on MCP run this way.
- **Import contracts**: `make check` runs import-linter on the [layer rules](architecture.md#layer-rules). A layer is
  optional until its package exists.
- `make format`, `make check` and `make test` must stay green locally; CI runs `make check` and `make test` in parallel
  as two separate GitHub Actions workflows (`check.yml` and `test.yml`). `make test-podman` runs locally only, CI does
  not run it.
