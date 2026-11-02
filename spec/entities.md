# Tables, Entities and Rules

## Entities

| Entity       | Table         | Notes                           |
| ------------ | ------------- | ------------------------------- |
| md_document  | md_documents  | a Markdown document             |
| tab          | tabs          |                                 |
| folder       | folders       |                                 |
| user         | users         |                                 |
| folder_right | folder_rights | the right of a user on a folder |

Time columns such as `created_at` follow the rules in [Time](time.md). The meaning of the rights is defined in
[Auth Concept](auth-concept.md).

### MD Document

| Column       | Type                  | Notes                               |
| ------------ | --------------------- | ----------------------------------- |
| `id`         | uuid, PK              |                                     |
| `name`       | text, not null        |                                     |
| `content_md` | text, not null        | the Markdown text, '' when empty    |
| `tab_id`     | uuid → tabs, not null | the tab the document is assigned to |
| `created_by` | uuid → users          |                                     |
| `created_at` | timestamptz           |                                     |

A unique constraint on `(tab_id, name)` enforces that the name is unique per tab.
A check constraint `name <> ''` enforces that the name is not empty.

### Tab

| Column       | Type                     | Notes                                  |
| ------------ | ------------------------ | -------------------------------------- |
| `id`         | uuid, PK                 |                                        |
| `name`       | text, not null           |                                        |
| `folder_id`  | uuid → folders, not null | the folder the tab is assigned to      |
| `is_default` | bool, not null           | true for the default tab of the folder |
| `created_by` | uuid → users             |                                        |
| `created_at` | timestamptz              |                                        |

A unique constraint on `(folder_id, name)` enforces that the name is unique per folder.
A check constraint `is_default = (name = '')` enforces that the default tab is named "" and that no other tab has this name.
Together with the not null name, these two constraints allow at most one default tab per folder.

### Folder

| Column       | Type                   | Notes |
| ------------ | ---------------------- | ----- |
| `id`         | uuid, PK               |       |
| `name`       | text, not null, unique |       |
| `created_by` | uuid → users           |       |
| `created_at` | timestamptz            |       |

A check constraint `name <> ''` enforces that the name is not empty.

### User

| Column       | Type                          | Notes                               |
| ------------ | ----------------------------- | ----------------------------------- |
| `id`         | uuid, PK                      |                                     |
| `name`       | text, not null, unique        |                                     |
| `is_admin`   | bool, not null, default false | Admin role                          |
| `is_root`    | bool, not null, default false | true for the root admin             |
| `created_by` | uuid → users                  | the root admin is created by itself |
| `created_at` | timestamptz                   |                                     |

A check constraint `name <> ''` enforces that the name is not empty.
A check constraint `is_root = (name = 'admin')` enforces that the user named `admin` is the root admin and that no other user is.
Together with the unique, not null name, this allows at most one root admin. The rule that users can not be renamed keeps the root admin in place.
A check constraint `NOT is_root OR is_admin` enforces that the root admin always has the admin role, also under concurrent transactions.

Notes:

- users can not be renamed

### Folder Right

| Column         | Type                     | Notes                            |
| -------------- | ------------------------ | -------------------------------- |
| `user_id`      | uuid → users, not null   | the user who holds the right     |
| `folder_id`    | uuid → folders, not null | the folder the right applies to  |
| `access_right` | text, not null           | `read`, `write` or `update`      |
| `created_by`   | uuid → users             | the admin who assigned the right |
| `created_at`   | timestamptz              | when the right was assigned      |

The composite primary key `(user_id, folder_id)` allows one row per user and folder, since each right includes the lower ones.
A check constraint limits `access_right` to `read`, `write` and `update`.
An index on `folder_id` supports listing the rights of a folder. The primary key already covers lookups by user.

Notes:

- the column is not named `right` because `RIGHT` is a reserved word in PostgreSQL

## Rules and Relations

- a folder always has exactly one default tab
  - the default tab is created together with the folder and is named "" (empty string)
  - the default tab can not be deleted
  - the default tab can not be renamed
- a tab is always assigned to exactly one folder
- a md_document is always assigned to exactly one tab
  - by default a md_document is assigned to the default tab of its folder
- every name is required
  - only the default tab has the name "" (empty string)
- the folder name must be unique
- the tab name must be unique per folder
- the md_document name must be unique per tab
- a violated unique name is reported as `NameConflictError`, see [API](api.md)
- a user has at most one right per folder
  - a user with no row for a folder has no access to it
  - rights are ordered: `read` < `write` < `update`
  - assigning a right replaces the existing row, so `created_by` and `created_at` describe the current assignment
  - deleting a right removes the row
- an admin has an implicit `update` right on all folders
  - it comes from `is_admin` and is not stored as rows
  - an assigned right of an admin has no effect while `is_admin` is true, and applies again if the flag is removed
- system initialization creates the root admin, a user named `admin` with `is_root` and `is_admin` set to true
  - `hippowiki init` runs it, see [Deployment](deployment.md)
  - it is idempotent: an existing root admin is left alone, and a concurrent run is caught by the unique name
  - the root admin can never be deleted or deactivated
  - the `is_admin` flag of the root admin can never be removed
- after system initialization at least one admin always exists, because the root admin always stays an admin
  - this also holds under concurrent transactions and needs no lock: admins who demote each other at the same time can not affect the root admin
  - before system initialization nobody can authenticate, so every request to a non-public route gets 401

Table constraints can not express the following rules, so the service layer enforces them. The responses to rejected operations are defined in [Rejected Operations](api.md#rejected-operations):

- creating a folder also creates its default tab in the same transaction
- deleting a default tab is rejected
- renaming a default tab is rejected, and `is_default` of a tab never changes after creation
- a new md_document without an explicit tab is assigned to the default tab of its folder
- a tab can not be moved to another folder, so `folder_id` of a tab never changes
- a md_document can only be moved to a tab in the same folder
- an admin changing their own `is_admin` flag is rejected
- changing the `is_admin` flag of the root admin is rejected
- deleting or deactivating the root admin is rejected, once these operations exist
- renaming a user is rejected, and `is_root` of a user never changes after creation
