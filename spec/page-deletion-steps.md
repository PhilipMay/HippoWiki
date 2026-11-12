# Page Deletion – Steps

## Goal

Pages you no longer need can be deleted without losing them: a deleted page disappears from the wiki, but each folder
lists its deleted pages, where they can be read and restored into the folder under a chosen name and place. The
behaviour is described from the user's point of view in `page-deletion.md`.

## Scope

- In:
  - a "Delete" button on every page with a confirmation dialog (`?action=delete` on the page address)
  - deleted pages disappear from the folder contents, the tab and "All pages"; their old address shows the not-found
    page; their name is free right away
  - a deleted page keeps its folder and forgets its place inside the folder
  - the list of the deleted pages of a folder at `/deleted-folders/<folder>`, reached by a "Deleted pages" button next
    to "All pages", newest first, with an empty state
  - a deleted page, read-only, at `/deleted-folders/<folder>/<id>`
  - the "Restore page" dialog at `/deleted-folders/<folder>/<id>?action=restore`: the old name prefilled, no
    preselected place, "Choose a place", "Name is already in use", the address shown once a place is chosen
- Not in:
  - deleting folders or tabs
  - removing a deleted page for good, emptying all deleted pages at once, automatic cleanup after some time
  - restoring a page into another folder
  - recording who deleted a page
  - an address `/deleted-folders` on its own; it shows the not-found page
  - editing, moving or renaming a deleted page other than by restoring it
  - redirects from the old address of a deleted page

## Checklist

- [ ] Deleted pages in the data model
- [ ] Deleting a page
- [ ] Deleted pages list and view
- [ ] Restoring a page
- [ ] Wrap-up

## Deleted pages in the data model

### Goal

The database can hold deleted pages. They are invisible in every list and at every page address, their names are free
at once, and no action changes them. There is no UI for deleting yet.

### Build

- `Page` in `prisma/schema.prisma` gets `deletedAt DateTime? @db.Timestamptz(3)`: `null` for a page that is not
  deleted, the time of deletion otherwise. A deleted page always has `tabId` `null`, because its place inside the
  folder is forgotten; `folderId` stays.
- The partial unique index on the names of pages placed directly in a folder covers only pages that are not deleted:
  `@@unique([folderId, name], where: { tabId: null, deletedAt: null })`. Deleted pages then never block a name, and two
  deleted pages of a folder may share one. `@@unique([tabId, name])` stays as it is, because deleted pages have no tab.
- The migration `soft_delete_pages`, with a directory name that sorts after `20261111120300_add_tabs` (see "Database"
  in `architecture.md`). Check the name of the changed index in the migration and keep `PAGE_NAME` in
  `src/lib/db-errors.ts` in sync with it.
- `src/features/pages/queries.ts`: `listFolderPages`, `listTabPages`, `listAllFolderPages` and `getPage` return only
  pages with `deletedAt: null`.
- `src/features/pages/actions.ts`: `updatePageContent`, `moveOrRenamePage` and `findPageAddress` only change or find
  pages with `deletedAt: null`; for a deleted page the actions show "This page no longer exists.", as for a missing one.
- `e2e/support/database.ts`: `createPage()` can create a deleted page by setting `deletedAt`; such a page has no tab.

### Test

- Unit: the page queries and the actions `updatePageContent` and `moveOrRenamePage` include `deletedAt: null` in their
  conditions; an action whose page is deleted returns "This page no longer exists.".
- Integration, `integration/queries.test.ts`: a deleted page of the folder is missing from `listFolderPages`,
  `listTabPages` and `listAllFolderPages`, and `getPage` returns `null` for its old name.
- Integration, `integration/db-errors.test.ts`: a deleted page does not block a page of the same name placed directly in
  the folder; two pages of the same name placed directly in the folder are still refused and recognised as `PAGE_NAME`.
- End-to-end: a deleted page set up with `createPage()` is missing from the folder contents, the tab and "All pages",
  and its old address shows the not-found page; a page of the same name can be created at the same place.

## Deleting a page

### Goal

A page can be deleted from its address after a short confirmation, and you land on the folder or tab it was in.

### Build

- The page address gets the action `delete` (`PAGE_ACTIONS` in `src/features/pages/components/PageView.tsx`) and a
  "Delete" button next to "Edit" and "Move or rename", a link to the page address with `?action=delete`.
- A "Delete page" dialog on top of the page, rendered by the route as described in "Addresses and actions" in
  `architecture.md` (`disablePortal`, its buttons disabled until hydration). It names the page and says that it can be
  restored later from the folder's deleted pages. "Delete" deletes the page; "Cancel" and the Escape key lead back to
  the page address without the query string. A failure shows a message in the dialog.
- The Server Action `deletePage` in `src/features/pages/actions.ts`, with the id bound:
  - It parses the id with `parsePageId`; a malformed id shows "This page no longer exists.".
  - In one transaction it reads the names of the page's folder and tab and sets `deletedAt` to the current time and
    `tabId` to `null` with `updateMany` where the page is not deleted. A count of 0 shows "This page no longer exists.".
  - It logs the event with the page id, calls `revalidatePath("/folders", "layout")` and
    `revalidatePath("/deleted-folders", "layout")` and redirects to the stored address of the folder or tab the page
    was in.
  - Any other database error is logged and shows "The page could not be deleted. Please try again.".

### Test

- Unit: `deletePage` for a malformed id, a page that no longer exists or is already deleted, a database error, and the
  redirect to the folder and to the tab on success.
- End-to-end:
  - deleting a page placed directly in a folder leads to the folder, deleting a page in a tab leads to the tab
  - the deleted page is gone from the folder contents, the tab and "All pages", and its old address shows the not-found
    page
  - a new page of the same name can be created at the same place right away
  - the dialog names the page; "Cancel" and the Escape key keep the page and lead back to its address
  - deleting a page that was deleted in the meantime shows "This page no longer exists."
- `e2e/hydration.spec.ts`: the buttons of the "Delete page" dialog are disabled until hydration.

## Deleted pages list and view

### Goal

Each folder lists its deleted pages, and a deleted page can be opened and read, but not edited.

### Build

- Addresses in `src/lib/addresses.ts`: `deletedPagesPath(folder)` for `/deleted-folders/<folder>` and
  `deletedPagePath(folder, id, action?)` for `/deleted-folders/<folder>/<id>`. Deleted pages are addressed by their id,
  because their names need not be unique.
- Queries in `src/features/pages/queries.ts`:
  - `listDeletedPages(folderId)`: the deleted pages of the folder with id, name, title and `deletedAt`, without their
    content, newest first.
  - `getDeletedPage(folderName, id)`, wrapped in `cache()`: the deleted page with the given id in the folder of that
    name, with its folder; `null` for a malformed name or id, a page of another folder or a page that is not deleted.
- Routes `src/app/deleted-folders/[folder]/page.tsx` and `src/app/deleted-folders/[folder]/[id]/page.tsx`. An unknown
  or malformed folder or id, a page of another folder, a page that is not deleted and any action or view show the
  not-found page (`parseAction`, `parseView`). There is no route for `/deleted-folders` itself.
- The folder address gets a "Deleted pages" button next to "All pages".
- The list: the breadcrumb `Folders › <folder> › Deleted pages`, the heading "Deleted pages", and the deleted pages of
  the folder with name, title and time of deletion (`formatDateTime`), newest first, each linking to the deleted page.
  It does not show where in the folder the pages were. A folder without deleted pages shows an empty state.
- The deleted page: a breadcrumb with the folder list, the folder and "Deleted pages", followed by the page name; the
  time of deletion; the rendered Markdown (`MarkdownContent`); no "Edit", "Move or rename" or "Delete".
- Browser titles with `pageTitle()`: `Deleted pages – <folder>` and the stored title of the deleted page.

### Test

- Unit: the address helpers; `listDeletedPages` and `getDeletedPage` await `connection()`, and malformed names and ids
  never reach the database.
- Integration, `integration/queries.test.ts`: `listDeletedPages` returns only the deleted pages of the folder, newest
  first; `getDeletedPage` finds a deleted page of the folder and returns `null` for a page that is not deleted and for
  a deleted page of another folder.
- End-to-end:
  - the "Deleted pages" button on the folder address leads to the list
  - the list shows name, title and time of deletion, newest first, only of this folder; the empty state
  - a deleted page can be opened and read and has no edit controls
  - the not-found page for an unknown folder, a malformed or unknown id, a page of another folder, a page that is not
    deleted, an action or view that the address does not have, and `/deleted-folders`

## Restoring a page

### Goal

A deleted page can be restored into its folder, under its old or a new name, at a place you choose; you land on its new
address.

### Build

- The deleted page address gets the action `restore` and a "Restore" button, a link to the address with
  `?action=restore`.
- A "Restore page" dialog on top of the deleted page, built like `MoveOrRenamePageDialog`: the name field and the
  places with `PageNameAndPlaceFields`, the old name prefilled and focused once the dialog has opened, its controls
  locked until hydration. No place is preselected: the shared fields get a state "no place chosen", in which no radio
  button is checked and the address line below the name is not shown; it appears once a place is chosen.
- The schema in `src/features/pages/schema.ts` gets a parser for the restore form: the name as for moving or renaming;
  a missing place shows "Choose a place" at the place field, an empty place is the folder itself, a tab id is that tab,
  and a malformed one shows "This tab no longer exists.". All errors are reported together.
- The Server Action `restorePage` in `src/features/pages/actions.ts`, with the id bound: `updateMany` where the page is
  deleted sets `deletedAt` to `null` and stores name and tab. The content is neither validated nor touched.
  - A taken name (`PAGE_NAME`) shows "Name is already in use" at the name field and focuses it; name and place are
    kept.
  - A tab that no longer exists or belongs to another folder (foreign key violation) shows "This tab no longer
    exists.".
  - A count of 0, for a page that no longer exists or is not deleted, shows "This page no longer exists.".
  - It logs the event, calls `revalidatePath("/folders", "layout")` and `revalidatePath("/deleted-folders", "layout")`
    and redirects to the new stored address of the page.

### Test

- Unit: the restore parser, including "Choose a place" for a missing place together with name errors; `restorePage`
  for a malformed id, a page that is not deleted or no longer exists, a taken name, a missing tab, a database error and
  the redirect on success.
- End-to-end:
  - restoring directly into the folder and into a tab, under the old and under a new name, leads to the new address
    and shows the content unchanged
  - the restored page is back in the folder contents or the tab and in "All pages", and gone from the deleted pages
  - saving without a place shows "Choose a place"
  - a name that is taken at the chosen place shows "Name is already in use" and keeps name and place
  - the address below the name appears once a place is chosen and follows name and place
  - "Cancel" and the Escape key lead back to the deleted page
- `e2e/hydration.spec.ts`: the name field is read-only and the places and "Save" are disabled until hydration.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (in the style of `pages.md`), or extend an existing feature
   spec; update `architecture.md`, `testing.md` or `tech.md` where conventions changed.
   - Rewrite `page-deletion.md` as the feature as built.
   - `pages.md`: the field `deletedAt`, the "Delete" button and the current limits.
   - `content-structure.md`: models and the unique index, the addresses under `/deleted-folders`, the actions `delete`
     and `restore`, routes, lists and current limits.
   - `architecture.md`: the prefix `/deleted-folders` next to `/folders` in "Addresses and actions".
2. Remove the feature from `roadmap.md`: narrow the candidates for soft delete, deleted item lists and restoring to
   folders and tabs.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file.

### Test

- The commands in "When a step is done" in `spec/workflow.md` pass.
