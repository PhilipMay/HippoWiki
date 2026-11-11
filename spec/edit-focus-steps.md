# Edit Focus – Steps

## Goal

When a page is opened for editing, the cursor is in the content, where most edits happen, not in the slug. When a save
is rejected, the cursor moves to the field with the error, so it can be fixed right away.

## Scope

- In: initial focus of the edit form at `/pages/[slug]/edit` on the content field, with the caret at the start; after
  a save the server rejects with field errors, focus on the first field with an error (slug before content).
- Not in: the new-page form and its "Save page" dialog; errors shown only as a message above the form (page deleted
  in the meantime, save failed), which keep the focus where it is (the alert is announced via `role="alert"`); caret
  placement other than the start of the content; any other form or page.

## Checklist

- [x] Initial focus on content
- [x] Focus on the field with an error
- [ ] Wrap-up

## Initial focus on content

### Goal

Opening the edit form puts the cursor at the start of the content field instead of in the slug field.

### Build

- In `PageForm` (`src/features/pages/components/PageForm.tsx`), move `autoFocus` from the slug `TextField` to the
  content `TextField`. Leave the field order (slug, then content) as it is.
- Confirm in the browser that the caret is at the start of the content and the page stays scrolled to the top, both
  when the edit URL is opened directly and when "Edit" is clicked on the page view (client-side navigation).

### Test

- End-to-end (`e2e/edit-delete-page.spec.ts`): new test "the edit form starts with the cursor at the start of the
  content", which
  - opens a page, clicks "Edit" and expects Content to be focused and Slug not to be focused;
  - opens `/pages/<slug>/edit` directly and expects the same;
  - checks via `evaluate` that the content field's `selectionStart` and `selectionEnd` are `0`;
  - asserts `collectErrors()` stays empty.
- No unit tests: no pure logic changes.

## Focus on the field with an error

### Goal

After the server rejects a save with field errors, the first field with an error has the focus: the slug if it has an
error, otherwise the content.

### Build

- In `PageForm`, give both fields an `inputRef` (`useRef<HTMLInputElement>` for the slug,
  `useRef<HTMLTextAreaElement>` for the content).
- Add a `useEffect` that depends on `state` from `useActionState`: if `state.fieldErrors?.slug` is set, focus the slug;
  else if `state.fieldErrors?.content` is set, focus the content. Each submission returns a new state object, so a
  repeated rejection moves the focus again. The initial state `{}` and message-only states change nothing.
- Comment why the effect exists (field errors come back from the server action, not from a client event).

### Test

- End-to-end (`e2e/edit-delete-page.spec.ts`):
  - extend "a slug taken by another page shows an error at the field and keeps all values": Slug is focused;
  - extend "removing the title heading shows an error at the content field and keeps all values": Content is
    focused;
  - new test "with errors at slug and content, the slug gets the focus": slug `Bad Slug` and content longer than
    `CONTENT_MAX_LENGTH` (the test removes the field's `maxlength`, as a crafted request would); both fields are
    `aria-invalid`, Slug is focused. Content without a title heading cannot be used here: the title heading is only
    checked once the slug is valid, so it never errors together with the slug;
  - extend "saving a page that was deleted in the meantime shows an error and keeps the values": the focus is not
    moved to a field (Slug and Content are not focused).
- No unit tests: the logic lives in the component and is covered end to end.

## Wrap-up

### Goal

The focus behaviour is described in the lasting specs and this step file is gone.

### Build

1. `spec/pages.md`, route `/pages/[slug]/edit`: the form opens with the cursor at the start of the content; after a
   rejected save the first field with an error (slug before content) is focused. `architecture.md` "UI": add the
   convention that forms focus the field the user most likely edits first, and that a rejected save focuses the first
   field with an error.
2. `roadmap.md`: nothing to remove, the feature was not listed.
3. `README.md`: check the `/pages/<slug>/edit` entry; no change expected, since it lists no focus details.
4. Delete `spec/edit-focus-steps.md`.
5. `CLAUDE.md` spec catalog: remove the step file entry.

### Test

- `npm run check`, `npm run test:e2e` and `npm run build` pass.
- `CLAUDE.md` catalog matches the files in `spec/`.
