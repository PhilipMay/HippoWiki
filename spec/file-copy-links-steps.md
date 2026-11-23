# File Copy Links – Steps

## Goal

The details page of an image offers both texts a page can use for it, each in a copy field with its own copy button:
the embed `![[…]]`, which shows the image, and the wiki link `[[…]]`, which only links it. The details page of a PDF
offers its `[[…]]` under the same label "Wiki link", so that the same text has the same label on every details page.
The plan is written from `spec/file-copy-links-requirements.md`.

## Scope

- In:
  - the copy fields of the details page of a file: "Embed link" then "Wiki link" for an image, "Wiki link" alone for a
    PDF (R1, R3);
  - a copy button of its own for each field, announced from the label of its field (R2);
  - the target in every field, the name of the file with its tab before it, as the wiki links of the folder name it
    (R4).
- Not in:
  - a hint text under the fields;
  - the view of a deleted file, which shows no copy field;
  - MCP: `read_file` returns no text to copy, and nothing changes there;
  - the editor, the picker on `[[` and how pages show links and embeds;
  - a change of `src/components/CopyField.tsx`, which already announces its button as "Copy" and the label in lower
    case, and keeps its own "Copied" or "Copy failed".

## Checklist

- [ ] Copy fields of the details page
- [ ] Wrap-up

## Copy fields of the details page

### Goal

The details page of an image shows "Embed link" and "Wiki link", the details page of a PDF shows "Wiki link", each
with the target of the file and a copy button of its own (R1–R4).

### Build

- `src/features/files/components/FileDetailsView.tsx`: replace `linkToCopy()` by a function that returns the copy
  fields of a file as pairs of label and value, in the order of the page: for an image `["Embed link", "![[target]]"]`
  then `["Wiki link", "[[target]]"]`, for a PDF only `["Wiki link", "[[target]]"]`. The target stays as it is computed
  today: the name with its extension, with the tab and a `/` before it for a file in a tab (R4). Render one
  `CopyField` per pair, in that order, where the single field "Link" is today, in a `Stack` of their own so that the
  two fields of an image stand together with a small gap between them.
- Update the doc comment of the component and of the function: "the link to copy" becomes the embed and the wiki link
  of an image, the wiki link of a PDF. Comments of the code and the tests name no requirement ID, so that the wrap-up
  changes only documentation.
- No other file of `src/` changes. The fields are only as current as the file the page reads, so the new target after
  a move or rename comes from the page loaded anew, as today.

### Test

- End to end, `e2e/file-details.spec.ts`:
  - The test of the details page of an image asserts, in place of the field "Link", the field "Embed link" with
    `![[guides/diagram.png]]` and the field "Wiki link" with `[[guides/diagram.png]]` (R1, R4), that the two
    textboxes of the main content after the table "Details" come in this order, and that no field is labelled "Link"
    (`getByLabel("Link", { exact: true })` has the count 0).
  - A new test of an image placed directly in the folder, `example.gif` made with `gifBytes()`, asserts "Embed link"
    `![[example.gif]]` followed by "Wiki link" `[[example.gif]]`, and no field "Link" (the acceptance of R1).
  - The test of the details page of a PDF asserts the single field "Wiki link" with `[[manual.pdf]]`, its button
    announced as "Copy wiki link", and neither a field "Embed link" nor a field "Link" (R3, R4).
  - The test of the copy button becomes a test of both buttons of an image, with the clipboard granted: "Copy embed
    link" shows "Copied" and puts `![[guides/diagram.png]]` on the clipboard while "Copy wiki link" still shows
    "Copy"; then "Copy wiki link" shows "Copied" and puts `[[guides/diagram.png]]` on it (R2).
  - A new test without the clipboard granted (see `testing.md`): "Copy wiki link" of an image shows "Copy failed",
    and "Copy embed link" still shows "Copy" (R2).
- End to end, `e2e/move-or-rename-file.spec.ts`, the fields after a move or rename (R4):
  - the test of the rename of `guides/diagram.png` to `network.png` asserts, on the details page it leads to, "Embed
    link" `![[guides/network.png]]` and "Wiki link" `[[guides/network.png]]`;
  - the test of the move of `guides/report.pdf` into the folder asserts "Wiki link" `[[report.pdf]]`.
- End to end, `e2e/hydration.spec.ts`: the case of the copy button of a PDF asserts the field "Wiki link" with
  `[[manual.pdf]]` and the button "Copy wiki link" disabled until hydration; it also loads the details page of an
  image and asserts that "Copy embed link" and "Copy wiki link" are both disabled.
- Search `e2e/` for every other use of the label "Link" of the details page or of the button "Copy link" of a file,
  and change it to the new labels.
- This step is the last one that changes anything but documentation, so it runs the complete `npm run test:e2e` in
  place of the specs it affects (see "The complete end-to-end suite" in `spec/step-plan-workflow.md`).
- Manual check: on the details page of an image in the browser, the two fields stand one above the other, each with
  its button, also at the width of a phone, and each button copies its own text.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Extend the feature specs with the copy fields as built, and move the rules and decisions of
   `spec/file-copy-links-requirements.md` that still hold into them:
   - `spec/attachments.md`, "The details page and versions": "the link to copy (`![[…]]` for an image, `[[…]]` for a
     PDF)" becomes the copy fields: "Embed link" with `![[…]]` then "Wiki link" with `[[…]]` for an image, only "Wiki
     link" for a PDF, each with a copy button of its own, the target named as the wiki links of the folder name the
     file (its name with its extension, with the tab and a `/` before it for a file in a tab).
   - `spec/attachments.md`, "Decisions": an image offers both the embed and the wiki link, so that a page can link an
     image without showing it, without editing the copied text, the embed first because showing is the more common
     use (rejected: only the embed); the field of a PDF is "Wiki link", so that the same text has the same label on
     every details page (rejected: keeping "Link" for PDFs); a PDF gets no "Embed link", because `![[…]]` of a PDF is
     only a link; no hint text under the fields (rejected: a line under each field).
   - `spec/content-structure.md`, the description of the details page of a file in "Routes": "the link to copy into a
     page (`![[…]]` for an image, `[[…]]` for a PDF)" becomes "the embed link `![[…]]` of an image and the wiki link
     `[[…]]` of every file to copy into a page", or words to the same effect, pointing to `attachments.md` for the
     rest.
   - `spec/testing.md`: only where its description of `e2e/file-details.spec.ts` or `e2e/hydration.spec.ts` names the
     single copy field; no convention changes.
2. `spec/roadmap.md` has no item for this feature; nothing is removed there.
3. Check that `README.md` has all the commands a developer needs, and that its summary of what the prototype can do
   still holds with two copy fields; no new command comes with this feature.
4. Delete this step file and `spec/file-copy-links-requirements.md`. The comments of the code and the tests name no
   requirement ID of this feature (see the first step); should one have slipped in, replace it by "The details page
   and versions" of `attachments.md`, which makes the wrap-up a change of more than documentation.
5. Update the spec catalog in `CLAUDE.md`: remove the entries of this step file and of
   `spec/file-copy-links-requirements.md`. The entries of `spec/attachments.md` and `spec/content-structure.md` keep
   their questions, which do not change.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. The wrap-up changes only documentation,
  so it runs `npm run check` (see "Changes to documentation only"); if it changes a comment of the code or the tests,
  it runs `npm run check:all` and the specs whose files it changed instead.
- `grep` finds no `file-copy-links` in `spec/`, `README.md` and `CLAUDE.md`, and no "the link to copy" in `spec/`.
