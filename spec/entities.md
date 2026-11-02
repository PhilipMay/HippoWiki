# Entities

This document defines the content rules and the database tables. Rules marked (service) can not be expressed by table
constraints, so the service layer enforces them. The rules for users and rights are in
[Users and Rights](users-and-rights.md), and the responses to rejected operations are in
[Rejected Operations](request-checks.md#rejected-operations).

| Entity               | Table                  | Notes                           |
| -------------------- | ---------------------- | ------------------------------- |
| md_document          | md_documents           | a Markdown document             |
| tab                  | tabs                   |                                 |
| folder               | folders                |                                 |
| user                 | users                  |                                 |
| folder_right         | folder_rights          | the right of a user on a folder |
| folder_history_entry | folder_history_entries | one numbered change in a folder |
| md_document_revision | md_document_revisions  | a snapshot of a md_document     |
| tab_revision         | tab_revisions          | a snapshot of a tab             |
| folder_revision      | folder_revisions       | a snapshot of a folder          |

## Folders, Tabs and MD Documents

- a folder always has exactly one default tab
  - creating a folder also creates its default tab in the same transaction, named "" (empty string) (service)
  - the default tab can not be deleted or renamed (service)
  - `is_default` of a tab never changes after creation (service)
- a tab can not be moved to another folder, so `folder_id` of a tab never changes (service)
- a new md_document without an explicit tab is assigned to the default tab of its folder (service)
- a md_document can only be moved to a tab in the same folder (service)

## Deleting and Restoring Content

Who can do this is defined in [Rights on Folders](users-and-rights.md#rights-on-folders) for md_documents and tabs, and
in [Admin Operations](users-and-rights.md#admin-operations) for folders. Which response a deleted item gets is defined
in [Deleted Items](request-checks.md#deleted-items).

- deleting a md_document, tab or folder sets its `deleted_at` and removes no row, so it can be restored (service)
- an item is live when it and all its parents have `deleted_at` null
- a tab or folder is deleted with its content: only its own row gets `deleted_at`, and the items in it are hidden
  through it (service)
  - there are no cascading writes, so restoring it brings back exactly what was visible before, and an item deleted
    earlier stays deleted
  - a create or move into a tab that is being deleted at the same time waits for the
    [lock on the folder row](history-revisions.md#optimistic-locking): after the delete it gets 404, and before it the
    item is hidden and comes back on restore
  - a deleted folder keeps its default tab, whose own `deleted_at` stays null, and the tab is hidden through the folder
- a deleted name can be used again, because the unique names apply only to live rows
- restoring an item whose name is taken is rejected, and the live item has to be renamed or deleted first
- restoring an item whose parent is deleted is rejected, so the parent is restored first (service)
- writes use `WHERE deleted_at IS NULL` and a restore uses `WHERE deleted_at IS NOT NULL`, and a statement that changes
  no row gets `NotFoundError`, so a racing update or a second delete behaves correctly
  - a version mismatch is found before that, under the
    [lock on the folder row](history-revisions.md#optimistic-locking), so it gets `VersionConflictError` and not this
    `NotFoundError`
- the rights on a deleted folder stay and apply again on restore, and changing them needs a restore first
- deleted content is never physically erased, see [Roadmap](roadmap.md#later)

## Names

- every name is required, and only the default tab has the name "" (empty string)
- folders, md_documents and users: `^[a-z0-9]+(-[a-z0-9]+)*$`, so lowercase ASCII words joined by single hyphens, with
  at most 100 characters
  - this also rules out a user who looks like the root admin, such as `Admin` or a name with a lookalike character
- tabs: at most 100 characters, no control characters and no leading or trailing whitespace, so a name of only spaces is
  not valid
- a create or rename request with the name "" is rejected for every entity, because PostgreSQL runs check constraints
  before unique indexes and a check violation would otherwise become a 500
- the name `admin` for a new user is rejected, because the root admin exists whenever someone can authenticate
  - this is a fixed rule for the same reason, not an up-front duplicate check, so it does not conflict with the
    [layer rules](architecture.md#layer-rules)

## Document Size

- `content_md` has at most 256 KiB (262,144 bytes) in UTF-8, and a document of exactly this size is accepted (service)
  - it counts bytes, not characters, because bytes bound both the storage and the
    [request body](authentication.md#request-body-limit)
- the size is checked only when a client sends `content_md`, so on a create and an update (service)
  - a rename, a move, a restore and a revert bring no new content and are not checked, so a limit lowered later can not
    block recovery or make a folder revert fail
- the value is fixed in the code, like the name lengths, and not a setting, because the request body limit and the
  reverse proxy depend on it
- there is no check constraint, so changing the value needs no migration

## Tables

Time columns such as `created_at` follow the rules in [Time](time.md).

IDs are UUIDv4. The services generate them with `uuid.uuid4()` and pass them to the repositories, so the real
repositories and the fakes behave the same. The root admin refers to itself, so it uses the same value for `id` and
`created_by`. UUIDv4 needs no new dependency and reveals nothing, while a UUIDv7 would put the host clock into stored
data, against [Time](time.md). A random ID is fine as a tie-breaker, which only needs to be stable.

Foreign keys have no `ON DELETE` action, because md_documents, tabs, folders and users are never removed. Only
`folder_rights` rows are physically deleted. So `created_by` and `assigned_by` are never null, and the root admin can
refer to itself because a foreign key is checked at the end of the statement.

The `name` columns of `md_documents`, `tabs`, `folders` and `users` use `COLLATE "C"`, because [lists](rest.md#lists)
are sorted by them, see [Implementation Notes](rest.md#implementation-notes).

### MD Document

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

### Tab

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

### Folder

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

### User

| Column           | Type                          | Notes                                                                      |
| ---------------- | ----------------------------- | -------------------------------------------------------------------------- |
| `id`             | uuid, PK                      |                                                                            |
| `name`           | text, not null, unique        | stays reserved after the user is deleted                                   |
| `auth_subject`   | text, unique                  | the `sub` claim of the linked Keycloak account, null when no one is linked |
| `is_admin`       | bool, not null, default false | Admin role                                                                 |
| `is_root`        | bool, not null, default false | true for the root admin                                                    |
| `created_by`     | uuid → users, not null        | the root admin is created by itself                                        |
| `created_at`     | timestamptz                   |                                                                            |
| `deactivated_at` | timestamptz                   | null while the user is active                                              |
| `deleted_at`     | timestamptz                   | null while the user is not deleted                                         |

- A check constraint `name <> ''` enforces that the name is not empty.
- A check constraint `auth_subject <> ''` enforces that a link is not empty. Null means that nobody can log in as this
  user, see [User Linking](authentication.md#user-linking). There is no issuer column, because there is one issuer.
- A check constraint `is_root = (name = 'admin')` enforces that the user named `admin` is the root admin and that no
  other user is. Together with the unique, not null name, this allows at most one root admin.
- A check constraint `NOT is_root OR is_admin` enforces that the root admin always has the admin role, also under
  concurrent transactions.
- A check constraint `NOT is_root OR (deactivated_at IS NULL AND deleted_at IS NULL)` enforces that the root admin is
  never deactivated or deleted, also under concurrent transactions.
- A check constraint `deleted_at IS NULL OR auth_subject IS NULL` enforces that a deleted user has no link, so nobody
  can log in as this user.

### Folder Right

The meaning of the rights is defined in [Users and Rights](users-and-rights.md).

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

### Folder History Entry

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

### Revisions

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
