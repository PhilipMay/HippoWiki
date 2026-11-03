# Content

This document defines the rules for folders, tabs and md_documents. Who can do what is in [Rights](rights.md).

## Folders, Tabs and MD Documents

- a folder always has exactly one default tab
  - creating a folder also creates its default tab in the same transaction, named "" (empty string) (service)
  - `is_default` of a tab never changes after creation (service)
- `folder_id` of a tab never changes (service)
- a new md_document without an explicit tab is assigned to the default tab of its folder (service)

## Deleting and Restoring Content

Which response a deleted item gets is defined in [Deleted Items](request-checks.md#deleted-items).

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
- restoring an item whose parent is deleted is rejected, so the parent is restored first (service)
- writes use `WHERE deleted_at IS NULL` and a restore uses `WHERE deleted_at IS NOT NULL`, and a statement that changes
  no row gets `NotFoundError`, so a racing update or a second delete behaves correctly
  - a version mismatch is found before that, under the lock on the folder row, so it gets `VersionConflictError` and not
    this `NotFoundError`
- the rights on a deleted folder stay and apply again on restore, and changing them needs a restore first
- deleted content is never physically erased, see [Roadmap](roadmap.md#later)

## Names

- every name is required, and only the default tab has the name "" (empty string)
- folders, tabs other than the default tab, md_documents and users: `^[a-z0-9]+(-[a-z0-9]+)*$`, so lowercase ASCII words
  joined by single hyphens, within the [length limit](limits.md#limits-at-a-glance)
  - this also rules out a user who looks like the admin, such as `Admin` or a name with a lookalike character
- a create or rename request with the name "" is rejected for every entity, because PostgreSQL runs check constraints
  before unique indexes and a check violation would otherwise become a 500
- the name `admin` for a new user is rejected, because the admin exists whenever someone can authenticate
  - this is a fixed rule for the same reason, not an up-front duplicate check, so it does not conflict with the
    [layer rules](package-layout.md#layer-rules)

## Rejected Content Operations

These rules reject an operation, whatever the rights of the user. The last column names the row in the
[check order](request-checks.md#check-order).

| Rule                                                                                                | Domain error                              | REST | Check              |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---- | ------------------ |
| rename a default tab (service)                                                                      | `ForbiddenError`                          | 403  | Target rules       |
| delete a default tab (service)                                                                      | `ForbiddenError`                          | 403  | Target rules       |
| move a md_document to a tab in another folder (service)                                             | `NotFoundError`                           | 404  | Target lookup      |
| restore an item that is not deleted                                                                 | `NotFoundError`                           | 404  | Target lookup      |
| restore a md_document whose tab is deleted                                                          | `NotFoundError`                           | 404  | Target lookup      |
| move a tab or set `is_default`                                                                      | none, the request model has no such field | 422  | Schema validation  |
| update, rename or move a md_document without a version                                              | none, the request model requires it       | 422  | Schema validation  |
| update anything with no field to change                                                             | none, the request model requires one      | 422  | Schema validation  |
| create or rename anything with the name ""                                                          | `DomainValidationError`                   | 422  | Domain validation  |
| create or update a md_document with a `content_md` over the [maximum size](limits.md#document-size) | `DomainValidationError`                   | 422  | Domain validation  |
| update, rename or move with a version that is not current                                           | `VersionConflictError`                    | 409  | Conflicts: version |
| restore an item whose name is taken, so the live item has to be renamed or deleted first            | `NameConflictError`                       | 409  | Conflicts: name    |
