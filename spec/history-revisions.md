# History and Revisions

This document defines which changes HippoWiki tracks and how a user reverts them. The tables are in
[Entities](entities.md#folder-history-entry), who can see and revert what is in
[Rights on Folders](users-and-rights.md#rights-on-folders), and the responses are in
[Rejected Operations](request-checks.md#rejected-operations). History and revert are available only on REST, see
[MCP](mcp.md#history-and-revert).

## Tracked Changes

| Entity      | Tracked changes                                                                 |
| ----------- | ------------------------------------------------------------------------------- |
| md_document | create, change of content, rename, move to another tab, delete, restore, revert |
| tab         | create, rename, delete, restore, change by a folder revert                      |
| folder      | create, rename, delete, restore, folder revert                                  |

- changes to [folder rights](entities.md#folder-right) are not tracked
- creating a folder adds one entry, which includes its default tab
- a delete or restore adds one revision on the deleted item only, and its children get none, because their rows do not
  change
- a change and its revision are written atomically, see [Transactions](architecture.md#cross-cutting-concerns)

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
    changed items come when that entry is fetched
- the author is returned as user ID and user name, because non-admins can not turn an ID into a name
  - the author is never null, because users are never removed, and the name of a deleted user stays reserved
- a history list returns metadata only, and the content comes only when one revision is fetched
- paging is defined with the other lists, see [Roadmap](roadmap.md#next-steps)

## Order and Versions

- timestamps do not give commit order, see [Time](time.md), so revisions are ordered by number
- a md_document has a version, which grows with each of its revisions and orders its history
- a folder has a revision counter, which grows with each change in the folder and orders its history
  - a transaction that adds revisions increments the counter once, so a folder revert shows up as one number
  - every write locks the folder row first, until the transaction ends, so writes within one folder wait for each other,
    and other folders are not affected
- the state of a folder at a number is, for each item, its latest revision up to that number

## Optimistic Locking

- a content update, rename or move of a md_document carries the version the client saw, on REST and MCP, and any other
  version than the current one is rejected
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
- a revision that belongs to another item or folder is treated as a missing one, and so is a number that is not in the
  history of the folder

### MD Document Revert

- content, name and tab return to the state of the target revision
- a md_document that is not live has to be restored first, and so does a target tab that is not live
- a target revision that records the deletion of the md_document is rejected, because delete is its own operation
- a name that is taken in the target tab is rejected, and the live item has to be renamed or deleted first

### Folder Revert

The target is a number from the history of the folder. All tabs and md_documents of the folder return to their state at
that number:

- an item created after the target is soft deleted, so it stays in the deleted list and can be restored
- an item deleted after the target is restored
- an item that was deleted at the target stays deleted, or is deleted again
- only the own fields of each item are written, so nothing cascades, in line with
  [Deleting and Restoring Content](entities.md#deleting-and-restoring-content)

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

## Implementation Notes

- The lock on the folder row is `SELECT ... FOR NO KEY UPDATE`, because this lock mode does not block the foreign key
  checks of `folder_rights`.
- The partial unique indexes can not be deferred, so a swap of two names in a folder revert has to free the names first,
  for example by setting `deleted_at` on the affected rows within the transaction.
