# History and Revisions

This document defines which changes HippoWiki tracks, who can see them and how a user reverts them. The tables are still
open, see [Known Limitations](known-limitations.md#next-steps). History and revert are available only on REST, see
[MCP](mcp.md#history-and-revert).

## Tracked Changes

| Entity      | Tracked changes                                                                 |
| ----------- | ------------------------------------------------------------------------------- |
| md_document | create, change of content, rename, move to another tab, delete, restore, revert |
| tab         | create, rename, delete, restore, change by a folder revert                      |
| folder      | create, rename, delete, restore, folder revert                                  |

- changes to [folder rights](entities.md#folder-right) are not tracked
- creating a folder adds one entry, which includes its default tab
- a delete or restore adds one revision on the deleted item only, and its children get none, because their rows do not change
- a change and its revision are written atomically, see [Transactions](architecture.md#cross-cutting-concerns)

## History Layers

- there are two histories, one per md_document and one per folder
- the history of a md_document holds its own revisions
- the history of a folder holds the changes of the folder and of all its tabs and md_documents, also of those deleted later
- a tab has no history of its own, so its changes appear in the history of its folder

## Revisions

- a revision is a full snapshot of the tracked fields of the item, so an earlier state needs no reconstruction
  - md_document: content, name, tab and deleted state
  - tab: name and deleted state
  - folder: name and deleted state
- a write that changes nothing adds no revision
- all revisions are kept, with no limit, and a delete never removes one. Erasure is open, see
  [Known Limitations](known-limitations.md#later)
- an entry in a history holds the kind of change, the item, its old and new name or tab, the time and the author
- the author is returned as user ID and user name, because non-admins can not turn an ID into a name
  - the author is never null, because users are never removed, and the name of a deleted user stays reserved
- a history list returns metadata only, and the content comes only when one revision is fetched
- paging is defined with the other lists, see [Known Limitations](known-limitations.md#next-steps)

## Order and Versions

- timestamps do not give commit order, see [Time](time.md), so revisions are ordered by number
- a md_document has a version, which grows with each of its revisions and orders its history
- a folder has a revision counter, which grows with each change in the folder and orders its history
  - a transaction that adds revisions increments the counter once, so a folder revert shows up as one number
  - the increment locks the folder row until the transaction ends, so writes within one folder wait for each other, and
    other folders are not affected
- the state of a folder at a number is, for each item, its latest revision up to that number

## Who Can See What

The [rights](auth-concept.md#rights-on-md_documents-tabs-and-folders) on the folder decide, and the current right applies to
all revisions, also to those from before the user got it:

- `read`: the history of a live md_document and of the folder, and the content of revisions of live md_documents
- `read`, for tabs and md_documents that are not live: their entries in the folder history, with metadata only
- `manage`: also the history of md_documents that are not live, and the content of their revisions
- admin: also the history of a deleted folder and the revisions in it, while every other user gets the same 404 as for a
  missing folder

The responses are defined in [Deleted Items](request-checks.md#deleted-items).

## Revert

- a revert needs the `manage` right on the folder, which admins have implicitly
- a revert never rewrites history: it adds new revisions by the reverting user, pointing at the target, so a revert can be
  reverted too
- a revert carries the version the user saw, the version of the md_document or the revision counter of the folder, and any
  other version gets `VersionConflictError`
  - a folder revert takes the lock on the folder row before it compares, so a concurrent change can not slip in between
- reverting to the state that is already current succeeds and adds no revision
- a revision that belongs to another item or folder gets the same 404 as a missing one
- the responses are defined in [Rejected Operations](request-checks.md#rejected-operations)

### MD Document Revert

- content, name and tab return to the state of the target revision
- a md_document that is not live gets 404, so it is restored first
- a target revision that records the deletion of the md_document is rejected, because delete is its own operation
- a target tab that is not live gets 404, so the tab is restored first
- a name that is taken in the target tab gets `NameConflictError`, and the live item has to be renamed or deleted first

### Folder Revert

The target is a number from the history of the folder. All tabs and md_documents of the folder return to their state at
that number:

- an item created after the target is soft deleted, so it stays in the deleted list and can be restored
- an item deleted after the target is restored
- an item that was deleted at the target stays deleted, or is deleted again
- only the own fields of each item are written, so nothing cascades, in line with
  [Deleting and Restoring Content](entity-rules.md#deleting-and-restoring-content)

A folder revert only changes what `manage` may change, so these stay as they are:

- the folder name: a folder rename stays visible in the history, but can never be reverted, because renaming a folder is an
  admin operation
- the deleted state of the folder: a deleted folder gets 404, and deleting and restoring a folder are admin operations
- the folder rights
- the default tab, which is never renamed or deleted

The revert itself:

- it runs in one transaction, all or nothing, and its size grows with the folder, which is accepted for now
- it adds one entry to the history of the folder and one revision per changed item, linked to that entry
- it gets no `NameConflictError`, because the items return to a state that was valid together
- the partial unique indexes can not be deferred, so a swap of two names has to free the names first, for example by setting
  `deleted_at` on the affected rows within the transaction
