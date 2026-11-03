# MCP

The MCP adapter is a thin layer over the services. This document covers what is specific to MCP, and tool errors are in
[MCP Errors](errors.md#mcp-errors). MCP exposes tools only for now, see [Roadmap](roadmap.md#later).

## Admin Account

MCP is only for users who are not the admin:

- The admin gets HTTP 403 on every MCP request, before any tool runs, see
  [Admin Account on MCP](authentication.md#admin-account-on-mcp).
- The adapter has no tools for the [admin operations](users.md#admin-operations), so a user who calls one gets the tool
  error for an unknown tool.
- [`is_admin` never changes](users.md#deactivating-users), so whether a user may use MCP is fixed when the user is
  created.
- The person who is the admin uses a separate account for connectors, see [AI Agents](connectors.md#ai-agents).

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

- Lists follow the rules of [Lists](lists.md), so `get_md_document` is the only tool that returns `content_md`.
- A result is one JSON text block, so it reaches the context of an AI client only once.
- A left-out optional argument and `null` both mean "not given", because AI clients often send `null`. No tool has an
  argument where `null` has a meaning of its own.
- `update_md_document` with no field to change gets a tool error with the code `schema_validation`.
- Tools carry annotations: `readOnlyHint` on the list and get tools and `destructiveHint` on the delete tools.
- A single large md_document still goes into the context in full. Its size is bounded only by the
  [maximum document size](limits.md#document-size) of 256 KiB, very roughly 65,000 to 85,000 tokens. Reading only a part
  of it is [for later](roadmap.md#later).
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

The reasons for these choices are in [MCP SDK Notes](implementation-notes.md#mcp-sdk-notes).
