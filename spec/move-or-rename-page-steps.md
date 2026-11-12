# Move or Rename Page – Steps

## Goal

A page address has one button "Move or rename" instead of "Rename" and "Move". It opens one dialog in which the page's
name can be changed and its place within the folder chosen – directly in the folder or one of its tabs – and both are
saved together. The dialog shows the address the page will get.

## Scope

- In:
  - one Server Action that stores the name and the place of a page in a single database update
  - the "Move or rename page" dialog for `?action=move-or-rename` on page addresses: name field, radio list of places,
    the resulting address
  - the button "Move or rename" replacing "Rename" and "Move" on page addresses
  - removing the page actions `rename` and `move`, `renamePage`, `movePage`, `MovePageDialog` and the parse helpers
    only they use
- Not in:
  - moving a page to another folder
  - folders and tabs: they keep "Rename", `?action=rename` and the name dialog; `NameDialog` stays unchanged
  - redirects from old page addresses or from `?action=rename` and `?action=move` on pages; both show the not-found
    page
  - changing content or title while moving or renaming

## Checklist

- [x] Move-or-rename action
- [ ] Move-or-rename dialog
- [ ] Wrap-up

## Move-or-rename action

### Goal

The server can change the name and the place of a page in one save. `renamePage` and `movePage` stay in use until the
next step, so nothing visible changes yet.

### Build

- `src/features/pages/schema.ts`:
  - `PageMoveOrRenameFormState` (`fieldErrors?: { name?: string[] }`, `message?: string`) and
    `PageMoveOrRenameFormAction`.
  - `parsePageMoveOrRenameFormData(formData)`: the name checked with `nameSchema` (trimmed, a missing field counts as
    empty), the target read from `MOVE_TARGET_FIELD` as in `parsePageMoveFormData` (empty or missing: directly in the
    folder; a malformed tab id or a file is no target). Returns `{ name, tabId }`, or the name field errors and whether
    the target is invalid. Other fields, the content in particular, are ignored, so no content rule can block a save.
- `src/features/pages/actions.ts`: `moveOrRenamePage(id, prevState, formData)`, bound with
  `moveOrRenamePage.bind(null, id)`, following `renamePage` and `movePage`:
  - a malformed page id: "This page no longer exists."
  - invalid input: the name errors at the name field and, for an invalid target, "This tab no longer exists." above
    the form; nothing is written
  - one `updateMany` with `{ name, tabId }`, then `findPageAddress()`; the content is neither validated nor touched
  - a `PAGE_NAME` unique violation (either index): "Name is already in use" at the name field (`nameTakenState`); the
    page keeps its name and place
  - a foreign key violation (missing tab, tab of another folder): "This tab no longer exists."
  - a count of 0: "This page no longer exists."; any other error: "The page could not be saved. Please try again."
  - success: log "page moved or renamed" with page and tab id, `revalidateFolders()`, redirect to the stored address

### Test

- Unit, `src/features/pages/schema.test.ts`, `parsePageMoveOrRenameFormData`: name and tab id of the target; no tab
  for an empty or missing target; trimmed name; missing, empty or invalid name at the name field; malformed tab id and
  a file refused as target; invalid name and target reported together; content and other fields ignored.
- Unit, `src/features/pages/actions.test.ts`, `moveOrRenamePage`: malformed page id; invalid name and malformed target
  without a database call; one update with name and tab id only, redirect to the stored address (folder and tab);
  unique violation at the name field; foreign key violation; missing page; other database error.
- No end-to-end tests yet: no page uses the action. `PAGE_NAME` is already covered in `integration/db-errors.test.ts`.

## Move-or-rename dialog

### Goal

Page addresses show "Move or rename", which opens the new dialog. The old page buttons, actions and dialog are gone.

### Build

- New `src/features/pages/components/MoveOrRenamePageDialog.tsx` (client), built from `MovePageDialog` and
  `NameDialog`:
  - title "Move or rename page"; props `action`, `folderName`, `tabs`, `currentTabId`, `initialName`, `closeHref`
  - the name field as in `NameDialog` (label "Name", required, `NAME_MAX_LENGTH`, no spell check or auto
    capitalization, read-only until hydrated); its helper text is the name error or
    `Address: <pagePath(folderName, chosen tab name, name.trim())>`, as in `NewPageForm`
  - below it the radio group "Place" with "Directly in the folder" and `Tab <name>` per tab, the current place
    preselected, disabled until hydrated
  - name and place are controlled; the form calls the action from `onSubmit` with `startTransition`, as
    `MovePageDialog` does, so React's form reset does not put the radios back
  - the name field is focused once the dialog has entered, and again whenever a save returns name errors
  - a message above the form; "Cancel" and the Escape key lead to `closeHref`; "Save" disabled while saving and
    before hydration, "Saving…" while saving
- `src/features/pages/components/PageView.tsx`: `PAGE_ACTIONS` becomes `["edit", "move-or-rename"]`; one button "Move
  or rename" after "Edit" replaces "Rename" and "Move"; the folder's tabs are loaded for `move-or-rename`; the dialog
  gets `moveOrRenamePage.bind(null, page.id)`. Doc comments follow.
- Remove `MovePageDialog.tsx`, `renamePage`, `movePage`, `NAME_TAKEN_AT_TARGET_MESSAGE`, `MOVE_FAILED_MESSAGE`,
  `pageNameInputSchema`, `PageNameInput`, `parsePageNameFormData`, `parsePageMoveFormData`, `PageMoveFormState`,
  `PageMoveFormAction` and their unit tests; keep `MOVE_TARGET_FIELD`. Update comments that mention the rename or move
  dialog of pages (e.g. `pageContentInputSchema` in `schema.ts`).

### Test

- End-to-end: `e2e/move-page.spec.ts` becomes `e2e/move-or-rename-page.spec.ts`, and the page rename tests move there
  from `e2e/edit-page.spec.ts`:
  - "Move or rename" opens the dialog at `?action=move-or-rename` with the name prefilled and focused, the current
    place checked and the current address shown
  - the address follows the typed name and the chosen place
  - rename only, for a page in the folder and one in a tab: new address, title and content unchanged, the old address
    shows the not-found page
  - move only: folder into a tab, tab back to the folder, one tab to another
  - rename and move together: the page appears at its new address
  - a name taken at the target: "Name is already in use" at the name field, the field focused, the entered name and
    chosen place kept, the page unchanged in the database
  - an invalid name: the error at the name field, nothing written
  - a page whose content is above the limit can be moved and renamed
  - saving unchanged keeps the page where it is
  - "Cancel" and the Escape key return to the page and change nothing
  - a tab that no longer exists and a crafted tab of another folder show "This tab no longer exists."
  - a page that no longer exists shows "This page no longer exists."
  - a folder without tabs offers only the folder itself
  - the not-found page for `?action=rename` and `?action=move` on pages, `?action=move-or-rename` on folder and tab
    addresses, a repeated action and a missing page
- End-to-end: the lifecycle test in `e2e/edit-page.spec.ts` renames through "Move or rename"; the move-dialog test in
  `e2e/hydration.spec.ts` covers the new dialog (name read-only, radios and "Save" disabled, "Cancel" link).
- Unit: the tests of the removed functions are removed; `src/lib/addresses.test.ts` keeps its generic examples.
- Manual: on a narrow screen "Edit" and "Move or rename" fit; with many tabs the dialog scrolls and stays usable.

## Wrap-up

### Goal

The spec describes the feature as built, and the step plan is gone.

### Build

1. `spec/pages.md`: input rules (moving or renaming submits name and target), the buttons of the page address,
   `?action=move-or-rename` instead of `?action=rename` and `?action=move`, the limits. `spec/content-structure.md`:
   the actions table, the sentence on how pages are renamed and moved, "Changing the structure" (`moveOrRenamePage`,
   a taken name shows "Name is already in use" at the name field), "A rename or move changes the address".
2. `roadmap.md`: the feature is not listed there; nothing to remove.
3. `README.md`: the feature list ("create, edit and rename pages", "move a page within its folder") names moving or
   renaming in one dialog.
4. Delete `spec/move-or-rename-page-steps.md`.
5. Remove the step file from the spec catalog in `CLAUDE.md`.

### Test

- All checks pass. A search for `renamePage`, `movePage`, `MovePageDialog`, "Move page", "Rename page" and the page
  actions `rename` and `move` finds nothing left in `src/`, `e2e/`, `spec/` and `README.md`.
