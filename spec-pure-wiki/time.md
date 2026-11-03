# Time

One rule: **persisted points in time are stored in UTC, set by the database clock; everything else is a representation
of that.** Library details are in [Implementation Notes](implementation-notes.md).

## Rules

- **Instants** (points in time) are PostgreSQL `timestamptz`, never plain `timestamp`. Columns are
  `NOT NULL DEFAULT now()` unless null has a meaning (e.g. `deleted_at`) or a lifetime sets them (`expires_at`, which is
  `now()` plus the lifetime). Column names end in `_at` (`created_at`, `deleted_at`). Server and connection time zone
  are set to `UTC`.
- **One clock: the database.** Persisted timestamps are set with `now()` (column default `now()`, updates set
  `deleted_at = now()`), never taken from clients and never from the app host clock. `now()` is the start of the
  transaction, so all rows written together share the exact same timestamp. The app host clock is only for values that
  are not persisted, such as log lines.
- **Ordering**: timestamps are for humans, not for ordering guarantees. `now()` is the transaction start and the clock
  is not monotonic, so timestamp order is not commit order, and rows from one transaction tie exactly. Revisions are
  ordered by version or folder number, and sorted lists use the primary key as a tie-breaker.
- **Last change**: no table stores it. The `created_at` of the latest
  [history entry](database.md#folder-history-entry-table) of an item gives it, so a second timestamp could only
  disagree.
- **Python** uses only timezone-aware `datetime` objects in UTC (`datetime.now(UTC)` if the app ever needs "now"); a
  naive `datetime` is a bug.
- **Wire format** is RFC 3339 (a profile of ISO 8601) in UTC with `Z` and always six fractional digits, e.g.
  `2026-10-30T14:05:09.123456Z`. REST uses one `UtcDatetime` annotated type from `schemas/time.py`. HTTP headers
  (HTTP-date) follow their own standard.
- **Wire input**: no request field takes a time, so there is no parser for one. A later field that takes a time needs
  its input rules defined first.
- **Durations** (TTLs, limits) are integers with the unit in the name, e.g. `SESSION_SECONDS`.
- **Logs** use UTC, RFC 3339 with `Z`.
- **Local time is presentation only**: converting to a user's time zone is the client's job, no user time zone is
  stored. Accepted trade-off: the author's original UTC offset is not kept.
