# HippoWiki – Attachments

Images and PDFs as built: users of a folder upload them as files of their own, directly into the folder or into a tab,
next to the pages, so that screenshots, diagrams and manuals live in the wiki. Pages show images with `![[…]]` and
link files with `[[…]]`; every file has an address that returns the file itself and a details page with its versions
and the actions on it. Files are moved, renamed, deleted and restored like pages, are found by their names in search,
and AI apps list them and read their details through MCP, download one with a short-lived signed link, and, with a
Writer or Manager connection, upload a new file or a new version with such a link.

Folders, tabs and their addresses are described in `content-structure.md`, the roles in `folder-roles.md`, the
links in `wiki-links.md`, the soft delete in `page-deletion.md`, the directory of the files in `container-image.md`.

Code:

- `src/features/files/`:
  - `types.ts`: the five types, their extensions, MIME types and the detection of a type from the content;
  - `derive.ts`: the name an upload suggests;
  - `store.ts`: the blobs on disk, their size limit and the free space;
  - `images.ts`: the processing of images with sharp;
  - `startup.ts`: the check of the directory at the start;
  - `schema.ts`, `service.ts`, `writes.ts` (the soft delete), `fields.ts`, `forms.ts`, `actions.ts`, `queries.ts`;
  - `http.ts`: the adapter of the file address and the upload address;
  - `file-query.ts`: what an address of a details page shows;
  - `components/`: the section "Files", the details page, a deleted file and the dialogs.
- The routes `src/app/files/[folder]/[...path]/route.ts` and `src/app/api/uploads/[folder]/[...path]/route.ts`; the
  details pages are dispatched by the routes of `src/app/folders/`.
- The name rule of files in `src/lib/name-limits.ts` and `src/lib/names.ts`, the settings in `src/lib/env.ts`, the
  limiter of the images in `src/lib/limiter.ts`.
- The links and embeds in `src/features/pages/wiki-link-target.ts`, `src/features/pages/markdown.ts`,
  `src/features/pages/wiki-links.ts` and `src/features/pages/links-service.ts`; the editor in
  `src/features/pages/editor/`; search in `src/features/search/file-names.ts`; MCP in `src/features/mcp/`.

Tests:

- unit: the tests in `src/features/files/`, `src/lib/names.test.ts`, `src/lib/env.test.ts`, `src/lib/limiter.test.ts`,
  and the tests of links, the editor, search and MCP next to their code; cost: `src/features/files/images.cost.test.ts`;
- integration: `integration/file-service.test.ts`, `integration/wiki-links-service.test.ts`,
  `integration/search-service.test.ts`, `integration/folder-service.test.ts` and the tests written from the spec alone,
  `integration/attachments.spec-tests.test.ts`;
- end to end: `e2e/files.spec.ts`, `e2e/upload-file.spec.ts`, `e2e/file-details.spec.ts`, `e2e/file-links.spec.ts`,
  `e2e/move-or-rename-file.spec.ts`, `e2e/delete-file.spec.ts`, `e2e/deleted-items.spec.ts`,
  `e2e/editor-wiki-links.spec.ts`, `e2e/search.spec.ts`, `e2e/mcp-read.spec.ts`, `e2e/mcp-search.spec.ts`,
  `e2e/mcp-manager.spec.ts`, `e2e/security-headers.spec.ts`, `e2e/access.spec.ts`, and the tests written from the spec
  alone, `e2e/attachments-spec-tests.spec.ts` and `e2e/mcp-attachments-spec-tests.spec.ts`;
- the smoke test of the container image (`scripts/image.sh`).

## Files as items

- A file is an item of its own, placed directly in a folder or in one tab of it, like a page, and not part of a page:
  it exists without any page that shows or links it, and a page that shows it can be deleted while the file stays.
- The types are PNG, JPEG, GIF, WebP and PDF, and no other. The type is detected from the first bytes of the content,
  never from the name or the type the browser claims; an image must also decode as an image of that type (see
  "Images"). Any other content, HTML or SVG named `.png` included, is refused with a message that names the accepted
  types, and nothing is stored.
- A file name is a name of the name rule of pages, a dot and the lowercase extension of its type: `png`, `jpg`, `gif`,
  `webp` or `pdf` (`FILE_NAME_PATTERN` in `src/lib/name-limits.ts`). A JPEG is always `.jpg`; `.jpeg`, upper case, a
  space and a second dot break the rule and are refused at the name field with the rule.
- The extension fixes the type of a file: a new version of another type is refused, and a rename keeps the extension.
- A name is unique among the files of its place; a file `setup.png` and a page `setup` sit side by side.
- The upload suggests the name from the name of the chosen file by the rule of page names: `Network Diagram (v2).PNG`
  gives `network-diagram-v2.png`, `photo.jpeg` gives `photo.jpg`. The user can change it before the upload is stored.

## Addresses and headers

- The file itself is at `/files/<folder>/<name.ext>` and `/files/<folder>/<tab>/<name.ext>`; `?version=<n>` returns an
  earlier version and `?download` sends the file as an attachment. The address answers only `GET` and `HEAD`, and no
  other query.
- The details page is at `/folders/<folder>/<name.ext>` and `/folders/<folder>/<tab>/<name.ext>` (see "Addresses" in
  `content-structure.md`).
- Both addresses answer only a logged-in user with a role on the folder, checked on every request, so that removing a
  role ends the access with the next request. Without a login the file address leads to the login page, as every
  other address of the app. The one exception is a `GET` or `HEAD` of the file address with a valid `token` of a signed
  link, which an AI app gets through MCP: it downloads the current version without a login for a few minutes and
  answers with `Cache-Control: private, no-store` (see `signed-file-links.md`).
- A user without a role, an admin, a missing or deleted file, a version that does not exist and a malformed address
  get the same answer, so that nobody learns from an address whether a file exists: the details page shows the
  not-found page, and the file address answers a plain 404, because no page of the app can run under the headers of
  the files.
- Every answer of the file address tells the browser to run nothing in it and to load nothing from it:
  `Content-Security-Policy: default-src 'none'; sandbox`, `X-Content-Type-Options: nosniff`,
  `Cross-Origin-Resource-Policy: same-origin`, `X-Frame-Options: DENY` and `Referrer-Policy: same-origin` (see "Security
  headers" in `architecture.md`). A file is served with the MIME type of the type detected at its upload,
  `Content-Disposition: inline` with its name (`attachment` with `?download`), `Cache-Control: private, no-cache` and
  its SHA-256 as `ETag`, answering a matching `If-None-Match` with 304, so that every view asks the server again.
- Files are served from the host of the wiki itself. Chrome shows a PDF in its viewer under `sandbox`.

## Storage and the operator

- The contents of files are kept in the directory of `HIPPOWIKI_FILES_DIR`, which the operator mounts into the
  container, as blobs named by their SHA-256 below `blobs/`, written through a temporary file in `tmp/` of the same
  directory (see "Configuration" and "What the environment has to provide" in `container-image.md`). The directory is
  backed up with the database, the database first.
- The same content is stored once: two uploads of the same bytes, in any folder, share one blob, and a revert writes
  no byte. Blobs are never removed, apart from the blob of a failed upload that no version holds.
- A file is at most 25 MiB by default; the operator sets another limit from 1 MiB to 1 GiB with
  `HIPPOWIKI_FILE_SIZE_LIMIT` (`FILE_SIZE_LIMIT` in `src/lib/env.ts`). A larger file is refused with a message that
  names the limit, and nothing of it is stored; the bytes are counted, whatever the request announced.
- An upload that does not fit on the disk is refused with a message and leaves no file and no part of one.
- Without the variable, or with a directory that is missing or that the server cannot write, the files are off: the
  wiki works, existing files are listed, their content is not sent, "Upload file" and "Upload new version" are not
  offered, every upload is refused, and the server logs one warning at its start.

## Uploading

- A Writer, a Manager and an Owner upload a file with "Upload file" in the view of a folder or a tab, into that place
  (see "Routes" in `content-structure.md`). The page editor uploads nothing: a pasted or dropped file changes nothing,
  and its toolbar has no upload button.
- The browser sends the file itself as the body of a `POST` to `/api/uploads/<folder>/[<tab>/]<name.ext>`. The upload
  address checks the session itself, because it is left out of `src/proxy.ts`, and refuses a user who still has the
  first password, an `Origin` other than the own and `Sec-Fetch-Site: cross-site`, so that no page of another site can
  make a browser upload a file (see "Login and sessions" in `architecture.md`).
- A `POST` of the upload address with the query `token` is an upload by a signed upload link, which a Writer or
  Manager connection of an AI app gets through MCP: it is checked by the token instead of a session, stores the file
  with the user of the connection and the way `mcp`, and takes every choice of the upload from the link (see
  `signed-file-links.md`).
- An upload under the name of a file at the same place asks whether to store a new version of that file; confirmed,
  it is stored as the newest version, cancelled, nothing is stored.

## Images

- An image is decoded before it is stored, with the limits of untrusted input: at most 100 megapixels
  (`MAX_IMAGE_PIXELS` in `src/features/files/images.ts`), no loader of sharp but those of the four types, and at most
  2 images at a time. One that does not decode, or whose format differs from its signature, is refused.
- "Remove location and camera data" is offered for an image, on by default. With it on, the image is written again in
  its own format, upright by its orientation, without EXIF, XMP and IPTC but with its colour profile, and with every
  frame of an animated GIF or WebP. With it off, the bytes stay as uploaded. A PDF is always stored byte for byte, and
  the option is not offered for it.
- The width and height of an image are stored upright with each version.

## The details page and versions

- The details page shows a preview of an image, at most as wide as the text, or "Open" for a PDF; the name and place,
  the type, the size, the width and height of an image, the number of versions, the last change with who made it,
  how and when, the copy fields, the pages that show or link it, and "Open" and "Download" (see "Routes" in
  `content-structure.md`).
- The copy fields hold the texts a page uses for the file: for an image "Embed link" with `![[…]]`, which shows it,
  then "Wiki link" with `[[…]]`, which only links it; for a PDF only "Wiki link" with `[[…]]`. Each field has a copy
  button of its own. The target names the file as the wiki links of the folder name it: its name with its extension,
  with the tab and a `/` before it for a file in a tab. The view of a deleted file shows no copy field. The texts come
  from `wikiLinkOf()` and `embedLinkOf()` of `src/features/pages/wiki-link-target.ts`, which build the links of files
  in the results of the MCP tools as well, so that both give the same texts.
- It lists the versions, newest first, each with its number, who stored it, how, when and its size, and opens each one.
- A Writer, a Manager and an Owner store a new version with "Upload new version", which takes a file of the same type,
  and revert to an earlier version, which stores that version again as the newest one with the actor as its uploader.
- Pages show the current version of a file, also an old revision of a page and a deleted page.
- A new version, a revert, a move or rename and a delete are refused when the file was changed after the dialog was
  opened, as for pages (see "Files" in `optimistic-locking.md`).

## Moving, renaming, deleting and restoring

- A Writer, a Manager and an Owner move a file into another tab of its folder or directly into it, and rename it; every
  link and embed of the file in the pages of the folder is changed in the same write, and the dialog says how many
  pages it changes (see `content-structure.md` and "Updates on a move or rename" in `wiki-links.md`). Renaming a tab
  changes the links and embeds of its files as well.
- A Manager and an Owner delete a file as a soft delete; deleted files are listed with the deleted pages under "Deleted
  items" and restored there with a name and a place, with all their versions (see "Deleting a file" in
  `page-deletion.md`). Deleting a tab deletes its files with its pages, in the browser and through `delete_tab`.

## Links and embeds

- `![[target]]` shows a file and `[[target]]` links it, each with an optional label after the first `|`; the target
  names the file as wiki links name pages, with its extension: `[[name.ext]]` for a file placed directly in the folder
  and `[[tab/name.ext]]` for one in a tab. A target without an extension names a page, and `![[setup]]` stays the
  character `!` and a link (see `wiki-links.md`).
- An image appears at its own size, at most as wide as the text, with the label or its name as its alt text, and a
  click opens the file in a new tab. `![[…]]` of a PDF is a link like `[[…]]`; no PDF is shown inside a page.
- Links and embeds of files follow the rules of wiki links: the same from every page of the folder, never into another
  folder, text in code and after a backslash, shown as missing when the file does not exist or is deleted, tracked in
  the index of links, and counted towards the 5,000 wiki links of a page. A missing file in a place that exists leads
  a Writer, a Manager and an Owner to "Upload file" with its name filled in; for a Reader it is marked text.
- Live preview shows the image of an embed under its line, and the picker on `[[` offers the files of the folder,
  each marked as a file (see `markdown-editor.md`).

## Search

- The search of a folder finds the files whose names match its words, in the browser and through `search_pages`, each
  marked as a file and leading to its details page. The text inside a PDF is not searched (see "What a file is found
  by" in `search.md`).

## MCP

- Every connection lists the files of its folder with `list_folder` and reads the details of one with `read_file`:
  its name and place, type, size, the width and height of an image, its last change, its addresses, its wiki link and,
  for an image, its embed link, the texts of the copy fields of its details page, and the pages that show or link it. No tool returns the content of a file, and no connection reaches the files of another folder.
- Every connection gets a short-lived signed link to the current version of a file of its folder with
  `get_file_download_link`, which downloads the file without a login (see `signed-file-links.md`).
- A Writer and a Manager connection upload a new file or a new version of a file with a short-lived signed link of
  `get_file_upload_link`, to which the app sends the bytes of the file (see `signed-file-links.md`). A new version is
  based on the lock version of the file, which `list_folder` and `read_file` give.
- No tool moves, renames, reverts or deletes a single file. The one tool after which a file is deleted is `delete_tab`
  of a Manager connection, together with its tab (see "Tools" in `mcp.md`).

## Decisions

- Files are items of their own next to the pages, directly in a folder or in a tab, so that a file can be used by
  several pages and kept as a document, and tabs, roles and the deletion of tabs apply to them as to pages. Rejected:
  files attached to one page, as in Confluence and BookStack; a files area of its own with subfolders, as in Wiki.js;
  files at the folder level only.
- The first version accepts only images and PDFs, the smallest set to secure. Rejected for now: Office and text files,
  and any type as a download.
- Every file has two addresses: the file itself under a prefix of its own, `/files`, so that it gets strict headers of
  its own, or another host later, and a details page under `/folders` next to the pages. Rejected: the file at the
  address of its details page with `?raw`; the file by its id, which survives renames but cannot be read.
- The file address answers a refusal with a plain 404 instead of the not-found page, because no page of the app runs
  under `sandbox` and `default-src 'none'`; the answer is the same for every reason, so that it tells nothing.
- The type comes from the content, and an image must decode, so that HTML or SVG named `.png` never reaches a browser.
  The signatures of the five types are a few bytes in `types.ts`. Rejected: `file-type`, a dependency with its own
  parsers for more than a hundred types.
- sharp, which Next.js installs already, decodes, measures and rewrites images, and is a direct dependency at the same
  version. Rejected: `image-size` and `exifr`, which read what sharp reads; the image optimizer of Next.js, which is
  switched off and does not forward the session cookie.
- The upload sends the file as the raw body of the request, its options in the query, to an address left out of the
  proxy, because the proxy buffers at most 10 MB of a body and cuts the rest silently, a limit fixed at build time.
  Rejected: a multipart body with `busboy`, `formidable` or `multer`.
- The contents are kept as blobs by their SHA-256, written through a temporary file that is synced and renamed, so that
  two uploads of the same content write the same blob and a revert writes nothing. Rejected: `write-file-atomic` and
  `proper-lockfile`; the contents in the database, which makes the database and its backups grow with every file.
- The contents are kept on a directory the operator mounts; S3-compatible storage comes later. Without the directory
  the wiki works but offers no upload and logs a warning, so that an installation does not fail after the update.
- Every change of a file counts its lock version up, and changes at the same time are refused as for pages. Rejected:
  the last change wins.
- Uploading under a taken name stores a new version after a question, and the old versions stay with a revert; new
  versions also come from the details page, and old revisions of pages show the current version. Rejected: replacing
  without a history, as Wiki.js and BookStack do; refusing the name; old revisions with the version of their time.
- The metadata of a photo is removed by default, so that an author does not publish where a photo was taken unless
  they choose to. Rejected: always removing it, and always keeping it.
- A file is at most 25 MiB by default, which the operator can change. Rejected: 10 MiB, too small for many manuals;
  100 MiB, more disk by default.
- The roles follow those of pages: every role reads, a Writer uploads, moves and renames, a Manager or Owner deletes.
  Rejected: deleting by a Writer; uploading by Managers only.
- Pages show and link files with the syntax of wiki links, so that the index of links, the missing display and the
  updates on renames work for files as for pages. Rejected: plain Markdown to `/files` addresses, which is not tracked.
- An image fits the width of the text and opens in a new tab; `![[…]]` of a PDF is a plain link. Rejected for now: a
  caption, an enlarged view, a card or a viewer of a PDF inside the page, which needs the headers relaxed.
- The details page of an image offers both the embed and the wiki link, so that a page can link an image without
  showing it, without editing the copied text; the embed comes first, because showing is the more common use of an
  image. Rejected: only the embed.
- The copy field of a PDF is labelled "Wiki link", so that the same text has the same label on every details page.
  Rejected: "Link" for PDFs, which would leave two labels for the same `[[…]]` text. A PDF gets no "Embed link",
  because `![[…]]` of a PDF is only a link.
- The copy fields have no hint text; their labels and values say what they do. Rejected: a line under each field.
- Files are uploaded only from the views of folders and tabs. Rejected for now: uploading from the editor.
- Files are found by their names; the text of PDFs comes later.
- AI apps read the details of files, through `list_folder`, `read_file` and `search_pages`, download a file with the
  short-lived link of `get_file_download_link`, upload one with the short-lived link of `get_file_upload_link`, and
  `delete_tab` deletes the files of a tab with its pages, as in the browser. Rejected for now: moving, renaming,
  reverting and deleting a single file through MCP; images as images and PDFs as their text. Rejected: refusing
  `delete_tab` for a tab with files.
- The address of a file answers logged-in users with a role, checked on every request, and an AI app with a
  short-lived signed link that follows the access of its connected app (see `signed-file-links.md`). Rejected: such
  links in the browser; public secret links, which cannot be withdrawn.

## Current limits

- no other types than PNG, JPEG, GIF, WebP and PDF, such as SVG, Office or text files
- no move, rename, revert or delete of a single file through MCP, and no content of files in a tool result
- no upload from the editor (paste, drop or a toolbar button)
- no limit on the total size of files per folder or user (see "Rate limits and quotas" in `roadmap.md`)
- no S3-compatible storage; no host of its own for files
- no links to files that work without a login, apart from the short-lived links of AI apps (see
  `signed-file-links.md`)
- no search of the text inside PDFs
- no list of the files that no page shows or links
- no progress bar of an upload, no Range requests, no thumbnails or smaller renditions of large images
- the versions of a deleted file cannot be opened, and the blobs of deleted files are never removed
- no redirects from the old addresses under `/deleted-pages`
