# Implementation Notes

This document collects library behaviour the implementation has to work around, grouped by library. The rules these
notes support are in the other documents.

## FastAPI Notes

- Static routes such as `/folders/deleted` are declared before `/folders/{folder_id}`, because `deleted` would otherwise
  be a malformed ID and get 422.
- The 401, the 413 and the 503 come from the middleware, which runs outside FastAPI's exception handlers, so it calls
  the problem+json helper in `problem.py` directly.
- The 422 from schema validation is not a domain error, so FastAPI's default 422 body has to be replaced with the one in
  [REST Error Format](errors.md#rest-error-format). The default would also send the input back, which at the login route
  would be a password.
- Framework errors (404 for unknown routes, 405, 500) go through a handler, since they return a different body by
  default. The handler keeps `exc.headers`, so rebuilding the 405 does not lose `Allow`.
- The app sets `redirect_slashes=False`. The default answers `/api/v1/folders/` with a 307 whose `Location` is built
  from the request, so behind a TLS proxy it depends on trusting forwarded headers. A trailing slash is then an unknown
  route.
- FastAPI turns any exception during body parsing into a 400. The application raises no 400 of its own, so the same
  handler answers it with the 422 for an unparsable body.
- Raising from a wrapped `receive` does not work for the [body limit](limits.md#request-body-limit). FastAPI turns any
  exception during body parsing into a 400, and a route that reads no body would answer 404, although the Body size
  check comes before Routing in the [check order](request-checks.md#check-order). So the body is read up front and
  replayed.

## Pydantic Notes

- `SafeText`: Pydantic's `str` accepts NUL and lone surrogates, but writing them raises a `DBAPIError`, which is not an
  `IntegrityError` and would end as a 500.
- `UtcDatetime`: on output it writes the fixed format, because Pydantic's default omits the fraction when microseconds
  are exactly zero.

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
- `infinity` comes back naive, so it is not a valid value: columns only get `now()`, or `now()` plus a lifetime.

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

`schemas/paging.py` has the shared types for `limit` and the cursors.

- The adapter decodes the cursor and passes the sort key to the service as plain values, because services never import
  `schemas/`.
- A repository returns a `Page` from `domain.py` with the rows and the sort key of the last one, and the adapter encodes
  that key.
- Decoded strings go through `SafeText`, because a crafted NUL would otherwise reach asyncpg and become a 500.
