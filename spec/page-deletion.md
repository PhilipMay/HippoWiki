# HippoWiki – Page Deletion

The planned soft delete of pages, described from the user's point of view. It is not built yet; the implementation is
planned in a step file `spec/page-deletion-steps.md` (see `workflow.md`).

## Goal

Remove pages you no longer need without losing them: a deleted page disappears from the wiki but can be restored later.

## Deleting a page

- A page has a "Delete" button next to "Edit" and "Move or rename".
- A short confirmation names the page and says that it can be restored later from the folder's deleted pages.
- After deleting, you land on the folder or tab the page was in.
- The deleted page disappears from every list: the folder contents, the tab and "All pages".
- Its old address shows the not-found page, as after a rename today.
- Its name is free right away: a new page with the same name can be created at the same place.
- The page stays in its folder. The wiki remembers which folder a deleted page belongs to. This is what puts the page in
  that folder's "Deleted pages" view, and it can only be restored into that folder. Pages cannot be moved between
  folders today either.
- The place inside the folder is forgotten. The wiki does not remember whether the page was placed directly in the
  folder or in a tab, nor in which tab.

## Deleted pages

- Each folder has a "Deleted pages" view, reached by a button next to "All pages".
- It lists the deleted pages of this folder only, with name, title and the time of deletion, newest first. It does not
  show where in the folder they were.
- A deleted page can be opened and read, but not edited, to check it before restoring.
- A folder without deleted pages shows an empty state.

## Restoring a page

- Each deleted page has a "Restore" button. It opens a "Restore page" dialog like "Move or rename", with the name and
  the place.
- The name is filled in with the page's old name and can be changed.
- No place is preselected. You choose one inside the page's folder: "Directly in the folder" or one of the folder's
  tabs. Restoring without a place shows "Choose a place".
- Below the name, the dialog shows the address the page will get, once a place is chosen.
- A name that is taken at the chosen place shows "Name is already in use"; you choose another name or place.
- The restored page has its content unchanged, and you land on its new address.

## Not included

- Deleting folders or tabs.
- Removing a deleted page for good, or emptying all deleted pages at once.
- Automatic cleanup of deleted pages after some time.
- Restoring a page into another folder.
- Recording who deleted a page; this comes with users and login.

## Decisions

- Old address of a deleted page: shows the not-found page.
- Name of a deleted page: free right away.
- Folder of a deleted page: remembered. The page appears only in its folder's "Deleted pages" and is restored into that
  folder.
- Place inside the folder: forgotten when the page is deleted, and chosen again when it is restored.
