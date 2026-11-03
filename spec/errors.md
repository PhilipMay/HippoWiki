# Errors

This document defines how errors look on REST and MCP. Which error a request gets is in
[Check Order](request-checks.md#check-order).

## REST Error Format

Every REST error uses RFC 9457 problem+json, built by one shared helper in `problem.py`. Every body has these members:

- `type`: always `about:blank`
- `title`: the HTTP reason phrase of the status
- `status`: the HTTP status
- `code`: an extension, so a client can tell apart errors with the same status, such as the two 409s, which need
  different reactions. It uses the same stable codes as MCP where both have them.
- `detail`: the fixed text of the `code`, so it never holds an ID, a name or an input value

| Status | `code`                | `detail`                                   |
| ------ | --------------------- | ------------------------------------------ |
| 401    | `unauthenticated`     | A valid access token is required.          |
| 403    | `forbidden`           | This operation is not allowed.             |
| 404    | `not_found`           | The item does not exist.                   |
| 405    | `method_not_allowed`  | This method is not allowed on this route.  |
| 409    | `name_conflict`       | The name is already taken.                 |
| 409    | `subject_conflict`    | The subject is already linked to a user.   |
| 409    | `version_conflict`    | The version is not the current one.        |
| 413    | `body_too_large`      | The request body is over the limit.        |
| 422    | `schema_validation`   | The request is not valid.                  |
| 422    | `domain_validation`   | The request breaks a rule for its values.  |
| 500    | `internal_error`      | An unexpected error occurred.              |
| 503    | `service_unavailable` | The service can not check the request now. |

A 422 also has an `errors` extension, a list of objects with `field` and `reason`, so a client can show which field
failed:

- `field` is the name of the field, dotted if it is nested, or `body` for a body that can not be parsed.
- `reason` never holds the input value, so a rejected `content_md` is not sent back. `DomainValidationError` carries its
  field and reason.

A 500 body contains no exception details. A 404 body has no `instance` and no ID, because a hidden and a missing item
have different IDs and their bodies must be identical.

Two responses need a header as well as the body:

- The 401 carries `WWW-Authenticate: Bearer resource_metadata="..."`, because RFC 9110 requires the header and MCP
  clients use it to find the [protected resource metadata](authentication.md#public-routes). When a token was presented,
  the header also carries `error="invalid_token"`, as RFC 6750 asks for.
- The 405 carries `Allow`, because RFC 9110 requires it.

## MCP Errors

The check order defines which tool error each check gives. Routing and schema validation are reported differently
depending on where they fail:

- routing: an unknown tool gets a tool error, and an unknown JSON-RPC method gets a protocol error. Both are found
  inside the SDK, so after the [host check](mcp.md#serving-the-mcp-app), which comes after routing only for the HTTP
  path and method
- schema validation: malformed JSON gets a protocol error and never reaches a tool. Invalid or unknown tool arguments
  get a tool error, and the tool does not run

MCP keeps the distinction REST makes between 404 and 403 through `not_found` and `forbidden`.

Tool errors are plain text, so `mcp/tools.py` raises a `ToolError` whose message is `<code>: <detail>`, with the texts
of [REST Error Format](#rest-error-format). A validation error adds its fields after that, as in
`schema_validation: The request is not valid. name: Input should be a valid string; limit: Input should be at least 1`.
The SDK puts `Error executing tool <name>: ` in front of the message, so clients find the code right after this text.
The tool error that the SDK produces itself for an unknown tool has no code.
