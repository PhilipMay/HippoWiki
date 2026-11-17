# Tab Deletion – Steps

## Goal

A Manager or an Owner of a folder deletes a tab that is no longer needed or was created by mistake, after a
confirmation that names the tab and the number of its pages. The tab is removed for good; its pages are soft deleted
like a single deleted page and can be restored one by one from the deleted pages of the folder. The requirements are
in `spec/tab-deletion-requirements.md`; their IDs are named below.

## Scope

- In: deleting a tab of a folder with all its pages, by a Manager or an Owner, in the browser: the service write, the
  function "Delete a tab" of the roles, the "Delete tab" dialog at the tab address with `?action=delete`, and the
  logging.
- Not in:
  - restoring a deleted tab, and a list of deleted tabs
  - restoring all pages of a deleted tab at once: they are restored one by one
  - deleting folders
  - deleting tabs through MCP, which belongs to "Manager role for MCP" on the roadmap
  - removing the pages of a deleted tab for good, which stays with "Erasure and retention of deleted content" on the
    roadmap
  - a delete control in the contents list of the folder (R7)
  - any change of the schema or a migration: the pages already have a soft delete, and a tab is removed as a row

## Checklist

- [x] Delete a tab in the service
- [x] Delete a tab in the browser
- [ ] Wrap-up

## Delete a tab in the service

### Goal

The folders service deletes a tab with all its pages in one all-or-nothing write, for a Manager and an Owner only, and
logs it. Covers the service side of R1, R3, R4, R5, R8, R9, R10, R11, R13, R14, R15, R16, R17, R18 and R19.

### Build

- `FUNCTION_ROLES` in `src/features/folder-roles/roles.ts` gets the function `deleteTab` with the lowest role
  `manager` (R5), with a comment like those of the other functions.
- `deleteTab(actor: BrowserActor, folderId: string, id: string)` in `src/features/folders/service.ts`, following
  `renameTab()`:
  - An admin gives `not-allowed`, logged, before anything else and without asking the database; a malformed actor id
    gives `failed`; a malformed folder or tab id gives `tab-not-found`.
  - The role is read on the given folder with `folderRoleOf()`, not with `roleOnFolderOfTab()`, and checked with
    `refusedByRole(…, "deleteTab", …)`: a Reader, a Writer and a user without a role get `not-allowed`, logged like the
    other refused content writes (R5, R16). A tab deleted meanwhile has no folder any more, so a role read through the
    tab would refuse a Manager instead of telling that the tab is gone (R19); with the folder of the route, a Manager
    learns that the tab is gone, and a user without a role is refused whether the tab exists or not.
  - One interactive transaction (`getDb().$transaction(async (tx) => ...)`), as "Database" in `architecture.md`
    describes:
    1. Lock the row of the tab in the given folder with `SELECT ... FOR UPDATE` and read the folder name. No row, also
       for a tab of another folder, gives `tab-not-found`, logged as not found (R19). The lock makes a concurrent create, move or restore of a page into
       this tab wait for the end of the transaction and then fail on the foreign key as a missing tab, so no page can
       slip into the tab between the update of its pages and the delete of the tab.
    2. Soft delete every page that is in the tab now, with one `updateMany` and one time for all of them: `deletedAt`
       set, `tabId` cleared, the actor as last editor, the version counted up, exactly as `deletePage()` does for one
       page (R4, R11). No version is checked (R8); a page added or edited meanwhile is taken as it is now, a page moved
       out meanwhile is no longer in the tab.
    3. Delete the tab row (R3, R10).
  - The tab is found by id, never by name, so a rename after the dialog was opened does not matter (R17). There is no
    limit on the number of pages (R18).
  - The folder is not written: its `updatedAt` and last editor stay as they are (R15).
  - Errors: a foreign key violation of the last editor gives `failed` through `unknownActor()`; every other error is
    logged and gives `failed`. Any error rolls the whole transaction back (R9).
  - On success it logs one info line `tab deleted` with the actor id, the folder id, the tab id and the number of
    pages deleted with it (R16), and returns the folder as stored (`{ id, name }`) and the number of deleted pages, so
    that the action can redirect to the folder by its stored name.
  - The error type `DeleteTabError` is `NotAllowed | TabNotFound | Failed`. The comment of the function says what it
    deletes, that the pages are soft deleted without a version check, and that the folder is not touched.
- Update the header comment of `src/features/folders/service.ts` where it speaks only of the writes that store a last
  editor of the folder or tab: a tab deletion stores the actor as the last editor of the deleted pages.

### Test

- Unit tests in `src/features/folders/service.test.ts`, with the mocked database as for `renameTab`: an admin is
  refused and logged without a database call; a malformed actor id gives `failed`; a malformed folder or tab id gives
  `tab-not-found`; the role is read on the given folder; the lowest role of `deleteTab` is Manager in "the lowest role of each function"; a Reader, a
  Writer and a user without a role get `not-allowed` and nothing is written; a missing locked row gives
  `tab-not-found`; a foreign key violation of the last editor gives `failed`; an unexpected error is logged and gives
  `failed`; a success logs `tab deleted` with actor, folder, tab and page count.
- `src/features/folder-roles/roles.test.ts`: `FUNCTION_ROLES` includes `deleteTab: "manager"`.
- Integration tests in `integration/folder-service.test.ts`, against the real database:
  - A Manager and an Owner delete a tab with two pages: the tab row is gone, both pages have `deletedAt` set, no tab,
    the actor as last editor, the same time of deletion and a version one higher; `listDeletedPages()` lists them
    with the actor as the user who deleted them (R1, R3, R4, R11).
  - A tab without pages is deleted and the result says zero pages.
  - A page placed directly in the folder, a page of another tab and an already deleted page of the folder are not
    touched (R8).
  - A Reader and a Writer get `not-allowed`, a user without a role and an admin as well; nothing changes (R5).
  - A tab that does not exist, one deleted before and one of another folder give `tab-not-found` and change nothing
    (R19); a user without a role on the given folder gets `not-allowed` also for a tab that is gone.
  - After a rename of the tab the deletion by id still deletes it with its pages (R17).
  - A tab of 300 pages is deleted with all its pages (R18).
  - After the deletion a new tab of the same name is created in the folder (R10).
  - The folder keeps its `updatedAt` and last editor (R15).
  - All or nothing (R9): when the delete of the tab row fails inside the transaction (for example through a trigger
    that the test creates on the table `Tab` to raise an error on delete, and drops afterwards), the result is
    `failed` and the tab and all its pages are as before, none of them deleted.
  - A concurrent write: a page created in the tab while another transaction holds the lock is either deleted with the
    tab or refused as `tab-not-found`, never left in a missing tab (R8). If this cannot be tested without timing
    tricks, check instead that the transaction locks the tab row before the update, and name it in the report.
  - After the deletion, the writes of a page of the deleted tab give `page-not-found`: `updatePageContent()`,
    `moveOrRenamePage()` and `deletePage()` with the version the page had before (R13).
  - Through MCP (the actor of a Writer connection): `listTabs()` and `listAllFolderPages()` show neither the tab nor its
    pages, and `createPage()` into the id of the deleted tab gives `tab-not-found` (R14).
- No end-to-end spec runs: nothing of the browser calls `deleteTab()` yet, and `roles.ts` only gains a function that no
  route offers. If the step changes anything a route uses, run the specs of that route.

## Delete a tab in the browser

### Goal

A Manager and an Owner find "Delete" on the tab, next to "Rename", confirm in the "Delete tab" dialog, which names the
tab and the number of its pages, and land on the folder. Covers R1, R2, R5, R6, R7, R9, R12, R13, R14 and R19 in the
browser, and checks R3, R4, R10, R11 and R17 end to end.

### Build

- A Server Action `deleteTab(folderId, id)` (the form submits no field, so it takes neither state nor form data) in `src/features/folders/actions.ts`, following
  `renameTab`: `requireUser()` first, a malformed id gives the "tab gone" state; it calls
  `folderService.deleteTab(inBrowser(user), folderId, id)` and maps the errors:
  - `not-allowed`: `notFound()` (R5)
  - `tab-not-found`: the message "This tab no longer exists." together with a flag that the tab is gone (R19)
  - `failed`: the message "The tab could not be deleted. Please try again." (R9)
  - On success: `revalidateContent()` and a redirect to the folder address built from the stored folder name (R6).
  - Its form state type lives in `src/features/folders/forms.ts`, like the other form types, without server-only
    imports. The form submits no field: there is no version to check (R8).
- A Client Component `DeleteTabDialog` in `src/features/folders/components/`, built like `DeletePageDialog`:
  `disablePortal`, open from the start, "Delete" locked until hydration and while pending, "Cancel" a link to the tab
  address, Escape back to the tab address (R6).
  - Title "Delete tab". The text names the tab and the number of pages that will be deleted with it, in singular,
    plural and zero ("no page is deleted with it"), and says that the pages can be restored one by one from the
    deleted pages of the folder, and that the tab itself cannot be restored (R2, R3).
  - The number of pages is the one the route read when it rendered the dialog (R2, R8).
  - When the action reports that the tab is gone, the dialog shows the message, hides "Delete" and "Cancel" and
    offers only a link back to the folder; Escape then leads to the folder as well (R19). The message of a failed
    deletion keeps the dialog as it was (R9).
- The tab route `src/app/folders/[folder]/[item]/page.tsx`:
  - `TAB_ACTIONS` gets `delete`, with the function `deleteTab` in `TAB_ACTION_FUNCTIONS`, so that the action shows a
    Reader, a Writer, a user without a role and an admin the not-found page, before the content is read (R5).
  - The tab shows "Delete" (outlined) next to "Rename" for the roles that may `deleteTab` (R6).
  - For `?action=delete` the route renders `DeleteTabDialog` on top of the tab with the number of pages of the tab
    from the list it already reads.
  - The comment of `TAB_ACTIONS` names the new action.
- The folder page and its contents list stay as they are: no delete control next to a tab (R7).

### Test

- Unit tests in `src/features/folders/actions.test.ts`, with the mocked service as for `renameTab`: a success
  revalidates and redirects to the stored folder name; `tab-not-found` and a malformed id give the gone state with
  the message; `failed` gives "The tab could not be deleted. Please try again."; `not-allowed` calls `notFound()`;
  without a logged-in user and for an admin, as in the existing blocks.
- A new end-to-end spec `e2e/delete-tab.spec.ts`:
  - A Manager opens a tab with two pages, clicks "Delete", sees the dialog at
    `/folders/<folder>/<tab>?action=delete` naming the tab and two pages, confirms and lands on `/folders/<folder>`;
    the tab is missing from the folder and its address shows the not-found page; "Deleted pages" lists both pages as
    deleted by the Manager, without a tab name, and nothing offers to restore the tab (R1, R2, R3, R4, R6, R11, R12).
  - An Owner deletes a tab in the same way (R1).
  - The dialog of a tab with one page and of a tab without pages says so (R2).
  - "Cancel" and the Escape key lead back to the tab, which keeps its pages (R6).
  - A page of the deleted tab is restored from "Deleted pages": the restore dialog has no place preselected, and the
    page is restored into another place of the folder (R4, R12).
  - After deleting `archive`, a new tab `archive` is created in the same folder (R10).
  - A page created in the tab while the dialog is open (in the test database) is deleted with it; a page moved out of
    the tab meanwhile is not (R8).
  - A tab renamed after the dialog was opened is deleted on confirming (R17).
  - Two dialogs of the same tab: after the first confirms, the second shows "This tab no longer exists." on
    confirming, with only the way back to the folder, and no further page is deleted (R19).
  - A Writer who opened the editor of a page of the tab before the tab was deleted gets "This page no longer exists."
    on saving, and nothing changes (R13).
  - The folder list shows the same time of the last change and last editor for the folder before and after (R15).
  - After the deletion in the browser, a Writer connection of MCP (a grant from `e2e/support/database.ts`, called with
    the `request` fixture as in `e2e/mcp.spec.ts`) lists neither the tab nor its pages with `list_folder`, and
    `create_page` into the tab is refused with the error that the tab does not exist (R14).
  - The folder page shows no delete control next to its tabs (R7).
- `e2e/folder-roles.spec.ts`:
  - A Reader and a Writer see no "Delete" on a tab, and `?action=delete` on a tab shows them the not-found page (R5).
  - A crafted form of the deletion by a Reader and by a Writer shows the not-found page and deletes nothing (R5).
  - "a Manager deletes, reads and restores a page, creates and renames a tab" also deletes a tab; the Owner is offered
    "Delete" on a tab.
- `e2e/access.spec.ts`: a tab with `?action=delete` among the addresses that lead to the login page without a login,
  and that show an admin the not-found page (R5).
- The specs that run: `e2e/delete-tab.spec.ts`, `e2e/tabs.spec.ts`, `e2e/folder-roles.spec.ts`, `e2e/access.spec.ts`,
  `e2e/deleted-pages.spec.ts`, `e2e/restore-page.spec.ts` and `e2e/hydration.spec.ts`.
- Manual check: the dialog in the browser, on a narrow screen and in the dark theme; a long tab name wraps.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs" in `step-plan-workflow.md`), or extend an
   existing feature spec, and move the rules and decisions of the requirements file that still hold into it; update
   `architecture.md`, `testing.md` or `tech.md` where conventions changed. For this feature, extend the existing
   specs instead of writing a new one, as "Effect on existing features" of the requirements says:
   - `content-structure.md`: deleting a tab (who, the confirmation with the number of pages, for good, its pages soft
     deleted without a version check, all or nothing, a renamed tab still deleted, the message for a tab deleted
     meanwhile, the name free at once, the folder untouched, the log line); the action `delete` in the table of
     actions; "Delete" next to "Rename" on the tab in "Routes"; the code and the tests (`deleteTab`,
     `DeleteTabDialog`, `e2e/delete-tab.spec.ts`); the decisions of the requirements; the limit "Folders and tabs
     cannot be deleted" becomes one about folders.
   - `page-deletion.md`: pages are also deleted together with their tab, with the user who deleted the tab as their
     last editor; the decision on `/deleted-pages` holds only for folders now; the limit "Folders and tabs cannot be
     deleted" changes.
   - `folder-roles.md`: "Delete a tab" for a Manager and an Owner in the table of functions; the decision that
     "Folders and tabs are never deleted" holds only for folders now.
   - `optimistic-locking.md`: the pages deleted with a tab are deleted without checking their version, and their
     versions count up as with every delete.
   - `mcp.md`, if it says that tabs are never deleted: a deleted tab is missing for MCP like one that never existed.
2. Remove the feature from `roadmap.md`: the entries on soft deleting, listing and restoring deleted folders and tabs
   keep only the folders.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and the requirements file of the feature, if there is one.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file and the requirements file, and
   update the descriptions of `content-structure.md`, `page-deletion.md` and `folder-roles.md`.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
- `spec/`, `README.md` and `CLAUDE.md` no longer say that tabs cannot be deleted.
