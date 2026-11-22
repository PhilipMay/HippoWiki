# Attachments – Steps

## Goal

Users of a folder upload images (PNG, JPEG, GIF, WebP) and PDFs as files of their own, directly into the folder or
into a tab, next to the pages. Pages show images with `![[…]]` and link files with `[[…]]`; every file has an address
that returns the file itself and a details page with its versions and the actions on it. Files are moved, renamed,
deleted and restored like pages, are found by search, and AI apps list them and read their details through MCP.

The plan is written from `spec/attachments-requirements.md`, which holds every rule and decision; this file says in
which step each requirement is built and how it is checked.

## Scope

- In: everything in "Scope" of `spec/attachments-requirements.md`: the five types as items of folders and tabs; the
  storage in a directory the operator mounts; the file address `/files/…` and the details page under `/folders/…`;
  the section "Files" and "Upload file" in the views of folders and tabs; versions with revert; moving and renaming
  with the update of links; soft delete and restore, also with a tab, in the browser and through `delete_tab`; the
  list "Deleted items" at `/deleted-items`; `![[…]]` and `[[…]]` of files in the page view and in live preview, with
  the picker on `[[`; finding files by name in search, in the browser and through `search_pages`; listing files and
  reading their details through MCP.
- Not in: everything in "Not in" of `spec/attachments-requirements.md`: other types (SVG, Office, text); uploading,
  changing, moving, renaming or deleting a single file through MCP; uploading from the editor; quotas per folder or
  user; S3-compatible storage; links that work without a login; the text inside PDFs; the content of files through
  MCP; a host of its own for files; a list of unused files; redirects from `/deleted-pages`. Also not in: a progress
  bar of an upload (the dialog shows that it is uploading), Range requests, thumbnails or a second, smaller rendition
  of large images, opening the versions of a deleted file, and removing the blobs of deleted files for good.

## Libraries

What the plan reuses, checked against the installed packages and the npm registry on 2026-11-21:

- `sharp` 0.35.5 (Apache-2.0; libvips LGPL-3.0, already allowed by "License check in CI" in `roadmap.md`) is already
  in `node_modules` as an optional dependency of Next.js, at the latest version. Step 2 adds it as a direct dependency
  at the same version, so that no second copy is installed and knip sees its use. It does everything the images need:
  it decodes an image, which proves its type beyond the magic bytes, reads width, height, the number of frames and the
  EXIF orientation (`metadata()`), turns an image upright (`autoOrient()`), writes it again without metadata (its
  default output) while keeping the colour profile (`keepIccProfile()`), keeps the frames of an animated GIF or WebP
  (`animated: true`), and takes the limits of untrusted input (`limitInputPixels`, `failOn`, `sharp.block()` for the
  loaders outside the four types, `sharp.concurrency()`, `sharp.cache(false)`). Its `withExif()` writes the EXIF of
  the test images, and `metadata()` reads it back.
- Node.js built-ins: `node:crypto` (the SHA-256 of a blob while it streams), `node:fs/promises` (`statfs()` for the
  free space, `open()` with `sync()`, `rename()`, `rm()`), `node:stream` (`Readable.fromWeb()` and `Readable.toWeb()`
  between the body of a route handler and a file) and `node:stream/promises` (`pipeline()`).
- Code of the project:
  - `deriveName()` suggests the name of an upload from its file name, by the rule that suggests page names
    (`Network Diagram (v2).PNG` gives `network-diagram-v2` and the extension `png`). Step 2 moves it from
    `src/features/pages/derive.ts`, which imports the Markdown parser, into the pure module `src/lib/derive-name.ts`,
    so that the upload dialog does not load markdown-it into the folder view.
  - `createLimiter()` of `src/lib/password-hash.ts` limits the images processed at the same time; step 2 moves it
    into `src/lib/limiter.ts`, with the error of a busy limiter as an argument, so that the hashing and the images
    share it.
  - `parseSearch()` of `src/features/search/words.ts` reads the words of a search of files, so that one syntax holds.
  - The inline rule `wiki_link` of `src/features/pages/markdown.ts`, the index of links and `updateLinks()` of
    `src/features/pages/links-service.ts`, and the picker and live preview of `src/features/pages/editor/`, all
    extended to files instead of built a second time.
  - The dialogs of `src/components/ActionDialog.tsx` (`ActionDialog`, `DialogForm`, `ConfirmDialog`),
    `PageNameAndPlaceFields` and `PageVersionField` of `src/features/pages/components/` and `changedPageForm()` of
    `src/features/pages/changed-page.ts`, generalised where a file needs it; the copy button of
    `src/features/mcp/components/McpAddress.tsx`, moved into `src/components/` for the link to copy.
  - `softDeleteData()` of `src/features/pages/writes.ts` as the model of the soft delete of a file.
- Evaluated and not added:
  - `file-type` 22.3 (MIT): detects more than a hundred types; HippoWiki accepts five, whose signatures are a few
    bytes in a pure module, and the decode of sharp is the real check of an image. Not worth a dependency with its
    own parsers.
  - `image-size` 2.1: sharp reads the same, from the decoded image.
  - `busboy`, `@fastify/busboy`, `formidable`, `multer`: no multipart body; the upload sends the file as the raw
    body of the request, its options in the query string, so that the handler streams it to disk without a parser.
  - `content-disposition` 3.1: file names follow the name rule and are ASCII, so `filename="<name.ext>"` needs no
    encoding.
  - `mime` 4.1: the five types and their MIME types are a constant.
  - `slugify`, `@sindresorhus/slugify`: `deriveName()` is already the rule of names.
  - `exifr`: sharp reads the EXIF of the test images.
  - `pdf-lib`, `pdfjs-dist`: nothing of a PDF is parsed in the first version; its header is checked, and it is served
    with headers that run nothing in it.
  - `write-file-atomic`, `proper-lockfile`: a temporary file in the same directory, synced and renamed into its
    content address, is enough; two uploads of the same content write the same blob.
  - The image optimizer of Next.js (`next/image`): switched off (see "Security headers" in `architecture.md`), and it
    does not forward the session cookie.
  - CodeMirror packages for images in the editor: a block widget from a `StateField` of `@codemirror/view` is a few
    lines and follows the decorations of live preview.

## Design

What the steps share, so that each step builds on the same model:

- The feature lives in `src/features/files/`: `types.ts` (the five types, their extensions, MIME types and
  signatures), `store.ts` (the blobs on disk), `images.ts` (sharp), `schema.ts`, `service.ts`, `http.ts` (the adapter
  of the two route handlers), `queries.ts`, `actions.ts`, `forms.ts`, `file-query.ts` (what a details address shows)
  and `components/`. `src/features/services.test.ts` gets the new service.
- A file name is a name of the name rule, a dot and the extension of its type: `png`, `jpg`, `gif`, `webp` or `pdf`
  (`FILE_NAME_PATTERN` in `src/lib/name-limits.ts`, `parseFileName()` in `src/lib/names.ts`); the name part has the
  length limit of a name. The type is fixed by the extension: a version of another type is refused.
- Models, added by one migration:
  - `File`: folder, optional tab, name with its extension, type, `lockVersion`, `deletedAt`, last editor and channel,
    times. Unique indexes as for pages: per tab, and per folder for the files placed directly in it and not deleted.
    A deleted file forgets its tab, like a page. Keys restrict deleting.
  - `FileVersion`: file, number from 1, the SHA-256 of its blob, size, width and height for an image, the user and
    channel who uploaded it, the time. The newest number is the current version.
  - The version of a file is one of its stored contents, which its details page lists; its lock version counts every
    stored change of the file (a new version, a revert, a move or rename, a delete, a restore), for optimistic locking,
    as the version of a page does. "Terms" in `architecture.md` names both.
- Blobs are kept by their SHA-256 below `HIPPOWIKI_FILES_DIR`, `blobs/<first two hex digits>/<hash>`, written through a
  temporary file in `tmp/` of the same directory. A revert stores the blob of the old version as a new version without
  writing a byte. Blobs are never removed in the first version, apart from one that a failed upload wrote and no
  version holds.
- The file address `/files/<folder>/[<tab>/]<name.ext>` is a route handler (`src/app/files/[folder]/[...path]/route.ts`)
  behind `src/proxy.ts`, which answers only `GET` and `HEAD` and takes `?version=<n>` and `?download`, nothing else.
  The upload is a
  `POST` to `/api/uploads/<folder>/[<tab>/]<name.ext>` (`src/app/api/uploads/[folder]/[...path]/route.ts`), left out of
  the matcher of `src/proxy.ts` because the proxy buffers at most 10 MB of a body and cuts the rest silently
  (`experimental.proxyClientMaxBodySize`), a limit fixed at build time. It checks the session itself with
  `getCurrentUser()`, refuses a user who still has the first password, an `Origin` other than the own and
  `Sec-Fetch-Site: cross-site`, and answers like a missing file to everyone else. The body is the file itself; the
  query says `strip=0` to keep the metadata of a photo and `replace=<lock version>` to store a new version of the file
  of that name.
- `next.config.ts` keeps the security headers of the app away from `/files/` and gives the file addresses their own:
  `Content-Security-Policy: default-src 'none'; sandbox`, `X-Content-Type-Options: nosniff`,
  `Cross-Origin-Resource-Policy: same-origin`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` and the
  `Strict-Transport-Security` of the app. The handler adds the type decided at upload, `Content-Disposition` with the
  name (`inline`, so that an image shows and a PDF opens in the viewer of the browser, and `attachment` for "Download",
  with `?download`), `Cache-Control: private, no-cache` and the SHA-256 as `ETag`, answering `If-None-Match` with 304,
  so that every view asks again and a removed role ends the access at once.
- The details page is `/folders/<folder>/<name.ext>` and `/folders/<folder>/<tab>/<name.ext>`: a segment that ends in
  a dot and an extension of a file is a file, `.md` a page, any other a tab. Its actions are given as for pages:
  `move-or-rename`, `delete`, `upload-version` and `revert&version=<n>`; the folder and the tab get `upload`, with an
  optional `&name=<name.ext>`.
- `FUNCTION_ROLES` of `src/features/folder-roles/roles.ts` gets `editFile` (Writer: upload, new version, revert, move,
  rename) and `deleteFile` (Manager), and `deletedPages` becomes `deletedItems` (Manager).
- Without `HIPPOWIKI_FILES_DIR`, or with a directory that is missing or that the server cannot write, the files are
  off: the wiki works, files that exist are listed, their addresses answer 404 for their content, "Upload file" and
  "Upload new version" are not offered, every upload is refused, and the server logs one warning at its start
  (`src/instrumentation.ts`).

### Changes found while building

- Step 3: `notFound()` in a route handler answers 404 without the not-found page of the app, and that page could not run
  under the headers of the files anyway (`sandbox`, `default-src 'none'`). So every refusal of the file address is a
  plain 404, the same for every reason; the end-to-end tests check it with `expectFileNotFound()` of
  `e2e/support/files.ts` instead of `expectNotFound()`. The upload address answers its refusals like a missing file in
  the same way.
- Step 3: the upload has two codes more than "Files in the database and their addresses" lists: `file-not-found`, for a
  new version of a file that is gone, and `invalid-image`, for an image that does not decode or has more than 100
  megapixels. `FileVersion` has `revertedTo`, so that the revert of step 5 needs no migration of its own.
- Step 3: Chrome shows a PDF under `sandbox` in its viewer (checked with the installed Chrome); Firefox and Safari are
  left to the manual check.

- Step 5: a refused "Upload new version" stays open with the chosen file and the message, and takes the lock version of
  the file as it is now from the answer of the upload address, instead of being shown again at `?notice=changed`,
  because the file is sent with `fetch()`; the revert follows the pages with `?notice=changed`. The message comes from
  `changedMessage()` of `src/features/pages/changed-page.ts`, now shared by pages and files.

- Step 6: `\![[diagram.png]]` is the character `!` followed by a link of the file, as `\![text](address)` is `!` and a
  link in Markdown. The derivation of the links of a page stored before the step is tested in
  `integration/wiki-links-service.test.ts`, next to the other tests of the derivation, instead of
  `integration/search-index.test.ts`. With file targets in the index, a tab rename already updates the links and
  embeds of the files of the tab, and the "Rename tab" dialog counts them; step 7 adds the tests.

- Step 7: a name with another extension than the type of the file is refused at the name field with a message that
  says the type cannot change (`fileExtensionMessage()` of `src/features/files/schema.ts`). The "Rename tab" dialog
  needed no change: it counts the rows of the index of links in the tab, which hold the targets of files since step 6.
  The "Move or rename file" dialog counts the pages that "Shown or linked from" lists.

- Step 8: the list of deleted items is merged from `listDeletedPages()` and `listDeletedFiles()` by
  `deletedItemsOf()` of `src/features/pages/components/DeletedItemsList.tsx`, instead of a read `listDeletedItems()`
  of its own, so that each service reads only its own table; the list gets the columns "Kind" and "Title or type". The
  "Restore page" dialog is shared by files (`item="file"`, "Restore file"). The soft delete of a file is in
  `src/features/files/writes.ts` (`softDeleteFileData()`), which the delete of a tab stores as well. The "Delete file"
  dialog says how many pages will show the file as missing.

- Step 9: the image of an embed shows under its line also on the lines of the cursor, where its Markdown is visible
  above it, so that the image does not jump while the cursor moves; the images come from `imageEmbedsField` of
  `src/features/pages/editor/file-embeds.ts`. A missing file in the editor leads to the "Upload file" dialog only while
  the files are on (`uploadAddress` of the page list). The editor's page list gets the files from
  `listAllFolderFiles()` of the files service.

- Step 10: the patterns of the names of files are built by `fileNamePatterns()` of the pure module
  `src/features/search/file-names.ts` and matched with `~` of PostgreSQL; a word with a letter that no name holds
  matches no file. The files are read with their fields in one raw statement of the search transaction, because a read
  of Prisma with the relation of the versions sends several queries at once over its one connection. The results get
  `files` and `moreFiles`, which `search_pages` returns as such, empty beyond the first call; with files listed, the
  pages of the results view get the heading "Pages", and the message without results reads "No pages or files in this
  folder match …". `FileList` lists a file with a `tab` of its own after its tab, for the results.

## Requirements by step

| Step                                      | Requirements                                      |
| ----------------------------------------- | ------------------------------------------------- |
| Deleted items                             | R37, R40                                          |
| File types, names, storage and images     | R2, R21, R25, R26, R32, R36, R39 (in the modules) |
| Files in the database and their addresses | R1, R3, R7, R8, R25, R27, R28, R32, R39           |
| Files in the views and the details page   | R1, R4, R8, R9, R10, R15, R16, R21, R26, R33, R38 |
| New versions and revert                   | R16, R34, R42                                     |
| Links and embeds of files                 | R12, R13, R14, R22, R23, R31, R33, R35, R41       |
| Moving and renaming files                 | R4, R17, R18, R42                                 |
| Deleting and restoring files              | R1, R4, R19, R20, R24, R42                        |
| Files in the editor                       | R11, R29                                          |
| Files in search                           | R30, R43                                          |
| Files through MCP                         | R5, R6                                            |
| Spec tests                                | all                                               |

## Sessions

The plan is large, so it has two stop points:

- after "New versions and revert": the next session starts with "Links and embeds of files";
- after "Files in the editor": the next session starts with "Files in search".

## Checklist

- [x] Deleted items
- [x] File types, names, storage and images
- [x] Files in the database and their addresses
- [x] Files in the views and the details page
- [x] New versions and revert
- [x] Links and embeds of files
- [x] Moving and renaming files
- [x] Deleting and restoring files
- [x] Files in the editor
- [x] Files in search
- [ ] Files through MCP
- [ ] Spec tests
- [ ] Wrap-up

## Deleted items

### Goal

The list of deleted pages becomes "Deleted items" at `/deleted-items/<folder>`, a deleted page lives at
`/deleted-items/<folder>/<id>`, and the old addresses under `/deleted-pages` show the not-found page (R37, R40), so
that the later steps add the deleted files to a list that already has its name and address.

### Build

- Move the routes `src/app/deleted-pages/` to `src/app/deleted-items/`, with their views and actions unchanged.
- `src/lib/addresses.ts`: `deletedItemsRootPath()`, `deletedItemsPath()`, `deletedItemPath()` and the paths of the
  history of a deleted page under `/deleted-items`, replacing the `deletedPages…` helpers; `src/lib/revalidate.ts`
  revalidates `/deleted-items` instead of `/deleted-pages`.
- The button on the folder and the heading of the list read "Deleted items"; the breadcrumbs follow.
- `FUNCTION_ROLES`: `deletedPages` becomes `deletedItems`, with every use.
- MCP: the results of `delete_page` and `delete_tab` name `/deleted-items/<folder>`, and the descriptions and
  instructions that name the list say "deleted items".
- `src/proxy.ts` and `e2e/access.spec.ts`: `/deleted-items` leads to the login page without a login, like the old
  prefix did.
- Specs: `content-structure.md`, `page-deletion.md`, `page-history.md`, `folder-roles.md`, `mcp.md`, `search.md`
  (the field is left out under `/deleted-items`) and `architecture.md` name the new address and the new name.

### Test

- Unit: the new address helpers and their parsers in `src/lib/addresses.test.ts`; `roles.test.ts` with
  `deletedItems`; `tools.test.ts` with the new address in the results of `delete_page` and `delete_tab`.
- End to end: rename `e2e/deleted-pages.spec.ts` to `e2e/deleted-items.spec.ts`; the folder offers a Manager
  "Deleted items", which leads to `/deleted-items/<folder>` with the heading "Deleted items"; a deleted page opens at
  `/deleted-items/<folder>/<id>` and is restored from there; `/deleted-pages/<folder>` and
  `/deleted-pages/<folder>/<id>` show the not-found page (`expectNotFound()`), also for a Manager; `e2e/access.spec.ts`
  has the new addresses; the specs of deleting, restoring, the history and MCP follow the new address.

## File types, names, storage and images

### Goal

The pure parts of files exist and are tested on their own before anything of the app uses them: the five types and
their detection from the content, the name rule of files and the suggested name, the store of blobs with its size
limit and its behaviour on a full disk, and the processing of images with sharp (R2, R21, R25, R26, R32, R36, R39).

### Build

- `sharp` as a direct dependency, at the version Next.js already installs (see "Libraries").
- `src/features/files/types.ts` (pure, no server-only imports): the five types with extension, MIME type and label;
  `detectType()` from the first bytes (PNG, JPEG, GIF87a and GIF89a, WebP as `RIFF….WEBP`, PDF as `%PDF-`), and the
  message that names the accepted types. A content that is none of them, such as HTML or SVG, gives no type.
- `src/lib/name-limits.ts` and `src/lib/names.ts`: `FILE_NAME_PATTERN`, `fileNameSchema` and `parseFileName()`, which
  read a name and its extension; a name with upper case, a space, a second dot or `.jpeg` breaks the rule, with the
  rule as its message. `suggestFileName()` in `src/features/files/` turns an uploaded file name into a suggestion with
  `deriveName()` of its base and the extension in lower case, `.jpeg` as `.jpg` (`photo.jpeg` gives `photo.jpg`,
  `Network Diagram (v2).PNG` gives `network-diagram-v2.png`).
- `src/lib/env.ts`: `HIPPOWIKI_FILES_DIR` (optional, a path; relative to the working directory of the server) and
  `HIPPOWIKI_FILE_SIZE_LIMIT` (optional, whole bytes in plain digits as the limits of MCP, from 1 MiB to 1 GiB,
  default 26,214,400, which messages show as 25 MiB); `.env.example` sets `HIPPOWIKI_FILES_DIR=files`, and `files/` is
  added to `.gitignore` and `.containerignore`.
- `src/features/files/store.ts` (server only): whether the store is usable (the directory exists and the server can
  write it, checked once and kept); `writeBlob()` streams a body into a temporary file in `tmp/`, counts its bytes and
  stops at the limit, hashes it while it reads, checks the free space with `statfs()` before it starts and after
  `Content-Length`, syncs and renames the file into `blobs/<aa>/<sha256>` (keeping an existing blob of the same
  hash), and removes the temporary file on every failure, a full disk (`ENOSPC`) included; `readBlob()` opens a blob
  for reading; `removeBlobIfUnused()` for the failed upload, which the service calls with a check of the versions.
- `src/lib/limiter.ts`: `createLimiter()` moved from `src/lib/password-hash.ts`, with the error of a busy limiter as an
  argument; the hashing uses it unchanged.
- `src/features/files/images.ts` (server only): `processImage()` decodes the stored image with the limits of untrusted
  input (`limitInputPixels` of 100 megapixels, `failOn: "error"`, every loader blocked but those of the four types,
  `sharp.cache(false)`, one image at a time per slot of a limiter of 2), refuses one that does not decode or whose
  format differs from its signature, and returns width and height upright; with the metadata removed, it writes the
  image again in its own format, upright by its orientation, without EXIF, XMP and IPTC but with its colour profile,
  and every frame of an animated GIF or WebP; without it, the bytes stay as uploaded. A PDF is not processed.

### Test

- Unit: `types.test.ts` (each signature, HTML and SVG saved as `.png`, an empty and a short file); `names.test.ts`
  (`FILE_NAME_PATTERN`, `parseFileName()`, upper case, spaces, a second dot, `.jpeg`); the suggestions of R21 and R36;
  `env.test.ts` (both variables, the default, the bounds, a malformed value stops the server); `limiter.test.ts` with
  the tests that `password-hash.test.ts` had for the limiter.
- Unit, with a temporary directory: `store.test.ts`: a file at the limit is stored and one byte more is refused with
  nothing left in `tmp/` and `blobs/`; a body without `Content-Length` and a false one are counted; the same content
  twice gives one blob; a write that fails with `ENOSPC` (an injected write) leaves nothing; a missing directory and
  one that cannot be written make the store unusable.
- Unit: `images.test.ts` with images made by sharp in the test: a JPEG with an orientation of 6 and a GPS position in
  its EXIF comes out upright, without EXIF and with its width and height swapped; kept as uploaded, its bytes are the
  same; an animated GIF keeps its frames; a PNG whose bytes are cut is refused; an image over the pixel limit is
  refused.
- Cost: `src/features/files/images.cost.test.ts`: a JPEG just under the pixel limit is processed, and a decompression
  bomb is refused, each within its budget.
- End to end: none, because nothing of the app uses the new modules yet; the hashing that now uses the moved limiter
  runs in `e2e/login.spec.ts`.

## Files in the database and their addresses

### Goal

Files are stored with their versions, uploaded through the upload address and served at their own address to the
users with a role on their folder, with headers that run nothing in them (R1, R3, R7, R8, R25, R27, R28, R32, R39).
The browser has no upload button yet; the tests upload with requests.

### Build

- `prisma/schema.prisma` and a migration that only adds: `File`, `FileVersion` and the enum of the types (see
  "Design"), with the relations on `Folder`, `Tab` and `User`; the unique indexes get constants in
  `src/lib/db-errors.ts`.
- `src/features/files/schema.ts` and `service.ts`: `uploadFile(actor, place, name, body, options)` stores a new file
  or, with `replace` and the lock version it is based on, a new version of the file of that name; it checks in the
  order of every content write (the actor, the ids, the role `editFile`, the place, the name, the store, the type
  against the extension, the size, the lock version), writes the blob, processes an image, and stores the file and
  its version in one transaction, removing the blob again when the transaction fails. Codes: `not-allowed`,
  `folder-not-found`, `tab-not-found`, `invalid-input` (the name), `name-taken` (with the file of that name),
  `file-changed`, `wrong-type`, `too-large`, `disk-full`, `files-off`, `failed`. Reads: `getFile()`,
  `listFolderFiles()`, `listTabFiles()`, `getFileContent()` (the blob of the current or a given version) for the
  role `read`.
- `src/features/files/http.ts`: `handleFileRequest()` for `GET` and `HEAD` of the file address, which answers a missing
  session, a user without a role, an admin, a deleted or missing file, a version that does not exist and any other
  query with the not-found page (`notFound()` of `next/navigation`); `handleUploadRequest()` for the upload, with the
  checks of "Design" and JSON answers that `src/features/files/components/` reads in the next step. Both log their
  outcomes like the other writes and reads; neither logs a body.
- `Content-Disposition`: `inline; filename="<name.ext>"` by default, `attachment; filename="<name.ext>"` with
  `?download`, the only parameter of the address besides `version`; any other query, or either of them twice or with
  a value it does not take, shows the not-found page.
- `next.config.ts`: the headers of the file addresses (see "Design"), and `e2e/security-headers.spec.ts` with them.
- `src/proxy.ts`: `/api/uploads/` left out of the matcher, with its reason in the comment.
- `src/instrumentation.ts`: at the start of the server, the warning that files are off, with the reason (no
  variable, a missing directory, one that cannot be written).
- `src/lib/revalidate.ts` is called by the upload adapter after a stored upload.
- The test helpers: `createFile()` in `e2e/support/database.ts`, which writes a blob into the directory of the worker
  and inserts the file and its versions; `playwright.config.ts` gives every server `HIPPOWIKI_FILES_DIR` below
  `.next-e2e/` of its worker; `integration/setup.ts` a temporary directory; `uploadFile()` in a new
  `e2e/support/files.ts`, which posts a file with the cookies of the page; fixtures made with sharp in the helper.
- Container image: `ENV HIPPOWIKI_FILES_DIR=/data/files` in the `Containerfile`, which does not create the directory,
  so that a container without the volume runs with files off. `scripts/image.sh smoke` checks: without the volume the
  server serves and logs the warning; with a volume mounted at `/data/files` (`:U`, so that it belongs to `node`) it
  logs none; sharp loads in `/app` (`node -e`); the server cannot write anywhere else.
- Specs: `container-image.md` ("Configuration" with both variables, "What the environment has to provide" with the
  volume and the backup of the database first, then the directory), `architecture.md` ("Login and sessions" with the
  upload address, "Security headers" with the headers of the files), `folder-roles.md` (the rows of R8).

### Test

- Unit: `src/features/files/service.test.ts` (the order of the checks, every code, an admin, no role, a Reader, the
  removal of the blob after a failed transaction, the log lines); `http.test.ts` (the 404 of every refusal, the
  status and headers of every outcome, `Origin` and `Sec-Fetch-Site`, a user with the first password, 304 for a
  matching `If-None-Match`, `HEAD`); `src/test/content-writes.ts` gets `uploadFile`.
- Integration: `integration/file-service.test.ts`: the rows a new file and a new version store; a taken name; a file
  `setup.png` next to a page `setup`; the same name in another tab; two uploads of a new file of the same name at
  once store one; a new version based on an older lock version is refused; the reads leave deleted files out;
  `integration/db-errors.test.ts` with the new constraints.
- End to end, new `e2e/files.spec.ts` with uploads through `uploadFile()`: each of the five types is stored and
  returned with its type; HTML and SVG named `.png`, a text file and a ZIP are refused with the message that names the
  types, and nothing is stored; a file at the limit is stored and one byte more is refused with the limit in the
  message (a server with a lower limit is not needed: the tests use the default); the file address answers a user
  without a role, an admin, a missing file and a malformed address with the not-found page, the same for each; after
  the Owner removes the role, the next request gets the not-found page; without a login the address leads to the
  login page and shows no file (`e2e/access.spec.ts`); every file response has the headers of "Design" and its
  `ETag`; a JPEG with a GPS position is served without it unless `strip=0` was sent; an upload from another origin is
  refused.
- End to end, the complete suite: the step changes `next.config.ts` and `src/proxy.ts`.
- Smoke test of the container image: `npm run image:build` and `npm run image:smoke`.
- Manual: a PDF opened at its address shows in the viewer of Chrome, Firefox and Safari despite `sandbox`; if one of
  them refuses it, the plan is changed before the next step (the headless Chromium of the tests has no PDF viewer).
- Manual: an upload into a volume that is full (a Podman volume of tmpfs with a small size) is refused with a message
  and leaves no file in the volume.

## Files in the views and the details page

### Goal

Writers upload files from the views of folders and tabs, every role sees the files in a section "Files" and opens
their details page with its details, its preview, its versions and the link to copy (R1, R4, R8, R9, R10, R15, R16,
R21, R26, R33, R38).

### Build

- `FolderView` and `TabView`: a section "Files" below the pages, only when the place holds files, each with its name,
  type, size and last change ("by <user> via <channel>"), leading to its details page; "Upload file" for the roles with
  `editFile` while the files are on, also without files.
- The dialog "Upload file" (`?action=upload` on the folder and the tab, `&name=` optional, parsed like `name` of
  `?action=new`): the file field (`accept` with the five types), the name field with the suggestion of the chosen file
  (the preset name instead, when the address has one), "Remove location and camera data" for an image, on by default,
  and "Upload". Before it sends the file it asks the server, with a Server Action, whether the name is taken at the
  place; when it is, it asks whether to store a new version of that file (R15), and the upload then states the lock
  version it saw. A refused upload keeps the dialog open with the message at the field it belongs to: the name, the
  type, the size, the full disk, files that are off. The upload is sent with `fetch()` as the body; the button shows
  that it is uploading and the dialog does not close meanwhile. Done, it leads to the details page of the file.
- The details page (`src/features/files/file-query.ts` with `fileAddressOf()`, the routes `[item]` and `[page]`
  dispatching a segment with a file extension): the breadcrumb, the name and place, the type, the size, width and height
  of an image, the number of versions, the last change, a preview of an image (`<img>` at most as wide as the text) or
  "Open" for a PDF, "Open" and "Download", the link to copy (`![[…]]` for an image, `[[…]]` for a PDF) with the copy
  button moved to `src/components/`, and the versions, newest first, each with its number, who uploaded it, how, when
  and its size, and a link that opens it (`?version=<n>`). The section of the pages that show or link the file
  follows in "Links and embeds of files".
- `e2e/hydration.spec.ts` and `e2e/pending-states.spec.ts` get the new dialog.
- Specs: `content-structure.md` ("Addresses", "Actions and views", "Routes", "Lists and order") and `folder-roles.md`
  for what each role sees.

### Test

- Unit: `file-query.test.ts` (every action of the details page and of `upload` per role, the not-found cases);
  `forms.test.ts` and `actions.test.ts` of the check of the name; `addresses.test.ts` with the file addresses and
  `parseFileSegment()`; `queries.test.ts` of the files feature.
- End to end, new `e2e/upload-file.spec.ts` and `e2e/file-details.spec.ts`: a Writer uploads into the folder and into a
  tab and finds the file in the section "Files" of that place only, with name, type, size and last change, and the
  pages lists unchanged; `Network Diagram (v2).PNG` suggests `network-diagram-v2.png` and `photo.jpeg` `photo.jpg`;
  `Setup.png`, `my file.png`, `a.b.png` and `photo.jpeg` are refused at the name field with the rule; an upload under a
  taken name asks for a new version, confirmed stores version 2, cancelled stores nothing; the option is offered for an
  image, on, and not for a PDF; a folder without files shows no section but "Upload file" for a Writer, Manager and
  Owner, and the section appears after the first upload; a Reader sees the files, the details page and the versions,
  and no "Upload file", and `?action=upload` shows a Reader the not-found page; the details page of an image and of a
  PDF shows each detail of R33 but the linking pages, "Download" saves the file under its name, "Open" opens its
  address, the copy button copies the link; a page that shows the file can be deleted and the file stays (with a page
  that holds its address as a plain Markdown image).
- End to end: the specs of the folder and tab views (`e2e/folders.spec.ts`, `e2e/tabs.spec.ts`), `e2e/hydration.spec.ts`
  and `e2e/pending-states.spec.ts`.

## New versions and revert

### Goal

The details page offers a Writer "Upload new version" and a revert to an earlier version, and both are refused when
the file was changed after the dialog was opened (R16, R34, R42).

### Build

- `?action=upload-version` on the details page: the upload dialog without the name, for a file of the same type
  (`accept` with that type), with the option for an image; it states the lock version of the file when it was opened.
- `?action=revert&version=<n>` on the details page: a `ConfirmDialog` that names the version; `revertFile()` of the
  service stores the blob of version n as the newest version, by the actor, and counts the lock version up.
- Both refuse a change after the dialog was opened with `file-changed`: the dialog is shown again with the file as it
  is now and the message that names who changed it last, how and when, as for pages (`changedPageForm()` generalised
  for files, `?notice=changed` on the details page), and confirming again stores it.
- Specs: `optimistic-locking.md` (files are protected as pages are, with their lock version).

### Test

- Unit: the service (`revertFile()`, `file-changed`, a version that does not exist); `file-query.test.ts` (the
  actions, `version` only with `revert`, the notice); `actions.test.ts`.
- Integration: a revert stores a new version with the blob of the old one and writes no blob; a new version and a
  revert with the same lock version at once store one.
- End to end, `e2e/file-details.spec.ts`: a new PNG for a PNG file adds a version and the file address returns it; a
  PDF chosen for a PNG file is refused with a message; after a revert to version 1 of a file with two versions it has
  three and returns the content of version 1; a Reader sees the versions and no "Upload new version" or revert, and
  their addresses show the not-found page; a new version uploaded in a second browser context while the revert dialog
  is open makes the revert show the message, and confirming again stores it; the same for "Upload new version".
- End to end, the complete suite: the last step of the first session.

## Links and embeds of files

### Goal

Pages show images with `![[…]]` and link files with `[[…]]`, tracked in the index of links like the links to pages:
missing files are marked, a Writer is led to upload them, and the details page lists the pages that show or link the
file (R12, R13, R14, R22, R23, R31, R33, R35, R41).

### Build

- `src/features/pages/wiki-link-target.ts`: a target names a file when its last part is a file name (`name.ext` with
  one of the five extensions); `WikiLinkTarget` gets the kind, page or file; a target without an extension still names
  a page, and `name.jpeg` or `name.docx` breaks the rule. The hints of a missing link name a file: "File does not
  exist".
- `src/features/pages/markdown.ts`: the inline rule reads `![[target]]` and `![[target|label]]` of a file as an embed,
  a `wiki_link` token marked as an embed, in the same places where a wiki link is one (not in code, after a backslash,
  in the text of a link or across a line); `![[target]]` of a page stays `!` followed by a link. Embeds and links of
  files count toward the 5,000 wiki links of a page (R41).
- `src/features/pages/wiki-links.ts`: the targets of files go into the index of links; `LINK_INDEX_VERSION` counts up,
  so that the start of the server derives the links of every page again (`[[setup.png]]` was a target that broke the
  rule before). `PageLink` keeps the name with its extension in `pageName`, whose doc comment says so.
- `resolveWikiLinks()` of the pages service also reads the files of the folder that are not deleted, with the type,
  width and height of their current version; the page view (`markdownToReact.tsx`) renders an embed of an image as an
  `<img>` with the file address, `loading="lazy"`, its width and height, at most as wide as the text, the label or the
  name as alt text, inside a link that opens the file address in a new tab; an embed of a PDF and every link to a file
  as a link to the file address, with the label or the name as its text. Revisions, deleted pages and the delete
  dialog show the current version, because they resolve against the folder as it is now (R35).
- Missing files: marked as a missing page link is; for the roles with `editFile` a missing file in a place that exists
  leads to `?action=upload&name=<name.ext>` of that place (R31); for a Reader it is marked text.
- The details page gets the section "Shown or linked from": the pages of the folder that show or link the file, from
  the index of links, as "Linked from" lists them (`listPagesLinkingToFile()` in the links service).
- Specs: `wiki-links.md` ("Syntax and target", "Display", "Missing links", "The index of links", "The limit") and
  `pages.md` ("Rendering", and "no attachments" leaves its current limits).

### Test

- Unit: `wiki-link-target.test.ts` (file targets, extensions, `.jpeg`, a page target without one), `markdown.test.ts`
  (embeds and links of files, `!` before a page link, code spans, `\![[…]]`, the render of an image, a PDF and a missing
  file, the alt text), `wiki-links.test.ts` (the index holds file targets, the limit counts embeds),
  `service-reads.test.ts` (the resolution of files).
- Integration: `integration/wiki-links-service.test.ts`: the pages that show or link a file, a page whose link was
  removed is gone after its save, deleted pages are left out; `integration/search-index.test.ts`: the derivation of the
  links of a page stored before this step takes its file targets.
- End to end, new `e2e/file-links.spec.ts`: `![[guides/diagram.png]]` shows the image at its own size, a wide one at
  the width of the text, with the label as alt text, and a click opens the file address in a new tab;
  `[[guides/report.pdf]]` and `![[guides/report.pdf|Manual]]` are links with the texts `report.pdf` and "Manual" to the
  file address; `[[guides/setup]]` stays a link to a page; a link to a missing file, a deleted file (with a deleted
  row from `createFile()`) and `[[other-folder/x.png]]` show as missing; `` `![[guides/diagram.png]]` `` is text; a
  Writer clicking `[[guides/manual.pdf]]` of a missing file gets the upload dialog of the tab `guides` with
  `manual.pdf`, a Reader marked text; the details page lists a page with `![[…]]` and one with `[[…]]`, and no longer
  the page whose link was removed; after a new version an old revision of a page that embeds the image shows the new
  one; a page with 4,000 links to pages and 1,001 links to files is refused at save with the error of the limit.
- End to end: `e2e/wiki-links.spec.ts` and `e2e/pages.spec.ts`, which render pages.

## Moving and renaming files

### Goal

A Writer moves and renames a file within its folder from its details page, every link and embed of the file is
updated in the same write, and renaming a tab updates the links into the files of the tab (R4, R17, R18, R42).

### Build

- `?action=move-or-rename` on the details page: a dialog with the name and the place (the fields of
  `PageNameAndPlaceFields`, generalised for a file name), that says how many pages show or link the file, and is
  disabled while name and place are unchanged; it states the lock version and is refused with `file-changed` as the
  dialogs of the last step.
- `moveOrRenameFile()` of the files service: the checks of a move of a page, the lock of the links of the folder
  (`lockFolderLinks()`), and `updateLinks()` generalised to a file target, each updated page getting its revision
  marked as links updated, as for pages; the extension stays, because the type is fixed (a new name with another
  extension is refused at the name field); a move to the own name and place stores nothing.
- `renameTab()` of the folders service: the update of links into the tab takes the file targets as well, and the
  "Rename tab" dialog counts the pages that show or link files of the tab.
- Specs: `content-structure.md` (moving and renaming files) and `wiki-links.md` ("Updates on a move or rename" and
  "Updates on a tab rename").

### Test

- Unit: the service (the order of the checks, every code, the unchanged move), `actions.test.ts`,
  `file-query.test.ts`.
- Integration: `integration/file-service.test.ts`: a rename updates the links and embeds of every page that is not
  deleted, with a revision each, and keeps the versions; a taken name, a tab of another folder and an older lock
  version are refused and change no page; `integration/folder-service.test.ts`: a tab rename updates
  `![[guides/diagram.png]]`.
- End to end, new `e2e/move-or-rename-file.spec.ts`: after renaming `guides/diagram.png` to `guides/network.png` every
  page shows or links it under the new name, the dialog named the number of pages, and the file keeps its versions;
  a move into the folder; a Reader is offered no "Move or rename" and its address shows the not-found page; a new
  version uploaded meanwhile makes the rename show the message, and confirming again stores it;
  `e2e/wiki-link-updates.spec.ts`: after renaming the tab `guides` to `manuals`, `![[guides/diagram.png]]` reads
  `![[manuals/diagram.png]]` in every page of the folder.

## Deleting and restoring files

### Goal

A Manager deletes a file as a soft delete, the deleted files are listed in "Deleted items" with the deleted pages and
restored with a name and a place, and deleting a tab deletes its files with its pages, in the browser and through
`delete_tab` (R1, R4, R19, R20, R24, R42).

### Build

- `?action=delete` on the details page for the roles with `deleteFile`: a `ConfirmDialog` with the lock version;
  `deleteFile()` stores the soft delete (`deletedAt`, no tab, the actor as last editor), refused with `file-changed`
  after a change meanwhile.
- "Deleted items": `listDeletedItems()` lists the deleted pages and files of the folder in one list, newest first,
  each marked as a page or a file, with its name, title (pages) or type (files), time, user and "Via";
  `/deleted-items/<folder>/<id>` shows a deleted file read-only with its details and its versions, without opening them,
  and "Restore" as its only action.
- `?action=restore` on a deleted file: the name and place dialog of pages for a file, the old name prefilled, no place
  preselected; `restoreFile()` with the checks of a restore of a page; a taken name is refused at the name field.
- `deleteTab()` of the folders service soft deletes the files of the tab in the same transaction as its pages; the
  "Delete tab" dialog names the number of files next to the number of pages; `delete_tab` through MCP names the
  deleted files next to the deleted pages in its result, and its description says that the files of the tab are
  deleted with it.
- Specs: `page-deletion.md` (the deleted items, deleted files), `content-structure.md` ("Deleting a tab") and
  `mcp.md` (`delete_tab`).

### Test

- Unit: the files service (`deleteFile()`, `restoreFile()`, every code), the folders service (`deleteTab()` with
  files), `tools.test.ts` (`delete_tab` names the files, the description), `file-query.test.ts` and the query of the
  deleted items.
- Integration: a deleted file loses its tab, its name is free at once, and its versions stay; a delete with an older
  lock version is refused; a restore under a taken name is refused; the rollback of the delete of a tab covers its
  files; a file uploaded into a tab while it is deleted never stays in the missing tab.
- End to end, new `e2e/delete-file.spec.ts`: a deleted file is missing from the section "Files", both its addresses
  show the not-found page, links to it show as missing; a Manager finds it in "Deleted items" marked as a file, next
  to a deleted page marked as a page, sees its details and versions and only "Restore", restores it under a name and a
  place, and it is listed again with all its versions; a taken name is refused at the name field; a Writer is offered
  no "Delete" and its address shows the not-found page; a new version uploaded meanwhile makes the delete show the
  message; after deleting a tab with two files both are among the deleted items and can be restored;
  `e2e/mcp-manager.spec.ts`: `delete_tab` of a Manager connection deletes a tab with two files and names both, and no
  other tool deletes a file.
- End to end: `e2e/delete-tab.spec.ts`, `e2e/deleted-items.spec.ts`, `e2e/restore-page.spec.ts`.

## Files in the editor

### Goal

Live preview shows the image of `![[…]]` under its line, the picker on `[[` offers the files of the folder next to its
pages, and the editor uploads nothing (R11, R29).

### Build

- `src/features/pages/editor-page-list.ts`: the list of the editor also holds the files of the folder that are not
  deleted, with their address, type, width and height, built on the server.
- `src/features/pages/editor/wiki-links.ts`: an embed and a link of a file show as the page view shows them; a missing
  file is marked with its hint.
- Live preview: a block widget from a `StateField` shows the image of an embed under its line, at most as wide as the
  editor, with its width and height reserved before it loads, and asks for a new measure when it has loaded; the
  Markdown of the embed stays visible on the lines of the cursor, as for other marks.
- `src/features/pages/editor/wiki-link-picker.ts`: the files of the folder among the options, each marked as a file
  and filtered by its name; choosing one inserts `[[name.ext]]` or `[[tab/name.ext]]`.
- The editor ignores pasted and dropped files: a drop or paste that carries files changes nothing, instead of the
  text that CodeMirror would read from a dropped file; the toolbar gets no upload button.
- Specs: `markdown-editor.md` ("What live preview shows", "Current limits") and `wiki-links.md` ("The editor").

### Test

- Unit: `editor-page-list.test.ts`; `src/features/pages/editor/wiki-links.test.ts` and `live-preview.test.ts` (the
  widget of an embed, the marks of a missing file); `wiki-link-picker.test.ts` (files among the options, the inserted
  target).
- Cost: `live-preview.cost.test.ts` with embeds of files in `src/test/editor-content.ts`.
- End to end: `e2e/editor-wiki-links.spec.ts`: in live preview `![[guides/diagram.png]]` shows the image below the
  line; typing `[[dia` offers `guides/diagram.png` marked as a file, and choosing it inserts `[[guides/diagram.png]]`;
  dropping and pasting a file into the editor changes nothing and uploads nothing; the toolbar has no upload button;
  `e2e/editor-preview.spec.ts` and `e2e/editor.spec.ts`.
- End to end, the complete suite: the last step of the second session.

## Files in search

### Goal

A search of a folder finds the files whose name matches its words, in the browser and through `search_pages`, each
marked as a file and leading to its details page (R30, R43).

### Build

- `searchFiles()` in the search service: the words of `parseSearch()`, each matched against the name of a file without
  its extension, with its parts split at the hyphens: exactly, by its start, and as a part of a word from 3 letters,
  as for page names; excluded words and `or` as for pages; no inflections and no typos, because names are no prose.
  Deleted files are never found. At most 100 files, ordered by how the words match (the whole name, the start of a
  part, a part of a word), then by name and place. The time limit and the slots of a search cover it.
- The results view: the matching files in a list "Files" above the pages, each with its name, place, type, size and
  last change, leading to its details page; the message without results counts files as well.
- `search_pages`: the result gets `files`, on the first window of results (`offset` 0), each with the details of R5
  and without content; the description and the output schema say so.
- Specs: `search.md` ("What a page is found by", "Results", "Search through MCP") and `mcp.md`.

### Test

- Unit: `service.test.ts` of search (the parse reaches the query of files as bound parameters), `tools.test.ts`
  (`search_pages` with `files`).
- Integration: `integration/search-service.test.ts`: `diagram` finds `guides/network-diagram.png`; a part of a word;
  an excluded word; a deleted file is not found; a word that appears only inside a PDF finds nothing.
- End to end: `e2e/search.spec.ts`: a search for `diagram` lists the file `guides/network-diagram.png` marked as a
  file, leading to its details page; `e2e/mcp-search.spec.ts`: the same search through MCP returns the file marked as
  a file, the same files as the browser, without content.

## Files through MCP

### Goal

Every connection lists the files of its folder and reads the details of one; no tool returns the content of a file,
and no tool uploads, changes, moves, renames or deletes a single file (R5, R6).

### Build

- `list_folder`: every file of the folder that is not deleted, with its name, tab, type, size, the width and height of
  an image, its last change, last editor and channel, and its address (the full URL of the file address) and the
  address of its details page.
- A new read tool `read_file`, by tab and name with the extension: the details of `list_folder` with the number of
  versions and the pages that show or link it, with their name, tab and title. A missing or deleted file is a tool
  error that points to `list_folder`. A Reader connection now has four tools, a Writer eight and a Manager twelve.
- The instructions of every role state the grammar of files: `[[name.ext]]` links a file, `![[name.ext]]` shows an
  image, the extensions, and that files are uploaded, changed and deleted only in the browser; `USER_TEXT_NOTE` and
  the `note` field also cover the names of files in the results.
- The log line of a call names the tab and the file name like a page name.
- Specs: `mcp.md` ("Tools", "Prompt injection", the instructions).

### Test

- Unit: `tools.test.ts` (the tools of each role against `FUNCTION_ROLES`, the outputs, the errors, no content in any
  result), `tool-schemas` of the new outputs.
- End to end: `e2e/mcp-read.spec.ts`: a Reader, a Writer and a Manager connection list the files of their folder and
  read the details of one; no result holds the bytes of an image or a PDF; a file of another folder cannot be read;
  the tools of each role are listed, and none of them changes a single file.
- End to end, the complete suite: the last step that changes more than documentation, unless "Spec tests" changes
  code.

## Spec tests

### Goal

Tests written from `spec/attachments-requirements.md` alone check the contract of files: the addresses and their
headers, the roles, the names and types, the links and embeds, and the MCP tools.

### Build

- Start the `spec-tester` agent (`.claude/agents/spec-tester.md`) with `spec/attachments-requirements.md` and wait for
  it, as "Step plans" in `spec/step-plan-workflow.md` says. The tests it keeps belong to this step.
- A finding with High confidence within the scope of this plan is fixed here, with the failing test of its Evidence;
  any other finding stops the plan.

### Test

- The tests the agent keeps pass, and the commands of "When a step is done" pass; the complete end-to-end suite runs
  here when the step changes code or tests.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/attachments.md`: its purpose, the code and the tests, the rules (files as
   items, names and types, the addresses and their headers, storage and the operator, uploading, versions, moving and
   renaming, deleting and restoring, links and embeds, the editor, search, MCP), its decisions from
   `spec/attachments-requirements.md` that still hold and those of this plan (the library choices of "Libraries", the
   upload address outside the proxy, the content-addressed blobs, the lock version), and its current limits (the
   "Not in" of the scope). Check that `architecture.md` (the feature `files` in the table of "Layout", "Terms",
   "Login and sessions", "Security headers", "Addresses and actions"), `testing.md` (the helpers `createFile()` and
   `e2e/support/files.ts`, the files directory of each worker, the specs of files) and `tech.md` (sharp for images)
   describe what the steps built.
2. Remove the entry "Attachments" from `roadmap.md`, and add the parts that may come later, each pointing to
   `spec/attachments-ideas.md`: S3-compatible storage, uploading from the editor, uploads and the content of files
   through MCP, the text of PDFs in search, more types, a list of unused files (with "Broken links and orphaned
   pages"), quotas (with "Rate limits and quotas"), and the backup of the files directory (with "Database backups").
3. Check that `README.md` has the commands a developer needs (the files directory of `npm run dev`, the volume of the
   container image) and that its summary of the prototype covers files.
4. Delete this step file and `spec/attachments-requirements.md`. The requirement IDs (`R1` to `R43`) leave the
   comments of the code and the tests in the same step: each is replaced by the section of `spec/attachments.md`
   that holds the rule now, or dropped with its sentence kept.
5. Update the spec catalog in `CLAUDE.md`: add `spec/attachments.md`, remove this step file and
   `spec/attachments-requirements.md`, and keep `spec/attachments-ideas.md` as the research the roadmap points to.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
- `grep -rnE "\bR[0-9]{1,2}\b" src e2e integration` finds no requirement ID of this plan.
