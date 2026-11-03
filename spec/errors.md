# Errors

This document defines how errors look on REST and MCP. Which error a request gets is in
[Check Order](request-checks.md#check-order).

## REST Error Format

Every REST error uses RFC 9457 problem+json, built by one shared helper. `type` stays `about:blank`. Every body has a
`code` extension, so a client can tell apart errors with the same status, such as the two 409s, which need different
reactions. It uses the same stable codes as MCP where both have them:

| Status | `code`                                                    |
| ------ | --------------------------------------------------------- |
| 401    | `unauthenticated`                                         |
| 403    | `forbidden`                                               |
| 404    | `not_found`                                               |
| 405    | `method_not_allowed`                                      |
| 409    | `name_conflict`, `subject_conflict` or `version_conflict` |
| 413    | `body_too_large`                                          |
| 422    | `schema_validation` or `domain_validation`                |
| 500    | `internal_error`                                          |
| 503    | `service_unavailable`                                     |

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

Tool errors are plain text, so `mcp/tools.py` raises a `ToolError` whose message starts with the stable code of the
domain error. The SDK puts `Error executing tool <name>: ` in front of the message, so clients find the code right after
this text. The tool error that the SDK produces itself for an unknown tool has no code.
