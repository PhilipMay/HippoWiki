# Test Cases

Every check and rule in [Request Checks](request-checks.md) needs a test, on REST and, where it applies, on MCP. This
document lists the combinations that are easy to miss, and the cases of other documents. The test kinds are defined in
[Testing Strategy](testing.md).

## Check Order

- Unauthenticated malformed JSON gets 401.
- An unauthenticated request to an unknown route or with a wrong method gets 401.
- An authenticated request to an unknown route gets 404, and one with a wrong method gets 405, also with an invalid body.
- On MCP, an unknown tool gets a tool error.
- An invalid body gets the same 422 for a hidden, a missing and a readable folder.
- On MCP, malformed JSON gets a protocol error and invalid tool arguments get a tool error.
- A non-admin on an admin operation with no existing folder as its target gets 422 with an invalid body and 403 with a
  valid one.
- A non-admin on a folder operation gets 422 with an invalid body, 404 with no right on the folder and 403 with a right.
- A user without the required right and with an invalid name gets 403.
- A user without the required right who names a missing target gets 403.
- A target tab in another folder gets the same 404 as a missing one, whatever the rights of the user on its folder.
- Each row of [Rejected Operations](request-checks.md#rejected-operations) gets its response.
- A name conflict is reported only after domain validation.
- An authenticated request with a body over the limit gets 413, and an unauthenticated one gets 401.
- A chunked body over the limit, so with no declared length, gets the same 413 on a REST route, on MCP and on an unknown
  route. A test with a declared length would pass with the wrong implementation.
- A body under the limit reaches the route unchanged after the replay.
- A body with invalid UTF-8 and a deeply nested JSON array get the same 422 as ordinary malformed JSON.
- A string field or tool argument with NUL or a lone surrogate gets 422 on REST and a tool error on MCP, including
  `content_md`.

## Names

- Each entity with a [name rule](entity-rules.md#names) gets `DomainValidationError` for a name that is too long, and accepts
  one of exactly 100 characters.
- `-`, `--`, `a--b`, `-a`, `a-` and `Admin` get `DomainValidationError` for folders, md_documents and users.
- A tab name of only spaces, with a control character or with leading or trailing whitespace gets `DomainValidationError`.

## Visibility

The rules from [Request Checks](request-checks.md) and [Auth Concept](auth-concept.md) on what a user can see are tested on
REST and MCP, including:

- A hidden and a missing item give an identical response, comparing the full 404 body on REST and the full tool error text
  on MCP.
- A matrix of operations against `read`, `write`, `manage`, admin and no right shows which operation each right allows.

## Rights Lists

- An admin's own rights show `manage` on every folder and ignore their stored rows.
- The rights of a folder and all rights show the stored rows, including rows with no effect.

## Public Routes

- Without credentials and with a unit-of-work factory that fails when called, health returns its fixed body.
- The same holds for the protected resource metadata routes, with the body built from the settings.
- The protected resource metadata lists the configured issuer in `authorization_servers`, and its `resource` equals the
  configured audience.
- Under the same conditions, every route except health and the protected resource metadata gets 401, including MCP and
  `/openapi.json`.
- A public path with a trailing slash or a path below it gets 401.
- `/docs` and `/redoc` get 404 when authenticated.

## Token Check

The rules are in [Authentication](authentication.md#token-check).

- A valid token of a linked user gives the principal of that user.
- These tokens each get 401: expired, wrong issuer, wrong audience, bad signature, `alg=none`, HS256 signed with the public
  key as the secret, no `sub`, and a valid token with no linked user.
- A token that fails with an unknown `kid` gets 401 after one refetch, and further unknown `kid`s within the rate limit
  cause no further fetch.
- An unreachable key source gets 503 when a key is needed, and a cached key keeps working while the key source is down.
- A 401 for a presented token carries `error="invalid_token"`, and a 401 without a token does not.

## User Linking

- Creating a user without `auth_subject` gets 422, and an `auth_subject` of "" or of 256 characters gets
  `DomainValidationError`.
- A duplicate `auth_subject` gets `SubjectConflictError`, on create and on change.
- After an admin removes or changes the link of a user, the old subject gets 401 on the next request.
- `hippowiki link-root-admin` run twice with the same subject changes nothing, a new subject replaces the link, and a
  subject that another user has is rejected.

## Other ASGI Scopes

- `lifespan` passes through the middleware, so startup and shutdown still run.
- A `websocket` scope is closed without reaching the app.

## Error Format

- The 401, the 404 for an unknown route, the 405, the 413, the 422 from schema validation, the 422 for an unparsable body,
  the 500 and the 503 are problem+json.
- Each of them carries the `code` from [REST Error Format](request-checks.md#rest-error-format), and a name conflict, a
  subject conflict and a version conflict can be told apart by it.
- A 404 body has no `instance` and no ID.
- The 401 carries `WWW-Authenticate` with `resource_metadata` and the 405 carries `Allow`.

## Failed Credential Lookup

- A credential check that raises gets 503 problem+json without exception details on REST and an HTTP 503 on the MCP
  transport.
- No adapter is reached, and health still answers.

## MCP Tools and Transport

- In the tool tests, an unknown argument gets a tool error from the shared wrapper, which pins how it uses the SDK.
- In the tool tests, the advertised `input_schema` has `additionalProperties: false`.
- In the tool tests, invalid arguments give `schema_validation`, and the text has no `input_value` and no pydantic.dev link.
- In the tool tests, each domain error gives its stable code.
- On the transport, responses carry no `Mcp-Session-Id`, on both protocol paths from
  [Serving the MCP App](mcp.md#serving-the-mcp-app).
- On the transport, each user's tool calls run under their own principal, on both protocol paths.
- On the transport, `POST /mcp` answers without a redirect.
- On the transport, an authenticated `GET /mcp` gets 405 with `Allow: POST` and an unauthenticated one gets 401.
- On the transport, a foreign `Host` gets 421 and a foreign `Origin` gets 403, and the configured ones are accepted.

## Time

- `UtcDatetime` accepts the strict profile from [Time](time.md) and converts to UTC.
- `0001-01-01T00:00:00+14:00` and `9999-12-31T23:59:59-14:00` get 422, not a 500.
- `2026-10-30t14:05:09z`, `2026-10-30 14:05:09Z`, `2026-10-30T14:05Z`, `2026-10-30T14:05:09.123456789Z` and Unix timestamps
  get 422.

## Integration (`podman`)

- Table constraints hold.
- Writes are atomic, such as a folder with its default tab.
- A unique violation surfaces inside the repository call.
- Time-dependent behaviour works in separate committed transactions.
- `hippowiki migrate` followed by `hippowiki init` twice leaves one root admin, and it stays unlinked until
  `hippowiki link-root-admin` runs.
- Creating or renaming anything to the name `""` gets `DomainValidationError` and creating a user named `admin` gets
  `NameConflictError`, not a check violation.
- Assigning a right twice updates `assigned_by` and `assigned_at`, also in separate committed transactions.
- A service result can be read after the commit, which fails without `expire_on_commit=False` if an ORM object reaches it.
- `SafeText` is needed: writing NUL or a lone surrogate through SQLAlchemy and asyncpg raises `DBAPIError`, so a change in
  this behaviour shows up.
