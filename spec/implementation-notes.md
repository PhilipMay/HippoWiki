# Implementation Notes

This document collects library behaviour the implementation has to work around, grouped by library. The rules these
notes support are in the other documents. The SDK line numbers refer to `mcp` 2.3.0.

## FastAPI Notes

- Static routes such as `/folders/deleted` are declared before `/folders/{folder_id}`, because `deleted` would otherwise
  be a malformed ID and get 422.
- The 401, the 413, the 503 and the 403 for the admin on MCP come from the middleware, which runs outside FastAPI's
  exception handlers, so it calls the problem+json helper in `problem.py` directly.
- The 422 from schema validation is not a domain error, so FastAPI's default 422 body has to be replaced with the one in
  [REST Error Format](errors.md#rest-error-format). The default would also send the input back.
- Framework errors (404 for unknown routes, 405, 500) go through a handler, since they return a different body by
  default. The handler keeps `exc.headers`, so rebuilding the 405 does not lose `Allow`.
- FastAPI turns any exception during body parsing into a 400 (`fastapi/routing.py:495-497` in FastAPI 0.162.0). The
  application raises no 400 of its own, so the same handler answers it with the 422 for an unparsable body.
- Raising from a wrapped `receive` does not work for the [body limit](limits.md#request-body-limit). FastAPI turns any
  exception during body parsing into a 400, and a route that reads no body would answer 404, although the Body size
  check comes before Routing in the [check order](request-checks.md#check-order). So the body is read up front and
  replayed.

## Pydantic Notes

- `SafeText`: Pydantic's `str` accepts NUL and lone surrogates, but writing them raises a `DBAPIError`, which is not an
  `IntegrityError` and would end as a 500.
- `UtcDatetime`:
  - On output it writes the fixed format, because Pydantic's default omits the fraction when microseconds are exactly
    zero.
  - On overflow the validator has to catch the `OverflowError`, which would otherwise become a 500, because Pydantic
    only turns `ValueError` and `AssertionError` into validation errors.
  - Pydantic's `AwareDatetime` alone is not enough, because it keeps the offset, accepts Unix timestamps and the
    rejected formats, and truncates the fraction.

## SQLAlchemy Notes

- Columns use `DateTime(timezone=True)`, set once through `type_annotation_map = {datetime: DateTime(timezone=True)}`,
  because a bare `Mapped[datetime]` would be naive.
- Mappers use `eager_defaults=True`, because the default `"auto"` only fetches server-set values after INSERT, and
  reading one after UPDATE, such as `deleted_at = now()` or the incremented `revision_counter`, would trigger implicit
  IO in async code.
- Sessions use `expire_on_commit=False` for the same reason: the default expires loaded objects on commit, and the next
  attribute access raises `MissingGreenlet`.

## asyncpg Notes

- asyncpg returns aware UTC datetimes and reads a naive parameter as host local time, so a naive value silently stores
  the wrong instant.
- `infinity` comes back naive, so it is not a valid value: columns only get `now()`, and input validation rejects it.

## PostgreSQL Notes

- **Time zone settings**: `compose.yaml` sets `timezone=UTC` on the server and `db/engine.py` passes
  `server_settings={"timezone": "UTC"}`. asyncpg returns UTC whatever the session time zone, so this only affects `psql`
  output and text casts in SQL.
- **Collation**: the [name columns](database.md#rules-for-all-tables) use `COLLATE "C"`. The keyset comparison and
  `ORDER BY` have to agree, the partial unique indexes have to serve them, and it matches the string order of Python, so
  the fakes sort like PostgreSQL. It also does not depend on the image, unlike the sort difference
  [Deployment](deployment.md) mentions.
- **Assigning a right** uses `ON CONFLICT DO UPDATE SET access_right, assigned_by, assigned_at = now()`.
  - The statement sets `assigned_at` itself, because `DEFAULT now()` does not fire on the update.
  - Delete and insert is not an alternative, because two concurrent first assignments would then hit the primary key.
- **Lock on the folder row**: it is `SELECT ... FOR NO KEY UPDATE`, because this lock mode does not block the foreign
  key checks of `folder_rights`.
- **Partial unique indexes** can not be deferred, so a swap of two names in a folder revert has to free the names first,
  for example by setting `deleted_at` on the affected rows within the transaction.

## ruff Notes

Its `DTZ` rules (included in `select = ["ALL"]`) catch common mistakes but are not a guarantee: they miss non-UTC
offsets and values returned by libraries. One shared type and tests enforce the rest.

## Paging Code

`schemas/paging.py` has the shared types for `limit` and the cursors, used by both adapters.

- The adapters decode the cursor and pass the sort key to the service as plain values, because services never import
  `schemas/`.
- A repository returns a `Page` from `domain.py` with the rows and the sort key of the last one, and the adapter encodes
  that key.
- Decoded strings go through `SafeText`, because a crafted NUL would otherwise reach asyncpg and become a 500.

## MCP SDK Notes

- Stateless mode: the SDK compares session owners only if the scope holds its own `AuthenticatedUser`, so with our
  principal in the scope any authenticated user holding a session ID would pass. Without sessions, tools can not reach
  the client (`streamable_http_manager.py:233`).
- Unknown arguments: the argument model generated by the SDK drops them, so the shared tool wrapper in `mcp/tools.py`
  sets `extra="forbid"` on it. This uses an SDK internal (`fn_metadata.arg_model`), which a test pins.
- Input schema: the generated `input_schema` has no `additionalProperties: false`, so the wrapper sets it.
- Invalid arguments: the SDK's error contains `input_value=...` and a pydantic.dev link, so the wrapper replaces it.
- Tool errors: a domain error that is not translated would be masked by the SDK as `Error executing tool <name>`.
- Tool results: tools register with `structured_output=False`. With a typed return the SDK sends the data twice, as
  `content` and as `structured_content` (`func_metadata.py:209-226`), and adds an output schema to every tool
  description.
- Routes: mounted at `/mcp`, `POST /mcp` gets a 307 redirect whatever `streamable_http_path` is set to. The `Location`
  of this redirect is built from the request, so behind a TLS proxy it depends on trusting forwarded headers, and MCP
  clients would have to follow it on a POST. `streamable_http_path` keeps its default of `/mcp`
  (`mcpserver/server.py:1291`).
- Lifespan: Starlette does not run the lifespan of the MCP app. Without the session manager in the FastAPI lifespan,
  requests fail with "Task group is not initialized" (`streamable_http_manager.py:140-146`, `:185`).
- Methods: without the 405 for everything except `POST`, `GET /mcp` answers 200 `text/event-stream` in stateless mode
  and holds a connection open that nothing uses.
- Host check: by default the SDK enables DNS rebinding protection that allows only localhost hosts and origins
  (`lowlevel/server.py:753`). Behind the required reverse proxy, real requests would be rejected, which is why the
  allowed hosts and origins are settings. The transport tests send the `Host` and `Origin` headers explicitly, because a
  local port would not notice otherwise. That the check comes before schema validation is an assumption about the SDK,
  which a transport test confirms.
- Protocol versions: the SDK sends requests with protocol version `2026-07-28` through a separate path
  (`handle_modern_request`, from `streamable_http_manager.py:194`), before it looks at the stateless setting. The
  transport tests cover both paths.
- Body size: the SDK limits MCP bodies to 4 MiB by itself and answers with a plain text 413
  (`transport_security.py:15`). Our [limit](limits.md#request-body-limit) is lower, so the middleware always answers
  first and `max_request_body_size` stays unset. The SDK's `RequestBodyLimitMiddleware` (`transport_security.py:126`)
  works the same way as ours.
