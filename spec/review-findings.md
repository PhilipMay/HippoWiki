# Review Findings

Open findings from the review of all documents in `spec/`, checked against each other, the Makefile, `pyproject.toml`, the
CI workflows, the tests and the source of the `mcp` SDK 2.3.0. Everything listed in
[Known Limitations](known-limitations.md) is left out.

Last updated on 2026-11-02, when the findings of the last review were applied. This was not a new full review.

## Open

There are no open findings.

These parts of the findings could not be settled yet and moved to [Known Limitations](known-limitations.md):

- the value of the request body limit
- browser clients and CORS
- deleting and deactivating users
- the name format for tabs and users

## Checked Without Findings

- The rejected operations in `api.md` match the service rules in `entities.md`, and the check order tests in `testing.md`
  match the order in `api.md`.
- The check constraints do what `entities.md` says, including at most one default tab per folder and one root admin.
- The "four unique constraints" in `testing.md` are correct, and `RIGHT` is a reserved word in PostgreSQL.
- Links and anchors between the documents resolve.
- The Makefile and the CI workflows match `testing.md`.
- `mcp` 2.x exists on PyPI with the `MCPServer` API, and the SDK references in `known-limitations.md` are correct.
- The MCP column of the error mapping in `api.md` holds against the 2.3.0 source: an unknown tool and invalid arguments give
  tool errors, an unknown method gives a protocol error, and unexpected exceptions are returned without details. This was
  read in the source, not run.
- `stateless_http=True` sends no session ID, and the SDK limits MCP bodies to 4 MiB. This was read in the source, not run.
- The shared wrapper for unknown arguments in `api.md` works on 2.3.0. A subclass of the generated argument model with
  `extra="forbid"`, registered through `MCPServer(tools=[...])`, gave a tool error on an in-memory client.
- The library behaviour in `time.md` matches the tests. `make test` passes with 29 tests and `make test-podman` with 7, so
  the asyncpg claims were also run against PostgreSQL 16.
