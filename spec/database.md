# Database Tables

This document defines the tables, indexes and constraints. Rules that table constraints can not express are in
[Content](content.md), [Rights](rights.md) and [Users](users.md).

| Entity               | Table                  | Notes                             |
| -------------------- | ---------------------- | --------------------------------- |
| md_document          | md_documents           | a Markdown document               |
| tab                  | tabs                   |                                   |
| folder               | folders                |                                   |
| user                 | users                  |                                   |
| user_password        | user_passwords         | the password hash of a user       |
| oauth_client         | oauth_clients          | an own client of the OAuth server |
| oauth_code           | oauth_codes            | an authorization code             |
| oauth_token          | oauth_tokens           | an access or refresh token        |
| folder_right         | folder_rights          | the right of a user on a folder   |
| folder_history_entry | folder_history_entries | one numbered change in a folder   |
| md_document_revision | md_document_revisions  | a snapshot of a md_document       |
| tab_revision         | tab_revisions          | a snapshot of a tab               |
| folder_revision      | folder_revisions       | a snapshot of a folder            |

## Rules for All Tables

- Time columns such as `created_at` follow the rules in [Time](time.md).
- IDs are UUIDv4.
  - The services generate them with `uuid.uuid4()` and pass them to the repositories, so the real repositories and the
    fakes behave the same.
  - The admin refers to itself, so it uses the same value for `id` and `created_by`.
  - UUIDv4 needs no new dependency and reveals nothing, while a UUIDv7 would put the host clock into stored data,
    against [Time](time.md). A random ID is fine as a tie-breaker, which only needs to be stable.
- Foreign keys have no `ON DELETE` action, because md_documents, tabs, folders and users are never removed. Only
  `folder_rights` rows and the rows of the [OAuth tables](#oauth-tables) are physically deleted. So `created_by` and
  `assigned_by` are never null, and the admin can refer to itself because a foreign key is checked at the end of the
  statement.
- The `name` columns of `md_documents`, `tabs`, `folders` and `users` use `COLLATE "C"`, because [lists](lists.md) are
  sorted by them, see [PostgreSQL Notes](implementation-notes.md#postgresql-notes).

## MD Document Table

| Column       | Type                   | Notes                                                                              |
| ------------ | ---------------------- | ---------------------------------------------------------------------------------- |
| `id`         | uuid, PK               |                                                                                    |
| `name`       | text, not null         |                                                                                    |
| `content_md` | text, not null         | the Markdown text, '' when empty                                                   |
| `tab_id`     | uuid → tabs, not null  | the tab the md_document is assigned to                                             |
| `version`    | integer, not null      | 1 at the create, see [Order and Versions](history-revisions.md#order-and-versions) |
| `created_by` | uuid → users, not null |                                                                                    |
| `created_at` | timestamptz            |                                                                                    |
| `deleted_at` | timestamptz            | null while the md_document is live                                                 |

- A partial unique index on `(tab_id, name) WHERE deleted_at IS NULL` enforces that the name is unique among the live
  md_documents of a tab.
- A partial index on `(tab_id, name, id) WHERE deleted_at IS NOT NULL` supports the deleted list.
- A check constraint `name <> ''` enforces that the name is not empty.

## Tab Table

| Column       | Type                     | Notes                                  |
| ------------ | ------------------------ | -------------------------------------- |
| `id`         | uuid, PK                 |                                        |
| `name`       | text, not null           |                                        |
| `folder_id`  | uuid → folders, not null | the folder the tab is assigned to      |
| `is_default` | bool, not null           | true for the default tab of the folder |
| `created_by` | uuid → users, not null   |                                        |
| `created_at` | timestamptz              |                                        |
| `deleted_at` | timestamptz              | null while the tab is live             |

- A partial unique index on `(folder_id, name) WHERE deleted_at IS NULL` enforces that the name is unique among the live
  tabs of a folder.
- A partial index on `(folder_id, name, id) WHERE deleted_at IS NOT NULL` supports the deleted list.
- A check constraint `is_default = (name = '')` enforces that the default tab is named "" and that no other tab has this
  name.
- A check constraint `NOT is_default OR deleted_at IS NULL` enforces that the default tab is never deleted, also under
  concurrent transactions.
- Together with the not null name, these three constraints allow at most one default tab per folder.

## Folder Table

| Column             | Type                   | Notes                                                                              |
| ------------------ | ---------------------- | ---------------------------------------------------------------------------------- |
| `id`               | uuid, PK               |                                                                                    |
| `name`             | text, not null         |                                                                                    |
| `revision_counter` | integer, not null      | 1 at the create, see [Order and Versions](history-revisions.md#order-and-versions) |
| `created_by`       | uuid → users, not null |                                                                                    |
| `created_at`       | timestamptz            |                                                                                    |
| `deleted_at`       | timestamptz            | null while the folder is live                                                      |

- A partial unique index on `name WHERE deleted_at IS NULL` enforces that the name is unique among the live folders.
- A check constraint `name <> ''` enforces that the name is not empty.

## User Table

| Column           | Type                          | Notes                                              |
| ---------------- | ----------------------------- | -------------------------------------------------- |
| `id`             | uuid, PK                      |                                                    |
| `name`           | text, not null, unique        | stays reserved, also while the user is deactivated |
| `is_admin`       | bool, not null, default false | true for the admin                                 |
| `created_by`     | uuid → users, not null        | the admin is created by itself                     |
| `created_at`     | timestamptz                   |                                                    |
| `deactivated_at` | timestamptz                   | null while the user is active                      |

- A check constraint `name <> ''` enforces that the name is not empty.
- A check constraint `is_admin = (name = 'admin')` enforces that the user named `admin` is the admin and that no other
  user is. Together with the unique, not null name, this allows at most one admin.
- A check constraint `NOT is_admin OR deactivated_at IS NULL` enforces that the admin is never deactivated, also under
  concurrent transactions.

## User Password Table

The rules are in [Passwords](users.md#passwords) and [Login Protection](oauth-server.md#login-protection). The hash has
its own table, so reading a user can not bring it along. A user without a row can not log in, which is how the admin
starts.

| Column            | Type                     | Notes                                       |
| ----------------- | ------------------------ | ------------------------------------------- |
| `user_id`         | uuid → users, PK         |                                             |
| `password_hash`   | text, not null           | Argon2id, with its parameters               |
| `is_one_time`     | bool, not null           | a new password is needed at the next login  |
| `failed_attempts` | int, not null, default 0 | failed logins since the last successful one |
| `locked_until`    | timestamptz              | null when no wait applies                   |
| `changed_at`      | timestamptz              |                                             |

## OAuth Tables

The rules are in [OAuth Server](oauth-server.md). Hashes are SHA-256 as `bytea`, and the values themselves are never
stored. `client_id` has no foreign key, because a [trusted client](oauth-server.md#trusted-clients) has no row. Rows are
physically deleted, so nothing refers to these tables, and their only foreign keys are `user_id` and `script_user`.

`oauth_clients` holds the [own clients](oauth-server.md#own-clients):

| Column          | Type                          | Notes                                                |
| --------------- | ----------------------------- | ---------------------------------------------------- |
| `id`            | text, PK                      | generated, and never a URL                           |
| `name`          | text, not null                | shown on the login page                              |
| `secret_hash`   | bytea                         | null for a public client                             |
| `redirect_uris` | text[], not null              | empty for a script client                            |
| `script_user`   | uuid → users                  | the user of a script client, null for a login client |
| `admin_allowed` | bool, not null, default false | the admin may approve this login client              |
| `created_at`    | timestamptz                   |                                                      |

- A check constraint enforces that a client is either a login client, with redirect URIs and no `script_user`, or a
  script client, with a `script_user`, a `secret_hash` and no redirect URIs.

`oauth_codes` holds the authorization codes:

| Column           | Type                   | Notes                                                               |
| ---------------- | ---------------------- | ------------------------------------------------------------------- |
| `code_hash`      | bytea, PK              |                                                                     |
| `family_id`      | uuid, not null         | the family that this code starts                                    |
| `client_id`      | text, not null         |                                                                     |
| `user_id`        | uuid → users, not null |                                                                     |
| `redirect_uri`   | text, not null         | exactly as the request sent it, so the token request can compare it |
| `code_challenge` | text, not null         | S256 is the only method                                             |
| `scope`          | text, not null         | the granted scope, may be empty                                     |
| `created_at`     | timestamptz            |                                                                     |
| `expires_at`     | timestamptz, not null  |                                                                     |
| `consumed_at`    | timestamptz            | null until used, kept to detect a second use                        |

`oauth_tokens` holds access and refresh tokens:

| Column        | Type                   | Notes                                                                           |
| ------------- | ---------------------- | ------------------------------------------------------------------------------- |
| `token_hash`  | bytea, PK              | the only lookup for a request, see [Token Check](authentication.md#token-check) |
| `kind`        | text, not null         | `access` or `refresh`, with a check constraint                                  |
| `family_id`   | uuid, not null         | indexed, and a script client starts a new family per token                      |
| `client_id`   | text, not null         | indexed                                                                         |
| `user_id`     | uuid → users, not null | indexed                                                                         |
| `scope`       | text, not null         |                                                                                 |
| `created_at`  | timestamptz            |                                                                                 |
| `expires_at`  | timestamptz, not null  | indexed for the cleanup                                                         |
| `replaced_at` | timestamptz            | a refresh token that was rotated, kept to detect reuse                          |

- There is no `resource` column, because every token has the one resource, the MCP URL.
- `oauth_codes` has indexes on `family_id`, `user_id` and `client_id`, for
  [ending tokens](oauth-server.md#ending-tokens) and removing a client, and on `created_at`, for the
  [cleanup](oauth-server.md#tokens).

## Folder Right Table

The meaning of the rights is defined in [Rights](rights.md).

| Column         | Type                     | Notes                            |
| -------------- | ------------------------ | -------------------------------- |
| `user_id`      | uuid → users, not null   | the user who holds the right     |
| `folder_id`    | uuid → folders, not null | the folder the right applies to  |
| `access_right` | text, not null           | `read`, `write` or `manage`      |
| `assigned_by`  | uuid → users, not null   | the admin who assigned the right |
| `assigned_at`  | timestamptz              | when the right was assigned      |

- The composite primary key `(user_id, folder_id)` allows one row per user and folder, since each right includes the
  lower ones.
- A check constraint limits `access_right` to `read`, `write` and `manage`.
- An index on `folder_id` supports listing the rights of a folder. The primary key already covers lookups by user.
- The column is not named `right` because `RIGHT` is a reserved word in PostgreSQL.

## Folder History Entry Table

The behaviour is defined in [History and Revisions](history-revisions.md). An entry is one numbered change in a folder.

| Column        | Type                     | Notes                                                                       |
| ------------- | ------------------------ | --------------------------------------------------------------------------- |
| `folder_id`   | uuid → folders, not null |                                                                             |
| `number`      | integer, not null        | the value of `revision_counter` of the folder after this change             |
| `kind`        | text, not null           | the kind of change                                                          |
| `reverted_to` | integer                  | a version for `revert`, a folder number for `folder_revert`, otherwise null |
| `created_by`  | uuid → users, not null   | the author                                                                  |
| `created_at`  | timestamptz              |                                                                             |

- The composite primary key is `(folder_id, number)`.
- A check constraint limits `kind` to `create`, `update`, `delete`, `restore`, `revert` and `folder_revert`, so a write
  that changes both name and content is one `update`.
- A check constraint `(reverted_to IS NOT NULL) = (kind IN ('revert', 'folder_revert'))` enforces that only a revert has
  a target.

## Revision Tables

Each revision has a foreign key `(folder_id, number)` to its entry, so author and time live on the entry, and the old
name or tab is read from the previous revision of the item. A normal entry has exactly one revision, and a
`folder_revert` entry has one per changed item. The default tab gets no revision, because it never changes and a folder
revert skips it.

MD document revision, with the composite primary key `(md_document_id, version)`:

| Column           | Type                          | Notes                               |
| ---------------- | ----------------------------- | ----------------------------------- |
| `md_document_id` | uuid → md_documents, not null |                                     |
| `version`        | integer, not null             | the version this revision created   |
| `folder_id`      | uuid → folders, not null      |                                     |
| `number`         | integer, not null             | the folder number of the entry      |
| `name`           | text, not null                |                                     |
| `content_md`     | text, not null                | the full text, not a difference     |
| `tab_id`         | uuid → tabs, not null         |                                     |
| `is_deleted`     | bool, not null                | true when `deleted_at` was set then |

Tab revision, with the composite primary key `(tab_id, number)`:

| Column       | Type                     | Notes                               |
| ------------ | ------------------------ | ----------------------------------- |
| `tab_id`     | uuid → tabs, not null    |                                     |
| `folder_id`  | uuid → folders, not null |                                     |
| `number`     | integer, not null        | the folder number of the entry      |
| `name`       | text, not null           |                                     |
| `is_deleted` | bool, not null           | true when `deleted_at` was set then |

Folder revision, with the composite primary key `(folder_id, number)`:

| Column       | Type                     | Notes                               |
| ------------ | ------------------------ | ----------------------------------- |
| `folder_id`  | uuid → folders, not null |                                     |
| `number`     | integer, not null        | the folder number of the entry      |
| `name`       | text, not null           |                                     |
| `is_deleted` | bool, not null           | true when `deleted_at` was set then |

An index on `(folder_id, number)` of `md_document_revisions` and of `tab_revisions` supports the folder history and the
state of a folder at a number. The primary key of `folder_revisions` already covers it.
