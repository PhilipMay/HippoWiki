# Request Checks

This document defines which checks a request goes through and how denied requests behave on REST and MCP. The format of
errors is in [Errors](errors.md).

## Check Order

A user only learns that a folder exists if they have a right on it or are the admin. Every request to a non-public route
runs these checks in this order, and the first one that fails decides the response. Services raise the same domain
errors for REST and MCP, and each adapter translates them. The last row is not a check: it covers any other exception.

| Check              | Rejects                                                                                                          | Domain error                     | REST          | MCP                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------- | -------------------------------------- |
| Credential lookup  | a request with credentials that can not be checked, because the lookup failed                                    | none, rejected by the middleware | 503           | rejected before the tools run          |
| Authentication     | an unauthenticated request                                                                                       | none, rejected by the middleware | 401           | rejected before the tools run          |
| Admin on MCP       | a request to MCP by the admin, see [MCP](mcp.md#admin-account)                                                   | none, rejected by the middleware | allowed       | HTTP 403, before the tools run         |
| Body size          | a request body over the limit                                                                                    | none, rejected by the middleware | 413           | rejected before the tools run          |
| Routing            | an unknown route (404), a known route with the wrong method (405)                                                | none, rejected by the framework  | 404, 405      | see [MCP Errors](errors.md#mcp-errors) |
| Host check         | a foreign `Host` (421) or `Origin` (403), see [MCP](mcp.md#serving-the-mcp-app)                                  | none, rejected by the SDK        | no such check | HTTP 421 or 403                        |
| Schema validation  | malformed JSON, an unparsable body, wrong types, missing or unknown fields, an invalid `limit` or `cursor`       | none, rejected by the adapter    | 422           | see [MCP Errors](errors.md#mcp-errors) |
| Visibility         | a user with no right on the folder or a deleted folder, also for any tab or md_document in it                    | `NotFoundError`                  | 404           | tool error `not_found`                 |
| Required right     | a user whose right on the folder is too low for the operation                                                    | `ForbiddenError`                 | 403           | tool error `forbidden`                 |
| Target lookup      | a missing or deleted tab or md_document, a missing user, or a missing folder right, also when named in the body  | `NotFoundError`                  | 404           | tool error `not_found`                 |
| Target rules       | an operation the target does not allow, see [below](#rejected-operations)                                        | `ForbiddenError`                 | 403           | tool error `forbidden`                 |
| Domain validation  | a name, `auth_subject` or size that breaks the domain rules                                                      | `DomainValidationError`          | 422           | tool error `domain_validation`         |
| Conflicts: version | a version conflict, compared before the write, see [Optimistic Locking](history-revisions.md#optimistic-locking) | `VersionConflictError`           | 409           | tool error `version_conflict`          |
| Conflicts: name    | a name conflict, which surfaces at the write                                                                     | `NameConflictError`              | 409           | tool error `name_conflict`             |
| Conflicts: subject | a Keycloak account that is already linked to another user                                                        | `SubjectConflictError`           | 409           | no such tool, admin operation          |
| Unexpected         | any other exception                                                                                              | none                             | 500           | generic tool error without details     |

## Validation

- two kinds of validation:
  - schema validation in the adapters: shape and types through the Pydantic models, without database access
  - domain validation in the services: the [name rules](content.md#names), the
    [`auth_subject` length and maximum document size](limits.md#limits-at-a-glance)
- schema validation leaks nothing: it depends only on the request and never reads the database, so a hidden, a missing
  and a readable folder give the same 422, and validators must not do lookups
- unknown fields: request models forbid them (`extra="forbid"`), so they get 422 instead of being silently ignored. For
  MCP see [Tool Arguments](mcp.md#tool-arguments)
- malformed IDs: an ID in the path with the wrong format gets 422, since it can not identify anything
- unparsable bodies: a body with invalid UTF-8 or JSON nested too deeply counts as malformed JSON and gets 422
- text PostgreSQL can not store: one shared type, `SafeText` in `schemas/text.py`, rejects NUL and lone surrogates. It
  is used for every string field of the request models and every string argument of the MCP tools, including
  `content_md`. It depends only on the request, so the result is the normal 422 and tool error

## Leaks

- routing leaks nothing: it depends only on the path and the method, and an unauthenticated request gets 401 even on an
  unknown route, so routes can not be probed
- identical 404: a hidden folder, tab or md_document gets the same status and the same message as one that does not
  exist, so a client can not tell them apart
- timing: a hidden item may take a different time to answer than a missing one. This is accepted, because the random
  UUIDs make it hard to exploit
- lists: list operations return only what the user can read, so hidden and deleted items are left out instead of causing
  an error
- no conflict leaks: a user without the required right gets 403 before any name or version conflict or domain validation
  error is reported
- conflicts leak nothing: tab and md_document names conflict only inside a folder the user already has the right on, and
  only the admin, who sees all folders and users, creates folders and users, renames folders and links Keycloak accounts

## Targets

- resolving by ID: a tab or md_document addressed by ID is first resolved to its folder, then the checks above run on
  that folder, and an ID that resolves to nothing gets the same 404 as a hidden item
- targets in the request body: a target tab that is not in the folder of the operation gets the same 404 as a missing
  tab, whatever the rights of the user on its folder. This covers moving a md_document and creating one with an explicit
  tab. A deleted target tab gets the same 404.

## Deleted Items

What deleting does is defined in [Content](content.md#deleting-and-restoring-content).

- a deleted md_document, tab or folder, and any item inside a deleted tab or folder, gets the same 404 as a missing
  item, for every operation except the deleted list, restore and history. This also holds for the admin
- deleting a deleted item gets this 404 as well, in the same way as deleting a right that does not exist
- a folder has two deleted lists, one for md_documents and one for tabs. They hold the items that have their own
  `deleted_at` and a live parent, with metadata only, and follow the check order on the folder
- restoring a md_document or tab, and reading the history of a md_document that is not live or the content of one of its
  revisions, resolves its ID among the deleted rows too, then runs the check order on its folder.
  [Rights on Folders](rights.md#rights-on-folders) gives the result
- no right on the folder, or a deleted folder, gets 404 in these cases
- accepted leak: a user with a right below `manage` gets 403 for an ID in their folder and 404 for an unknown ID, so
  they can tell a deleted item from one that never existed. This is accepted, because the user has a right on the folder
  and the random UUIDs make it hard to exploit

## Responses to Admin Operations

- REST only: admin operations and the admin are not available on MCP, so the rules below describe REST
- the admin:
  - on admin operations and when reading a folder, every live folder is visible, so a 404 means it really does not exist
    or is deleted
  - on everything inside a folder, the [admin has no access](users.md#admin-operations), so it gets the same 404 as a
    user with no right on the folder
- admin operations by other users:
  - operations on an existing folder (rename or delete the folder, assign or delete its rights, list its rights) follow
    the checks above: 404 with no right on the folder, otherwise 403
  - all other admin operations (such as create users, create folders, list users, list all rights of all folders, change
    the `auth_subject` of a user, deactivate or reactivate a user, list deleted folders, restore a folder) get 403 after
    schema validation and before their target is looked at or their input is checked against domain rules, so user and
    folder names can not be probed

## Rejected Operations

Some rules reject an operation whatever the rights of the user. Each topic lists its own, with the domain error and the
check that applies:

- [Rejected Content Operations](content.md#rejected-content-operations)
- [Rejected Revert Operations](history-revisions.md#rejected-revert-operations)
- [Rejected User and Right Operations](users.md#rejected-user-and-right-operations)

A name that breaks the [name rules](content.md#names) gets `DomainValidationError`, and a violated unique name gets
`NameConflictError`.
