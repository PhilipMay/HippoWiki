# Testing Strategy

- **Unit tests**
- **Integration tests**: services and repositories against a real PostgreSQL (testcontainers). They carry the `podman`
  marker, so `make test` skips them. `make test-podman` runs them and sets `DOCKER_HOST` to the Podman socket and
  `TESTCONTAINERS_RYUK_DISABLED=true`; both can be overridden from the environment.
- **REST tests**: `httpx.AsyncClient` against the FastAPI app.
- **MCP tests**: in-memory client session from the `mcp` SDK calling the tools.
- **Check order tests**: the order defined in [API](api.md), on REST and, where it applies, on MCP.
  - Unauthenticated malformed JSON gets 401.
  - An invalid body gets the same 422 for a hidden, a missing and a readable folder.
  - A non-admin on an admin operation gets 422 with an invalid body and 403 with a valid one.
  - A user without the required right and with an invalid name gets 403.
- **Public route tests**: without credentials, health returns its fixed body without touching the database, and every
  other route gets 401, including MCP and the OpenAPI docs.
- `make format`, `make check` and `make test` must stay green locally; CI runs `make check` and `make test` in parallel
  as two separate GitHub Actions workflows (`check.yml` and `test.yml`). `make test-podman` runs locally only, CI does
  not run it.
