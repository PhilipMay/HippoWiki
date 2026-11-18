# Unchanged Moves and Roles – Steps

## Goal

A move or rename of a page to the name and place it already has, and a change of a role on a folder to the role the
user already has, store nothing: the page keeps its last editor, channel, time and version, so that editors and dialogs
other users have open on it are not refused for no reason, and the role stays as it is. The "Move or rename page"
dialog keeps "Save" disabled while nothing changed. Written from `spec/unchanged-moves-and-roles-requirements.md`.

## Scope

- In: moves and renames of pages to their own name and place, in the browser and through `move_or_rename_page` of MCP
  (R1, R2, R3, R6, R7, R8, R11); "Save" and Enter of the "Move or rename page" dialog (R4, R12, R13); changes of a role
  on a folder to the same role (R5, R9, R10).
- Not in: content saves, reverts and renames of folders and tabs, which already store nothing without a change;
  restoring a deleted page; creating pages, tabs and folders; giving and removing roles; a notice in the browser or a
  note in the result of `move_or_rename_page` for an unchanged move; an error for a change to the same role; any
  change of the database schema.

## Checklist

- [ ] Unchanged moves and renames of pages store nothing
- [ ] "Save" of the "Move or rename page" dialog is disabled while nothing changed
- [ ] Changes of a role to the same role store nothing
- [ ] Wrap-up

## Unchanged moves and renames of pages store nothing

### Goal

`moveOrRenamePage()` of the page service stores nothing when the validated name and the place are the ones the page has
stored, after all the checks of every move; the browser and `move_or_rename_page` answer as for every move (R1, R2, R3,
R6, R7, R8, R11).

### Build

- In `moveOrRenamePage()` of `src/features/pages/service.ts`, keep the checks and their order: admin, role, place, name
  (validated and trimmed by `pageNameInputSchema`), version. Make the comparison part of the write, so that it holds
  for the name and place stored at that moment, as `storeContentChange()` does for the content and `writeRename()` of
  `src/features/folders/service.ts` for names:
  - The `updateMany` matches only a page that is not deleted, has the given version and differs from the new name or
    the new place (`tabId`, with `null` for directly in the folder).
  - When it matched no row, read the page that is not deleted, has the given version and has exactly that name and
    place. If there is one, nothing is stored: return it as stored, with its last editor, channel, time and version,
    and log `page not changed: name and place are the same` with the page id and the channel. Otherwise refuse it as
    now with `refusedWrite()` (`page-changed` or `page-not-found`).
  - A stored move is logged as now with `page moved or renamed`.
- A place that is the page's own tab always exists, so an unchanged move never reaches the tab key; a tab of another
  folder or one that no longer exists differs from the stored place and is refused as now.
- Update the doc comments of `moveOrRenamePage()` in the service and in `src/features/pages/actions.ts`, and the comments
  of `lastEditedById` and `version` of `Page` in `prisma/schema.prisma` where they say that every move or rename counts
  as an edit or counts the version up. Only comments change in the schema; no migration.
- `src/features/pages/actions.ts` and `moveOrRenamePage()` of `src/features/mcp/tools.ts` need no change: an unchanged
  move returns the page as stored, so the browser leads to the page address without a notice and the tool returns the
  page with the version that was sent (R7). Check this in the tests.

### Test

- Unit, `src/features/pages/service.test.ts`: an unchanged move stores nothing and returns the page as stored, with the
  log line of its own; a name with surrounding spaces counts as the same (R11); an admin, a Reader, a malformed or
  missing tab, an invalid name, a missing or deleted page, a missing version and another version are refused as before
  also when name and place are unchanged (R6); a changed name or place is stored and logged as before.
- Unit, `src/features/mcp/tools.test.ts`: `move_or_rename_page` with the current name and tab returns the page with its
  tab, address and the version that was sent (R7).
- Integration, `integration/page-service.test.ts`, against the database: an unchanged move, in a tab and directly in the
  folder, keeps `lastEditedById`, `lastEditedVia`, `updatedAt` and `version`, and records no revision (R1); with
  " setup " as name likewise (R11); based on an older version it is refused with `page-changed` and changes nothing
  (R6); a content save based on the version read before the unchanged move succeeds (R3); a move that changes only the
  name or only the place is still stored and counts the version up.
- End-to-end, `e2e/move-or-rename-page.spec.ts`:
  - The test "saving the dialog unchanged keeps the page where it is" also checks that the page keeps its last editor,
    channel, time and version, and that the browser shows the page address without a notice (R1, R7). The next step
    disables "Save" there and changes the test to submit the form although "Save" is disabled.
  - User B opens the editor of a page, user A saves the dialog unchanged, user B saves the content without a refusal
    (R3).
  - An unchanged save based on an older version shows the dialog with the current name and place and the message who
    changed the page, how and when (R6).
- End-to-end, `e2e/mcp.spec.ts`: `move_or_rename_page` with the current name and tab, and with " setup " as name, keeps
  the page's last editor, channel, time and version and returns the version that was sent; the same call based on an
  older version gives the tool error that tells the agent to read the page again; from a Writer connection of a user
  who is now only a Reader of the folder it is refused as not allowed (R1, R2, R6, R7, R11).
- End-to-end, `e2e/folder-roles.spec.ts`: the crafted forms of a Reader include an unchanged move, which shows the
  not-found page and changes nothing (R6).
- Run also `e2e/edit-page.spec.ts` and `e2e/hydration.spec.ts`, which open the dialog.

## "Save" of the "Move or rename page" dialog is disabled while nothing changed

### Goal

The "Move or rename page" dialog keeps "Save" disabled, and Enter in the name field without effect, while the name
without its surrounding spaces and the chosen place are those the page had when the dialog was opened, also after a
refusal reloaded it (R4, R12, R13).

### Build

- In `src/features/pages/components/MoveOrRenamePageDialog.tsx`, derive `unchanged` from the state, as `NameDialog` of
  folders and tabs does: `name.trim()` equals `initialName` and the chosen place equals `currentTabId ?? FOLDER_TARGET`.
  Disable "Save" while it holds, next to `pending` and `!hydrated`. Explain the comparison in a comment: trimmed as the
  server trims the name, compared with the name and place the dialog was opened with, while the server compares with
  those stored at the moment of the save.
- Enter in the name field submits nothing while "Save" is disabled, because the form's default button is disabled; check
  that this holds for the form submitted by its own `onSubmit` handler, and guard `submit()` with `unchanged` only if it
  does not. No extra text: the name field keeps its address hint.
- After a refused move, the route renders the dialog again with the current page and a new `key`, so `initialName` and
  `currentTabId` are the current name and place and "Save" is disabled until the user changes one of them (R13). Check
  that nothing else is needed.

### Test

- End-to-end, `e2e/move-or-rename-page.spec.ts`:
  - The dialog opens with "Save" disabled; a new name enables it, the old name and the old name with spaces around it
    disable it again; another place enables it and the old place disables it again; Enter in the unchanged dialog sends
    no request and leaves it open; the name field keeps its address hint throughout; with an empty name "Save" is
    enabled and saving shows that a name is required; no console errors (R4, R12). Modelled on the test of the rename
    dialog of a folder in `e2e/folders.spec.ts`.
  - The test "saving the dialog unchanged keeps the page where it is" submits the form with `requestSubmit()` although
    "Save" is disabled, as a crafted request, and still shows that the page keeps its last editor, channel, time and
    version, and that the browser shows the page address without a notice (R1, R7).
  - The tests of a refused move check that "Save" is disabled after the refusal, that changing the name enables it and
    that saving then moves the page (R13).
- Adapt every end-to-end test that clicks "Save" in an unchanged dialog. Run `e2e/move-or-rename-page.spec.ts`,
  `e2e/edit-page.spec.ts`, `e2e/hydration.spec.ts` and `e2e/folder-roles.spec.ts`, which open the dialog.
- Manual: in the browser, the dialog opens with "Save" disabled and enables it once the name or place changes.

## Changes of a role to the same role store nothing

### Goal

A change of a user's role on a folder to the role the user already has passes the checks of every role change and then
stores nothing, is answered like every role change and is logged in a line of its own (R5, R9, R10).

### Build

- In `writeRole()` of `src/features/folder-roles/service.ts`, keep the checks in their order inside the transaction:
  admin, Owner of the folder, user with a role on the folder, last Owner (which never refuses a change of an Owner to
  Owner). Then, for a change whose new role is the stored role, write nothing and return a new outcome `unchanged` with
  the role and the folder name.
- Log the outcome `unchanged` as `role not changed: the role is the same` with the folder, the user, the role and the
  Owner, at level `info`; return the same `RoleChange` as a stored change. `role changed` and `role removed` stay for
  stored changes.
- Update the doc comments of `writeRole()` and `changeRole()`, which say that every change is logged.
- `src/features/folder-roles/actions.ts` and `FolderRoleList` need no change: the action answers as for every change.

### Test

- Unit, `src/features/folder-roles/service.test.ts`: a change to the same role writes nothing and returns the folder name
  and the role of the actor afterwards, with its log line; an admin, a Writer of the folder and a user without a role
  are refused as before for the same role too (R9); the only Owner changing the own role to Owner is no refusal and
  writes nothing.
- Integration, `integration/folder-role-service.test.ts`: after a change to the same role the role row keeps its role and
  its `updatedAt` (R5); a change to another role still updates both.
- End-to-end, `e2e/folder-roles.spec.ts`: an Owner sets the role of a user to the role the user has (by selecting the
  selected option, or with a crafted request if the select sends no change then); the Owner stays in the roles view
  without an error, and the role row keeps its role and `updatedAt` (R5, R10); a crafted change to the same role of a
  Manager or Writer changes nothing and shows the not-found page, as for any other role (R9).

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs" in `step-plan-workflow.md`), or extend an
   existing feature spec, and move the rules and decisions of the requirements file that still hold into it; update
   `architecture.md`, `testing.md` or `tech.md` where conventions changed. Here, no new feature spec:
   - `pages.md`, `content-structure.md` and `optimistic-locking.md`: a move or rename of a page to its own name and
     place stores nothing and is logged apart, after the checks of every move, with the name compared without its
     surrounding spaces; the "Move or rename page" dialog keeps "Save" disabled, and Enter without effect, while nothing
     changed, also after a refusal; remove the rule that such a move makes the user the last editor and counts the
     version up, and the decision that rejected covering it. Move the decisions of the requirements file there.
   - `mcp.md`: `move_or_rename_page` with the current name and place changes nothing and answers as every move.
   - `folder-roles.md`: a change to the same role is checked like every role change, stores nothing, is answered like
     one and is logged in a line of its own; the rule that every role change is logged holds for real changes. Move the
     decisions on roles there.
   - Check `page-history.md`, `architecture.md` and `testing.md` for statements about moves that count the version up or
     roles that are always written.
2. Remove the feature from `roadmap.md`. It has no entry there now; remove any item about unchanged moves or roles
   that was added meanwhile.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and the requirements file of the feature, if there is one.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file and the requirements file. Also
   update the entries of the feature specs changed in item 1 where they name the old behaviour.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
- A search of `spec/`, `README.md` and `CLAUDE.md` for "move", "rename" and "role changed" finds no statement that an
  unchanged move stores a change or that a change to the same role is written.
