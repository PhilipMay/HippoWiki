# Gaps

These are open gaps in the specification, each with a suggested fix. The fixes are suggestions and are not applied yet,
so the other documents still have the current text. Remove a gap from this document once it is resolved.

## Missing Behaviour

These gaps leave a response undefined, so the fix decides how the system behaves.

### Reactivating the Root Admin or Your Own User

- Gap: [Admin Operations](users-and-rights.md#admin-operations) lets an admin reactivate only other users, and not the
  root admin. [Rejected Operations](request-checks.md#users-and-rights) has rows only for deleting and deactivating, so
  no response is defined for these two requests.
- Suggested fix: reject both with `ForbiddenError` (403, Target rules), by changing the two rows to "delete, deactivate
  or reactivate the root admin" and "delete, deactivate or reactivate own user".
- Why: it matches the existing text, and the requests have no use. The root admin is never deactivated, and a
  deactivated admin can not authenticate to reactivate themselves.

### Folder Revert to an Unknown Number

- Gap: [Revert](history-revisions.md#revert) treats a revision of another item or folder as a missing one, but the
  target of a [folder revert](history-revisions.md#folder-revert) is a number, not a revision. No response is defined
  for a number that is not in the history of the folder.
- Suggested fix: add the row "revert a folder to a number that is not in its history" with `NotFoundError` (404, Target
  lookup) to [Rejected Operations](request-checks.md#revert), and extend the sentence in
  [Revert](history-revisions.md#revert) to cover it.
- Why: it is the same case as a revision that does not exist, so it should get the same response.

### Host and Origin Checks in the Check Order

- Gap: [Serving the MCP App](mcp.md#serving-the-mcp-app) gives a foreign `Host` a 421 and a foreign `Origin` a 403, but
  these checks are not in the [check order](request-checks.md#check-order), so it is undefined which response wins when
  a request fails several checks.
- Suggested fix: add a row "Host check" after Routing and before Schema validation, for MCP only, with no domain error
  and HTTP 421 or 403 on MCP. Add a transport test that sends an unauthenticated request and an invalid body with a
  foreign `Host`, expecting 401 and 421.
- Why: the SDK runs this check, and only an authenticated `POST` reaches the SDK, so it can not come before Routing. The
  place before Schema validation is an assumption about the SDK, and the test has to confirm it.

## Wording

These gaps are inaccurate text. The fix changes no behaviour.

### `auth_subject` in Domain Validation

- Gap: the Domain validation row of the [check order](request-checks.md#check-order) and the
  [Validation](request-checks.md#validation) rules mention only names and sizes, but the `auth_subject` row of
  [Rejected Operations](request-checks.md#users-and-rights) uses this check.
- Suggested fix: change the row to "a name, `auth_subject` or size that breaks the domain rules", and add the
  [`auth_subject` length](users-and-rights.md#user-linking) to the Validation rules.

### "Live but Hidden" Default Tab

- Gap: [Deleting and Restoring Content](entities.md#deleting-and-restoring-content) calls the default tab of a deleted
  folder "live but hidden". The same section says an item is live only when it and all its parents have `deleted_at`
  null, so this tab is not live.
- Suggested fix: change the text to "a deleted folder keeps its default tab, whose own `deleted_at` stays null, and the
  tab is hidden through the folder".

### "The One Exception" in the Architecture

- Gap: the [overview](architecture.md#overview) calls admin access the one exception to both interfaces behaving
  identically, but [history and revert](mcp.md#history-and-revert) are also available only on REST, for every right.
- Suggested fix: change the text to "The one exception is that some things exist only on REST: admins, admin operations,
  history and revert".

### Stale Examples in Time

- Gap: the One clock rule in [Time](time.md#rules) covers an expiry stored in the database, and the Durations rule uses
  `token_ttl_seconds` as its example, but [HippoWiki stores no tokens](authentication.md#token-lifecycle) and no table
  has an expiry column.
- Suggested fix: remove the sentence about stored expiries, because the rest of the One clock rule already covers any
  later case. Replace the example with a duration HippoWiki needs, such as `jwks_refetch_interval_seconds` for the
  limited refetch in the [Token Check](authentication.md#token-check).
