# Time

One rule: **persisted points in time are stored in UTC, set by the database clock; everything else is a
representation of that.**

- **Instants** (points in time) are PostgreSQL `timestamptz`, never plain `timestamp`. Columns are
  `NOT NULL DEFAULT now()` unless null has a meaning (e.g. `deleted_at`). Column names end in `_at`
  (`created_at`, `updated_at`, `deleted_at`). Server and connection time zone are set to `UTC`: `compose.yaml` sets
  `timezone=UTC` on the server and `db/engine.py` passes `server_settings={"timezone": "UTC"}`. asyncpg returns UTC
  whatever the session time zone, so this only affects `psql` output and text casts in SQL.
- **One clock: the database.** Persisted timestamps are set with `now()` (column default `now()`, updates set
  `updated_at = now()`), never taken from clients and never from the app host clock. `now()` is the start of the
  transaction, so all rows written together share the exact same timestamp. The app host clock is only for values
  that are not persisted, such as log lines. An expiry stored in the database is compared with `now()`. Import follows
  the same rule: `created_at` means "entered this system", and dates from the source stay in the frontmatter.
- **Ordering**: timestamps are for humans and filters, not for ordering guarantees. `now()` is the transaction
  start and the clock is not monotonic, so timestamp order is not commit order, and rows from one transaction tie
  exactly. Revisions are ordered by version number, and sorted lists use the primary key as a tie-breaker.
- **Python** uses only timezone-aware `datetime` objects in UTC (`datetime.now(UTC)` if the app ever needs "now");
  a naive `datetime` is a bug. ruff's `DTZ` rules (included in `select = ["ALL"]`) catch common mistakes but are not
  a guarantee: they miss non-UTC offsets and values returned by libraries. One shared type and tests enforce the
  rest.
- **SQLAlchemy** columns use `DateTime(timezone=True)`, set once through
  `type_annotation_map = {datetime: DateTime(timezone=True)}`, because a bare `Mapped[datetime]` would be naive.
  `updated_at` uses `onupdate=func.now()`. Mappers use `eager_defaults=True`, because the default `"auto"` only
  fetches server-set values after INSERT, and reading one after UPDATE would trigger implicit IO in async code.
  Sessions use `expire_on_commit=False` for the same reason: the default expires loaded objects on commit, and the next
  attribute access raises `MissingGreenlet`. The fakes expire nothing, so only `make test-podman` can notice this. A
  test fails on any naive datetime column. asyncpg returns aware UTC datetimes and reads a naive parameter as host
  local time, so a naive value silently stores the wrong instant. `infinity` comes back naive, so it is not a valid
  value: columns only get `now()`, and input validation rejects it.
- **Wire format** (REST, MCP, export) is RFC 3339 (a profile of ISO 8601) in UTC with `Z` and always six fractional
  digits, e.g. `2026-10-30T14:05:09.123456Z`. REST and MCP share one `UtcDatetime` annotated type from
  `schemas/time.py`. On output it writes the fixed format, because Pydantic's default omits the fraction when microseconds are exactly zero. On
  input it accepts only strings in a strict profile of RFC 3339: `YYYY-MM-DDTHH:MM:SS`, optionally a fraction of one to
  six digits, then `Z` or an offset such as `+02:00`. It rejects values without offset or seconds, a lowercase `t` or `z`,
  a space as the separator, Unix timestamps and more than six fractional digits, which it does not truncate. It converts
  to UTC, and a value that overflows there, such as `0001-01-01T00:00:00+14:00`, is a validation error: Pydantic only
  turns `ValueError` and `AssertionError` into validation errors, so the validator has to catch the `OverflowError`, which
  would otherwise become a 500. Pydantic's `AwareDatetime` alone is not enough, because it keeps the offset, accepts Unix
  timestamps and the formats above, and truncates the fraction. HTTP headers (HTTP-date) and JWT claims (Unix seconds)
  follow their own standards.
- **Time ranges** (e.g. list filters, and later search filters) are half-open: `[since, until)`.
- **Calendar dates** without a time of day (e.g. a "published" date) are `date` / `YYYY-MM-DD`, column names end
  in `_on`. A date is never encoded as midnight UTC.
- **Durations** (config, TTLs, limits) are integers with the unit in the name, e.g. `token_ttl_seconds`.
- **Frontmatter** stays verbatim in `content_md`. If it is ever extracted into `jsonb`, dates and times are kept as
  strings by turning off PyYAML's timestamp parsing.
- **Logs** use UTC, RFC 3339 with `Z`.
- **Local time is presentation only**: converting to a user's time zone is the client's job, no user time zone
  is stored. Accepted trade-off: the author's original UTC offset is not kept. Future events in local time would
  need local time plus an IANA zone, which is out of scope for now.
- **Tests** of time-dependent behaviour use separate committed transactions, because one rolled-back wrapper
  transaction gives every `now()` the same value. They do not rely on freezing Python's clock, which does not affect
  the database.
