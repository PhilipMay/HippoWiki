# Unchanged Renames – Steps

## Goal

Renaming a folder or a tab to the name it already has changes nothing, in the browser and through `rename_tab`, so
that the time of the last change, the last editor and the channel name only who really changed it. The "Rename folder"
and "Rename tab" dialogs keep "Save" disabled, and Enter submits nothing, while the name is the current one. The plan is
written from `spec/unchanged-renames-requirements.md` (R1 to R8).

## Scope

- In:
  - renaming a folder and a tab to its own name stores nothing, is answered as every rename is and is logged in a line
    of its own, in the browser and through MCP (R1, R2, R3, R5, R6, R7)
  - "Save" and the Enter key of the "Rename folder" and the "Rename tab" dialog while the name is unchanged (R4, R8)
- Not in:
  - moving or renaming a page to its own name and place, which keeps making the user its last editor and counting the
    version of the page up
  - the "New folder" and "New tab" dialogs, and the name field of pages
  - a check of folder and tab renames against changes meanwhile: the last save wins
  - a notice in the browser or a note in the result of `rename_tab` for an unchanged rename
  - an empty name: it differs from the current name, so "Save" is enabled and the server answers "Name is required" as
    today

## Checklist

- [ ] Store nothing for an unchanged rename
- [ ] Disable "Save" while the name is unchanged
- [ ] Wrap-up

## Store nothing for an unchanged rename

### Goal

`renameFolder()` and `renameTab()` of `src/features/folders/service.ts` store nothing when the name, once validated,
is the name stored at the moment of the save, and return the item as stored, so that the browser and `rename_tab`
answer as after every rename (R1, R2, R3, R5, R6, R7).

### Build

- In `renameFolder()` and `renameTab()`, keep the checks and their order: admin, actor, id, role, then the name with
  `folderInputSchema` or `tabInputSchema`, which removes the surrounding spaces (R2, R6). Only then compare.
- Compare in the write, with the stored name at that moment (R7): the update matches the item only when its stored name
  differs from the validated one (`name: { not: … }` next to the id). When no row matched, read the item by its id:
  - no item: `folder-not-found` or `tab-not-found`, logged as today;
  - an item with the validated name: an unchanged rename. Return the folder as `{ id, name }` and the tab as
    `StoredTab`, as stored, and log it with `logger.info` in a line of its own that names the item and the channel
    (`channelOf(actor)`), for example "folder not changed: name is the same" and "tab not changed: name is the same"
    (R5);
  - an item with another name, renamed by someone else between the update and the read: update it once more without
    the name condition, so that the last save wins as for every rename.
- A rename that is stored is logged as today; add the channel to the line "folder renamed", as "tab renamed" has it.
- Update the comments of both functions and the file comment where they say that every rename makes the actor the last
  editor.
- The actions in `src/features/folders/actions.ts` and the tool `rename_tab` in `src/features/mcp/tools.ts` need no
  change of their flow: an unchanged rename is a success and leads to the address of the item, and `rename_tab` returns
  its usual result for the current name (R3). Check that the comments there still hold.
- Replace the end-to-end test "saving the rename dialog with the unchanged name keeps the folder" in
  `e2e/folders.spec.ts`: from the next step on, "Save" is disabled for the unchanged name, so the browser tests of this
  step reach an unchanged rename through a rename meanwhile (see "Test"), which holds in both steps.

### Test

- Unit tests in `src/features/folders/service.test.ts`, for folders and tabs:
  - a rename to the stored name, also with surrounding spaces (" guides "), writes nothing but the conditional update,
    returns the item as stored and logs the line of an unchanged rename with the item and the channel, not "renamed"
    (R1, R2, R5);
  - a rename to another name is stored and logged as before, the folder line now with the channel;
  - an admin, a user without the role (for a tab a Writer), a malformed id and an invalid name are refused with the
    current name as with any other name, before the comparison and without a write (R6);
  - no row matched and no item: `folder-not-found` or `tab-not-found`;
  - no row matched and an item with another name: the update is repeated without the name condition and the rename is
    stored.
- Integration tests in `integration/folder-service.test.ts`, against the database:
  - a folder and a tab renamed to their own name, also with surrounding spaces, keep `updatedAt`, the last editor and
    the channel; the actor differs from the last editor and the channel from the stored one, so that a stored write
    would show (R1, R2);
  - a tab renamed through MCP to its own name keeps them as well (R1);
  - a tab renamed meanwhile from `guides` to `news` and then renamed to `news` by another user stores nothing and
    returns the tab `news` (R7);
  - a Writer renaming a tab, and an admin renaming a folder or tab, to the current name are refused as with any other
    name; a tab that does not exist gives `tab-not-found` also through MCP; nothing is stored (R6).
- End-to-end tests:
  - `e2e/folders.spec.ts`: an Owner opens "Rename folder" for `old-name`, the folder is renamed to `new-name` in the
    database meanwhile, the Owner types `new-name` and saves: the browser ends on `/folders/new-name` without a notice,
    and the folder list and the folder show the last editor, channel and time of the rename meanwhile, not the Owner
    (R1, R3, R7). This replaces the test "saving the rename dialog with the unchanged name keeps the folder".
  - `e2e/tabs.spec.ts`: the same for "Rename tab", from `guides` to `news` (the scenario of the requirements): the
    browser ends on the tab `news`, and the contents of the folder and the tab show the last editor of the rename
    meanwhile (R1, R3, R7).
  - `e2e/mcp.spec.ts`: `rename_tab` with the current name of a tab, and with it in surrounding spaces, returns the same
    result as a rename to a new name would, for the current name; the tab keeps its time, last editor and channel in
    `list_folder` and in the database (R1, R2, R3); `rename_tab` with the name of a tab that does not exist, as old and
    new name, is the usual tool error, and a Writer connection gets the usual refusal for the current name (R6).
- Run `e2e/folders.spec.ts`, `e2e/tabs.spec.ts`, `e2e/mcp.spec.ts` and `e2e/folder-roles.spec.ts`.
- The log line of an unchanged rename (R5) is checked by the unit tests; a manual check is not needed.

## Disable "Save" while the name is unchanged

### Goal

In the "Rename folder" and the "Rename tab" dialog, "Save" is disabled while the name in the field, without its
surrounding spaces, is the name the item had when the dialog was opened, and Enter in the field submits nothing then
(R4, R8). The "New folder" and "New tab" dialogs stay as they are.

### Build

- Give `NameDialog` (`src/features/folders/components/NameDialog.tsx`) an optional prop with the current name, which
  only the two rename dialogs pass (`src/app/folders/[folder]/page.tsx` and `src/app/folders/[folder]/[item]/page.tsx`);
  the dialogs of new items pass none and keep "Save" enabled for every name, also an empty one.
- With that prop, "Save" is disabled while `name.trim()` equals it, besides while pending and before hydration. The
  trim matches the server's `nameSchema`, so that the button and the server agree. The helper text of the field stays
  as it is, and no further text is shown (R4).
- Enter in the field must submit nothing while "Save" is disabled (R8). The submit button is the default button of the
  form through its `form` attribute, so a disabled default button blocks the implicit submission; check this in the
  end-to-end tests, and if the browser submits anyway, stop the submission in the form for the unchanged name.
- `e2e/hydration.spec.ts` checks that "Save" of the rename dialogs is disabled before hydration; with the unchanged
  name it now stays disabled after hydration as well. Keep that test meaningful: the read-only field still proves the
  lock, and the check of "Save" moves to a case where it is enabled after hydration, for example a changed name or the
  "New folder" dialog, which `e2e/hydration.spec.ts` may already cover.

### Test

- End-to-end tests in `e2e/folders.spec.ts` and `e2e/tabs.spec.ts`, for both rename dialogs:
  - the dialog opens with "Save" disabled; typing a different name enables it; typing the current name again disables
    it, also with surrounding spaces; the hint below the field is the same in each case (R4);
  - Enter in the field with the unchanged name leaves the dialog open, keeps the address with `?action=rename` and
    sends no save, so the item keeps its time and last editor; with a changed name, Enter saves and leads to the new
    address (R8);
  - an empty field enables "Save", and saving it shows "Name is required" as today (scope).
- The "New folder" and "New tab" dialogs keep "Save" enabled for an empty field (scope); an existing test may already
  cover this.
- The test of the previous step that reaches an unchanged rename through a rename meanwhile still passes: the dialog
  compares with the name it was opened with (R7).
- Run `e2e/folders.spec.ts`, `e2e/tabs.spec.ts` and `e2e/hydration.spec.ts`.
- Manual check: in the browser, open "Rename folder" and "Rename tab", and see "Save" disabled with the current name
  and enabled with another one.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs" in `step-plan-workflow.md`), or extend an
   existing feature spec, and move the rules and decisions of the requirements file that still hold into it; update
   `architecture.md`, `testing.md` or `tech.md` where conventions changed. For this feature, extend the existing specs
   instead of writing a new one:
   - `content-structure.md`: a rule for renames of folders and tabs to their own name (they store nothing, are checked
     like every rename with the comparison last, compare with the stored name, are answered as every rename and logged
     apart), in "Last editor" that such a rename is no edit, and that the rename dialogs disable "Save" and Enter while
     the name is unchanged; the decisions of the requirements file that hold (only folders and tabs, the comparison
     without surrounding spaces, the answer, the log line, the order of the checks, dialog against stored name, no
     extra text, Enter); the pointers to the tests.
   - `pages.md`, "Saves without a change": renaming a folder or tab to its own name no longer makes the user the last
     editor; moves and renames of pages stay as they are. Change the decision that rejected covering renames of folders
     and tabs for now, so that only moves and renames of pages are left out.
   - `mcp.md`: `rename_tab` with the current name changes nothing and returns its usual result.
2. Remove the feature from `roadmap.md`. It has no entry there; check that no other entry names it.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and the requirements file of the feature, if there is one.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file and the requirements file, and
   update the descriptions of `content-structure.md`, `pages.md` and `mcp.md` where they name what changed.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
