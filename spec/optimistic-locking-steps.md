# Optimistic Locking – Steps

## Goal

Two users who change the same page at the same time no longer overwrite each other without noticing. A content save,
move, rename or delete of a page that is based on an older state of the page than the one stored is refused; the
editor or dialog is shown again with the page as stored and a message that names who changed it and when. The rule
lives in the page service, so that the later MCP write tools follow it unchanged.

Written from `spec/optimistic-locking-requirements.md` (status `approved`); the requirement IDs below refer to it.

## Scope

- In:
  - A version of every page that every stored change of the page counts up: creating it, a content save, a move or
    rename, a delete and a restore.
  - Refusing a content save (R1), a move or rename (R2) and a delete (R3) whose version is not the stored one, by any
    user and from any tab (R7, R10), and one that states no version (R14), in the page service for every caller (R6).
  - What the browser shows after a refused change: the editor or dialog again, at the page's current address, with
    the page as stored and the message that names the last editor and the time of the last change (R5, R8, R9, R12).
  - A change of a page deleted in the meantime gives today's message that the page no longer exists (R11).
  - Changes that nobody overtook work as before (R4); restoring is not checked (R13).
- Not in (as in the requirements):
  - Folders and tabs: renaming them keeps "the last save wins"; renaming a folder or a tab does not count as a change
    of its pages.
  - Creating pages, which a taken name already protects.
  - Merging two changes, a page history, showing who else is editing a page right now.
  - The MCP write tools themselves; the MCP read tools do not show the version yet.

## Design

These choices hold for all steps; the wrap-up moves the ones that last into the feature specs.

- The state of a page is an integer column `version` of `Page`, starting at 1 and counted up by every write of the
  page, in the same write that changes `updatedAt` and the last editor. Existing pages get 1. `updatedAt` is not used
  as the state: Prisma sets it from the clock of the app, which can jump back or differ between instances, and an
  exact time is more fragile to send back through a form field or an MCP call and compare than an integer. Rejected
  for the same reason: comparing `updatedAt`, which would have saved the migration.
- The service writes `updatePageContent`, `moveOrRenamePage` and `deletePage` take the version the change is based on
  as part of their input, always. The service parses it itself (a schema `pageVersionSchema` in
  `src/features/pages/schema.ts`: an integer of at least 1); a missing or malformed version (the input type allows
  `null`, so that the form adapter can pass on what it did not find) counts as a change based on an older state.
- The check is part of the write: the conditional `updateMany` matches the id, `deletedAt: null` and the version, and
  counts the version up. A count of 0 is then told apart by reading the page: deleted or missing gives
  `page-not-found` (R11), otherwise the new code `page-changed`, which carries the page as stored (`StoredPage`) so
  that the adapter can build its current address. A move to a taken name that is based on an older state gives
  `page-changed`, not `name-taken`, because the condition matches no row. The role is checked before, as today, so
  `page-changed` tells nothing to an actor without a role.
- The form adapters read the version from a hidden form field `version` (`VERSION_FIELD` in
  `src/features/pages/forms.ts`), with a parser that gives `null` for a missing or malformed value; that is no form
  error but goes to the service, which refuses it with `page-changed`, so that the action can show the current page
  (R14). The editor and the two dialogs submit the version of the page they were rendered with.
- An action maps `page-changed` to a redirect to the page's current address as stored, with its own action and the
  search parameter `notice=changed`, for example `/folders/team/plan.md?action=edit&notice=changed`
  (`pagePath(..., action, notice)` in `src/lib/addresses.ts`). It revalidates first, so that the address shows the
  stored page. The redirect serves every case alike, also the new address of R12.
- The page routes read `notice` with `parseChoice` and allow it only together with an action of the page; any other
  value, or a notice without an action, shows the not-found page. With `notice=changed` the editor or dialog shows the
  message of R9 above its fields, built from the last editor and the time of the last change as the page shows them
  (`formatDateTime` of `src/lib/format.ts`): "This page was changed by <name> at <time> after you opened it."
- The editor and the dialogs get a React `key` from the version of the page and the notice, so that they start anew
  with the stored page after the redirect instead of keeping the text and choices the user entered (R5, R8).
- Rejected: returning the current page in the form state without a redirect, because the address can have changed
  (R12) and a second path for the same refusal would differ from the first; a cookie for the notice, which is more
  code for a message that may show again on a reload.

## Checklist

- [x] Page versions
- [x] Refuse outdated content saves
- [ ] Refuse outdated moves and renames
- [ ] Refuse outdated deletes
- [ ] Wrap-up

## Page versions

### Goal

Every page has a version that every stored change of it counts up, and the page view reads it, so that the later
steps can submit and check it. Nothing the user sees changes yet.

### Build

- `prisma/schema.prisma`: the column `version Int @default(1)` of `Page`, with a comment that every write of the page
  counts it up together with `updatedAt` and the last editor. A migration created with
  `npm run db:migrate -- --name add_page_version`; existing pages get 1.
- `src/features/pages/service.ts`:
  - `updatePageContent`, `moveOrRenamePage`, `deletePage` and `restorePage` count the version up (`increment: 1`) in
    the write that sets the last editor; `createPage` stores the default.
  - `getPage` returns the version as part of `PageWithPlace`.
- `e2e/support/database.ts`: `createPage()` accepts `version` like any other field.
- Update the comments of the service and the schema that list what changes with `updatedAt`.

### Test

- Unit (`src/features/pages/service.test.ts`): every write of a page sends `version: { increment: 1 }` with its
  data; a create sends no version.
- Integration (`integration/page-service.test.ts`): a new page has version 1; a content save, a move or rename, a
  delete and a restore each count it up by one; a write that fails (name taken, tab not found) leaves it as it is;
  `getPage` returns it (`toStrictEqual` updated).
- End-to-end: the complete `npm run test:e2e`, because the step changes `prisma/schema.prisma` and its migrations;
  it passes unchanged (R4).

## Refuse outdated content saves

### Goal

Saving the content of a page is refused when the page was changed after the editor was opened, also by a rename or by
the same user in another tab, and the editor shows the page as stored with the message of R9, at its current address
(R1, R5, R6, R7, R9, R10, R11, R12, R14 for content saves).

### Build

- `src/features/pages/schema.ts`: `pageVersionSchema` and `parsePageVersion()`, which gives `null` for anything that is
  no version.
- `src/features/pages/service.ts`: `updatePageContent(actor, id, { content, version })` with the check of "Design"; the
  error type `PageChanged` (`{ code: "page-changed"; page: StoredPage }`) in `UpdatePageContentError`; a refusal is
  logged as a warning with the page id and the version given.
- `src/features/pages/forms.ts`: `VERSION_FIELD`, and `parsePageContentFormData` returns the version as well, `null`
  when it is missing or malformed.
- `src/lib/addresses.ts`: `pagePath` takes an optional notice after the action; the notice `changed` as a constant
  next to it.
- `src/features/pages/actions.ts`: `updatePageContent` passes the version to the service and maps `page-changed` to
  `revalidateContent()` and a redirect to the stored address with `edit` and the notice.
- The page routes (`src/app/folders/[folder]/[item]/page.tsx` and `src/app/folders/[folder]/[item]/[page]/page.tsx`)
  read the notice as "Design" says and pass it to `PageView`.
- `src/features/pages/components/PageView.tsx` builds the message of R9 for the notice and gives `PageForm` the
  version, the message and the `key` of "Design"; `src/features/pages/components/PageForm.tsx` submits the version in
  a hidden field and shows the message above the content field, as an alert of its own next to the error alert of
  the form state.
- Move `logInElsewhere()` from `e2e/folder-roles.spec.ts` into `e2e/support/auth.ts`, so that the specs of this
  feature log in a second user in a browser context of their own.

### Test

- Unit:
  - `src/features/pages/schema.test.ts`: `parsePageVersion()` accepts integers from 1 and refuses 0, negative and
    fractional numbers, text and `null`.
  - `src/features/pages/forms.test.ts`: the version is read from the form; a missing, empty, malformed or file value
    gives `null` and no field error.
  - `src/features/pages/service.test.ts`: the update matches the version; a count of 0 with the page stored gives
    `page-changed` with the stored page, without it `page-not-found`; a version of `null` or a malformed one writes
    nothing and gives `page-changed` (R6, R14); what is logged; invalid content is reported before the version.
  - `src/features/pages/actions.test.ts`: the version is passed on, also `null`; `page-changed` revalidates and
    redirects to the stored address with `?action=edit&notice=changed`.
  - `src/lib/addresses.test.ts`: `pagePath` with and without a notice.
- Integration (`integration/page-service.test.ts`): a save with the stored version is stored; one with an older
  version, without a version or with a malformed one changes nothing and gives `page-changed` with the page as stored;
  one based on the version from before a rename gives `page-changed` with the new name (R6, R7); one of a page deleted
  in the meantime gives `page-not-found` (R11).
- End-to-end (`e2e/edit-page.spec.ts`):
  - R1, R5, R9: alice and a second user with the role Writer, logged in with `logInElsewhere()`, open the editor of
    the same page; the second user saves; alice's save is refused, the editor holds the content of the second user,
    the message names the second user and the time the page shows, and the page keeps that content; saving again
    without a change is stored.
  - R10: alice opens the editor in two tabs, saves in the first, and the save in the second is refused.
  - R7, R12: alice opens the editor; the second user renames the page; alice's save is refused and the browser shows
    the editor at the new address with the message.
  - R11: alice opens the editor; the page is deleted; the save shows "This page no longer exists." as before.
  - R14: a save whose `version` field is removed in the form's `formdata` event is refused, changes nothing and
    shows the editor with the current page and the message.
  - The notice: `?notice=changed` without an action, with an unknown value or repeated shows the not-found page.
  - R4: the existing tests of the spec pass unchanged.
- End-to-end: the complete `npm run test:e2e`, because the step changes `e2e/support/`.
- Manual: the message reads well in the light and the dark theme and on a narrow screen.

## Refuse outdated moves and renames

### Goal

Moving or renaming a page is refused when the page was changed after the "Move or rename page" dialog was opened, and
the dialog stays open with the stored name and place and the message, at the current address (R2, R6, R7, R8, R9,
R11, R12, R14 for moves and renames).

### Build

- `src/features/pages/service.ts`: `moveOrRenamePage(actor, id, { name, tabId, version })` with the check of "Design"
  and `PageChanged` in `MoveOrRenamePageError`.
- `src/features/pages/forms.ts`: `parsePageMoveOrRenameFormData` returns the version.
- `src/features/pages/actions.ts`: `moveOrRenamePage` passes the version and maps `page-changed` to a redirect to the
  stored address with `move-or-rename` and the notice.
- `src/features/pages/components/PageView.tsx` and
  `src/features/pages/components/MoveOrRenamePageDialog.tsx`: the version in a hidden field, the message and the
  `key` of "Design".

### Test

- Unit:
  - `src/features/pages/forms.test.ts`: the version of the move or rename form, as for the content.
  - `src/features/pages/service.test.ts`: the update matches the version; `page-changed`, `page-not-found` and a
    version of `null` as for the content save; a stale version with a taken name gives `page-changed`.
  - `src/features/pages/actions.test.ts`: the version is passed on; `page-changed` redirects to the stored address
    with `?action=move-or-rename&notice=changed`.
- Integration (`integration/page-service.test.ts`): a move or rename with the stored version is stored; one with an
  older version, without a version or with a malformed one changes nothing and gives `page-changed`; one based on the
  version from before a content save is refused (R7); one of a deleted page gives `page-not-found`; one with an older
  version and a taken name gives `page-changed`.
- End-to-end (`e2e/move-or-rename-page.spec.ts`):
  - R2, R8, R9: alice opens the dialog; the second user saves a change of the content; alice's move is refused, the
    dialog stays open with the stored name and place and the message, and the page keeps its name and place; saving
    the dialog again moves the page.
  - R12: alice opens the dialog; the second user renames the page; alice's rename is refused and the dialog is shown
    at the new address with the new name.
  - R11: the page is deleted while the dialog is open; the save shows "This page no longer exists." as before.
  - R14: a save without the `version` field is refused, changes nothing and shows the dialog with the stored name and
    place and the message.
  - R4: the existing tests of the spec pass unchanged.
- End-to-end: also `e2e/edit-page.spec.ts` and `e2e/hydration.spec.ts`, because `PageView` and the dialog change.

## Refuse outdated deletes

### Goal

Deleting a page is refused when the page was changed after the "Delete page" dialog was opened; the dialog stays open
with the message, and confirming again deletes the page. Restoring stays as it is (R3, R6, R8, R9, R11, R12, R13, R14
for deletes).

### Build

- `src/features/pages/service.ts`: `deletePage(actor, id, { version })` with the check of "Design" inside its
  transaction, and `PageChanged` in `DeletePageError`. `restorePage` stays unchecked (R13).
- `src/features/pages/forms.ts`: `parsePageDeleteFormData`, which reads only the version.
- `src/features/pages/actions.ts`: `deletePage(id, _prevState, formData)` parses the form, passes the version and maps
  `page-changed` to a redirect to the stored address with `delete` and the notice.
- `src/features/pages/components/PageView.tsx` and `src/features/pages/components/DeletePageDialog.tsx`: the version
  in a hidden field, the message and the `key` of "Design".

### Test

- Unit:
  - `src/features/pages/forms.test.ts`: `parsePageDeleteFormData` reads the version, `null` when it is missing or
    malformed.
  - `src/features/pages/service.test.ts`: the delete matches the version; `page-changed`, `page-not-found` and a
    version of `null` as for the other writes; nothing is deleted on a refusal.
  - `src/features/pages/actions.test.ts`: the form is parsed and the version passed on; `page-changed` redirects to
    the stored address with `?action=delete&notice=changed`.
- Integration (`integration/page-service.test.ts`): a delete with the stored version deletes; one with an older
  version, without a version or with a malformed one deletes nothing and gives `page-changed`; one of a page deleted
  in the meantime gives `page-not-found`; a restore needs no version and counts the version up (R13).
- End-to-end (`e2e/delete-page.spec.ts`):
  - R3, R8, R9: a folder with alice as Manager and the second user as Writer; alice opens the dialog; the second user
    saves a change; alice's delete is refused, the dialog shows the message and the page is still at its address;
    confirming again deletes the page.
  - R12: the second user renames the page while the dialog is open; the delete is refused and the dialog is shown at
    the new address.
  - R11: two deletes of the same page; the second shows "This page no longer exists." as before.
  - R14: a delete without the `version` field is refused, deletes nothing and shows the dialog with the message.
  - R4: the existing tests of the spec pass unchanged.
- End-to-end (`e2e/restore-page.spec.ts`), R13: the existing tests pass unchanged; two Managers who restore the same
  page at once get today's message for the second restore (add the case if the spec lacks it).
- End-to-end: also `e2e/edit-page.spec.ts`, `e2e/move-or-rename-page.spec.ts` and `e2e/hydration.spec.ts`, because
  `PageView` changes.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs" in `step-plan-workflow.md`), or extend an
   existing feature spec, and move the rules and decisions of the requirements file that still hold into it; update
   `architecture.md`, `testing.md` or `tech.md` where conventions changed.
   - A new feature spec `spec/optimistic-locking.md`: the version of a page and what counts it up, which changes are
     refused and when, what the browser shows, the rule for callers other than the browser, restoring unchecked,
     editors and dialogs open over a deployment (R14), the decisions of the requirements and of "Design", and the
     current limits (folders and tabs, no merge, no history, no presence, the version not yet shown by MCP).
   - `pages.md`, `content-structure.md` (remove "no handling of concurrent changes" for pages from "Current limits";
     the version next to the last editor in "Last editor"; the notice in "Actions and views"), `page-deletion.md`
     (a delete can be refused, restoring is not) and `mcp.md` (the later write tools follow the rule) point to it.
   - `architecture.md`: the code `page-changed` among the codes of the content, the search parameter `notice` among
     the addresses that carry other search parameters, and the check of a version in the conditional write.
   - `testing.md`: `logInElsewhere()` among the helpers of `e2e/support/`, and `version` for `createPage()`.
2. Remove the feature from `roadmap.md`: the entry "Optimistic locking with versions"; "MCP write tools" keeps waiting
   for page history only.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and the requirements file of the feature, if there is one.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file and the requirements file.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
