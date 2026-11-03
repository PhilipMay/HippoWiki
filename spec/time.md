# Time

One rule: **persisted points in time are stored in UTC, set by the database clock; everything else is a representation
of that.** Library details are in [Implementation Notes](implementation-notes.md).

## Rules

- **Instants** (points in time) are PostgreSQL `timestamptz`, never plain `timestamp`. Columns are
  `NOT NULL DEFAULT now()` unless null has a meaning (e.g. `deleted_at`). Column names end in `_at` (`created_at`,
  `deleted_at`). Server and connection time zone are set to `UTC`.
- **One clock: the database.** Persisted timestamps are set with `now()` (column default `now()`, updates set
  `deleted_at = now()`), never taken from clients and never from the app host clock. `now()` is the start of the
  transaction, so all rows written together share the exact same timestamp. The app host clock is only for values that
  are not persisted, such as log lines. Import follows the same rule: `created_at` means "entered this system", and
  dates from the source stay in the frontmatter.
- **Ordering**: timestamps are for humans and filters, not for ordering guarantees. `now()` is the transaction start and
  the clock is not monotonic, so timestamp order is not commit order, and rows from one transaction tie exactly.
  Revisions are ordered by version or folder number, and sorted lists use the primary key as a tie-breaker.
- **Last change**: no table stores it. The `created_at` of the latest
  [history entry](database.md#folder-history-entry-table) of an item gives it, so a second timestamp could only
  disagree.
- **Python** uses only timezone-aware `datetime` objects in UTC (`datetime.now(UTC)` if the app ever needs "now"); a
  naive `datetime` is a bug.
- **Wire format** (REST, MCP, export) is RFC 3339 (a profile of ISO 8601) in UTC with `Z` and always six fractional
  digits, e.g. `2026-10-30T14:05:09.123456Z`. REST and MCP share one `UtcDatetime` annotated type from
  `schemas/time.py`. HTTP headers (HTTP-date) and JWT claims (Unix seconds) follow their own standards.
- **Wire input** accepts only strings in a strict profile of RFC 3339: `YYYY-MM-DDTHH:MM:SS`, optionally a fraction of
  one to six digits, then `Z` or an offset such as `+02:00`. It rejects values without offset or seconds, a lowercase
  `t` or `z`, a space as the separator, Unix timestamps and more than six fractional digits, which it does not truncate.
  It converts to UTC, and a value that overflows there, such as `0001-01-01T00:00:00+14:00`, is a validation error.
- **Time ranges** (e.g. list filters, and later search filters) are half-open: `[since, until)`.
- **Calendar dates** without a time of day (e.g. a "published" date) are `date` / `YYYY-MM-DD`, column names end in
  `_on`. A date is never encoded as midnight UTC.
- **Durations** (config, TTLs, limits) are integers with the unit in the name, e.g. `jwks_refetch_interval_seconds`.
- **Frontmatter** stays verbatim in `content_md`. If it is ever extracted into `jsonb`, dates and times are kept as
  strings by turning off PyYAML's timestamp parsing.
- **Logs** use UTC, RFC 3339 with `Z`.
- **Local time is presentation only**: converting to a user's time zone is the client's job, no user time zone is
  stored. Accepted trade-off: the author's original UTC offset is not kept. Future events in local time would need local
  time plus an IANA zone, which is out of scope for now.
