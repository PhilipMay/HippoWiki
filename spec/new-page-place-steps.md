# Place of a New Page – Steps

## Goal

The "Save page" dialog of a new page asks for the name and the place: "Directly in the folder" or one of the folder's
tabs, with the place the editor was opened for preselected. Name field and place choice are one component, shared by
the "Save page" and the "Move or rename page" dialog.

## Scope

- In: a shared component for the name field and the place choice; the place as a form field of `createPage` with the
  parsing `moveOrRenamePage` already uses; the place choice in the "Save page" dialog; the tabs of the folder loaded
  for the new page routes; the spec updates.
- Not in: placing a page in another folder; creating a tab from the dialog; a change to the editor's own "Cancel",
  which still leads back to the folder or tab the editor was opened for; merging the two dialogs into one component;
  changes to `NameDialog`.

## Checklist

- [x] Shared name and place fields
- [ ] Place in the create action
- [ ] Place choice in the "Save page" dialog
- [ ] Wrap-up

## Shared name and place fields

### Goal

The name field and the place choice of the "Move or rename page" dialog become a component of their own, without any
change in behaviour.

### Build

- New component `src/features/pages/components/PageNameAndPlaceFields.tsx`:
  - the controlled name `TextField` with the address below it (`pagePath`), the error at the field, `NAME_MAX_LENGTH`
    and the ref for the focus;
  - the "Place" `RadioGroup` with "Directly in the folder" and `Tab <name>` for each tab, named by the place field of
    `schema.ts`.
- Props: `folderName`, `tabs`, `name` and `onNameChange`, `place` and `onPlaceChange`, `nameError`, `nameRef` and
  `locked`. `locked` makes the name read-only and disables the places, for dialogs that render before hydration.
- The value of the place "directly in the folder" (`FOLDER_TARGET`) moves into the new component and is exported from
  there.
- `MoveOrRenamePageDialog` renders the new component. It keeps its dialog frame, its state, `useActionState` and the
  submission by `onSubmit` with `startTransition`.

### Test

- No new tests: the step changes no behaviour.
- `e2e/move-or-rename-page.spec.ts` and the "Move or rename page" case of `e2e/hydration.spec.ts` pass unchanged.

## Place in the create action

### Goal

`createPage` takes the place of the new page from the submitted form instead of a bound tab id. The visible behaviour
stays the same.

### Build

- `schema.ts`: `MOVE_TARGET_FIELD` becomes `PLACE_FIELD` and `parseMoveTarget` becomes `parsePlace`, as both forms use
  them now.
- `parseNewPageFormData` reads the place as well: on success name, content, title and `tabId`; on failure the field
  errors and whether the place is invalid.
- `createPage(folderId, prevState, formData)` no longer binds a tab id:
  - An invalid place returns "This tab no longer exists.", together with the field errors, if any.
  - The foreign key cases stay: a missing tab or a tab of another folder shows the tab message, otherwise the folder
    message.
- Both new page routes bind `createPage.bind(null, folder.id)`.
- `NewPageForm` gets the id of the tab the editor was opened for (`initialTabId`). Until the next step,
  `SavePageDialog` submits it in a hidden place field.

### Test

- Unit tests in `schema.test.ts` for the place of `parseNewPageFormData`:
  - an empty or missing place is the folder itself;
  - a well-formed tab id is that tab;
  - a malformed tab id or a file is invalid;
  - an invalid place is reported together with errors of name and content.
- `actions.test.ts`: the `createPage` cases use the new signature; new cases for an invalid place and for a place the
  foreign key refuses.
- `e2e/create-page.spec.ts`: a crafted request whose place is a tab of another folder shows "This tab no longer
  exists." in the open dialog, creates nothing and keeps the values. The place is changed in the form's `formdata`
  event (see `testing.md`).
- The existing tests that create pages in a folder and in a tab pass unchanged.

## Place choice in the "Save page" dialog

### Goal

The "Save page" dialog shows the places of the folder, preselects the place the editor was opened for and creates the
page in the chosen place.

### Build

- The routes for `?action=new` (`src/app/folders/[folder]/page.tsx` and `src/app/folders/[folder]/[item]/page.tsx`)
  load the tabs of the folder with `listTabs(folder.id)` and pass them to `NewPageForm`.
- `SavePageDialog` renders `PageNameAndPlaceFields`, not locked, as the dialog opens only after hydration. It keeps
  the chosen place in its state; the hidden place field goes away.
- `SavePageDialog` submits by `onSubmit` with `startTransition` instead of the form's `action`: React resets a form
  after its action, and that reset puts the radio buttons back to the initial choice, out of sync with the controlled
  one (as in `MoveOrRenamePageDialog`).
- Every opening of the dialog starts with the place the editor was opened for, as the dialog is mounted anew for every
  opening (`dialogKey`).

### Test

- New cases in `e2e/create-page.spec.ts`:
  - on a folder address "Directly in the folder" is preselected, on a tab address that tab;
  - choosing another tab, or the folder from a tab, changes the address below the name and creates the page there;
  - in a folder without tabs the dialog shows only "Directly in the folder";
  - a name in use at the chosen place shows "Name is already in use" and keeps name, place and content; the same name
    is free at another place;
  - cancelling the dialog and opening it again starts with the place the editor was opened for;
  - no console errors (`collectErrors()`).

## Wrap-up

### Goal

The lasting content of this plan is in the spec files, and the plan is removed.

### Build

1. `spec/pages.md`, "Routes": the "Save page" dialog asks for the name and the place. `spec/content-structure.md`,
   "Changing the structure": the place a page is created in is preselected in the "Save page" dialog, and any place
   of the folder can be chosen; the paragraph on moving pages mentions the shared fields. `spec/architecture.md`:
   `PageNameAndPlaceFields` next to the note on the shared `NameDialog`.
2. The feature is not in `roadmap.md`; nothing to remove.
3. Bring `README.md` up to date where needed.
4. Delete this step file.
5. Remove this step file from the spec catalog in `CLAUDE.md`.

### Test

- `npm run check`, `npm run test:integration`, `npm run test:e2e` and `npm run build` pass.
- The specs are read against the code.
