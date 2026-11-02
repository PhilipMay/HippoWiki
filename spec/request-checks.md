# Request Checks

This document defines how denied requests and errors behave on REST and MCP. The routes are in [REST](rest.md) and the
tools in [MCP](mcp.md#tools).

## Check Order

A user only learns that a folder exists if they have a right on it. Every request to a non-public route runs these
checks in this order, and the first one that fails decides the response. Services raise the same domain errors for REST
and MCP, and each adapter translates them. The last row is not a check: it covers any other exception.

| Check              | Rejects                                                                                                          | Domain error                     | REST          | MCP                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------- | ---------------------------------- |
| Credential lookup  | a request with credentials that can not be checked, because the lookup failed                                    | none, rejected by the middleware | 503           | rejected before the tools run      |
| Authentication     | an unauthenticated request                                                                                       | none, rejected by the middleware | 401           | rejected before the tools run      |
| Admin on MCP       | a request to MCP by an admin, see [MCP](mcp.md#admin-accounts)                                                   | none, rejected by the middleware | allowed       | HTTP 403, before the tools run     |
| Body size          | a request body over the limit                                                                                    | none, rejected by the middleware | 413           | rejected before the tools run      |
| Routing            | an unknown route (404), a known route with the wrong method (405)                                                | none, rejected by the framework  | 404, 405      | see [MCP](mcp.md#errors)           |
| Host check         | a foreign `Host` (421) or `Origin` (403), see [MCP](mcp.md#serving-the-mcp-app)                                  | none, rejected by the SDK        | no such check | HTTP 421 or 403                    |
| Schema validation  | malformed JSON, an unparsable body, wrong types, missing or unknown fields, an invalid `limit` or `cursor`       | none, rejected by the adapter    | 422           | see [MCP](mcp.md#errors)           |
| Visibility         | a user with no right on the folder or a deleted folder, also for any tab or md_document in it                    | `NotFoundError`                  | 404           | tool error `not_found`             |
| Required right     | a user whose right on the folder is too low for the operation                                                    | `ForbiddenError`                 | 403           | tool error `forbidden`             |
| Target lookup      | a missing or deleted tab, md_document or user, or a missing folder right, also when named in the body            | `NotFoundError`                  | 404           | tool error `not_found`             |
| Target rules       | an operation the target does not allow, see [below](#rejected-operations)                                        | `ForbiddenError`                 | 403           | tool error `forbidden`             |
| Domain validation  | a name, `auth_subject` or size that breaks the domain rules                                                      | `DomainValidationError`          | 422           | tool error `domain_validation`     |
| Conflicts: version | a version conflict, compared before the write, see [Optimistic Locking](history-revisions.md#optimistic-locking) | `VersionConflictError`           | 409           | tool error `version_conflict`      |
| Conflicts: name    | a name conflict, which surfaces at the write                                                                     | `NameConflictError`              | 409           | tool error `name_conflict`         |
| Conflicts: subject | a Keycloak account that is already linked to another user                                                        | `SubjectConflictError`           | 409           | no such tool, admin operation      |
| Unexpected         | any other exception                                                                                              | none                             | 500           | generic tool error without details |

## Rules

### Validation

- two kinds of validation:
  - schema validation in the adapters: shape and types through the Pydantic models, without database access
  - domain validation in the services: the [name rules](entities.md#names), the
    [`auth_subject` length](users-and-rights.md#user-linking), maximum document size
- schema validation leaks nothing: it depends only on the request and never reads the database, so a hidden, a missing
  and a readable folder give the same 422, and validators must not do lookups
- unknown fields: request models forbid them (`extra="forbid"`), so they get 422 instead of being silently ignored. For
  MCP see [Tool Arguments](mcp.md#tool-arguments)
- malformed IDs: an ID in the path with the wrong format gets 422, since it can not identify anything
- unparsable bodies: a body with invalid UTF-8 or JSON nested too deeply counts as malformed JSON and gets 422
- text PostgreSQL can not store: one shared type, `SafeText` in `schemas/text.py`, rejects NUL and lone surrogates. It
  is used for every string field of the request models and every string argument of the MCP tools, including
  `content_md`. It depends only on the request, so the result is the normal 422 and tool error

### Leaks

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
  only admins, who see everything, create folders and users, rename folders and link Keycloak accounts

### Targets

- resolving by ID: a tab or md_document addressed by ID is first resolved to its folder, then the checks above run on
  that folder, and an ID that resolves to nothing gets the same 404 as a hidden item
- targets in the request body: a target tab that is not in the folder of the operation gets the same 404 as a missing
  tab, whatever the rights of the user on its folder. This covers moving a md_document and creating one with an explicit
  tab. A deleted target tab gets the same 404.

### Deleted Items

What deleting does is defined in [Entities](entities.md#deleting-and-restoring-content).

- a deleted md_document, tab or folder, and any item inside a deleted tab or folder, gets the same 404 as a missing
  item, for every operation except the deleted list, restore and history. This also holds for admins
- deleting a deleted item gets this 404 as well, in the same way as deleting a right that does not exist
- a folder has two deleted lists, one for md_documents and one for tabs. They hold the items that have their own
  `deleted_at` and a live parent, with metadata only, and follow the check order on the folder
- restoring a md_document or tab, and reading the history of a md_document that is not live or the content of one of its
  revisions, resolves its ID among the deleted rows too, then runs the check order on its folder.
  [Rights on Folders](users-and-rights.md#rights-on-folders) gives the result
- no right on the folder, or a deleted folder, gets 404 in these cases. An admin can still read the history of a
  md_document in a deleted folder and the content of its revisions, but can not restore anything in it
- accepted leak: a user with a right below `manage` gets 403 for an ID in their folder and 404 for an unknown ID, so
  they can tell a deleted item from one that never existed. This is accepted, because the user has a right on the folder
  and the random UUIDs make it hard to exploit

### Admin Operations

- REST only: admin operations and admins themselves are not available on MCP, so the rules below describe REST
- admins: every live folder is visible and their [implicit `manage` right](users-and-rights.md#admin-operations) is
  sufficient, so a 404 means it really does not exist or is deleted
- admin operations by non-admins:
  - operations on an existing folder (rename or delete the folder, assign or delete its rights, list its rights) follow
    the checks above: 404 with no right on the folder, otherwise 403
  - all other admin operations (such as create users, create folders, list users, list all rights of all folders, change
    the `is_admin` flag or the `auth_subject` of a user, deactivate, reactivate or delete a user, list deleted folders,
    restore a folder) get 403 after schema validation and before their target is looked at or their input is checked
    against domain rules, so user and folder names can not be probed

## Rejected Operations

These rules reject an operation, whatever the rights of the user. A name that breaks the [name rules](entities.md#names)
gets `DomainValidationError`, and a violated unique name gets `NameConflictError`.

### Content

| Rule                                                      | Domain error                              | REST | Check              |
| --------------------------------------------------------- | ----------------------------------------- | ---- | ------------------ |
| rename a default tab                                      | `ForbiddenError`                          | 403  | Target rules       |
| delete a default tab                                      | `ForbiddenError`                          | 403  | Target rules       |
| move a md_document to a tab in another folder             | `NotFoundError`                           | 404  | Target lookup      |
| restore an item that is not deleted                       | `NotFoundError`                           | 404  | Target lookup      |
| restore a md_document whose tab is deleted                | `NotFoundError`                           | 404  | Target lookup      |
| move a tab or set `is_default`                            | none, the request model has no such field | 422  | Schema validation  |
| update, rename or move a md_document without a version    | none, the request model requires it       | 422  | Schema validation  |
| update anything with no field to change                   | none, the request model requires one      | 422  | Schema validation  |
| create or rename anything with the name ""                | `DomainValidationError`                   | 422  | Domain validation  |
| update, rename or move with a version that is not current | `VersionConflictError`                    | 409  | Conflicts: version |
| restore an item whose name is taken                       | `NameConflictError`                       | 409  | Conflicts: name    |

### Revert

| Rule                                                         | Domain error           | REST | Check              |
| ------------------------------------------------------------ | ---------------------- | ---- | ------------------ |
| revert a md_document to a revision that records its deletion | `ForbiddenError`       | 403  | Target rules       |
| revert a md_document that is not live                        | `NotFoundError`        | 404  | Target lookup      |
| revert to a revision of another item or folder               | `NotFoundError`        | 404  | Target lookup      |
| revert a md_document to a tab that is not live               | `NotFoundError`        | 404  | Target lookup      |
| revert a folder to a number that is not in its history       | `NotFoundError`        | 404  | Target lookup      |
| revert with a version that is not the current one            | `VersionConflictError` | 409  | Conflicts: version |
| revert a md_document to a name that is taken                 | `NameConflictError`    | 409  | Conflicts: name    |

### Users and Rights

| Rule                                                | Domain error                              | REST | Check              |
| --------------------------------------------------- | ----------------------------------------- | ---- | ------------------ |
| change own `is_admin` flag                          | `ForbiddenError`                          | 403  | Target rules       |
| change the `is_admin` flag of the root admin        | `ForbiddenError`                          | 403  | Target rules       |
| change own `auth_subject`                           | `ForbiddenError`                          | 403  | Target rules       |
| change the `auth_subject` of the root admin         | `ForbiddenError`                          | 403  | Target rules       |
| delete or deactivate the root admin                 | `ForbiddenError`                          | 403  | Target rules       |
| delete or deactivate own user                       | `ForbiddenError`                          | 403  | Target rules       |
| any operation on a deleted user                     | `NotFoundError`                           | 404  | Target lookup      |
| delete a right that does not exist                  | `NotFoundError`                           | 404  | Target lookup      |
| rename a user or set `is_root`                      | none, the request model has no such field | 422  | Schema validation  |
| create a user without `auth_subject`                | none, the request model requires it       | 422  | Schema validation  |
| set an `auth_subject` of "" or one that is too long | `DomainValidationError`                   | 422  | Domain validation  |
| create a user named `admin`                         | `NameConflictError`                       | 409  | Conflicts: name    |
| create a user with the name of a deleted user       | `NameConflictError`                       | 409  | Conflicts: name    |
| set an `auth_subject` that another user already has | `SubjectConflictError`                    | 409  | Conflicts: subject |

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

## Implementation Notes

- `SafeText`: Pydantic's `str` accepts NUL and lone surrogates, but writing them raises a `DBAPIError`, which is not an
  `IntegrityError` and would end as a 500.
- The 401, the 413, the 503 and the 403 for an admin on MCP come from the middleware, which runs outside FastAPI's
  exception handlers, so it calls the helper directly.
- The 422 from schema validation is not a domain error, so FastAPI's default 422 body has to be replaced.
- Framework errors (404 for unknown routes, 405, 500) go through a handler, since they return a different body by
  default. The handler keeps `exc.headers`, so rebuilding the 405 does not lose `Allow`.
- FastAPI turns any exception during body parsing into a 400 (`fastapi/routing.py:495-497` in FastAPI 0.162.0). The
  application raises no 400 of its own, so the same handler answers it with the 422 for an unparsable body.
