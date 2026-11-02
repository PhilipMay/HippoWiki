# Review Results

Full project review of 2026-11-02: all documents in `spec/`, `CLAUDE.md`, `README.md`, the code, the tests and the build and CI configuration.

## Summary

HippoWiki is still a specification plus scaffolding. The only application code is `src/hippowiki/demo.py`, and the tests that matter pin library behaviour for [Time](time.md). So nothing below is a bug in running code; the findings are places where the code would go wrong if it were written as specified.

The specification is in good shape. No contradiction was found between the documents, and most of its claims about libraries proved correct when tested. The main problems are:

- Four planned behaviours fail when tried on the real stack: reading results after commit, text PostgreSQL rejects, oversized streamed bodies and extreme timestamps. The in-memory fakes would hide the first two from `make test`.
- There is no implementation plan, although that is the stated objective, and the order of the next steps delays coding more than it needs to.
- The login method remains the largest open decision, and the goal of supporting Claude and ChatGPT narrows it considerably.

## How This Was Checked

| Check                                  | Result                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `make check`                           | passes (black, ruff, mypy, mdformat)                                     |
| `make test`                            | 29 passed, 7 deselected                                                  |
| `make test-podman`                     | 7 passed                                                                 |
| Internal links and anchors in the docs | 73 checked, none broken                                                  |
| Numbered headings                      | none, as `CLAUDE.md` requires                                            |
| Files listed in `CLAUDE.md`            | all exist                                                                |
| CI workflows                           | read only: no run results were looked at and the action tags not checked |

The planned stack is not in `pyproject.toml` yet, so claims about it were tested with small throwaway programs in a separate environment, against a temporary `postgres:16-alpine` container. No project file other than this one was changed. Results below marked **Verified** come from these runs, with these versions:

- `mcp` 2.3.0
- `fastapi` 0.162.0
- `starlette` 1.10.0
- `uvicorn` 0.54.0
- `sqlalchemy` 2.1.6
- `asyncpg` 0.32.0
- `pydantic` 2.14.2

Findings not marked this way come from reading the documents.

## High Priority

### Reading a result after commit fails with the default session settings

[Architecture](architecture.md#cross-cutting-concerns) has each public service method commit before returning, but no document says what happens to the loaded objects. SQLAlchemy's default `expire_on_commit=True` expires them on commit, so the next attribute access needs IO.

- **Verified:** reading `created_at` after `await session.commit()` raises `MissingGreenlet`. With `expire_on_commit=False` it returns the value.
- **Why it can hide:** fakes do not expire anything, so `make test` stays green and only real requests fail.
- **Recommendation:** state `expire_on_commit=False` in the `db/engine.py` entry of [Package Layout](package-layout.md), next to `eager_defaults` in [Time](time.md).

### No document defines the data passed between the layers

The layer rules say who may call whom, but not what repositories and services return. This decides how fakes are written, whether ORM objects can reach the adapters, and whether the previous finding can happen at all. The rules also do not say whether `services/` may import `schemas/`.

- **Recommendation:** repositories and services exchange small frozen dataclasses defined next to the Protocols, and the adapters map them to `schemas/`. ORM models then stay inside `repositories/`, the fakes need no SQLAlchemy objects, and `schemas/` stays free of domain types.

### Valid JSON text can reach PostgreSQL and become a 500

Pydantic's `str` accepts text that PostgreSQL's `text` type can not store. [Request Checks](request-checks.md#validation) covers shape, types and name rules, but not this.

- **Verified:** with a FastAPI body model, `{"s":"a\u0000b"}` and `{"s":"a\ud800b"}` both pass validation. Writing either through SQLAlchemy and asyncpg raises `DBAPIError`, which is not an `IntegrityError`, so it ends in the 500 row of the check order.
- **Why it can hide:** the fakes store any string, so only `make test-podman` could notice, and only with a test written for it.
- **Reach:** every text field, including `content_md`, and this is easy to trigger because AI clients write the content. The MCP path was not run with these inputs.
- **Recommendation:** add one shared text type in `schemas/` that rejects NUL and lone surrogates, used by all request models. The result is the normal 422 and tool error, because it depends only on the request. Add both inputs to [Test Cases](test-cases.md).

### A streamed body over the limit gets 400 on REST, or 404 on a route that reads no body

[Auth Middleware](auth-middleware.md#request-body-limit) promises a 413 "while reading, whatever the route". The obvious implementation wraps `receive` and raises when the limit is passed, and that does not keep the promise.

**Verified** with a chunked body over the limit, so with no declared length:

| Target             | Result                                                      |
| ------------------ | ----------------------------------------------------------- |
| REST route         | 400 `There was an error parsing the body`, not problem+json |
| MCP route          | 413, as intended                                            |
| Unknown REST route | 404, because nothing reads the body                         |

FastAPI turns any exception during body parsing into this 400 (`fastapi/routing.py:495-497`). The 400 appears nowhere in the [check order](request-checks.md#check-order), and the 404 contradicts its Body size row, which comes before Routing.

- **Recommendation:** buffer up to the limit in the middleware before calling the app, and replay the body. The SDK's `RequestBodyLimitMiddleware` (`transport_security.py:126`) already works this way. Memory is bounded by the limit, and all three cases above then give 413, so the check order becomes true as written.
- **Test:** the existing case on line 23 of [Test Cases](test-cases.md) does not say the body is streamed, so add a chunked variant. A test with a declared length would pass while this bug remains.

### Other unparsable bodies also get an undocumented 400

This comes from the same FastAPI code path as the previous finding, but needs its own fix.

- **Verified:** a body with invalid UTF-8 and a deeply nested JSON array both get 400 `There was an error parsing the body`. Only ordinary malformed JSON gets the 422 that the check order requires for all malformed JSON.
- **Recommendation:** decide whether these count as schema validation (422) or get their own documented row, and make sure the response is problem+json either way. The current framework handler text covers 404, 405 and 500 only, so add 400 to [REST Error Format](request-checks.md#rest-error-format) and [Test Cases](test-cases.md#error-format).

### The login method is narrower than the open list suggests

[Still Missing: Authentication](known-limitations.md#still-missing-authentication) treats passwords, API tokens and OAuth as open, but [Goals](goals.md) names Claude and ChatGPT as clients, and this probably settles part of it.

- Anthropic's documentation describes OAuth with discovery from a 401 carrying `WWW-Authenticate: Bearer resource_metadata=...`, and also lists authless servers, which [Goals](goals.md) rules out, and a request-header option whose details could not be confirmed.
- For ChatGPT the sources agree on OAuth as the usual setup but partly contradict each other, and no OpenAI documentation was found in this search. This needs checking directly.
- **Likely result:** OAuth for hosted AI connectors, perhaps with API tokens for scripts. That brings a decision on running an authorization server or using an external identity provider, and it adds `/.well-known/oauth-protected-resource` to the public routes.
- **Recommendation:** make the first question "what must the hosted connectors have", not a free choice of method, and try it early with a real connector, because the local transport tests can not show this.

Sources: [Claude connector authentication](https://claude.com/docs/connectors/building/authentication.md), [Claude custom connectors](https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers), [Auth0 on ChatGPT and MCP](https://auth0.com/blog/add-remote-mcp-server-chatgpt/), [Oceanum on ChatGPT](https://docs.oceanum.io/datamesh/ai-tools/chatgpt/).

## Medium Priority

### Mounting at `/mcp` leaves clients with a redirect

[MCP](mcp.md#open-mounting-the-mcp-app) lists the `/mcp/mcp` problem, but the obvious fix has its own.

**Verified:**

| Setup                                         | `POST /mcp` | `POST /mcp/` | `POST /mcp/mcp` |
| --------------------------------------------- | ----------- | ------------ | --------------- |
| mounted at `/mcp`, default path               | 307         | 404          | 200             |
| mounted at `/mcp`, `streamable_http_path="/"` | 307         | 200          | 404             |
| `mcp_app.routes` added to the FastAPI router  | 200         | 307          | 404             |

The redirect's `Location` is built from the request, so behind a TLS proxy it depends on forwarded headers being trusted, and it is one more thing MCP clients must follow on a POST.

- **Recommendation:** add the routes to the FastAPI router instead of mounting. The middleware still wraps them, and the session manager runs in the parent lifespan as already required. Update "mounted" in [Architecture](architecture.md), [Auth Middleware](auth-middleware.md) and [Package Layout](package-layout.md) if this is chosen.

### `GET /mcp` holds a connection open in stateless mode

- **Verified:** with `stateless_http=True`, `GET /mcp` answers 200 `text/event-stream` and was still open when the probe stopped after 3 seconds. [MCP](mcp.md) says nothing needs a session, and nothing uses this stream either, so any authenticated client can hold connections open for no benefit.
- **Recommendation:** answer `GET` with 405 in front of the SDK, as MCP allows for a server without such a stream, and check first that the target clients accept it. Add a transport test, and note the idle timeout at the reverse proxy in [Deployment](deployment.md).

### REST errors have no stable code, so the two 409s look the same

MCP gets stable codes such as `name_conflict` and `version_conflict`, while [REST Error Format](request-checks.md#rest-error-format) defines only the format. A REST client can not tell a name conflict from a version conflict, although it must react differently: pick a new name or reload the document.

- **Recommendation:** define problem `type` values, or a `code` extension, that match the MCP codes.
- **Also state** that a 404 body has no `instance` and no ID. [Test Cases](test-cases.md#visibility) compare the full 404 body of a hidden and a missing item, and those necessarily have different IDs.

### `UtcDatetime` can raise an uncaught exception, and its accepted format is not settled

[Time](time.md) says the type "converts to UTC". Pydantic only turns `ValueError` and `AssertionError` into validation errors.

- **Verified:** converting `0001-01-01T00:00:00+14:00` or `9999-12-31T23:59:59-14:00` with `astimezone(UTC)` in a validator raises `OverflowError`, which is not caught and so gives a 500 instead of a 422.
- **Verified:** `AwareDatetime` also silently truncates `.123456789` to six digits, and accepts `2026-10-30t14:05:09z`, `2026-10-30 14:05:09Z` and `2026-10-30T14:05Z`. The spec does not say whether these are acceptable, and the fixed output format suggests they may not be.
- **Recommendation:** catch the overflow in the validator, decide on strict RFC 3339 input, and add these values to `tests/test_time_libraries.py` and the unit tests.

### Lists have no pagination or size limit, and this is not tracked

[Size Limits](known-limitations.md#next-steps) covers document size and request bodies only. A list of md_documents can be arbitrarily large, and this matters most on MCP, where a large tool result goes straight into an AI client's context.

- **Recommendation:** add it to REST and MCP planning: page size, a maximum, cursor or offset, and whether lists return `content_md`. [Time](time.md) already provides the tie-breaker rule that a stable order needs.

### Name rules have gaps beyond the ones already tracked

Step 4 of the [Next Steps](known-limitations.md#next-steps) covers the format for tabs and users. These are not covered:

- No name has a maximum length. Only the request body limit would stop a very long folder name.
- The folder and md_document format allows `-`, `--` and names with leading or trailing hyphens.
- `is_root = (name = 'admin')` is an exact match, so until the user name format exists a user can be called `Admin`, or use a lookalike character, and look like the root admin in lists.
- Tab names are unrestricted, so a name of only spaces is valid.

### The layer rules do not cover every package, and nothing enforces them

The [Layer Rules](architecture.md#layer-rules) do not mention `auth/`, `problem.py` or `config.py`. In practice adapters need `auth/principal.py`, services need it too, `auth/credentials.py` needs `repositories/interfaces.py`, and the adapters must import `services/errors.py`. These are all reasonable, but they are not written down, and "`api/` and `mcp/` call only `services/`" reads as if they were not allowed.

- **Recommendation:** add these rules, and add [import-linter](https://import-linter.readthedocs.io/) contracts to `make check`. These rules are the core of the architecture, and nothing else in `make check` would catch a violation. Check with the maintainer first, since this is a new dev tool.

### How shared schemas become MCP tool arguments is undefined

[Tech Stack](tech-stack.md) says request models are shared with MCP, but the SDK builds the arguments from the function signature.

**Verified:**

- A tool taking a model has to be called as `{"req": {...}}`. Flat arguments fail with `Field required`, so the model's name becomes part of the tool's interface for AI clients.
- A flat signature avoids this but repeats each field outside the shared model.
- Unknown top-level arguments are dropped as [Tool Arguments](mcp.md#tool-arguments) says, while unknown fields inside a nested model with `extra="forbid"` are rejected. So the shared wrapper is needed either way.
- The generated `input_schema` has no `additionalProperties: false`, so if the wrapper only changes the model, clients are not told. The wrapper also relies on SDK internals (`fn_metadata.arg_model`).
- The SDK's invalid-argument error contains `input_value=...` and a pydantic.dev link, which is what AI clients will see.

**Recommendation:** decide flat or nested before the first tool, and make the wrapper update the advertised schema as well.

### The SDK references are correct but tied to an unnamed version

- [Tech Stack](tech-stack.md) says "2.x", and the citations in [MCP](mcp.md) and [Known Limitations](known-limitations.md) give line numbers without a version. They match 2.3.0, so name that version.
- `mcpserver/server.py:1164-1168` is in `sse_app`. The Streamable HTTP code is at `lowlevel/server.py:753`. The behaviour the spec describes is correct: **Verified** a foreign `Host` gets 421 and a foreign `Origin` gets 403.
- [MCP](mcp.md) does not mention protocol version `2026-07-28`. The SDK sends those requests through a separate path (`handle_modern_request`, from `streamable_http_manager.py:194`) before it looks at the stateless setting. **Verified** the principal resolver works there and no session ID is sent, but the transport tests should cover both paths, as should the test that each user's calls run under their own principal.
- [MCP](mcp.md#open-mounting-the-mcp-app) says local transport tests can not notice the host check. They can if they send an explicit `Host` header, as this review did, so add a test once the setting exists.

## Low Priority

### Specification

- **Non-HTTP scopes:** [Auth Middleware](auth-middleware.md) should say that `lifespan` passes through and `websocket` fails closed. Add a test for this, and for public routes matching on the exact path, so a trailing slash or a mount can not open or close one by accident.
- **Stale principal:** `is_admin` is read in the middleware's unit of work, before the service's transaction. A request already running when an admin is demoted can still finish as admin. This is probably acceptable, but the spec should say so, and say whether services read rights inside their own transaction.
- **Database outage:** the same outage gives 503 from the middleware but 500 if it starts during the service call. Decide whether this is intended. The 503 also has no row in the [check order](request-checks.md#check-order) table.
- **Timing:** a hidden item may take a different time to answer than a missing one, despite the [identical 404](request-checks.md#leaks). Random UUIDs make this hard to exploit, so accepting it in writing is enough.
- **Discovering your own account:** users have no way to read their own user record, and non-admins can not list users, so a `created_by` ID can not be turned into a name. Cover this in REST planning.
- **OpenAPI docs:** Swagger UI behind authentication can not load `/openapi.json` from a browser without extra setup, and it loads assets from a CDN. Consider serving only `/openapi.json`.
- **Logging:** [Architecture](architecture.md) asks for structured JSON through stdlib `logging`, but no formatter is chosen, and Uvicorn's own logs need the same format.
- **Deployment:** [Deployment](deployment.md) does not cover secrets in `compose.yaml`, running the container as non-root, or how the health check works in a slim image without `curl`.
- **PostgreSQL image:** the pin tests use `postgres:16-alpine`, while the `compose.yaml` image is not named. Alpine and Debian images can sort text differently, so use the same image for both once sorted lists exist.

### Repository and Tooling

- **Demo code:** `[project.scripts]` points `hippowiki` to `demo:main`, while the spec has `cli.py`. Remove `demo.py` and `test_demo.py` with the first real code.
- **Dependencies:** `asyncpg` and `pydantic` are runtime dependencies but only tests import them, which is fine as preparation. When SQLAlchemy is added, use `sqlalchemy[asyncio]`, because greenlet is only in that extra (**Verified** in the 2.1.6 package metadata). [Tech Stack](tech-stack.md) says 2.0, while the current release is 2.1.
- **PostgreSQL tests in CI:** [Testing Strategy](testing.md) accepts not running them, and the current suite takes under 2 seconds here. This is worth reconsidering when repositories arrive, since the most important findings above would only show up there. `DOCKER_HOST` can already be overridden, so CI would not need the `podman machine` call in the `Makefile`.
- **`make install`:** `--all-extras` does nothing because no extras are defined, and `uv lock` can change the lock file as a side effect of installing.
- **Test configuration to add with the first async tests:** `asyncio_mode`, a mypy Pydantic plugin, and `--import-mode=importlib`, because `tests/` is not a package and test files in subfolders with the same name would collide. Coverage is not measured, although [Test Cases](test-cases.md) asks for every check and rule to be tested.
- **CI:** actions are pinned by tag, not by hash, and `cancel-in-progress` also cancels runs on `main`.
- **`README.md`:** it does not mention `make install`, `make check` or `make test`.
- **`CLAUDE.md`:** `# Objective` is a top-level heading in the middle of the file, which places `## Documents` and the rest under it.
- **PyYAML tests:** `tests/test_time_libraries.py` pins behaviour for frontmatter parsing, which is out of scope for now. This costs little, so it can stay.

## Checked and Found Correct

These claims could have been wrong, and each was tried or checked against the source:

- PostgreSQL reports a check violation before a unique violation: a second tab named `""` with `is_default` false gives 23514. This confirms the reason for the fixed rule on the empty name in [Entity Rules](entity-rules.md#names).
- A unique violation surfaces at flush, and the session then refuses further work with `PendingRollbackError`, as the [layer rules](architecture.md#layer-rules) assume.
- The root admin can be inserted with `created_by` equal to its own `id`.
- The repository translation has what it needs: `orig.sqlstate` separates 23505 from other violations, and the constraint name is on `orig.__cause__`. It has to test for 23505, so that check and foreign key violations do not become `DuplicateNameError`.
- MCP behaves as [MCP](mcp.md#errors) describes:
  - An unexpected exception is masked as `Error executing tool <name>`, with no details.
  - A `ToolError` gets the documented prefix.
  - An unknown tool gets a tool error.
  - An unknown JSON-RPC method and malformed JSON get protocol errors.
  - No `Mcp-Session-Id` is sent.
- The principal can be read from `ctx.request_context.request.scope` in a tool, as the production resolver plans.
- The SDK citations for the 4 MiB limit, the task group error, the default path and the back channel all point to the right lines in 2.3.0.
- The session owner check only applies to the SDK's `AuthenticatedUser`, which is the reason given for stateless mode.
- `schemas/time.py` does not trigger ruff's `A005` standard-library shadowing rule, and neither does `hippowiki/mcp/`.
- The check order, the [rejected operations](request-checks.md#rejected-operations), [Auth Concept](auth-concept.md) and [Test Cases](test-cases.md) agree with each other. No contradiction was found between the documents, and the known gaps such as revisions and `updated_at` are all tracked in [Known Limitations](known-limitations.md).
