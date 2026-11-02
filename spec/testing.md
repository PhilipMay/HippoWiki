# Testing Strategy

- **Test data**: `make test` uses in-memory repository fakes from `tests/` behind a fake unit-of-work factory, injected
  through `create_app()` together with a fake credential check, see [Architecture](architecture.md).
  - The fakes implement the same Protocols as the real repositories and raise `DuplicateNameError` for the four unique
    constraints.
  - The fake unit of work restores a snapshot of the in-memory data when it exits without a commit, so a forgotten commit
    also fails in `make test`.
  - They do not reproduce check constraints, foreign keys, isolation between concurrent transactions or `now()`.
- **Marker**: only tests against a real PostgreSQL carry the `podman` marker. These are the integration tests and the real
  side of the contract tests. All other test kinds below run in `make test`.
- **Accepted trade-off**: table constraints, atomic writes, migrations and real SQL run only in `make test-podman`, which
  CI does not run, so it has to be run locally after such changes.
- **Unit tests**: pure code, such as `markdown/`.
- **Contract tests**: one suite runs against the fakes and against the real repositories (`podman`), so drift between them
  shows up when `make test-podman` runs. The suite covers only what both sides implement: returned data,
  `DuplicateNameError`, commit and rollback. Foreign keys and check constraints are covered only by the integration tests.
- **Integration tests**: services and repositories against a real PostgreSQL (testcontainers), including the table
  constraints, atomic writes such as a folder with its default tab, a unique violation surfacing inside the repository
  call, and time-dependent behaviour. `hippowiki migrate` followed by `hippowiki init` twice leaves one root admin.
  `make test-podman` runs these tests and sets `DOCKER_HOST` to the Podman socket and
  `TESTCONTAINERS_RYUK_DISABLED=true`; both can be overridden from the environment.
- **REST tests**: `httpx.AsyncClient` against the FastAPI app with fakes.
- **MCP tool tests**: in-memory client session from the `mcp` SDK calling the tools, for tool behaviour only. It has no
  HTTP layer, so it bypasses the auth middleware, and these tests pass the server factory a principal resolver that
  returns a fixed principal.
- **MCP transport tests**: an MCP client over streamable HTTP against the full ASGI app with the auth middleware, served
  by Uvicorn on a local port, because `httpx.ASGITransport` buffers responses and can not stream. All authentication and
  check order tests on MCP run this way.
- **Check order tests**: the order defined in [API](api.md), on REST and, where it applies, on MCP.
  - Unauthenticated malformed JSON gets 401.
  - An unauthenticated request to an unknown route or with a wrong method gets 401.
  - An authenticated request to an unknown route gets 404, and one with a wrong method gets 405, also with an invalid body.
  - On MCP, an unknown tool gets a tool error.
  - An invalid body gets the same 422 for a hidden, a missing and a readable folder.
  - On MCP, malformed JSON gets a protocol error and invalid tool arguments get a tool error.
  - An unknown field in the body gets 422.
  - A non-admin on an admin operation with no existing folder as its target gets 422 with an invalid body and 403 with a
    valid one.
  - A non-admin on a folder operation gets 422 with an invalid body, 404 with no right on the folder and 403 with a right.
  - A user without the required right and with an invalid name gets 403.
  - A user without the required right who names a missing target gets 403.
  - A target tab in another folder gets the same 404 as a missing one, whatever the rights of the user on its folder.
  - An admin deleting a right that does not exist gets 404.
  - Each row of [Rejected Operations](api.md#rejected-operations) gets its response.
  - A name conflict is reported only after domain validation.
- **Rights list tests**: an admin's own rights show `update` on every folder and ignore their stored rows, and the rights
  of a folder and all rights show the stored rows, including rows with no effect.
- **Public route tests**: without credentials and with a unit-of-work factory that fails when called, health returns its
  fixed body, and every route except health and the login routes gets 401, including MCP and the OpenAPI docs.
- **Error format tests**: the 401, the 404 for an unknown route, the 405 and the 500 are problem+json.
- **Failed credential lookup tests**: a credential check that raises gets 503 problem+json without exception details on
  REST and an HTTP 503 on the MCP transport, no adapter is reached, and health still answers.
- `make format`, `make check` and `make test` must stay green locally; CI runs `make check` and `make test` in parallel
  as two separate GitHub Actions workflows (`check.yml` and `test.yml`). `make test-podman` runs locally only, CI does
  not run it.
