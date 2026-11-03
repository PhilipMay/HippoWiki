# MCP

The MCP adapter is a thin layer over the services, see [Architecture](architecture.md). This document covers what is
specific to MCP. MCP exposes tools only for now, see [Roadmap](roadmap.md#later).

## Admin Account

MCP is only for users who are not the admin:

- The admin gets HTTP 403 on every MCP request, before any tool runs, see
  [Admin Account on MCP](authentication.md#admin-account-on-mcp).
- The adapter has no tools for the [admin operations](users-and-rights.md#admin-operations), so a user who calls one
  gets the tool error for an unknown tool.
- [`is_admin` never changes](users-and-rights.md#deactivating-users), so whether a user may use MCP is fixed when the
  user is created.
- The person who is the admin uses a separate account for connectors, see [AI Agents](authentication.md#ai-agents).

## History and Revert

[History and revert](history-revisions.md) are available only on REST, for every right. The adapter has no tools for
them, so a call gets the tool error for an unknown tool.

## Sessions and Principal

- The MCP app runs with `stateless_http=True`, and the server sends no session ID. MCP is tools only for now, so nothing
  needs a session.
- Tools can not send requests to the client, so there is no sampling or elicitation. A later feature that needs a
  session has to bind it to the user first.
- MCP tools get the principal through a resolver passed to the server factory. The production resolver reads it from the
  ASGI scope of the HTTP request in the tool context and fails closed if there is none.

## Tools

Each tool makes one service call and answers like its REST route, see [REST](rest.md). The rights are the same as there,
and the fields of the results are in [Response Fields](rest.md#response-fields).

| Tool                        | Arguments                                                   | REST route                                      |
| --------------------------- | ----------------------------------------------------------- | ----------------------------------------------- |
| `get_own_user`              |                                                             | `GET /me`                                       |
| `list_own_rights`           | `limit`, `cursor`                                           | `GET /me/rights`                                |
| `list_folders`              | `limit`, `cursor`                                           | `GET /folders`                                  |
| `get_folder`                | `folder_id`                                                 | `GET /folders/{folder_id}`                      |
| `list_tabs`                 | `folder_id`, `limit`, `cursor`                              | `GET /folders/{folder_id}/tabs`                 |
| `get_tab`                   | `tab_id`                                                    | `GET /tabs/{tab_id}`                            |
| `create_tab`                | `folder_id`, `name`                                         | `POST /folders/{folder_id}/tabs`                |
| `rename_tab`                | `tab_id`, `name`                                            | `PATCH /tabs/{tab_id}`                          |
| `delete_tab`                | `tab_id`                                                    | `DELETE /tabs/{tab_id}`                         |
| `list_deleted_tabs`         | `folder_id`, `limit`, `cursor`                              | `GET /folders/{folder_id}/tabs/deleted`         |
| `restore_tab`               | `tab_id`                                                    | `POST /tabs/{tab_id}/restore`                   |
| `list_md_documents`         | `folder_id`, `tab_id`, `limit`, `cursor`                    | `GET /folders/{folder_id}/md-documents`         |
| `get_md_document`           | `md_document_id`                                            | `GET /md-documents/{md_document_id}`            |
| `create_md_document`        | `folder_id`, `name`, `content_md`, `tab_id`                 | `POST /folders/{folder_id}/md-documents`        |
| `update_md_document`        | `md_document_id`, `version`, `content_md`, `name`, `tab_id` | `PATCH /md-documents/{md_document_id}`          |
| `delete_md_document`        | `md_document_id`                                            | `DELETE /md-documents/{md_document_id}`         |
| `list_deleted_md_documents` | `folder_id`, `limit`, `cursor`                              | `GET /folders/{folder_id}/md-documents/deleted` |
| `restore_md_document`       | `md_document_id`                                            | `POST /md-documents/{md_document_id}/restore`   |

- Lists follow the rules of [Lists](rest.md#lists), so `get_md_document` is the only tool that returns `content_md`.
- A result is one JSON text block, so it reaches the context of an AI client only once.
- A left-out optional argument and `null` both mean "not given", because AI clients often send `null`. No tool has an
  argument where `null` has a meaning of its own.
- `update_md_document` with no field to change gets a tool error with the code `schema_validation`.
- Tools carry annotations: `readOnlyHint` on the list and get tools and `destructiveHint` on the delete tools.
- A single large md_document still goes into the context in full. Its size is bounded only by the
  [maximum document size](entities.md#document-size) of 256 KiB, very roughly 65,000 to 85,000 tokens. Reading only a
  part of it is [for later](roadmap.md#later).
- `get_md_document` sets no `anthropic/maxResultSizeChars`, so Claude Code keeps its default: a text result over 50,000
  characters goes to a file instead of the context, see its [MCP documentation](https://code.claude.com/docs/en/mcp).
  How other clients behave is part of the [Connector Test](roadmap.md#connector-test).

## Tool Arguments

Tools take flat arguments, such as `{"folder_id": "...", "name": "..."}`. The tool signatures repeat the fields, and
share the field types from `schemas/`, such as `SafeText`, `UtcDatetime` and the types for `limit` and the cursors, so
the validation stays the same as on REST.

- A tool taking a request model has to be called as `{"req": {...}}`, which would make the name of that parameter part
  of the interface AI clients see.
- Most tools also need an ID that REST carries in the path, so the REST request models would not fit them anyway.

`mcp/tools.py` registers every tool through one shared wrapper, which does what the SDK does not:

- Unknown arguments get a tool error.
- The `input_schema` has `additionalProperties: false`, so clients are told about the rule.
- Invalid arguments get the stable code `schema_validation` and the field and reason only, because this text goes
  straight to AI clients.

## Errors

The [check order](request-checks.md#check-order) defines which tool error each check gives. Routing and schema
validation are reported differently depending on where they fail:

- routing: an unknown tool gets a tool error, and an unknown JSON-RPC method gets a protocol error. Both are found
  inside the SDK, so after the [host check](#serving-the-mcp-app), which comes after routing only for the HTTP path and
  method
- schema validation: malformed JSON gets a protocol error and never reaches a tool. Invalid or unknown tool arguments
  get a tool error, and the tool does not run

MCP keeps the distinction REST makes between 404 and 403 through `not_found` and `forbidden`.

Tool errors are plain text, so `mcp/tools.py` raises a `ToolError` whose message starts with the stable code of the
domain error. The SDK puts `Error executing tool <name>: ` in front of the message, so clients find the code right after
this text. The tool error that the SDK produces itself for an unknown tool has no code.

## Serving the MCP App

- Routes: `create_app()` adds the routes of the MCP app to the FastAPI router instead of mounting it, so `POST /mcp`
  answers directly, without a redirect.
- Lifespan: the session manager runs in the lifespan of the FastAPI app.
- Methods: only `POST` reaches the SDK. Every other method gets 405 problem+json with `Allow: POST`, after
  authentication, as MCP allows for a server without a server-initiated stream. Whether the target clients accept this
  is part of the [Connector Test](roadmap.md#connector-test).
- Host check: the allowed hosts and origins are settings (`HIPPOWIKI_MCP_ALLOWED_HOSTS`,
  `HIPPOWIKI_MCP_ALLOWED_ORIGINS`). A foreign `Host` gets 421 and a foreign `Origin` gets 403. Only an authenticated
  `POST` reaches the SDK, which runs this check before it parses the body, see the
  [check order](request-checks.md#check-order).

## Implementation Notes

The SDK line numbers refer to `mcp` 2.3.0.

- Stateless mode: the SDK compares session owners only if the scope holds its own `AuthenticatedUser`, so with our
  principal in the scope any authenticated user holding a session ID would pass. Without sessions, tools can not reach
  the client (`streamable_http_manager.py:233`).
- Unknown arguments: the argument model generated by the SDK drops them, so the wrapper sets `extra="forbid"` on it.
  This uses an SDK internal (`fn_metadata.arg_model`), which a test pins.
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
- Methods: otherwise `GET /mcp` answers 200 `text/event-stream` in stateless mode and holds a connection open that
  nothing uses.
- Host check: by default the SDK enables DNS rebinding protection that allows only localhost hosts and origins
  (`lowlevel/server.py:753`). Behind the required reverse proxy, real requests would be rejected, which is why these are
  settings. The transport tests send these headers explicitly, because a local port would not notice otherwise. That the
  check comes before schema validation is an assumption about the SDK, which a transport test confirms.
- Protocol versions: the SDK sends requests with protocol version `2026-07-28` through a separate path
  (`handle_modern_request`, from `streamable_http_manager.py:194`), before it looks at the stateless setting. The
  transport tests cover both paths.
- Body size: the SDK has its own limit of 4 MiB, which our lower [limit](authentication.md#request-body-limit) never
  reaches, so `max_request_body_size` stays unset (`transport_security.py:15`).
