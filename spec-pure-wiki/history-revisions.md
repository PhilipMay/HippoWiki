# History and Revisions

This document defines which changes HippoWiki tracks and how a user reverts them. Who can see and revert what is in
[Rights on Folders](rights.md#rights-on-folders).

## Tracked Changes

| Entity      | Tracked changes                                                                 |
| ----------- | ------------------------------------------------------------------------------- |
| md_document | create, change of content, rename, move to another tab, delete, restore, revert |
| tab         | create, rename, delete, restore, change by a folder revert                      |
| folder      | create, rename, delete, restore, folder revert                                  |

- changes to folder rights are not tracked
- creating a folder adds one entry, which includes its default tab
- a delete or restore adds one revision on the deleted item only, and its children get none, because their rows do not
  change
- a change and its revision are written [atomically](architecture.md#transactions)

## History Layers

- there are two histories, one per md_document and one per folder
- the history of a md_document holds its own revisions
- the history of a folder holds the changes of the folder and of all its tabs and md_documents, also of those deleted
  later
- a tab has no history of its own, so its changes appear in the history of its folder

## Revisions

- a revision is a full snapshot of the tracked fields of the item, so an earlier state needs no reconstruction
  - md_document: content, name, tab and deleted state
  - tab: name and deleted state
  - folder: name and deleted state
- a write that changes nothing adds no revision
- all revisions are kept, with no limit, and a delete never removes one. Erasure is open, see
  [Roadmap](roadmap.md#later)
- an entry in a history holds the kind of change, its number, the time and the author
  - a normal entry has one revision, which gives the item and its old and new name or tab
  - a folder revert has one revision per changed item, so a history list shows its number, target and author, and its
    changed items come from a paged list of their own
- the author is returned as user ID and user name, see [Own Account](users.md#own-account)
  - the author is never null, because users are never removed, and the name of a deactivated user stays reserved
- a history list returns metadata only, and the content comes only when one revision is fetched
- history lists page like all other [lists](lists.md)

## Order and Versions

- timestamps do not give commit order, see [Time](time.md), so revisions are ordered by number
- a md_document has a version, which grows with each of its revisions and orders its history
- a folder has a revision counter, which grows with each change in the folder and orders its history
  - a transaction that adds revisions increments the counter once, so a folder revert shows up as one number
  - every write locks the folder row first, until the transaction ends, so writes within one folder wait for each other,
    and other folders are not affected
- the state of a folder at a number is, for each item, its latest revision up to that number

## Optimistic Locking

- a content update, rename or move of a md_document carries the version the client saw, and any other version than the
  current one is rejected
- reads and write results of a md_document return its version
- delete and restore do not check the version, because both can be undone and lose nothing. They still add a revision,
  so the version grows
- tabs and folders have no version of their own, so their renames stay last write wins

A write runs in this order, after the visibility and right checks of [Request Checks](request-checks.md#check-order):

1. Lock the folder row. The same order everywhere rules out a deadlock with a folder revert.
2. Read the item, its version and a target tab, so nothing can change them until the commit.
3. Compare the version, so a stale version gets the conflict even when the write would change nothing.
4. Stop without a revision if the write changes nothing.
5. Write the item, increment the counter and add the entry and its revision.

## Revert

- a revert never rewrites history: it adds new revisions by the reverting user, pointing at the target, so a revert can
  be reverted too
- a revert carries the version the user saw, the version of the md_document or the revision counter of the folder, and
  compares it under the lock on the folder row, see [Optimistic Locking](#optimistic-locking), so a concurrent change
  can not slip in between
- reverting to the state that is already current with the current version succeeds and adds no revision

### MD Document Revert

Content, name and tab return to the state of the target revision.

### Folder Revert

The target is a number from the history of the folder. All tabs and md_documents of the folder return to their state at
that number:

- an item created after the target is soft deleted, so it stays in the deleted list and can be restored
- an item deleted after the target is restored
- an item that was deleted at the target stays deleted, or is deleted again
  - it also gets the other fields it had at the target, with a revision if they differ from its current ones, so a later
    restore brings back that state
- only the own fields of each item are written, so nothing cascades, in line with
  [Deleting and Restoring Content](content.md#deleting-and-restoring-content)

A folder revert only changes what `manage` may change, so these stay as they are:

- the folder name: a folder rename stays visible in the history, but can never be reverted, because renaming a folder is
  an admin operation
- the deleted state of the folder: a deleted folder can not be reverted, and deleting and restoring a folder are admin
  operations
- the folder rights
- the default tab, which is never renamed or deleted

The revert itself:

- it runs in one transaction, all or nothing, and its size grows with the folder, which is accepted for now
- it adds one entry to the history of the folder and one revision per changed item, linked to that entry
- it gets no `NameConflictError`, because the items return to a state that was valid together

## Rejected Revert Operations

These rules reject an operation, whatever the rights of the user. The last column names the row in the
[check order](request-checks.md#check-order).

| Rule                                                                                                                | Domain error           | REST | Check              |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---- | ------------------ |
| revert a md_document to a revision that records its deletion, because delete is its own operation                   | `ForbiddenError`       | 403  | Target rules       |
| revert a md_document that is not live, which has to be restored first                                               | `NotFoundError`        | 404  | Target lookup      |
| revert to a revision of another item or folder, which is treated as a missing one                                   | `NotFoundError`        | 404  | Target lookup      |
| revert a md_document to a tab that is not live, which has to be restored first                                      | `NotFoundError`        | 404  | Target lookup      |
| revert a folder to a number that is not in its history, which is treated as a missing one                           | `NotFoundError`        | 404  | Target lookup      |
| revert with a version that is not the current one                                                                   | `VersionConflictError` | 409  | Conflicts: version |
| revert a md_document to a name that is taken in the target tab, so the live item has to be renamed or deleted first | `NameConflictError`    | 409  | Conflicts: name    |
