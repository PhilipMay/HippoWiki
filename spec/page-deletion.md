# HippoWiki – Page Deletion

The soft delete of pages as built: deleting a page, the deleted pages of a folder and restoring a page. Code:
`src/features/pages/` (`deletePage`, `restorePage`, `listDeletedPages`, `getDeletedPage` and the components
`DeletePageDialog`, `DeletedPagesList`, `DeletedPageView`, `RestorePageDialog`), routes under `src/app/deleted-pages/`.
Pages themselves are described in `pages.md`, folders, tabs and addresses in `content-structure.md`.

## Model

- `Page.deletedAt` in `prisma/schema.prisma`: `null` for a page that is not deleted, the time of deletion otherwise.
- A deleted page keeps its row, its content and its folder (`folderId`); its tab (`tabId`) is set to `null`, because
  its place inside the folder is forgotten. The wiki only knows which folder a deleted page belongs to.
- The partial unique index on the names of pages placed directly in a folder covers only pages that are not deleted
  (`where: { tabId: null, deletedAt: null }`, migration `soft_delete_pages`). A deleted page never blocks a name, and
  two deleted pages of a folder may share one. The index on `(tabId, name)` never covers deleted pages, because they
  have no tab.

## Deleted pages are invisible

- The page lists (`listFolderPages`, `listTabPages`, `listAllFolderPages`) and `getPage` read only pages with
  `deletedAt: null`. A deleted page is missing from the folder contents, its former tab and "All pages".
- The old address of a deleted page shows the not-found page. There are no redirects.
- The name of a deleted page is free right away: a new page of the same name can be created at the same place.
- Editing, moving or renaming only changes pages that are not deleted (`updatePageContent`, `moveOrRenamePage`); for a
  deleted page they show "This page no longer exists.", as for a missing one.

## Deleting a page

- A page address has a "Delete" button next to "Edit" and "Move or rename", a link to `?action=delete`.
- `?action=delete` shows the "Delete page" dialog on top of the page. It names the page with `.md` and says that it can
  be restored later from the deleted pages of its folder. "Delete" is disabled until hydration; "Cancel" and the Escape
  key lead back to the page address.
- `deletePage` reads the folder and tab of the page and marks it deleted in one transaction: `updateMany` where the page
  is not deleted sets `deletedAt` to the current time, `tabId` to `null` and `updatedAt`. It redirects to the stored
  address of the folder or tab the page was in.
- A malformed id, a page that no longer exists and a page that was deleted in the meantime show "This page no longer
  exists." in the dialog; any other database error is logged and shows "The page could not be deleted. Please try
  again.".

## Deleted pages of a folder

- The folder address has a "Deleted pages" button next to "All pages".
- `/deleted-pages/<folder>`: the breadcrumb `Folders › <folder> › Deleted pages`, the heading "Deleted pages", and the
  deleted pages of the folder (`listDeletedPages`) in a table with name, title and the time of deletion, newest first,
  each name linking to the deleted page. The list does not show where in the folder the pages were. A folder without
  deleted pages shows the empty state "No deleted pages".
- `/deleted-pages/<folder>/<id>`: the deleted page (`getDeletedPage`), read-only. The breadcrumb links to the folder
  list, the folder and "Deleted pages", followed by the page name without `.md`, since a deleted page has no `.md`
  address. Below it the time of deletion and a "Restore" button, then the rendered Markdown. There is no "Edit",
  "Move or rename" or "Delete".
- Deleted pages are addressed by their id, because their names need not be unique.
- Browser titles: `Deleted pages – <folder>` and `Deleted: <title>`, so the tab shows that the page is a deleted copy.
- An unknown or malformed folder or id, a page of another folder, a page that is not deleted, any view, and any action
  other than `restore` on a deleted page show the not-found page. The list has no actions. `/deleted-pages` on its own
  has no route and shows the not-found page.

## Restoring a page

- `?action=restore` on a deleted page shows the "Restore page" dialog on top of it, built like the "Move or rename page"
  dialog with the shared `PageNameAndPlaceFields`: the name field, prefilled with the page's old name and focused once
  the dialog has opened, and the places "Directly in the folder" and `Tab <name>` for each tab of the folder. Its
  controls are locked until hydration.
- No place is preselected: no radio button is checked and the address line below the name is not shown; it appears once
  a place is chosen and follows name and place.
- The form is parsed by `parsePageRestoreFormData` in `src/features/pages/schema.ts`: the name as for moving or
  renaming; a missing place shows "Choose a place" at the place field, an empty place is the folder itself, a tab id is
  that tab, and a malformed one shows "This tab no longer exists.". All errors are reported together. The name field is
  focused when it has an error, otherwise the place field when it has one.
- `restorePage` restores the page with `updateMany` where the page is deleted: it sets `deletedAt` to `null` and stores
  name and tab; `updatedAt` is set as well. The content is neither validated nor touched. It redirects to the new stored
  address of the page.
  - A taken name at the chosen place shows "Name is already in use" at the name field and focuses it; name and place
    are kept.
  - A tab that no longer exists or belongs to another folder (foreign key violation) shows "This tab no longer
    exists.".
  - A malformed id, a page that no longer exists and a page that is not deleted show "This page no longer exists.".
  - Any other database error is logged and shows "The page could not be restored. Please try again.".
- "Cancel" and the Escape key lead back to the deleted page.

## Current limits

- Folders and tabs cannot be deleted.
- A deleted page cannot be removed for good; there is no emptying of all deleted pages and no automatic cleanup.
- A page is restored only into its own folder.
- Who deleted a page is not recorded.
- A deleted page cannot be edited, moved or renamed other than by restoring it.
