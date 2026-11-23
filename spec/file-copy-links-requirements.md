# File Copy Links – Requirements

Status: approved

## Goal

The details page of an image offers both texts a page can use for it, ready to copy: the embed `![[…]]`, which shows
the image in a page, and the wiki link `[[…]]`, which only links it. Today the page offers only the embed, under the
label "Link", so a user who wants to link an image without showing it has to remove the `!` by hand.

## Users and roles

- Every role of a folder (Reader, Writer, Manager, Owner) sees the details page of a file and its copy fields, as
  today. No role gains or loses anything.
- A user without a role on the folder sees the not-found page, as today.

## Scenarios

- A Writer wants to show a diagram in a page. They open the details page of `diagram.png`, copy the "Embed link"
  `![[diagram.png]]` and paste it into the page, which shows the image.
- A Writer wants to mention a screenshot in a list of sources without showing it. They open the details page of
  `screenshot.gif`, copy the "Wiki link" `[[screenshot.gif]]` and paste it into the page, which shows a link that opens
  the image in a new tab.
- A Reader opens the details page of `manual.pdf` in the tab `guides` and copies the "Wiki link" `[[guides/manual.pdf]]`
  to send it to a Writer.

## Requirements

### Copy fields of an image

- R1: The details page of an image (PNG, JPEG, GIF or WebP) must show two copy fields: first "Embed link" with
  `![[target]]`, then "Wiki link" with `[[target]]`.
  - Acceptance: the details page of `example.gif` placed directly in a folder shows a field labelled "Embed link" with
    the value `![[example.gif]]`, followed by a field labelled "Wiki link" with the value `[[example.gif]]`. No field is
    labelled "Link".
- R2: Each of the two fields must have a copy button of its own that copies exactly the text of its field.
  - Acceptance: "Copy" next to "Embed link" puts `![[example.gif]]` on the clipboard, "Copy" next to "Wiki link" puts
    `[[example.gif]]` on it. The buttons are announced as "Copy embed link" and "Copy wiki link". Each button shows
    "Copied" or "Copy failed" on its own, as the copy field does today.

### Copy field of a PDF

- R3: The details page of a PDF must show one copy field, labelled "Wiki link", with `[[target]]`, and no "Embed link".
  - Acceptance: the details page of `manual.pdf` shows a single field labelled "Wiki link" with the value
    `[[manual.pdf]]`, and its button is announced as "Copy wiki link".

### Target

- R4: The target in every copy field must name the file as the wiki links of the folder name it: its name with its
  extension, with the tab and a `/` before it when the file is in a tab, and no label.
  - Acceptance: an image `diagram.png` in the tab `guides` shows `![[guides/diagram.png]]` and
    `[[guides/diagram.png]]`; a PDF `manual.pdf` placed directly in the folder shows `[[manual.pdf]]`. After a move or
    rename the fields show the new target.

## Scope

- In: the copy fields of the details page of a file, for images and PDFs.
- Not in:
  - a hint text under the fields;
  - the view of a deleted file, which shows no copy field;
  - MCP: `read_file` returns no text to copy, and nothing changes there;
  - the editor, the picker on `[[` and how pages show links and embeds.

## Effect on existing features

- The details page of a file: the single field "Link" (`![[…]]` for an image, `[[…]]` for a PDF) is replaced by two
  fields for an image and by the field "Wiki link" for a PDF. This changes the rule of the details page in "The details
  page and versions" of `attachments.md` and in the description of the details page of a file in
  `content-structure.md`.
- Nothing else changes: links, embeds, their rendering, the index of links and the updates on a move or rename stay as
  they are.

## Decisions

- An image offers both the embed and the wiki link, so that a page can link an image without showing it, without
  editing the copied text. Rejected: only the embed, as today.
- The embed comes first, because showing is the more common use of an image.
- The field of a PDF is renamed from "Link" to "Wiki link", so that the same text has the same label on every details
  page. Rejected: keeping "Link" for PDFs, which would leave two labels for the same `[[…]]` text.
- A PDF gets no "Embed link", because `![[…]]` of a PDF is only a link (see "Links and embeds" in `attachments.md`).
- The fields have no hint text; their labels and values say what they do. Rejected: a line under each field.

## Open questions

- None.
