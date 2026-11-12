# Review of `page-deletion-steps.md`

## issue: The delete step depends on a list that is only built in the next step

- **Location:** `spec/page-deletion-steps.md`, sections "Checklist", "Deleting a page" and "Deleted pages list and
  view"
- **Severity:** Major
- **Category:** Correctness
- **Problem:** "Deleting a page" comes before "Deleted pages list and view". Yet its dialog says the page "can be
  restored later from the folder's deleted pages", and it calls `revalidatePath("/deleted-pages", "layout")` for routes
  that do not exist yet.
- **Impact:** After step 2 the app tells users about a list they cannot find. The delete step's end-to-end tests also
  cannot check that a deleted page shows up in its folder's deleted pages, which is the core promise of the feature.
  Nothing in the plan adds that check later.
- **Evidence:** "It names the page and says that it can be restored later from the folder's deleted pages."
- **Suggestion (required):** Swap the two steps, so the list and view come right after the data model. The list can be
  built and tested without a Delete button, because `createPage()` can already create deleted pages after step 1. Then
  add an end-to-end case to the delete step: the deleted page appears at the top of the folder's deleted pages.

## issue: Folder and tab actions do not refresh `/deleted-pages`

- **Location:** `spec/page-deletion-steps.md`, sections "Deleted pages list and view" and "Restoring a page";
  `src/features/folders/actions.ts`, function `revalidateFolders` (line 23)
- **Severity:** Major
- **Category:** Correctness
- **Problem:** `architecture.md` requires an action to call `revalidatePath` for every route it affects. The folder
  actions only refresh `/folders`. With the new prefix, three of them also affect `/deleted-pages`:
  - `renameFolder` changes every `/deleted-pages/<folder>/…` address.
  - `createTab` and `renameTab` change the places offered in the "Restore page" dialog.
- **Impact:** After renaming a folder, links and breadcrumbs under `/deleted-pages` that are still in the router cache
  can point to the old folder name. The restore dialog can show an outdated list of tabs. Neither problem shows up in
  the tests listed.
- **Evidence:** `revalidatePath("/folders", "layout");` is the only revalidation in `src/features/folders/actions.ts`.
- **Suggestion (required):** In "Deleted pages list and view", add a build item: one shared helper refreshes both
  `/folders` and `/deleted-pages`, and all folder and page actions use it. Add an end-to-end case: rename a folder,
  then open its deleted pages under the new name.

## suggestion: Delete and restore change "Last updated" without the plan saying so

- **Location:** `spec/page-deletion-steps.md`, sections "Deleting a page" and "Restoring a page"
- **Severity:** Minor
- **Category:** Docs
- **Problem:** `updatedAt` is `@updatedAt`, so Prisma sets it on every `updateMany`, including the delete and the
  restore. The plan says nothing about whether that is intended.
- **Impact:** A restored page shows the restore time as "Last updated", although its content did not change. That may
  be fine, since a move or rename does the same today, but it should be decided rather than happen by accident.
- **Suggestion (optional):** Add one sentence to "Restoring a page", either "`updatedAt` is set, as for a move" or
  "`updatedAt` keeps its value".

## nit: The breadcrumb of a deleted page leaves the name format open

- **Location:** `spec/page-deletion-steps.md`, section "Deleted pages list and view"
- **Severity:** Nit
- **Category:** Docs
- **Problem:** "followed by the page name" does not say whether that is `<name>` or `<name>.md`, the way live pages
  show it.
- **Evidence:** "a breadcrumb with the folder list, the folder and "Deleted pages", followed by the page name"
- **Suggestion (optional):** Use `<name>` without `.md`, since a deleted page has no `.md` address.

## nit: The browser tab of a deleted page looks like a live page

- **Location:** `spec/page-deletion-steps.md`, section "Deleted pages list and view"
- **Severity:** Nit
- **Category:** Readability
- **Problem:** The browser title is the stored title of the deleted page, the same as for the live page.
- **Evidence:** "Browser titles with `pageTitle()`: `Deleted pages – <folder>` and the stored title of the deleted
  page."
- **Suggestion (optional):** Use `Deleted: <title>`, so the tab shows it is a deleted copy.

## nit: Step 1's test says "the same place" for a page that has no place

- **Location:** `spec/page-deletion-steps.md`, section "Deleted pages in the data model", "Test"
- **Severity:** Nit
- **Category:** Docs
- **Problem:** The test speaks of creating a page "at the same place", but a deleted page has no place.
- **Evidence:** "a page of the same name can be created at the same place"
- **Suggestion (optional):** Write "directly in the folder".
