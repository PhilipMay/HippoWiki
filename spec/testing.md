# Testing

This document defines how HippoWiki is tested. The cases that are easy to miss are in [Test Cases](test-cases.md).

## Strategy

- **Test data**: `make test` uses in-memory repository fakes from `tests/` behind a fake unit-of-work factory, injected
  through `create_app()` together with a fake credential check, see [Composition](architecture.md#composition).
  - The fakes implement the same Protocols as the real repositories, and raise `DuplicateNameError` for the four unique
    names. The names of md_documents, tabs and folders are unique among live rows only, and the name of a user always.
  - The fakes hide deleted rows and the children of deleted parents, in the same way as the real repositories.
  - The fake unit of work restores a snapshot of the in-memory data when it exits without a commit, so a forgotten
    commit also fails in `make test`.
  - They do not reproduce check constraints, foreign keys, isolation between concurrent transactions or `now()`. They
    also store any string and expire nothing, so only `make test-podman` can show what `SafeText` and
    `expire_on_commit=False` protect against.
- **Marker**: only tests against a real PostgreSQL carry the `podman` marker. These are the integration tests and the
  real side of the contract tests. All other test kinds below run in `make test`.
- **CI**: `make format`, `make check` and `make test` must stay green locally; CI runs `make check`, `make test` and
  `make test-podman` in parallel as three separate GitHub Actions workflows (`check.yml`, `test.yml` and
  `test-podman.yml`). `test-podman.yml` starts the Podman socket of the runner and sets `DOCKER_HOST` to it, so it does
  not use the `podman machine` call in the `Makefile`. It also adds an AppArmor rule that lets Podman signal `pasta`, as
  a workaround for [Ubuntu bug 2154379](https://bugs.launchpad.net/ubuntu/+source/passt/+bug/2154379), which otherwise
  fails container removal on Ubuntu 26.04. Table constraints, atomic writes, migrations and real SQL run only in
  `make test-podman`, so run it locally as well after such changes.

## Test Kinds

- **Unit tests**: pure code, such as `UtcDatetime`.
- **OAuth tests**: the [OAuth Server](oauth-server.md) through `httpx.AsyncClient` against the app with fakes and a fake
  source of client documents, so `make test` needs no network. They run each flow as a client would, including the login
  page. Most other tests keep the fake credential check. Row locks, expiry by the database clock and the atomic failure
  counter run only against a real PostgreSQL (`podman`). The real clients are covered by the
  [Connector Test](roadmap.md#connector-test).
- **Client document tests**: `auth/client_documents.py` against a small local server, with the current documents of
  Claude, Claude Code and ChatGPT as test data.
- **Time and pinned library tests**: `UtcDatetime` on input and output, a test that fails on any naive datetime column,
  and the tests in `tests/test_time_*.py` that pin the library behaviour [Time](time.md) relies on. The asyncpg ones
  carry the `podman` marker. Tests of time-dependent behaviour use separate committed transactions, because one
  rolled-back wrapper transaction gives every `now()` the same value. They do not rely on freezing Python's clock, which
  does not affect the database.
- **Contract tests**: one suite runs against the fakes and against the real repositories (`podman`), so drift between
  them shows up when `make test-podman` runs. The suite covers only what both sides implement: returned data,
  `DuplicateNameError`, hiding deleted rows, commit and rollback. Foreign keys and check constraints are covered only by
  the integration tests.
- **Integration tests**: services and repositories against a real PostgreSQL (testcontainers). `make test-podman` runs
  these tests and sets `DOCKER_HOST` to the Podman socket and `TESTCONTAINERS_RYUK_DISABLED=true`; both can be
  overridden from the environment.
- **REST tests**: `httpx.AsyncClient` against the FastAPI app with fakes.
- **MCP tool tests**: in-memory client session from the `mcp` SDK calling the tools, for tool behaviour only. It has no
  HTTP layer, so it bypasses the auth middleware, and these tests pass the server factory a principal resolver that
  returns a fixed principal.
- **MCP transport tests**: an MCP client over streamable HTTP against the full ASGI app with the auth middleware, served
  by Uvicorn on a local port, because `httpx.ASGITransport` buffers responses and can not stream. All authentication and
  check order tests on MCP run this way.
- **Production composition test** (`podman`): `create_production_app()` as a whole, with a real PostgreSQL, the real
  repositories and credential check, tokens from the real [OAuth Server](oauth-server.md), and client documents from a
  small local server. All other test kinds replace part of this composition, so only this one shows that it fits
  together.
- **Import contracts**: `make check` runs import-linter on the [layer rules](package-layout.md#layer-rules). A layer is
  optional until its package exists.

## What Needs a Test

Every rule in this specification needs a test, on REST and, where it applies, on MCP. That includes every row of
[Check Order](request-checks.md#check-order) and of the tables linked from
[Rejected Operations](request-checks.md#rejected-operations), and every cell of
[Rights on Folders](rights.md#rights-on-folders), tested as a matrix that also has a user with no right. The matrix has
no admin, because the admin behaves like a user with no right on REST and is rejected on MCP.
