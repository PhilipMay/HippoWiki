# Tab Deletion – Requirements

Status: approved

## Goal

A Manager or an Owner of a folder can delete a tab that is no longer needed or was created by mistake, so that the
structure of the folder stays tidy. The tab is removed for good; its pages are soft deleted like a single deleted page
and can be restored one by one from the deleted pages of the folder.

## Users and roles

- A Manager and an Owner of the folder may delete its tabs.
- A Reader and a Writer may not; they are not offered the deletion, and a submitted deletion changes nothing.
- An admin never reaches content and deletes no tab, as for every other content write.
- AI apps through MCP delete no tab: MCP has no Manager role.

## Scenarios

- A Manager created a tab `meetngs` by mistake and moved two pages into it. The Manager opens the tab, chooses
  "Delete", sees that the tab `meetngs` and its two pages will be deleted, and confirms. The tab is gone, and the two
  pages are listed under "Deleted pages" of the folder, from where they can be restored into another place.
- An Owner no longer needs the tab `archive`. The Owner deletes it with its pages. Later a page of it is needed again;
  a Manager restores that one page from "Deleted pages" into a place of the folder.

## Requirements

### Deleting a tab

- R1: A Manager and an Owner of a folder must be able to delete a tab of that folder after a confirmation.
  - Acceptance: a Manager and an Owner can delete a tab; after the confirmation the tab no longer exists.
- R2: The confirmation must name the tab and the number of pages that will be deleted with it.
  - Acceptance: the confirmation of a tab with three pages names the tab and says that three pages will be deleted
    with it; for a tab without pages it says that no page is deleted with it. The number is the one at the moment the
    dialog was opened (see R8).
- R3: Deleting a tab must remove the tab for good: it cannot be restored, and it does not appear among deleted items.
  - Acceptance: after the deletion the tab is missing from the folder, and nothing offers to restore it.
- R4: Every page of a deleted tab must be soft deleted, exactly as if it had been deleted on its own: it keeps its
  content and its folder, forgets its tab, and appears under "Deleted pages" of the folder, from where it can be
  restored one by one.
  - Acceptance: after deleting a tab with two pages, both pages are listed under "Deleted pages" of the folder and each
    can be restored into a place of the folder.

### Roles

- R5: A Reader, a Writer, an admin and a user without a role on the folder must not be able to delete a tab, and must
  not be offered the deletion.
  - Acceptance: none of them sees "Delete" on a tab; `?action=delete` on a tab shows them the not-found page; a
    submitted deletion changes nothing.

### Where it is offered

- R6: A Manager and an Owner must find "Delete" on the tab, next to "Rename"; it opens the "Delete tab" dialog at the
  tab address with `?action=delete`. Confirming must lead to the folder; cancelling and the Escape key lead back to the
  tab.
  - Acceptance: a Manager clicks "Delete" on a tab, sees the dialog at `/folders/<folder>/<tab>?action=delete`,
    confirms and lands on `/folders/<folder>`; "Cancel" and Escape lead to `/folders/<folder>/<tab>`.
- R7: The contents list of the folder must offer no deletion of its tabs.
  - Acceptance: the folder page shows no delete control next to its tabs.

### What is deleted

- R8: The deletion must remove the tab together with the pages that are in the tab at the moment of confirming. It
  must not be checked against changes since the dialog was opened: pages added to the tab meanwhile are deleted with
  it, pages moved out meanwhile are not, and pages edited meanwhile are deleted with their latest content.
  - Acceptance: a page created in the tab while the dialog is open is among the deleted pages after confirming; a page
    moved out of the tab meanwhile is not deleted.
- R9: Deleting must be all or nothing: either the tab and all its pages are deleted, or nothing changes.
  - Acceptance: when the deletion fails, the tab and all its pages are still there as before, and the dialog stays
    open with the message "The tab could not be deleted. Please try again.", like the other dialogs.
- R17: Confirming must delete the tab even when it was renamed while the dialog was open, together with its pages.
  - Acceptance: a tab renamed by another Manager after the dialog was opened is deleted on confirming.
- R18: A tab of any number of pages must be deletable; there is no limit.
  - Acceptance: a tab with several hundred pages is deleted with all its pages.
- R19: When the tab no longer exists on confirming, because it was deleted meanwhile, the dialog must stay open with
  the message that the tab no longer exists, offer only the way back to the folder, and change nothing.
  - Acceptance: two Managers open the dialog for the same tab; after the first confirms, the second sees the message
    on confirming, and no further page is deleted.
- R10: The name of a deleted tab must be free at once: a new tab of the same name can be created in the folder.
  - Acceptance: after deleting the tab `archive`, a Manager creates a new tab `archive` in the same folder.

### The deleted pages

- R11: Every page deleted with its tab must show the user who deleted the tab as its last editor and as the user who
  deleted it, with the time of the tab deletion.
  - Acceptance: after Anna deletes a tab, "Deleted pages" lists its pages as deleted by Anna at that time.
- R12: The deleted pages must show nothing about the tab they were in, and restoring one must ask for a place with
  none preselected, as for every deleted page.
  - Acceptance: "Deleted pages" and a deleted page of the tab show no tab name; the restore dialog has no place
    preselected.

### Others who are working in the tab

- R13: An editor or dialog that is still open on a page of the deleted tab must answer its save or confirmation with
  the message that the page no longer exists, and change nothing.
  - Acceptance: a Writer who opened the editor of a page before its tab was deleted gets "the page no longer exists"
    on saving.
- R14: For an AI app through MCP the deleted tab must be gone: it is missing from the list of the folder, and a read or
  write that names it gets the error that the tab does not exist.
  - Acceptance: after the deletion `list_folder` shows neither the tab nor its pages, and `create_page` into that tab
    is refused with the tab-does-not-exist error.

### The folder

- R15: Deleting a tab must leave the time of the last change and the last editor of the folder as they are.
  - Acceptance: the folder list shows the same time of the last change and last editor for the folder before and
    after a tab of it is deleted.

### Logging

- R16: Every deletion of a tab must be logged with the user who deleted it, the folder, the tab and the number of
  pages deleted with it; a refused deletion is logged like other refused content writes.
  - Acceptance: the log holds one line per tab deletion with these four pieces.

## Scope

- In: deleting a tab of a folder with all its pages, by a Manager or an Owner, in the browser.
- Not in:
  - restoring a deleted tab, and a list of deleted tabs
  - restoring all pages of a deleted tab at once: they are restored one by one
  - deleting folders
  - deleting tabs through MCP, which belongs to "Manager role for MCP" on the roadmap
  - removing the pages of a deleted tab for good, which stays with "Erasure and retention of deleted content" on the
    roadmap

## Effect on existing features

- `content-structure.md`: the limit "Folders and tabs cannot be deleted" changes; tabs can be deleted. The tab
  address gets the action `delete`, and the tab shows "Delete" next to "Rename" for a Manager.
- `page-deletion.md`: the limit "Folders and tabs cannot be deleted" changes; pages are also deleted together with
  their tab. The decision that `/deleted-pages` is named so that "deleted tabs and folders can get addresses there
  later" holds only for folders now.
- `folder-roles.md`: the table of functions gets "Delete a tab" for a Manager and an Owner. The decision that "Folders
  and tabs are never deleted", so that a missing tab is met only with a crafted request, no longer holds for tabs.
- `optimistic-locking.md`: the pages deleted with a tab are deleted without checking their version; their versions
  count up as with every delete.

## Decisions

- A tab is deleted for good instead of softly, because a tab holds no content of its own: its pages keep their content
  as deleted pages, and a new tab can be created at any time. Rejected: a soft delete of tabs with a list of deleted
  tabs and restoring them.
- The confirmation names the number of pages, so that the user sees how much goes with the tab. Rejected: typing the
  tab name to confirm, and a confirmation without the number of pages.
- "Delete" is offered on the tab only, like "Delete page" on the page, and leads to the folder. Rejected: a delete
  control next to each tab in the contents list of the folder.
- The deletion takes the pages that are in the tab when it is confirmed, without checking for changes since the
  dialog was opened: tabs have no version, renaming a tab is not checked either, and every page deleted this way can
  be restored. Rejected: refusing the deletion when the pages of the tab changed meanwhile.
- The deleted pages keep showing nothing about their former place, so that the rules of deleted pages do not change.
  Rejected: showing the name of the former tab.
- A renamed tab is still deleted, because the dialog refers to the tab and not to its name, like the deletion takes
  the pages that are there. Rejected: refusing the deletion after a rename.
- No limit on the number of pages: the pages are only marked as deleted. Rejected: a maximum number of pages.
- A tab deleted meanwhile is answered with a message in the dialog, like a page deleted meanwhile. Rejected: the
  not-found page, which does not tell the user why.
- Hard deletion is the lasting rule for tabs; the roadmap entries on soft deleting, listing and restoring deleted
  folders and tabs keep only the folders.

## Open questions
