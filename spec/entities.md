# Tables and Entities

This document defines the tables and what their constraints enforce. Everything the constraints can not express is in
[Entity Rules](entity-rules.md).

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

IDs are UUIDv4. The services generate them with `uuid.uuid4()` and pass them to the repositories, so the real repositories and the fakes behave the same. The root admin refers to itself, so it uses the same value for `id` and `created_by`. UUIDv4 needs no new dependency and reveals nothing, while a UUIDv7 would put the host clock into stored data, against [Time](time.md). A random ID is fine as a tie-breaker, which only needs to be stable.

### MD Document

| Column       | Type                  | Notes                                  |
| ------------ | --------------------- | -------------------------------------- |
| `id`         | uuid, PK              |                                        |
| `name`       | text, not null        |                                        |
| `content_md` | text, not null        | the Markdown text, '' when empty       |
| `tab_id`     | uuid → tabs, not null | the tab the md_document is assigned to |
| `created_by` | uuid → users          |                                        |
| `created_at` | timestamptz           |                                        |

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
Together with the unique, not null name, this allows at most one root admin.
A check constraint `NOT is_root OR is_admin` enforces that the root admin always has the admin role, also under concurrent transactions.

### Folder Right

| Column         | Type                     | Notes                            |
| -------------- | ------------------------ | -------------------------------- |
| `user_id`      | uuid → users, not null   | the user who holds the right     |
| `folder_id`    | uuid → folders, not null | the folder the right applies to  |
| `access_right` | text, not null           | `read`, `write` or `manage`      |
| `assigned_by`  | uuid → users             | the admin who assigned the right |
| `assigned_at`  | timestamptz              | when the right was assigned      |

The composite primary key `(user_id, folder_id)` allows one row per user and folder, since each right includes the lower ones.
A check constraint limits `access_right` to `read`, `write` and `manage`.
An index on `folder_id` supports listing the rights of a folder. The primary key already covers lookups by user.

Notes:

- the column is not named `right` because `RIGHT` is a reserved word in PostgreSQL
