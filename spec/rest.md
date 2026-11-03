# REST

The REST adapter is a thin layer over the services. This document defines its routes and its response fields.

## Conventions

- All routes below have the prefix `/api/v1`. The [public routes](authentication.md#public-routes) and `/openapi.json`
  stay outside it.
- Items are addressed flat by ID, see [Targets](request-checks.md#targets). Lists and creates are nested under the
  parent.
- A route marked paged follows [Lists](lists.md).
- A create answers 201 and deleting a right answers 204. Everything else answers 200 with the item.
- A delete and a restore return the summary of the item, because
  [write results](history-revisions.md#optimistic-locking) of a md_document return its version and both grow it.
- The result of a create or update of a md_document is its summary without `content_md`, because the client just sent
  it.
- The version the client saw travels in the body, not in `If-Match`.
- A `PATCH` with no field to change gets 422 `schema_validation`.
- A `null` for a field gets 422 `schema_validation`, except `auth_subject`, where `null` removes the link and leaving it
  out changes nothing.

## Routes

The right is the lowest one that is enough, see [Rights on Folders](rights.md#rights-on-folders). The admin
[has no right](users.md#admin-operations) on any folder, so a route that names a right gets 404 for the admin, unless it
says otherwise. Body fields are named where they are not obvious.

### Own Account Routes

For every user, see [Own Account](users.md#own-account).

| Route            | Purpose                                |
| ---------------- | -------------------------------------- |
| `GET /me`        | own user                               |
| `GET /me/rights` | own rights with the folder name, paged |

### Folder Routes

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

### Tab Routes

| Route                                   | Right            |
| --------------------------------------- | ---------------- |
| `GET /folders/{folder_id}/tabs`         | `read`, paged    |
| `POST /folders/{folder_id}/tabs`        | `write`, `name`  |
| `GET /folders/{folder_id}/tabs/deleted` | `manage`, paged  |
| `GET /tabs/{tab_id}`                    | `read`           |
| `PATCH /tabs/{tab_id}`                  | `manage`, `name` |
| `DELETE /tabs/{tab_id}`                 | `manage`         |
| `POST /tabs/{tab_id}/restore`           | `manage`         |

### MD Document Routes

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
  [`update`](database.md#folder-history-entry-table). The right it needs is in
  [Combined Updates](rights.md#combined-updates).
- Without `tab_id`, the list returns the live md_documents of all live tabs of the folder, and each row has its
  `tab_id`. Without `tab_id`, a create uses the [default tab](content.md#folders-tabs-and-md-documents).
- A `tab_id` in the list follows the same rule as in the create: a missing, deleted or foreign tab gets the 404 of
  [Targets](request-checks.md#targets).

### User and Right Routes

Admin operations only, see [Admin Operations](users.md#admin-operations).

| Route                                          | Purpose                           |
| ---------------------------------------------- | --------------------------------- |
| `GET /users`                                   | paged, includes deactivated users |
| `POST /users`                                  | `name`, `auth_subject`            |
| `GET /users/{user_id}`                         | one user                          |
| `PATCH /users/{user_id}`                       | `auth_subject`                    |
| `POST /users/{user_id}/deactivate`             | idempotent                        |
| `POST /users/{user_id}/reactivate`             | idempotent                        |
| `GET /rights`                                  | all rights of all folders, paged  |
| `GET /folders/{folder_id}/rights`              | paged                             |
| `PUT /folders/{folder_id}/rights/{user_id}`    | `access_right`, replaces the row  |
| `DELETE /folders/{folder_id}/rights/{user_id}` | 204                               |

## Response Fields

A user is always named as `{id, name}`, see [Own Account](users.md#own-account). This applies to `created_by`,
`assigned_by` and `user` below.

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
- **User**: `id`, `name`, `auth_subject`, `is_admin`, `created_by`, `created_at`, `deactivated_at`.
- **Own right**: `folder` as `{id, name}`, `access_right`.
- **Stored right**: `folder` as `{id, name}`, `user`, `access_right`, `assigned_by`, `assigned_at`.
