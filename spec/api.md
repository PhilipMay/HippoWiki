# API

This document plans the behavior of the REST API and MCP. So far it covers denied requests and errors.

## Denied Requests

A user only learns that a folder exists if they have a right on it. Every request to a non-public route runs these
checks in this order, and the first one that fails decides the response:

1. Authentication: an unauthenticated request gets 401.
2. Schema validation: a request with malformed JSON, wrong types, missing fields or unknown fields gets 422. MCP reports
   these differently, see [Error Mapping](#error-mapping).
3. Visibility: a user with no right on the folder gets 404, also for any tab or md_document in it.
4. Required right: a user whose right on the folder is too low for the operation gets 403.
5. Target lookup: a missing tab, md_document or user gets 404, also when it is named in the request body.
6. Target rules: an operation that the target does not allow gets 403, see [Rejected Operations](#rejected-operations).
7. Domain validation: a name or size that breaks the domain rules gets 422.
8. Conflicts: a name or version conflict gets 409.

Rules:

- authentication comes first: it runs before the request body is read or parsed, on every route except the public ones
  listed in [Architecture](architecture.md)
- two kinds of validation: schema validation checks shape and types in the adapters, domain validation (name format,
  maximum size) lives in the services
- schema validation leaks nothing: it depends only on the request and never reads the database, so a hidden, a missing
  and a readable folder give the same 422, and validators must not do lookups
- unknown fields: request models forbid them (`extra="forbid"`), so they get 422 instead of being silently ignored
- identical 404: a hidden folder, tab or md_document gets the same status and the same message as one that does not
  exist, so a client can not tell them apart
- resolving by ID: a tab or md_document addressed by ID is first resolved to its folder, then the checks above run on
  that folder, and an ID that resolves to nothing gets the same 404 as a hidden item
- targets in the request body: a target tab that is not in the folder of the operation gets the same 404 as a missing
  tab, whatever the rights of the user on its folder. This covers moving a md_document and creating one with an explicit
  tab.
- malformed IDs: an ID in the path with the wrong format gets 422, since it can not identify anything
- no conflict leaks: a user without the required right gets 403 before any name or version conflict or domain validation
  error is reported
- conflicts leak nothing: tab and md_document names conflict only inside a folder the user already has the right on, and
  only admins, who see everything, change folder and user names
- lists: list operations return only what the user can read, so hidden items are left out instead of causing an error
- admins: the implicit "update" right makes every folder visible and sufficient, so a 404 means it really does not exist
- admin operations by non-admins:
  - operations on an existing folder (rename the folder, assign or delete its rights, list its rights) follow the checks
    above: 404 with no right on the folder, otherwise 403
  - all other admin operations (such as create users, create folders, list users, list all rights of all folders, change
    the `is_admin` flag of a user) get 403 after schema validation and before their target is looked at or their input is
    checked against domain rules, so user and folder names can not be probed
- user targets: an admin naming a user that does not exist gets 404

## Rejected Operations

These rules from [Tables, Entities and Rules](entities.md) reject an operation, whatever the rights of the user:

| Rule                                                     | Domain error                              | REST | Check             |
| -------------------------------------------------------- | ----------------------------------------- | ---- | ----------------- |
| rename a default tab                                     | `ForbiddenError`                          | 403  | Target rules      |
| delete a default tab, once delete exists                 | `ForbiddenError`                          | 403  | Target rules      |
| change own `is_admin` flag                               | `ForbiddenError`                          | 403  | Target rules      |
| change the `is_admin` flag of the root admin             | `ForbiddenError`                          | 403  | Target rules      |
| delete or deactivate the root admin, once these exist    | `ForbiddenError`                          | 403  | Target rules      |
| move a md_document to a tab in another folder            | `NotFoundError`                           | 404  | Target lookup     |
| move a tab, rename a user, set `is_default` or `is_root` | none, the request model has no such field | 422  | Schema validation |

## Error Mapping

Services raise the same domain errors for REST and MCP, and each adapter translates them:

| Check              | Domain error                                           | REST | MCP                                                                                                                |
| ------------------ | ------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------ |
| Authentication     | none, rejected by the middleware                       | 401  | rejected before the tools run                                                                                      |
| Schema validation  | none, rejected by the adapter                          | 422  | malformed JSON: protocol error, it never reaches a tool. Invalid tool arguments: tool error, the tool does not run |
| Visibility         | `NotFoundError`                                        | 404  | tool error                                                                                                         |
| Required right     | `ForbiddenError`                                       | 403  | tool error                                                                                                         |
| Target lookup      | `NotFoundError`                                        | 404  | tool error                                                                                                         |
| Target rules       | `ForbiddenError`                                       | 403  | tool error                                                                                                         |
| Domain validation  | `DomainValidationError`                                | 422  | tool error                                                                                                         |
| Conflicts: name    | `NameConflictError`                                    | 409  | tool error                                                                                                         |
| Conflicts: version | `VersionConflictError`, once optimistic locking exists | 409  | tool error                                                                                                         |

MCP keeps the same distinction: its tool errors tell the domain errors apart, and a hidden item gets the same
`NotFoundError` as one that does not exist.

Every REST error uses RFC 9457 problem+json, built by one shared helper:

- The 401 comes from the middleware, which runs outside FastAPI's exception handlers, so it calls the helper directly.
- The 422 from schema validation is not a domain error, so FastAPI's default 422 body has to be replaced.
- Framework errors (404 for unknown routes, 405, 500) go through a handler, since they return a different body by
  default. A 500 body contains no exception details.
