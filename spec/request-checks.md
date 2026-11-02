# Request Checks

This document defines how denied requests and errors behave on REST and MCP. The REST endpoints and MCP tools themselves
are not planned yet, see [Known Limitations](known-limitations.md).

## Check Order

A user only learns that a folder exists if they have a right on it. Every request to a non-public route runs these checks
in this order, and the first one that fails decides the response. Services raise the same domain errors for REST and MCP,
and each adapter translates them. The last row is not a check: it covers any other exception.

| Check              | Rejects                                                                       | Domain error                     | REST     | MCP                                |
| ------------------ | ----------------------------------------------------------------------------- | -------------------------------- | -------- | ---------------------------------- |
| Credential lookup  | a request with credentials that can not be checked, because the lookup failed | none, rejected by the middleware | 503      | rejected before the tools run      |
| Authentication     | an unauthenticated request                                                    | none, rejected by the middleware | 401      | rejected before the tools run      |
| Body size          | a request body over the limit                                                 | none, rejected by the middleware | 413      | rejected before the tools run      |
| Routing            | an unknown route (404), a known route with the wrong method (405)             | none, rejected by the framework  | 404, 405 | see [MCP](mcp.md#errors)           |
| Schema validation  | malformed JSON, an unparsable body, wrong types, missing or unknown fields    | none, rejected by the adapter    | 422      | see [MCP](mcp.md#errors)           |
| Visibility         | a user with no right on the folder, also for any tab or md_document in it     | `NotFoundError`                  | 404      | tool error `not_found`             |
| Required right     | a user whose right on the folder is too low for the operation                 | `ForbiddenError`                 | 403      | tool error `forbidden`             |
| Target lookup      | a missing tab, md_document, user or folder right, also when named in the body | `NotFoundError`                  | 404      | tool error `not_found`             |
| Target rules       | an operation the target does not allow, see [below](#rejected-operations)     | `ForbiddenError`                 | 403      | tool error `forbidden`             |
| Domain validation  | a name or size that breaks the domain rules                                   | `DomainValidationError`          | 422      | tool error `domain_validation`     |
| Conflicts: name    | a name conflict                                                               | `NameConflictError`              | 409      | tool error `name_conflict`         |
| Conflicts: subject | a Keycloak account that is already linked to another user                     | `SubjectConflictError`           | 409      | tool error `subject_conflict`      |
| Conflicts: version | a version conflict, once optimistic locking exists                            | `VersionConflictError`           | 409      | tool error `version_conflict`      |
| Unexpected         | any other exception                                                           | none                             | 500      | generic tool error without details |

## Rules

### Validation

- two kinds of validation:
  - schema validation in the adapters: shape and types through the Pydantic models, without database access
  - domain validation in the services: the [name rules](entity-rules.md#names), maximum document size
- schema validation leaks nothing: it depends only on the request and never reads the database, so a hidden, a missing
  and a readable folder give the same 422, and validators must not do lookups
- unknown fields: request models forbid them (`extra="forbid"`), so they get 422 instead of being silently ignored. For MCP
  see [Tool Arguments](mcp.md#tool-arguments)
- malformed IDs: an ID in the path with the wrong format gets 422, since it can not identify anything
- unparsable bodies: a body with invalid UTF-8 or JSON nested too deeply counts as malformed JSON and gets 422, see
  [REST Error Format](#rest-error-format)
- text PostgreSQL can not store: Pydantic's `str` accepts NUL and lone surrogates, but writing them raises a `DBAPIError`,
  which is not an `IntegrityError` and would end as a 500. One shared type, `SafeText` in `schemas/text.py`, rejects both
  and is used for every string field of the request models and every string argument of the MCP tools, including
  `content_md`. It depends only on the request, so the result is the normal 422 and tool error. The fakes store any
  string, so only `make test-podman` can show what the type protects against

### Leaks

- authentication comes first, see [Auth Middleware](auth-middleware.md)
- routing leaks nothing: it depends only on the path and the method, and an unauthenticated request gets 401 even on an
  unknown route, so routes can not be probed
- identical 404: a hidden folder, tab or md_document gets the same status and the same message as one that does not
  exist, so a client can not tell them apart
- timing: a hidden item may take a different time to answer than a missing one. This is accepted, because the random
  UUIDs make it hard to exploit
- lists: list operations return only what the user can read, so hidden items are left out instead of causing an error
- no conflict leaks: a user without the required right gets 403 before any name or version conflict or domain validation
  error is reported
- conflicts leak nothing: tab and md_document names conflict only inside a folder the user already has the right on, and
  only admins, who see everything, create folders and users, rename folders and link Keycloak accounts

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
    the `is_admin` flag or the `auth_subject` of a user) get 403 after schema validation and before their target is looked at or their input is
    checked against domain rules, so user and folder names can not be probed

## Rejected Operations

These rules from [Entity Rules](entity-rules.md) reject an operation, whatever the rights of the user:

| Rule                                                     | Domain error                              | REST | Check             |
| -------------------------------------------------------- | ----------------------------------------- | ---- | ----------------- |
| rename a default tab                                     | `ForbiddenError`                          | 403  | Target rules      |
| delete a default tab, once delete exists                 | `ForbiddenError`                          | 403  | Target rules      |
| change own `is_admin` flag                               | `ForbiddenError`                          | 403  | Target rules      |
| change the `is_admin` flag of the root admin             | `ForbiddenError`                          | 403  | Target rules      |
| change own `auth_subject`                                | `ForbiddenError`                          | 403  | Target rules      |
| change the `auth_subject` of the root admin              | `ForbiddenError`                          | 403  | Target rules      |
| delete or deactivate the root admin, once these exist    | `ForbiddenError`                          | 403  | Target rules      |
| move a md_document to a tab in another folder            | `NotFoundError`                           | 404  | Target lookup     |
| move a tab, rename a user, set `is_default` or `is_root` | none, the request model has no such field | 422  | Schema validation |
| create or rename anything with the name ""               | `DomainValidationError`                   | 422  | Domain validation |
| create a user named `admin`                              | `NameConflictError`                       | 409  | Conflicts: name   |
| set an `auth_subject` of "" or one that is too long      | `DomainValidationError`                   | 422  | Domain validation |

## REST Error Format

Every REST error uses RFC 9457 problem+json, built by one shared helper:

- The 401, the 413 and the 503 come from the middleware, which runs outside FastAPI's exception handlers, so it calls the
  helper directly.
- The 422 from schema validation is not a domain error, so FastAPI's default 422 body has to be replaced.
- Framework errors (404 for unknown routes, 405, 500) go through a handler, since they return a different body by
  default. A 500 body contains no exception details.
- FastAPI turns any exception during body parsing into a 400 (`fastapi/routing.py:495-497` in FastAPI 0.162.0). The
  application raises no 400 of its own, so the same handler answers it with the 422 for an unparsable body.

`type` stays `about:blank`. Every body has a `code` extension, so a client can tell apart errors with the same status,
such as the two 409s, which need different reactions. It uses the same stable codes as MCP where both have them:

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

A 404 body has no `instance` and no ID, because a hidden and a missing item have different IDs and their bodies must be
identical.

Two responses need a header as well as the body:

- The 401 carries `WWW-Authenticate: Bearer resource_metadata="..."`, because RFC 9110 requires the header and MCP clients
  use it to find the [protected resource metadata](auth-middleware.md#public-routes). When a token was presented, the
  header also carries `error="invalid_token"`, as RFC 6750 asks for.
- The 405 carries `Allow`, because RFC 9110 requires it. The framework error handler keeps `exc.headers`, so rebuilding the
  response does not lose it.
