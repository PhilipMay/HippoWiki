# API

This document plans the behavior of the REST API and MCP. So far it covers denied requests.

## Denied Requests

A user only learns that a folder exists if they have a right on it. Every request to a non-public route runs these
checks in this order, and the first one that fails decides the response:

1. Authentication: an unauthenticated request gets 401.
2. Schema validation: a request with malformed JSON, wrong types or missing fields gets 422.
3. Visibility: a user with no right on the folder gets 404, also for any tab or md_document in it.
4. Required right: a user whose right on the folder is too low for the operation gets 403.
5. Request state: a missing tab or md_document in the folder gets 404, and domain validation errors and conflicts are
   reported only now.

Rules:

- authentication comes first: it runs before the request body is read or parsed, on every route except the public ones
  listed in [Architecture](architecture.md)
- two kinds of validation: schema validation checks shape and types in the adapters, domain validation (name format,
  maximum size) lives in the services
- schema validation leaks nothing: it depends only on the request and never reads the database, so a hidden, a missing
  and a readable folder give the same 422, and validators must not do lookups
- identical 404: a hidden folder, tab or md_document gets the same status and the same message as one that does not
  exist, so a client can not tell them apart
- resolving by ID: a tab or md_document addressed by ID is first resolved to its folder, then the checks above run on
  that folder
- malformed IDs: an ID in the path with the wrong format gets 422, since it can not identify anything
- no conflict leaks: a user without the required right gets 403 before any name or version conflict or domain validation
  error is reported
- lists: list operations return only what the user can read, so hidden items are left out instead of causing an error
- admins: the implicit "update" right makes every folder visible and sufficient, so a 404 means it really does not exist
- admin operations by non-admins:
  - operations on an existing folder (rename the folder, assign or delete its rights) follow the checks above: 404 with
    no right on the folder, otherwise 403
  - all other admin operations (such as create users, create folders, list users) get 403 after schema validation and
    before their target is looked at or their input is checked against domain rules, so user and folder names can not be
    probed
- own `is_admin` flag: an admin changing their own flag gets 403
- root admin `is_admin` flag: an admin changing the flag of the root admin gets 403

## Error Mapping

Services raise the same domain errors for REST and MCP, and each adapter translates them:

| Check             | Domain error                     | REST | MCP                               |
| ----------------- | -------------------------------- | ---- | --------------------------------- |
| Authentication    | none, rejected by the middleware | 401  | rejected before the tools run     |
| Schema validation | none, rejected by the adapter    | 422  | tool error, the tool does not run |
| Visibility        | `NotFoundError`                  | 404  | tool error                        |
| Required right    | `ForbiddenError`                 | 403  | tool error                        |
| Domain validation | `DomainValidationError`          | 422  | tool error                        |

MCP keeps the same distinction: its tool errors tell `NotFoundError` and `ForbiddenError` apart, and a hidden item gets
the same `NotFoundError` as one that does not exist.

Every REST error uses RFC 9457 problem+json. This includes the 401 from the middleware and the 422 from schema
validation, which are not domain errors, so FastAPI's default 422 body has to be replaced.
