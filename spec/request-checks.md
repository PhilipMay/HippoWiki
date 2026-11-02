# Request Checks

This document defines how denied requests and errors behave on REST and MCP. The REST endpoints and MCP tools themselves
are not planned yet, see [Known Limitations](known-limitations.md).

## Check Order

A user only learns that a folder exists if they have a right on it. Every request to a non-public route runs these checks
in this order, and the first one that fails decides the response. Services raise the same domain errors for REST and MCP,
and each adapter translates them. The last row is not a check: it covers any other exception.

| Check              | Rejects                                                                       | Domain error                     | REST     | MCP                                |
| ------------------ | ----------------------------------------------------------------------------- | -------------------------------- | -------- | ---------------------------------- |
| Authentication     | an unauthenticated request                                                    | none, rejected by the middleware | 401      | rejected before the tools run      |
| Body size          | a request body over the limit                                                 | none, rejected by the middleware | 413      | rejected before the tools run      |
| Routing            | an unknown route (404), a known route with the wrong method (405)             | none, rejected by the framework  | 404, 405 | see [MCP](mcp.md#errors)           |
| Schema validation  | malformed JSON, wrong types, missing fields or unknown fields                 | none, rejected by the adapter    | 422      | see [MCP](mcp.md#errors)           |
| Visibility         | a user with no right on the folder, also for any tab or md_document in it     | `NotFoundError`                  | 404      | tool error `not_found`             |
| Required right     | a user whose right on the folder is too low for the operation                 | `ForbiddenError`                 | 403      | tool error `forbidden`             |
| Target lookup      | a missing tab, md_document, user or folder right, also when named in the body | `NotFoundError`                  | 404      | tool error `not_found`             |
| Target rules       | an operation the target does not allow, see [below](#rejected-operations)     | `ForbiddenError`                 | 403      | tool error `forbidden`             |
| Domain validation  | a name or size that breaks the domain rules                                   | `DomainValidationError`          | 422      | tool error `domain_validation`     |
| Conflicts: name    | a name conflict                                                               | `NameConflictError`              | 409      | tool error `name_conflict`         |
| Conflicts: version | a version conflict, once optimistic locking exists                            | `VersionConflictError`           | 409      | tool error `version_conflict`      |
| Unexpected         | any other exception                                                           | none                             | 500      | generic tool error without details |

## Rules

### Validation

- two kinds of validation:
  - schema validation in the adapters: shape and types through the Pydantic models, without database access
  - domain validation in the services: folder and md_document name rules (lowercase `a-z0-9-`, at least one character),
    maximum document size
- schema validation leaks nothing: it depends only on the request and never reads the database, so a hidden, a missing
  and a readable folder give the same 422, and validators must not do lookups
- unknown fields: request models forbid them (`extra="forbid"`), so they get 422 instead of being silently ignored. For MCP
  see [Tool Arguments](mcp.md#tool-arguments)
- malformed IDs: an ID in the path with the wrong format gets 422, since it can not identify anything

### Leaks

- authentication comes first, see [Auth Middleware](auth-middleware.md)
- routing leaks nothing: it depends only on the path and the method, and an unauthenticated request gets 401 even on an
  unknown route, so routes can not be probed
- identical 404: a hidden folder, tab or md_document gets the same status and the same message as one that does not
  exist, so a client can not tell them apart
- lists: list operations return only what the user can read, so hidden items are left out instead of causing an error
- no conflict leaks: a user without the required right gets 403 before any name or version conflict or domain validation
  error is reported
- conflicts leak nothing: tab and md_document names conflict only inside a folder the user already has the right on, and
  only admins, who see everything, create folders and users and rename folders

### Targets

- resolving by ID: a tab or md_document addressed by ID is first resolved to its folder, then the checks above run on
  that folder, and an ID that resolves to nothing gets the same 404 as a hidden item
- targets in the request body: a target tab that is not in the folder of the operation gets the same 404 as a missing
  tab, whatever the rights of the user on its folder. This covers moving a md_document and creating one with an explicit
  tab.

### Admin Operations

- admins: the [implicit `manage` right](auth-concept.md#admin-rights) makes every folder visible and sufficient, so a 404
  means it really does not exist
- admin operations by non-admins:
  - operations on an existing folder (rename the folder, assign or delete its rights, list its rights) follow the checks
    above: 404 with no right on the folder, otherwise 403
  - all other admin operations (such as create users, create folders, list users, list all rights of all folders, change
    the `is_admin` flag of a user) get 403 after schema validation and before their target is looked at or their input is
    checked against domain rules, so user and folder names can not be probed

## Rejected Operations

These rules from [Entity Rules](entity-rules.md) reject an operation, whatever the rights of the user:

| Rule                                                     | Domain error                              | REST | Check             |
| -------------------------------------------------------- | ----------------------------------------- | ---- | ----------------- |
| rename a default tab                                     | `ForbiddenError`                          | 403  | Target rules      |
| delete a default tab, once delete exists                 | `ForbiddenError`                          | 403  | Target rules      |
| change own `is_admin` flag                               | `ForbiddenError`                          | 403  | Target rules      |
| change the `is_admin` flag of the root admin             | `ForbiddenError`                          | 403  | Target rules      |
| delete or deactivate the root admin, once these exist    | `ForbiddenError`                          | 403  | Target rules      |
| move a md_document to a tab in another folder            | `NotFoundError`                           | 404  | Target lookup     |
| move a tab, rename a user, set `is_default` or `is_root` | none, the request model has no such field | 422  | Schema validation |
| create or rename anything with the name ""               | `DomainValidationError`                   | 422  | Domain validation |
| create a user named `admin`                              | `NameConflictError`                       | 409  | Conflicts: name   |

## REST Error Format

Every REST error uses RFC 9457 problem+json, built by one shared helper:

- The 401, the 413 and the 503 come from the middleware, which runs outside FastAPI's exception handlers, so it calls the
  helper directly.
- The 422 from schema validation is not a domain error, so FastAPI's default 422 body has to be replaced.
- Framework errors (404 for unknown routes, 405, 500) go through a handler, since they return a different body by
  default. A 500 body contains no exception details.

Two responses need a header as well as the body:

- The 401 carries `WWW-Authenticate`, because RFC 9110 requires it and MCP clients use it to find the login method. The
  login method sets its scheme.
- The 405 carries `Allow`, because RFC 9110 requires it. The framework error handler keeps `exc.headers`, so rebuilding the
  response does not lose it.
