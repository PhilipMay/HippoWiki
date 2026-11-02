# Testing Strategy

- **Test data**: `make test` uses in-memory repository fakes from `tests/`, injected through `create_app()` together with
  a fake credential check, see [Architecture](architecture.md).
  - The fakes implement the same Protocols as the real repositories and raise `DuplicateNameError` for the four unique
    constraints.
  - They do not reproduce check constraints, foreign keys, transactions or `now()`.
- **Marker**: only tests against a real PostgreSQL carry the `podman` marker. These are the integration tests and the real
  side of the contract tests. All other test kinds below run in `make test`.
- **Accepted trade-off**: table constraints, atomic writes, migrations and real SQL run only in `make test-podman`, which
  CI does not run, so it has to be run locally after such changes.
- **Unit tests**: pure code, such as `markdown/`.
- **Contract tests**: one suite runs against the fakes and against the real repositories (`podman`), so the fakes can not
  drift from the repositories.
- **Integration tests**: services and repositories against a real PostgreSQL (testcontainers), including the table
  constraints, atomic writes and time-dependent behaviour. `hippowiki migrate` followed by `hippowiki init` twice leaves
  one root admin. `make test-podman` runs these tests and sets `DOCKER_HOST` to the Podman socket and
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
  - An invalid body gets the same 422 for a hidden, a missing and a readable folder.
  - On MCP, malformed JSON gets a protocol error and invalid tool arguments get a tool error.
  - An unknown field in the body gets 422.
  - A non-admin on an admin operation with no existing folder as its target gets 422 with an invalid body and 403 with a
    valid one.
  - A non-admin on a folder operation gets 422 with an invalid body, 404 with no right on the folder and 403 with a right.
  - A user without the required right and with an invalid name gets 403.
  - A user without the required right who names a missing target gets 403.
  - A target tab in another folder gets the same 404 as a missing one, whatever the rights of the user on its folder.
  - Each row of [Rejected Operations](api.md#rejected-operations) gets its response.
  - A name conflict is reported only after domain validation.
- **Public route tests**: without credentials and with repositories that fail on any call, health returns its fixed body,
  and every route except health and the login routes gets 401, including MCP and the OpenAPI docs.
- **Error format tests**: the 401, the 404 for an unknown route, the 405 and the 500 are problem+json.
- `make format`, `make check` and `make test` must stay green locally; CI runs `make check` and `make test` in parallel
  as two separate GitHub Actions workflows (`check.yml` and `test.yml`). `make test-podman` runs locally only, CI does
  not run it.
