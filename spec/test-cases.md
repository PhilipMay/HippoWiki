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
- Under the same conditions, every route except health and the login routes gets 401, including MCP and the OpenAPI docs.

## Error Format

- The 401, the 404 for an unknown route, the 405, the 413, the 422 from schema validation and the 500 are problem+json.
- The 401 carries `WWW-Authenticate` and the 405 carries `Allow`.

## Failed Credential Lookup

- A credential check that raises gets 503 problem+json without exception details on REST and an HTTP 503 on the MCP
  transport.
- No adapter is reached, and health still answers.

## MCP Tools and Transport

- In the tool tests, an unknown argument gets a tool error from the shared wrapper, which pins how it uses the SDK.
- In the tool tests, each domain error gives its stable code.
- On the transport, responses carry no `Mcp-Session-Id`.
- On the transport, each user's tool calls run under their own principal.

## Integration (`podman`)

- Table constraints hold.
- Writes are atomic, such as a folder with its default tab.
- A unique violation surfaces inside the repository call.
- Time-dependent behaviour works in separate committed transactions.
- `hippowiki migrate` followed by `hippowiki init` twice leaves one root admin.
- Creating or renaming anything to the name `""` gets `DomainValidationError` and creating a user named `admin` gets
  `NameConflictError`, not a check violation.
- Assigning a right twice updates `assigned_by` and `assigned_at`, also in separate committed transactions.
