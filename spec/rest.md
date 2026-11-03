# REST

The REST adapter is a thin layer over the services, see [Architecture](architecture.md). This document defines its
routes, its response fields and how lists page. The list rules also apply to [MCP](mcp.md#tools). Denied requests and
the error format are in [Request Checks](request-checks.md), and who can do what is in
[Users and Rights](users-and-rights.md).

## Conventions

- All routes below have the prefix `/api/v1`. The [public routes](authentication.md#public-routes) and `/openapi.json`
  stay outside it.
- Items are addressed flat by ID, see [Targets](request-checks.md#targets). Lists and creates are nested under the
  parent.
- A create answers 201 and deleting a right answers 204. Everything else answers 200 with the item.
- A delete and a restore return the summary of the item, because
  [write results](history-revisions.md#optimistic-locking) of a md_document return its version and both grow it.
- The result of a create or update of a md_document is its summary without `content_md`, because the client just sent
  it.
- The version the client saw travels in the body, not in `If-Match`, see
  [Optimistic Locking](history-revisions.md#optimistic-locking).
- A `PATCH` with no field to change gets 422 `schema_validation`.
- A `null` for a field gets 422 `schema_validation`, except `auth_subject`, where `null` removes the link and leaving it
  out changes nothing.

## Routes

The right is the lowest one that is enough, see [Rights on Folders](users-and-rights.md#rights-on-folders). The admin
[has no right](users-and-rights.md#admin-operations) on any folder, so a route that names a right gets 404 for the
admin, unless it says otherwise. Body fields are named where they are not obvious.

### Own Account

For every user, see [Own Account](users-and-rights.md#own-account).

| Route            | Purpose                                |
| ---------------- | -------------------------------------- |
| `GET /me`        | own user                               |
| `GET /me/rights` | own rights with the folder name, paged |

### Folders

| Route                                             | Right                                         |
| ------------------------------------------------- | --------------------------------------------- |
| `GET /folders`                                    | lists only what the user can see, paged       |
| `POST /folders`                                   | admin, `name`                                 |
| `GET /folders/deleted`                            | admin, paged                                  |
| `GET /folders/{folder_id}`                        | `read` or admin                               |
| `PATCH /folders/{folder_id}`                      | admin, `name`                                 |
| `DELETE /folders/{folder_id}`                     | admin                                         |
| `POST /folders/{folder_id}/restore`               | admin                                         |
| `POST /folders/{folder_id}/revert`                | `manage`, `revision_counter`, `target_number` |
| `GET /folders/{folder_id}/history`                | `read`, paged                                 |
| `GET /folders/{folder_id}/history/{number}`       | `read`, one entry                             |
| `GET /folders/{folder_id}/history/{number}/items` | `read`, paged, the changed items of the entry |

A folder revert can change thousands of items, so the changed items of an entry are a list of their own.

### Tabs

| Route                                   | Right            |
| --------------------------------------- | ---------------- |
| `GET /folders/{folder_id}/tabs`         | `read`, paged    |
| `POST /folders/{folder_id}/tabs`        | `write`, `name`  |
| `GET /folders/{folder_id}/tabs/deleted` | `manage`, paged  |
| `GET /tabs/{tab_id}`                    | `read`           |
| `PATCH /tabs/{tab_id}`                  | `manage`, `name` |
| `DELETE /tabs/{tab_id}`                 | `manage`         |
| `POST /tabs/{tab_id}/restore`           | `manage`         |

### MD Documents

| Route                                                    | Right                                                   |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `GET /folders/{folder_id}/md-documents`                  | `read`, paged, optional query parameter `tab_id`        |
| `POST /folders/{folder_id}/md-documents`                 | `write`, `name`, optional `content_md` and `tab_id`     |
| `GET /folders/{folder_id}/md-documents/deleted`          | `manage`, paged                                         |
| `GET /md-documents/{md_document_id}`                     | `read`, the only live read with `content_md`            |
| `PATCH /md-documents/{md_document_id}`                   | `write` or `manage`, `version`, see below               |
| `DELETE /md-documents/{md_document_id}`                  | `manage`                                                |
| `POST /md-documents/{md_document_id}/restore`            | `manage`                                                |
| `POST /md-documents/{md_document_id}/revert`             | `manage`, `version`, `target_version`                   |
| `GET /md-documents/{md_document_id}/revisions`           | `read`, `manage` when it is not live, paged             |
| `GET /md-documents/{md_document_id}/revisions/{version}` | `read`, `manage` when it is not live, with `content_md` |

- `PATCH` takes the optional fields `content_md`, `name` and `tab_id`, and changing several of them is one
  [`update`](entities.md#folder-history-entry). The right it needs is in
  [Combined Updates](users-and-rights.md#combined-updates).
- Without `tab_id`, the list returns the live md_documents of all live tabs of the folder, and each row has its
  `tab_id`. Without `tab_id`, a create uses the [default tab](entities.md#folders-tabs-and-md-documents).
- A `tab_id` in the list follows the same rule as in the create: a missing, deleted or foreign tab gets the 404 of
  [Targets](request-checks.md#targets).

### Users and Rights

Admin operations only, see [Admin Operations](users-and-rights.md#admin-operations).

| Route                                          | Purpose                                       |
| ---------------------------------------------- | --------------------------------------------- |
| `GET /users`                                   | paged, includes deactivated and deleted users |
| `POST /users`                                  | `name`, `auth_subject`                        |
| `GET /users/{user_id}`                         | one user, a deleted user gets 404             |
| `PATCH /users/{user_id}`                       | `auth_subject`                                |
| `DELETE /users/{user_id}`                      | delete the user, which is final               |
| `POST /users/{user_id}/deactivate`             | idempotent                                    |
| `POST /users/{user_id}/reactivate`             | idempotent                                    |
| `GET /rights`                                  | all rights of all folders, paged              |
| `GET /folders/{folder_id}/rights`              | paged                                         |
| `PUT /folders/{folder_id}/rights/{user_id}`    | `access_right`, replaces the row              |
| `DELETE /folders/{folder_id}/rights/{user_id}` | 204                                           |

## Response Fields

A user is always named as `{id, name}`, see [Own Account](users-and-rights.md#own-account). This applies to
`created_by`, `assigned_by` and `user` below.

- **Folder**: `id`, `name`, `revision_counter`, `created_by`, `created_at`, `deleted_at`. A folder revert needs the
  counter.
- **Tab**: `id`, `name`, `folder_id`, `is_default`, `created_by`, `created_at`, `deleted_at`.
- **MD document summary**: `id`, `name`, `folder_id`, `tab_id`, `version`, `created_by`, `created_at`, `deleted_at`. The
  full md_document adds `content_md`.
- **Revision summary**: `version`, `number`, `kind`, `name`, `tab_id`, `is_deleted`, `created_by`, `created_at`. The
  full revision adds `content_md`.
- **History entry**: `number`, `kind`, `reverted_to`, `created_by`, `created_at`, `item`. `item` is null for a
  `folder_revert`, whose changed items come from the items route.
- **History item**: `type` (`md_document`, `tab` or `folder`), `id`, `name`, `previous_name`, and for a md_document also
  `tab_id`, `previous_tab_id` and `version`. It holds no content, which comes from the revision of the md_document.
- **Own user**: `id`, `name`, `is_admin`, `created_at`.
- **User**: `id`, `name`, `auth_subject`, `is_admin`, `created_by`, `created_at`, `deactivated_at`, `deleted_at`.
- **Own right**: `folder` as `{id, name}`, `access_right`.
- **Stored right**: `folder` as `{id, name}`, `user`, `access_right`, `assigned_by`, `assigned_at`.

## Lists

These rules apply to every paged list, on REST and on [MCP](mcp.md#tools):

- Lists take `limit` and `cursor`, as query parameters on REST.
- `limit` is 1 to 100, with a default of 50. A value out of range gets a schema validation error and is not clamped.
- A list returns `{"items": [...], "next_cursor": "..."}`, and `next_cursor` is null on the last page.
  - It has no total, so nothing has to count.
  - The repository reads `limit + 1` rows, so a null `next_cursor` is certain and a full last page is not followed by an
    empty one.
- Lists never return `content_md`, so the size of a page depends only on the number of rows. A page of 100 summaries is
  roughly 25 kB.
- The cursor is opaque for clients. It is base64url of the sort key of the last row, such as `["some-name", "<uuid>"]`.
  - A cursor that can not be decoded or has the wrong shape gets a schema validation error, which depends only on the
    request and so [leaks nothing](request-checks.md#validation).
  - It is not signed, because it only says where to continue. The rights still filter every row, and the row it names
    need not exist any more.
- Hidden and deleted rows are left out by the query itself, so a page is full unless it is the last one.
- There is no snapshot across pages, because each page is its own
  [unit of work](architecture.md#cross-cutting-concerns). A rename during paging can show a row twice or not at all,
  which is accepted.

The order is fixed, and a client can not choose it:

| List                                                | Order                      |
| --------------------------------------------------- | -------------------------- |
| folders, tabs, md_documents and their deleted lists | `name`, `id`               |
| users                                               | `name`, `id`               |
| own rights                                          | folder `name`, folder `id` |
| rights of a folder                                  | `user_id`                  |
| all rights                                          | `user_id`, `folder_id`     |
| revisions of a md_document                          | `version`, newest first    |
| folder history                                      | `number`, newest first     |
| changed items of an entry                           | `type`, `id`               |

The ID is the [tie-breaker](time.md#rules): names repeat among deleted rows and across the tabs of a folder.

## Implementation Notes

- Static routes such as `/folders/deleted` are declared before `/folders/{folder_id}`, because `deleted` would otherwise
  be a malformed ID and get 422.
- Paging: `schemas/paging.py` has the shared types for `limit` and the cursors, used by both adapters.
  - The adapters decode the cursor and pass the sort key to the service as plain values, because services never import
    `schemas/`.
  - A repository returns a `Page` from `domain.py` with the rows and the sort key of the last one, and the adapter
    encodes that key.
  - Decoded strings go through `SafeText`, because a crafted NUL would otherwise reach asyncpg and become a 500.
- Collation: the [name columns](entities.md#tables) use `COLLATE "C"`. The keyset comparison and `ORDER BY` have to
  agree, the partial unique indexes have to serve them, and it matches the string order of Python, so the fakes sort
  like PostgreSQL. It also does not depend on the image, unlike the sort difference [Deployment](deployment.md)
  mentions.
