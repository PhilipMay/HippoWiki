# Tabs as Folders – Steps

## Goal

A folder shows its tabs like sub-folders: a list with a folder icon per tab, below the pages placed directly in the
folder, instead of a navigation bar above them. Tabs, the list of all pages and pages are reached and left through
links and breadcrumbs, as in a file browser.

## Scope

- In:
  - On the folder address: the list "Tabs" below the page list, each tab with a folder icon, its name and its last
    update, linking to the tab; no list when the folder has no tabs.
  - "All pages" and "New tab" as buttons in the folder header, next to "Rename" and "New page".
  - On the tab address and the all-pages view: a breadcrumb instead of the folder heading and the navigation bar.
  - A breadcrumb component shared by tabs, the all-pages view and pages.
  - Removing the navigation bar (`FolderNav`).
  - The package `@mui/icons-material` for the folder icon.
- Not in:
  - Changes to addresses, actions, views, models, queries other than the selected fields of `listTabs`, or Server
    Actions.
  - A breadcrumb on the folder address and on `/folders`.
  - Icons in other lists (folders, pages, all pages).
  - A page count or the last page update per tab.
  - A tree or sidebar navigation.
  - Ordering tabs other than by name.

## Checklist

- [ ] Tab list on the folder address
- [ ] Breadcrumbs instead of the navigation bar
- [ ] Wrap-up

## Tab list on the folder address

### Goal

The folder address shows its tabs as a list of folders below its pages, and its header holds all of its buttons. The
navigation bar is no longer shown there.

### Build

- Add `@mui/icons-material` in its latest stable version that matches `@mui/material` 9. Extend the
  `no-restricted-imports` rule so that its barrel import `@mui/icons-material` is not allowed in `src/` either; icons
  are imported per path (`@mui/icons-material/Folder`).
- `listTabs()` in `src/features/folders/queries.ts` also selects `updatedAt`.
- New Server Component `TabList` in `src/features/folders/components/`, built like `FolderList`: an outlined `Paper`
  with a `List` labelled "Tabs", one `ListItemButton` per tab linking to `tabPath(folderName, tab.name)`, a
  `ListItemIcon` with the folder icon (decorative), the tab name as primary text and "Updated <time>" as secondary
  text. It renders nothing for an empty list.
- `src/app/folders/[folder]/page.tsx`, default view:
  - Header: the folder name as `h1`, buttons "Rename", "All pages" (`allPagesPath`), "New tab"
    (`folderPath(name, "new-tab")`) and "New page"; the buttons wrap on narrow screens instead of overflowing.
  - Below the header the page list, then, if the folder has tabs, an `h2` "Tabs" and the `TabList`.
  - No `FolderNav`.
- The all-pages view and the tab address keep `FolderNav` until the next step.

### Test

- E2E (`e2e/tabs.spec.ts`, `e2e/folders.spec.ts`):
  - The folder address lists its tabs by name below the page list, each linking to its tab and showing its last update
    (`time` with `datetime`); tabs of other folders are not listed.
  - A folder without tabs shows no "Tabs" heading and no tab list; a folder with tabs but without pages shows the
    empty page state and the tab list.
  - The header buttons "All pages", "New tab" and "New page" link to `?view=all`, `?action=new-tab` and `?action=new`.
  - Creating a tab through the dialog leads to the tab; the folder address then lists it.
  - Tests that read the navigation bar on the folder address read the tab list or the header buttons instead.
- Manual: the folder header at phone width wraps its buttons without horizontal scrolling.

## Breadcrumbs instead of the navigation bar

### Goal

The tab address and the list of all pages show the way back to their folder as a breadcrumb, like pages do, and the
navigation bar is gone.

### Build

- Turn `PageBreadcrumbs` into a shared `FolderBreadcrumbs` in `src/features/folders/components/`: links to the folder
  list, the folder and, if given, the tab, followed by the current entry as text with `aria-current="page"`. The page
  view passes `<page>.md` as current entry; its breadcrumb stays as it is.
- Tab address (`src/app/folders/[folder]/[item]/page.tsx`): the breadcrumb `Folders › <folder> › <tab>`, then the tab
  name as `h1` with "Rename" and "New page", then the page list. No folder heading, no navigation bar, no "New tab".
- All-pages view: the breadcrumb `Folders › <folder> › All pages`, the heading `h1` "All pages", then the table. No
  buttons.
- Delete `FolderNav`.
- Browser titles stay as they are (`<tab> – <folder>`, `All pages – <folder>`).

### Test

- E2E (`e2e/tabs.spec.ts`, `e2e/all-pages.spec.ts`, `e2e/pages.spec.ts` where they read headings or the navigation
  bar):
  - The tab address shows the breadcrumb `Folders`, `<folder>`, `<tab>` with links to `/folders` and the folder, the
    tab marked as current, and the tab name as `h1`; there is no navigation "Folder".
  - Renaming a tab shows the new name in the breadcrumb and the heading.
  - The all-pages view shows the breadcrumb `Folders`, `<folder>`, `All pages` and the heading "All pages"; the folder
    link leads back to the folder.
  - The breadcrumb of pages directly in a folder and in a tab is unchanged.
  - Assertions on `h1` `<folder>` at tab addresses and on the navigation bar are replaced.

## Wrap-up

### Goal

The lasting content of this plan lives in the other spec files, and the step file is gone.

### Build

1. `spec/content-structure.md`, "Routes": the folder address with its buttons, page list and tab list; the tab
   address and the all-pages view with breadcrumb and heading; remove the bullet on the navigation bar. `pages.md`:
   mention that the page breadcrumb is the shared folder breadcrumb if the wording needs it. `tech.md`: add
   `@mui/icons-material`. `architecture.md`: icons are imported per path; the lint rule forbids the barrel import.
2. `roadmap.md`: nothing to remove, the feature was not listed.
3. Bring `README.md` up to date if it describes the folder view.
4. Delete `spec/tabs-as-folders-steps.md`.
5. `CLAUDE.md`: remove the step file from the spec catalog.

### Test

- `npm run check`, `npm run test:integration`, `npm run test:e2e` and `npm run build` pass.
- The spec files describe the folder, tab and all-pages addresses as built, and no spec mentions the navigation bar.
