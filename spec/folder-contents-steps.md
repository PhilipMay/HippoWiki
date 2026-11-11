# Folder Contents – Steps

## Goal

A folder address lists everything in the folder in one list: first the pages placed directly in the folder, then its
tabs. A document icon marks a page and a folder icon marks a tab, so the user tells them apart at a glance without a
separate "Tabs" section.

## Scope

- In:
  - A document icon in front of every page in the page lists of folders and tabs.
  - One list "Contents" on the folder address with the folder's pages (by name) followed by its tabs (by name); the
    heading "Tabs" and the separate tab list go away.
  - An empty state on the folder address only when the folder has neither pages nor tabs.
  - Updating the end-to-end tests and the spec files to match.
- Not in:
  - Changes to the tab address beyond the page icon, to the "All pages" view, to the folder list at `/folders` or to
    the breadcrumbs.
  - Other orders (mixed by name, by update time), sorting or filtering controls.
  - Changes to queries, models, addresses, actions or the buttons of the folder header.
  - Deleting, dragging or reordering items.

## Checklist

- [x] Page icon
- [ ] One folder list
- [ ] Wrap-up

## Page icon

### Goal

Every page in a page list shows a document icon in front of its title, as tabs already show a folder icon, so the two
look alike in structure and differ only in their icon.

### Build

- `src/features/pages/components/PageListItem.tsx` (Server Component): one row of a page list, moved out of
  `PageList.tsx`: `ListItem` with `ListItemButton component={Link}` to `pagePath(folderName, tabName, page.name)`, a
  `ListItemIcon` with `DescriptionIcon` (`@mui/icons-material/Description`, decorative like the folder icon in
  `TabList.tsx`), and the existing `ListItemText` (title; `<name>.md · Updated <time>`). Props: `page: PageSummary`,
  `folderName`, `tabName`, `divider`.
- `PageList.tsx` renders its rows with `PageListItem`; its empty state and `aria-label="Pages"` stay as they are.

### Test

- End-to-end (`e2e/pages.spec.ts`, `e2e/tabs.spec.ts`): the page lists of a folder and of a tab still list title, name
  and update time and link to their pages (existing tests keep passing unchanged).
- Manual: on a folder and on a tab address the page rows show the document icon and the texts line up with the tab
  rows below them.

## One folder list

### Goal

The folder address shows its pages and tabs in one list, pages first and then tabs, each group ordered by name.

### Build

- `src/features/folders/components/FolderContentsList.tsx` (Server Component), replacing `TabList.tsx`:
  - Props: `folderName`, `pages: PageSummary[]` (pages placed directly in the folder, in display order),
    `tabs: TabSummary[]` (in display order).
  - One `Paper variant="outlined"` with one `List disablePadding aria-label="Contents"`: first a `PageListItem` per
    page (`tabName` `null`), then a row per tab with `FolderIcon`, the tab name and `Updated <time>`, linking to
    `tabPath(folderName, tab.name)`, as `TabList` does today. A divider separates every row from the next one,
    including the last page from the first tab; the last row has none.
  - With neither pages nor tabs it shows the empty state "This folder is empty" with "Create a page with “New page” or
    a tab with “New tab”." in the style of the empty state of `PageList`.
  - The tab row stays inline in this component; it is used nowhere else.
- `src/app/folders/[folder]/page.tsx`: render `FolderContentsList` with the results of `listFolderPages` and
  `listTabs` instead of `PageList`, the "Tabs" heading and `TabList`.
- Delete `src/features/folders/components/TabList.tsx`.
- The tab address keeps `PageList` with its own empty state "No pages yet".

### Test

- End-to-end, `e2e/tabs.spec.ts`:
  - Replace "the folder address lists its tabs by name below its pages …" with a test that a folder with pages and tabs
    shows exactly one list "Contents" in `main`, no heading "Tabs", pages by name before tabs by name (names chosen so
    that a mixed order would differ, e.g. page `zulu` and tab `alpha`), the links to the page and tab addresses, and the
    update times; a click on a tab opens the tab.
  - "a folder without tabs shows no tab list" becomes "a folder without tabs lists only its pages".
  - "a folder with tabs but without pages …" becomes "a folder with tabs but without pages lists only its tabs, without
    an empty state".
  - The page list on tab addresses keeps the list name "Pages".
- End-to-end, `e2e/pages.spec.ts`, `e2e/create-page.spec.ts`, `e2e/edit-page.spec.ts`, `e2e/move-page.spec.ts`,
  `e2e/folders.spec.ts`, `e2e/all-pages.spec.ts`: locators of the page list on a folder address use the list
  "Contents" instead of "Pages", and the empty state of an empty folder is "This folder is empty" instead of "No pages
  yet"; on tab addresses nothing changes.
- End-to-end: a folder with neither pages nor tabs shows the empty state and no list.
- Manual: on a narrow screen the combined list wraps long names without horizontal scrolling.

## Wrap-up

### Goal

The lasting content of this plan is in the spec files and the plan is removed.

### Build

1. `spec/content-structure.md`: in "Routes", describe the folder address with one list of its pages followed by its
   tabs, each page with a document icon, its title, name with `.md` and last update, each tab with a folder icon, its
   name and last update; the empty state only for a folder without pages and tabs. Mention the document icon for the
   page list of a tab. In "Lists and order", replace the separate page and tab lists of a folder with the combined
   list (pages by name, then tabs by name). Update the code paths if a component is named there.
2. `spec/roadmap.md`: nothing to remove; the feature was not on the roadmap.
3. `README.md`: tabs are no longer "listed like sub-folders below the folder's pages" but in one list with the pages,
   after them.
4. Delete `spec/folder-contents-steps.md`.
5. `CLAUDE.md`: remove the step file from the spec catalog.

### Test

- `npm run check`, `npm run test:integration`, `npm run test:e2e` and `npm run build` pass.
- The spec catalog in `CLAUDE.md` matches the files in `spec/`.
