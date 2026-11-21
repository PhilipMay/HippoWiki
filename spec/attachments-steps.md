# Attachments – Steps

## Goal

Users of a folder upload images (PNG, JPEG, GIF, WebP) and PDFs as files of their own, directly in the folder or in a
tab, next to the pages. Pages show images with `![[…]]` and link files with `[[…]]`, every file has an address that
returns the file itself and a details page with its versions and actions, and files are found by search and read
through MCP by their details. The requirements are `spec/attachments-requirements.md`; every requirement ID is covered
by a step below.

## Scope

- In: everything "In" of the scope of `attachments-requirements.md`: images and PDFs as items of folders and tabs;
  their two addresses; uploading from the views of folders and tabs, with the removal of photo metadata; versions with
  revert; showing and linking files in pages, with the index of links, the missing display and the updates on a move,
  a rename and a tab rename; moving, renaming, deleting and restoring files; "Deleted items" at `/deleted-items`; the
  section "Files" of folders and tabs; images in live preview and files in the picker on `[[`; files by name in search,
  in the browser and through `search_pages`; listing files and reading their details through MCP; the mounted
  directory and the size limit of the container image.
- Not in: everything "Not in" of that scope: other file types; uploading, changing, moving, renaming or deleting files
  through MCP; uploading from the editor; quotas per folder or user; S3-compatible storage; links that work without a
  login; the text inside PDFs in search; the content of files through MCP; a host of its own for files; a list of
  unused files; redirects from `/deleted-pages`. Also not in, as decided below: HTTP Range requests, smaller renditions
  of large images, files in the view "All pages", and a cleanup of blobs that no version uses.

## Libraries

Checked against the npm registry on 2026-11-21. Only one new package is added.

- sharp (`sharp`, Apache-2.0, libvips LGPL-3.0, 0.35.5): used, as a direct dependency. It reads width and height, turns
  a photo upright by its EXIF orientation and removes all metadata when it encodes again (its default, without
  `keepMetadata()`), for all four image types, animated GIF and WebP included (`animated: true`). It is an optional
  dependency of Next.js today, so it is in `node_modules/` already, but the app must not rely on an optional dependency
  of another package. It is on the built-in `serverExternalPackages` list of Next.js, so it needs no configuration in
  `next.config.ts`. There is no maintained library that removes metadata without encoding again for all four types, and
  none can turn the pixels upright without it.
- Not used, with the reason:
  - `file-type`: nine dependencies for a check that our own code does in a few lines for five types by their magic
    bytes (PNG, JPEG, GIF, WebP, PDF); everything else is refused, SVG and HTML included.
  - `image-size`, `exifr`, `piexifjs`: sharp already reads the sizes; the others only read EXIF or only handle JPEG and
    are unmaintained.
  - `busboy`, `@fastify/busboy`, `formidable`: the upload sends the file itself as the body of the request, so there is
    no multipart body to parse.
  - `send`, `etag`, `fresh`, `range-parser`: `send` needs the request and response of Node.js, a route handler answers
    with a web `Response`; the SHA-256 of a blob is its ETag, and comparing `If-None-Match` is a few lines; Range is not
    needed, because the PDF viewers of Firefox and Chrome load a whole file when the response has no `Accept-Ranges`.
  - `content-disposition`: file names follow the name rule and are ASCII only, so `filename="<name>"` needs no
    encoding.
  - `write-file-atomic`: `node:fs/promises` writes a temporary file, syncs it and renames it in a few lines;
    `fs.statfs` is built in.
  - `slugify`, `@sindresorhus/slugify`: `deriveName()` of `src/features/pages/derive.ts` already turns
    `Network Diagram (v2)` into `network-diagram-v2`.
  - `mime`, `mime-types`: five types are a map of five entries.
  - markdown-it and CodeMirror plugins for Obsidian embeds (`markdown-it-obsidian`, `ink-mde` and others): unmaintained
    or whole editors; the wiki already has its own `wiki_link` rule in `src/features/pages/markdown.ts` and its own
    extension of the Lezer parser in `src/features/pages/editor/wiki-links.ts`, which embeds extend.

## Design

Decisions that several steps rely on:

- The feature is `src/features/files/`, with the modules of `architecture.md`: `schema.ts`, `service.ts`, `forms.ts`,
  `queries.ts`, `actions.ts`, `http.ts` (the upload and the file addresses), `components/`, and pure modules for the
  names, the types and the address of a file.
- The bytes live on disk as immutable blobs, each named by the SHA-256 of its content, below the directory
  `HIPPOWIKI_FILES_DIR`; temporary files of uploads live in a directory inside it, so that a finished upload is renamed
  into place on the same file system. A blob is written first and the rows after it in one transaction, so that a
  failure leaves no row without its blob. Versions are rows that name a blob: a revert names an old blob again, and
  the same bytes uploaded twice are one blob.
- Three models: `File` (folder, tab, name with extension, type, the soft delete, the last editor and channel, the
  version for optimistic locking), `FileVersion` (number, blob, time, user, channel, the version a revert went back to)
  and `FileBlob` (SHA-256, size, width and height of an image). A file in a tab and a file placed directly in a folder
  are unique by name like pages, deleted files never block a name, and a deleted file forgets its tab.
- The type of a file is fixed by its first upload: the extension of its name names it, the content must match it, and
  a new version must be of the same type.
- The upload is a route handler, not a Server Action: a Server Action takes at most 1 MB and reads the body into
  memory, and the limit of the wiki is set when the server runs. The browser sends the file itself as the body of a
  `POST` to `/api/uploads/<folder>[/<tab>]/<name.ext>`. That address is left out of the matcher of `src/proxy.ts`,
  because the proxy buffers the body of every request it runs on and cuts it silently after 10 MB
  (`experimental.proxyClientMaxBodySize`); the handler checks the session itself, refuses an `Origin` other than the
  wiki and a `Sec-Fetch-Site` of `cross-site`, and stops reading at the limit.
- The addresses of the files themselves, `/files/<folder>[/<tab>]/<name.ext>`, are a route handler behind the login
  (the proxy sends a request without a session cookie to the login page), which checks the session and the role on
  every request and answers a missing file, a deleted file and a file without a role with the not-found page.
- Every response of a file address carries headers of its own instead of those of the app: the stored type,
  `X-Content-Type-Options: nosniff`, `Content-Disposition: inline` with the name, `Cache-Control: private, no-cache`,
  the SHA-256 as `ETag` with 304 answers, `Cross-Origin-Resource-Policy: same-origin`, and a Content Security Policy
  that allows nothing (`default-src 'none'`), for images with `sandbox`. A PDF gets no `sandbox`, because Chrome shows
  no PDF under it (Jira and Redmine leave PDFs out of it for the same reason); its viewer is the browser's own, and
  the PDF still runs on no script of the wiki.
- The writes of files take the actor of the browser (`BrowserActor`), so that no MCP tool can call them; the reads take
  every content actor.
- A wiki link target with an accepted extension names a file (`[[name.ext]]`, `[[tab/name.ext]]`); every other target
  stays as it is. The index of links stores file targets in the same model `PageLink`, so that backlinks, counts and
  the updates on moves and renames work for files without a second index, and the limit of 5,000 links counts them.

## Sessions

The plan runs in three sessions. Stop points:

- after "The details page of a file, its versions and revert";
- after "Files in the Markdown editor".

## Checklist

- [ ] File names, types and addresses
- [ ] File storage and image processing
- [ ] Files in the database and the files service
- [ ] Serving files
- [ ] Files in folder and tab views, and uploading
- [ ] The details page of a file, its versions and revert
- [ ] Wiki links and embeds of files
- [ ] Moving and renaming files
- [ ] Deleted items
- [ ] Deleting and restoring files
- [ ] Files in the Markdown editor
- [ ] Files in search
- [ ] Files through MCP
- [ ] Files in the container image
- [ ] Spec tests
- [ ] Wrap-up

## File names, types and addresses

### Goal

The pure rules of a file: its name, its type and its addresses, which every later step uses (R2, R21, R36, R3, R4).

### Build

- `src/features/files/file-names.ts`, without imports of Zod or server-only modules, so that Client Components use it:
  - the accepted extensions `png`, `jpg`, `gif`, `webp` and `pdf`, each with its type, its media type and whether it is
    an image;
  - the rule of a file name: a stem under the name rule of pages (`NAME_PATTERN` of `src/lib/names.ts`, at most
    `NAME_MAX_LENGTH` characters), a dot and one accepted extension, all lowercase; `.jpeg` and a second dot break it;
  - `suggestFileName()`: the name of an uploaded file turned into a file name, the stem through `deriveName()` of
    `src/features/pages/derive.ts`, the extension in lower case with `jpeg` as `jpg`
    (`Network Diagram (v2).PNG` → `network-diagram-v2.png`, `photo.jpeg` → `photo.jpg`); a name without a usable stem,
    such as a pasted screenshot, gets `file-<date>-<time>` as its stem; a name without an accepted extension gets none,
    so that the dialog shows the rule.
- The schema of a file name in `src/features/files/schema.ts` with `nameSchemaWith()` of `src/lib/names.ts` and the
  extension, with the message of the rule that names the accepted extensions.
- `src/features/files/file-types.ts`: the type of a file from its first bytes, by the magic bytes of the five types
  (PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, GIF `GIF87a` or `GIF89a`, WebP `RIFF` and `WEBP` at byte 8, PDF
  `%PDF-`), and `null` for anything else, so that HTML, SVG and every other content is refused.
- The addresses in `src/lib/addresses.ts`: `filePath()` for `/files/<folder>[/<tab>]/<name.ext>` with an optional
  version (`?version=<n>`), `fileDetailsPath()` for `/folders/<folder>[/<tab>]/<name.ext>` with an optional action,
  and `parseFileSegment()`, which tells a segment with an accepted extension from a tab (no dot) and a page (`.md`).

### Test

- Unit tests of `file-names.ts` with the examples of R21 and R36: the suggestions above; upper case, a space, a second
  dot and `.jpeg` refused with the rule; the stem limit; a name without a stem or an extension.
- Unit tests of `file-types.ts`: each of the five types from real headers; HTML, SVG, text and an empty file are
  `null`, also when the name ends in `.png`.
- Unit tests of the new helpers in `src/lib/addresses.test.ts`, also that `setup.png`, `setup.md` and `setup` are a
  file, a page and a tab.
- No end-to-end spec: nothing the app runs uses the modules yet.

## File storage and image processing

### Goal

The bytes of files are kept in the mounted directory, uploads are limited in size, and photos lose their metadata and
stand upright (R25, R26, R27, R39).

### Build

- `src/lib/env.ts`: `HIPPOWIKI_FILES_DIR`, optional, the directory of the files; `HIPPOWIKI_FILE_SIZE_LIMIT`, optional,
  the limit of a file in bytes, a whole number from 1,048,576 to 1,073,741,824, default 26,214,400 (25 MB), read like
  the limits of MCP.
- `src/features/files/storage.ts`, the store of blobs on disk, with `node:fs/promises` only:
  - whether the store is usable: the variable is set and names a directory that the server may write; otherwise the
    reason;
  - receiving an upload: a stream is written into a new temporary file in the directory of temporary files, counted,
    hashed with SHA-256 while it is written and stopped one byte past the limit; then synced and renamed into its place
    `blobs/<first two hex digits>/<sha256>`, or dropped when that blob exists already;
  - every failure removes the temporary file: a body over the limit (`too-large`), a full disk (`ENOSPC` and `EDQUOT`
    as `storage-full`), an aborted request and any other error, so that nothing of a refused upload stays stored;
  - opening a blob as a stream with its size;
  - removing the temporary files left by an earlier run.
- `src/features/files/images.ts` with sharp, added to `package.json` as a direct dependency in its latest stable
  version:
  - the width and height of an image as shown, after its orientation;
  - with the removal of metadata on: the image turned upright by its orientation and encoded again in its own type,
    without any metadata, JPEG and WebP with a high quality; an animated GIF or WebP keeps its frames; an animated
    image, which sharp turns only by 180 degrees, is turned as far as sharp can;
  - the limits of untrusted input: `failOn: "warning"`, a pixel limit below the default of sharp, only the loaders of
    the four types (`sharp.block()` and `sharp.unblock()`), the cache of libvips off, and a few images processed at the
    same time (`createSlots()` of `src/features/search/slots.ts`, moved to `src/lib/` now that two features use it); an
    image that sharp cannot read is refused as `invalid-image`.
- `src/instrumentation.ts` (`register()`, on the Node.js runtime only): at the start of the server it logs a warning
  that names the reason when the store is not usable, and removes the temporary files of an earlier run.
- The servers of the end-to-end tests get a directory of files each (`playwright.config.ts`, below the directory of
  the worker), and the mocked environment of the integration tests one directory per run.
- `.env.example` and `README.md`: the two variables, and a directory of files for the development server that Git
  ignores.

### Test

- Unit tests of the environment: defaults, bounds and refused values of `HIPPOWIKI_FILE_SIZE_LIMIT`.
- Unit tests of `storage.ts` against a temporary directory: a file of exactly the limit is stored, one byte more is
  refused and leaves no file; a full disk simulated by a write that fails with `ENOSPC` leaves no file; the same bytes
  twice give one blob; a missing or read-only directory is reported as not usable; temporary files are removed.
- Unit tests of `images.ts` with images made by sharp in the test, no binary fixtures: a JPEG with a GPS position,
  camera data and orientation 6 comes out without any EXIF, with width and height swapped; with the option off the
  bytes stay as uploaded; an animated GIF keeps its frames; a PNG with text chunks loses them; a broken image and one
  over the pixel limit are refused.
- A cost test (`images.cost.test.ts`) of the processing of a large photo within a time budget.
- The complete end-to-end suite, because `src/lib/env.ts` and `playwright.config.ts` change.

## Files in the database and the files service

### Goal

Files, their versions and their blobs are stored with the role checks of the folder, and an upload stores a new file
or a new version (R1, R2, R8, R15, R21, R25, R32, R34, R39, R42).

### Build

- `prisma/schema.prisma` and a migration that only adds: the models `File`, `FileVersion` and `FileBlob` and the enum
  of the five types, as "Design" describes, with the composite foreign key of a file's tab and folder, the partial
  unique indexes of `Page`, an index for the files of a folder that are not deleted, and restricting foreign keys.
- `FUNCTION_ROLES` in `src/features/folder-roles/roles.ts`: `editFile` (upload a file or a new version, revert, move
  and rename) for a Writer and `deleteFile` for a Manager; the deleted files belong to `deletedPages`, which the step
  "Deleted items" renames.
- `src/features/files/service.ts`, under the rules of "Services" in `architecture.md`, the order of the checks
  included:
  - `findFileForUpload()`: whether a file of the name exists at the place, with its version and type, so that the
    dialog asks its question before it sends the body;
  - `uploadFile(actor, input, body)`: the folder, the tab (or none), the name, the removal of metadata, and for a new
    version the version of the file it is based on; the body is a web stream. It checks the actor, the role, the place
    and the name before it reads a byte, then the store, then receives the body, checks the type from the bytes against
    the extension (R2, R32) and against the type of the file for a new version (R34), processes an image, and stores
    the blob, the version and the file in one transaction. A name taken at the place without a stated version is
    `name-taken`; a stated version that is not the stored one is `file-changed` (R42); the codes of the store and of
    the images are passed on. The temporary file is removed on every path;
  - `listFiles()` of a folder or a tab, `getFile()` with its versions and last editor, and `openFile()` with the blob
    of the current or of a given version, all `null` for a missing or deleted file and for an actor without a role;
  - every write logs as the writes of pages do, with the folder, tab, file and channel, never the bytes.
- `createFile()` in `e2e/support/database.ts`, which stores a blob in the directory of the worker and the rows, for
  the integration and end-to-end tests.

### Test

- Unit tests of the new schemas and of `roles.ts`.
- Integration tests `integration/file-service.test.ts`: each of the five types stored, directly in the folder and in a
  tab, with no page around it (R1); another type and HTML named `.png` refused, nothing stored (R2, R32); a taken name
  and a new version with and without the right version (R15, R42); a PDF as a new version of a PNG refused (R34); the
  limit of 25 MB with one byte more (R25); a store that is not usable and a full disk (R39); a Reader and an admin
  refused before the body is read (R8); a page `setup` and a file `setup.png` side by side (R21); the reads for an
  actor without a role and for MCP.
- `integration/db-errors.test.ts`: the new unique indexes are recognised.
- `e2e/smoke.spec.ts`, because the migration only adds.

## Serving files

### Goal

Every file has an address that returns the file itself to a logged-in user with a role, safely (R3, R7, R28, R32).

### Build

- `src/app/files/[folder]/[...path]/route.ts` with `GET` and `HEAD`, which hands the request to `src/features/files/http.ts`:
  `requireUser()`, the segments parsed (a file, or a tab and a file), `?version=<n>` as the only search parameter,
  `openFile()` of the service, and `notFound()` for everything that is not a file the user may read, the same for a
  missing file, a deleted one, a folder without a role and an admin (R7, R28).
- The response streams the blob with the headers of "Design"; `If-None-Match` with the ETag answers 304 without a body.
- `next.config.ts`: the headers of the app are left off `/files/`, whose route sets its own set, with
  `Strict-Transport-Security` and `Referrer-Policy` like the app.
- The step checks that `notFound()` in the route handler shows the not-found page of the app; if it does not, the
  route renders the same answer as a missing page, and the step says how in its report.

### Test

- End-to-end tests `e2e/files.spec.ts` with files from `createFile()`: an image opens at its address and an `<img>` of
  the wiki loads it; a PDF is answered inline as `application/pdf` (Chromium of Playwright downloads PDFs, so its
  viewer is a manual check); the headers of an image, a PDF, a version and a 304; the not-found page for a missing
  file, a user without a role and an admin, the same at the addresses of a file that does not exist (R7); the login
  page without a login, and the not-found page on the next request after the Owner removed the role (R28).
- `e2e/security-headers.spec.ts`: the headers of the app on every other address stay as they are.
- The complete end-to-end suite, because `next.config.ts` changes.
- Manual: a PDF opens in the viewers of Chrome, Firefox and Safari, and an image opened directly shows in all three.

## Files in folder and tab views, and uploading

### Goal

A folder and a tab list their files, and a Writer, Manager or Owner uploads a file into them (R8, R9, R10, R15, R21,
R25, R26, R38, R39).

### Build

- `FolderView` and `TabView`: a section "Files" below the pages, each file with its name as a link to its details
  page, its type, its size and its last change with its last editor and channel; no section without files (R9, R38).
- The action `upload` on the folder and the tab address (`?action=upload`, with `&name=<name.ext>` for the missing
  links of R31), offered as "Upload file" to the roles of `editFile` while the store is usable, and the not-found page
  otherwise (R10, R39); the tables of `folder-query.ts` hold it.
- `UploadFileDialog`, a Client Component on `ActionDialog`: the file field, accepting the five types; the name field,
  filled with the suggestion when a file is chosen and checked against the rule at the field (R21, R36); for an image
  the switch "Remove location and other photo data", on by default, and none for a PDF (R26); on "Upload" it asks
  `findFileForUpload()` through a Server Action, asks "Store as a new version?" when the name is taken (R15), and then
  sends the file to the upload address with the version it was asked about. While it uploads, the dialog is locked and
  shows that it is uploading. The answer leads to the details page of the file, or shows the message at the field or
  above it: the accepted types (R2), the limit (R25), a full disk (R39), a changed file (R42).
- `src/app/api/uploads/[folder]/[...path]/route.ts` and `handleUpload()` in `src/features/files/http.ts`, as "Design"
  describes: left out of the matcher of `src/proxy.ts` with its reason in the comment, the session through
  `getCurrentUser()` of `src/features/auth/session.ts`, the checks of `Origin` and `Sec-Fetch-Site`, a `Content-Length`
  above the limit refused before the body is read, the service called with `request.body`, the answer as JSON with the
  address of the details page or the message, and `revalidateContent()` after a stored upload.

### Test

- End-to-end tests `e2e/upload-file.spec.ts`: each of the five types uploaded into the folder and into a tab and
  listed in its section (R2, R9, R10); a text file refused with the accepted types and nothing listed; the suggested
  name of R21 and R36 and a name that breaks the rule refused at the field; the question for a taken name, confirmed
  with two versions and cancelled with nothing stored (R15); a file over the limit refused with the limit in the
  message (R25, with a small limit for these servers: the limit of 25 MB itself is in the integration tests); a photo
  made in the test with GPS and orientation has no EXIF at its address and is upright with the switch on, and is
  stored as uploaded with it off, and a PDF offers no switch (R26); a folder without files shows no section but
  "Upload file" for a Writer (R38).
- The same spec: a Reader sees no "Upload file", `?action=upload` shows a Reader the not-found page, and a `POST` of a
  Reader, an admin, a request without a login and a request from another origin to the upload address stores nothing
  (R8).
- Unit tests of `handleUpload()` with a mocked service, and of the new tables of `folder-query.ts`.
- The complete end-to-end suite, because `src/proxy.ts` changes.
- Manual: an upload from a phone, and an upload over a slow connection.

## The details page of a file, its versions and revert

### Goal

Every file has a details page with its details, its versions and the actions of the role, and a Writer uploads a new
version or reverts to an earlier one (R4, R8, R16, R33, R34, R42).

### Build

- The routes `src/app/folders/[folder]/[item]/page.tsx` and `src/app/folders/[folder]/[item]/[page]/page.tsx` tell a
  file segment from a tab and a page with `parseFileSegment()` and show `FileView`; `fileAddressOf()` in
  `src/features/files/file-query.ts` decides what the address shows, with the actions of the file and the lowest role
  of each (`mayDoFileAction()`), like `pageAddressOf()`.
- `FileView` (R33): the breadcrumb; a preview of an image at most as wide as the text, and "Open" for a PDF; the name
  and place, the type, the size, the width and height of an image, the number of versions, the last change with its
  last editor and channel; the link to copy, `![[…]]` for an image and `[[…]]` for a PDF, with a copy button; "Open",
  which opens the address of the file, and "Download", which saves it under its name; the versions, newest first, each
  with its user, channel and time and a link to the file in that version (R16).
- `?action=upload-version`, "Upload new version" for the roles of `editFile` (R34): the dialog of the upload with the
  file field for the type of the file, and the version of the file the dialog was opened with.
- `?action=revert&version=<n>`, "Revert" at every older version for the roles of `editFile` (R16): a `ConfirmDialog`
  and the Server Action `revertFile()`, with `revertFile()` of the service, which stores a new version with the blob of
  the old one, based on the version of the file.
- A refused change shows the dialog again with `&notice=changed`, the file as stored and a message that names who
  changed it and when, as for pages (R42, `optimistic-locking.md`).

### Test

- End-to-end tests `e2e/file-details.spec.ts`: every detail of R33 for an image and for a PDF, "Open" and "Download";
  a new version of a PNG added and a PDF for it refused (R34); a revert to version 1 of a file with two versions gives
  three versions and the content of version 1 at its address (R16); a Reader sees the versions but no "Upload new
  version" or "Revert", and both actions show a Reader the not-found page (R8); a new version uploaded in a second
  browser while the dialog was open is refused with the message, and stored when confirmed again (R42).
- Integration tests of `revertFile()`; unit tests of `file-query.ts`.
- The end-to-end specs of the page routes, because both page routes change: `e2e/pages.spec.ts`, `e2e/tabs.spec.ts`,
  `e2e/access.spec.ts`; and the complete suite, because this step ends the first session.

## Wiki links and embeds of files

### Goal

Pages show images with `![[…]]` and link files with `[[…]]`, under the rules of wiki links, and the details page lists
the pages that use a file (R12, R13, R14, R22, R23, R31, R35, R41).

### Build

- `src/features/pages/wiki-link-target.ts`: a target with an accepted extension names a file of the folder; `.jpeg`,
  another extension and every other break of the rule stay as they are.
- `src/features/pages/markdown.ts`: `![[target]]` and `![[target|label]]` become an embed when the target names a
  file, under the rules of wiki links (code, a backslash, one line); `![[setup]]` stays `!` followed by a link (R12).
  `plainText()` reads an embed like a link, so the title, the suggested name and the search text treat it as one.
- `src/features/pages/wiki-links.ts`: the links of a content and the targets of the index include file targets, which
  `PageLink` stores with the file name as the name of the target; `LINK_INDEX_VERSION` counts up, so that the start of
  the server derives every page again. The limit of 5,000 counts embeds and links of files (R41).
- `resolveWikiLinks()` of the pages service and `markdownToReact.tsx`: a file target is resolved against the files of
  the folder that are not deleted; an image embed shows `<img>` from the file address with the stored width and
  height, `loading="lazy"`, at most as wide as the text, the label or the name as its alt text, inside a link that
  opens the file in a new tab (R22); a PDF embed and every link to a file are a link to the file address with the
  label or the name (R23); a missing file is marked like a missing page, and leads a Writer, Manager or Owner to
  `?action=upload&name=<name.ext>` of its folder or tab when the place exists (R13, R31). Revisions and deleted pages
  show the current version, because the address names no version (R35).
- The details page lists the pages of the folder that show or link the file, like "Linked from" (R14).

### Test

- Unit tests of the target, of the parse and of the links of a content: embeds and file links, `![[guides/setup]]`, a
  code span, a backslash, the limit of 5,000 with links of files counted.
- Integration tests: the index stores file targets, and the backlinks of a file follow a save that removes the link
  (R14); `integration/search-index.test.ts` derives a page with file links again.
- End-to-end tests `e2e/file-links.spec.ts`: a small image keeps its size, a wide one fits the text, the alt text, a
  click opens the file in a new tab (R22); both forms for a PDF are a link with `report.pdf` (R23); a link to a missing
  file, a deleted file and a file of another folder shows as missing (R13); a Writer follows a missing file link to the
  upload dialog of the tab with the name, a Reader sees marked text (R31); an old revision shows the new version of an
  image (R35); the details page lists both pages (R14).
- The specs of wiki links and pages: `e2e/wiki-links.spec.ts`, `e2e/wiki-links-spec-tests.spec.ts`,
  `e2e/pages.spec.ts`, `e2e/page-history.spec.ts`, `e2e/deleted-pages.spec.ts`.

## Moving and renaming files

### Goal

A Writer moves and renames a file, and the links and embeds in the pages follow, as for pages and on a tab rename (R17,
R18, R42).

### Build

- `?action=move-or-rename` on the details page for the roles of `editFile`, with `MoveOrRenameFileDialog`: the name
  field with the extension of the file and the place choice of `PageNameAndPlaceFields`, made usable for files, and
  the number of pages whose links will change (R17).
- `moveOrRenameFile()` of the service, like `moveOrRenamePage()`: based on the version (R42), the lock of the folder
  taken exclusively, the links in every page of the folder updated with `updateLinks()` in the same write with a
  revision marked as an update of links, the extension kept, the own name and place stored as nothing, and a taken
  name refused at the field. The file keeps its versions.
- `renameTab()` updates the file links into the tab with the page links; the "Rename tab" dialog and `rename_tab`
  count and name the pages that hold links to its files as well (R18).

### Test

- Integration tests of `moveOrRenameFile()` and of a tab rename with file links.
- End-to-end tests `e2e/move-or-rename-file.spec.ts`: a rename of `guides/diagram.png` to `guides/network.png`
  changes every page that shows or links it, the dialog named their number, the versions stay (R17); a new version
  uploaded meanwhile refuses the rename, which works when confirmed again (R42); a Reader gets no action.
- `e2e/wiki-link-updates.spec.ts`: a tab rename changes `![[guides/diagram.png]]` to `![[manuals/diagram.png]]` (R18).
- The specs of tabs and MCP writes that the tab rename touches: `e2e/tabs.spec.ts`, `e2e/mcp-manager.spec.ts`.

## Deleted items

### Goal

The deleted pages of a folder become its deleted items, at `/deleted-items`, ready to hold deleted files (R37, R40).

### Build

- The routes move from `src/app/deleted-pages/` to `src/app/deleted-items/`; the button and the heading say "Deleted
  items"; the helpers of `src/lib/addresses.ts` and `src/lib/revalidate.ts` name `/deleted-items`; `deletedPages` of
  `FUNCTION_ROLES` becomes `deletedItems`; the results of `delete_page` and `delete_tab` name the new address.
- Nothing answers below `/deleted-pages`, so its addresses show the not-found page, with no redirect (R40).

### Test

- The end-to-end specs of deleted pages and restores renamed and changed to the new addresses and names, with tests
  that `/deleted-pages/<folder>` and `/deleted-pages/<folder>/<id>` show the not-found page (R40) and that a Manager
  reaches "Deleted items" from the folder (R37).
- The unit and integration tests that name the old addresses.
- The complete end-to-end suite, because `src/lib/revalidate.ts` changes.

## Deleting and restoring files

### Goal

A Manager or Owner deletes a file softly, also with its tab, and restores it with its versions from "Deleted items"
(R8, R13, R19, R20, R24, R42).

### Build

- `?action=delete` on the details page for the roles of `deleteFile`, a `ConfirmDialog` based on the version of the
  file (R42), and `deleteFile()` of the service: the soft delete of pages, the tab forgotten, the user who deleted it
  as the last editor (R19).
- "Deleted items" lists the deleted pages and files of the folder in one list, newest first, each marked as a page or
  a file (R24). `/deleted-items/<folder>/<id>` shows a deleted file read-only: its details and versions without a
  preview and without links to its content, whose address shows the not-found page, and "Restore" as its only action.
- `?action=restore` on a deleted file asks for a name and a place in its folder, with the old name and no place
  preselected, a taken name refused at the field (R24), and `restoreFile()`, with all its versions (R19).
- `deleteTab()` soft deletes the files of the tab with its pages, in the same transaction; the "Delete tab" dialog
  names the number of files as well (R20).
- `delete_tab` through MCP refuses a tab that holds files, with a tool error that says to delete it in the browser, so
  that no tool deletes a file (R6); its description says so.

### Test

- Integration tests of `deleteFile()`, `restoreFile()`, of `deleteTab()` with files, and of `delete_tab` with files.
- End-to-end tests `e2e/delete-file.spec.ts`: a deleted file is missing from "Files", both its addresses and the
  version addresses show the not-found page, a link to it shows as missing (R13, R19); a Writer gets no "Delete" (R8);
  a file and a page appear in one list, marked; a restore asks for name and place and refuses a taken name; the
  restored file has all its versions (R24); deleting a tab with two files lists both, which can be restored (R20); a
  change meanwhile refuses the delete (R42).
- The specs of deleted items, restores, tabs and MCP: `e2e/deleted-items.spec.ts`, `e2e/restore-page.spec.ts`,
  `e2e/delete-tab.spec.ts`, `e2e/mcp-manager.spec.ts`.

## Files in the Markdown editor

### Goal

Live preview shows images, the picker on `[[` offers files, and the editor uploads nothing (R11, R29).

### Build

- `src/features/pages/editor-page-list.ts`: the list of the editor holds the files of the folder with their place,
  type, address, width and height.
- `src/features/pages/editor/wiki-links.ts` and `live-preview.ts`: `![[…]]` of an image shows the image in a block
  widget under its line, from a `StateField`, which asks CodeMirror to measure again when the image has loaded; a
  missing file is marked like a missing page; file links show their label or name; Ctrl+click or Cmd+click opens the
  file or, for a missing file, the upload dialog.
- `src/features/pages/editor/wiki-link-picker.ts`: the files are offered next to the pages, each marked as a file, and
  choosing one inserts `[[name.ext]]` or `[[tab/name.ext]]` (R29).
- The editor ignores a pasted or dropped file, which CodeMirror otherwise inserts as text, and the toolbar gets no
  upload button (R11).

### Test

- Unit tests in the `node` environment of Vitest: the widget of an embed, the picker with files, the editor list with
  files.
- End-to-end tests `e2e/editor-files.spec.ts`: the image below the line of `![[guides/diagram.png]]` in live preview,
  `[[dia` offering `guides/diagram.png` marked as a file and inserting its link (R29), pasting and dropping a file
  changing nothing and storing no file (R11).
- The editor specs: `e2e/editor.spec.ts`, `e2e/editor-preview.spec.ts`, `e2e/editor-wiki-links.spec.ts`,
  `e2e/editor-spec-tests.spec.ts`, `e2e/editor-toolbar.spec.ts`; and the complete suite, because this step ends the
  second session.

## Files in search

### Goal

Search finds files by their name, in the browser and through `search_pages` (R30, R43).

### Build

- `searchPages()` of the search service also reads the files of the folder that are not deleted whose name matches
  the words: every word that is not excluded is a part of the name, a phrase is its words joined by hyphens, `or`
  gives alternatives and an excluded word removes a file, in lower case and as bound parameters; no stemming and no
  typos for files. The matching files follow the pages in the same list, sorted by name, within the 100 results.
- The results in the browser show a file with its name as a link to its details page, its place, its type, its size
  and its last change, marked as a file, without a piece of text.
- `search_pages` marks each result as a page or a file; a file comes with its name, tab, type, size, width and height,
  address and last change, and never with its content (R43).

### Test

- Unit tests of the match of a file name to the parsed words.
- Integration tests in `integration/search-service.test.ts`: `diagram` finds `guides/network-diagram.png`, excluded
  words, `or`, deleted files and other folders left out.
- End-to-end tests in `e2e/search.spec.ts` (R30, a word inside a PDF finds nothing) and `e2e/mcp-search.spec.ts`
  (R43, the same files as the browser).

## Files through MCP

### Goal

An AI app lists the files of its folder and reads the details of one, and changes none (R5, R6).

### Build

- `list_folder` lists the files of the folder after its pages: name, tab, type, size, address and last change with
  last editor and channel.
- A new read tool `read_file_details` for every connection, by tab and name: name and place, type, size, width and
  height of an image, its versions, its last change, its address and the pages that show or link it, with their name,
  tab and title; never the content (R5). An unknown file is a tool error that points to `list_folder`.
- The instructions of every connection state the grammar of file links and embeds, that files are uploaded,
  changed and deleted in the browser only, and that the content of a file cannot be read; no tool uploads, changes,
  moves, renames or deletes a file (R6).

### Test

- Unit tests in `src/features/mcp/tools.test.ts` and of the tool schemas, with the counts of tools of each role.
- End-to-end tests in `e2e/mcp-read.spec.ts`: a Reader, a Writer and a Manager connection list the files and read the
  details of one, no result holds the bytes (R5); `e2e/mcp-access.spec.ts`: no connection reaches the files of another
  folder; the list of tools of each role holds no tool that writes a file (R6).

## Files in the container image

### Goal

The image keeps the files in a mounted directory, starts without it, and its smoke test checks both (R27, R39).

### Build

- `Containerfile`: the image sets `HIPPOWIKI_FILES_DIR=/app/files` and does not create the directory, so that it
  exists only as a mounted volume; sharp and its platform packages (`node_modules/sharp` and `node_modules/@img`) are
  copied from the `deps` stage like `@node-rs`, if the standalone output does not trace them.
- `scripts/image.sh smoke`: a container without the volume logs the warning and serves the login page; a container
  with a volume writable by `node` (`:U`) stores an uploaded photo without its metadata, returns it at its address and
  still returns it after a new container is started on the same volume.
- `README.md`: the volume in the example of running the image.

### Test

- `npm run image:build` and `npm run image:smoke` pass.
- The complete end-to-end suite does not run again: nothing the end-to-end servers run changes. The specs that the
  step affects: none.
- Manual: the image on the server behind Traefik with a bind mount, a backup of the database followed by a copy of the
  directory, restored into a new installation, with every file back (R27).

## Spec tests

### Goal

Tests written from the requirements alone find where the code or the requirements are wrong.

### Build

- Start the `spec-tester` agent (`.claude/agents/spec-tester.md`) with `spec/attachments-requirements.md` and wait for
  it. The tests it keeps belong to this step. A finding with High confidence within the scope of the plan is fixed
  here, and the failing test of its Evidence is added back with the fix; any other finding stops the plan, as "When a
  step cannot be finished" in `spec/step-plan-workflow.md` says.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass, with the end-to-end specs the agent
  added or changed.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in a new `spec/files.md`: the purpose, the pointers to the code and the tests, the
   rules (types and names, the two addresses and their headers, roles, uploads and their limits, the metadata of
   photos, storage, versions, links and embeds, moving and renaming, deleting and restoring, search, MCP), with the
   decisions of `attachments-requirements.md` and of "Libraries" and "Design" above, and its current limits (no Range,
   no smaller renditions, no files in "All pages", blobs of failed writes left on disk, no cleanup of unused blobs,
   `delete_tab` refused for a tab with files). Extend the specs the feature changes: `content-structure.md` (the
   addresses, `/files` and `/deleted-items`, the action `upload`, the section "Files", deleting a tab), `pages.md` (the
   lifted limit "no attachments"), `wiki-links.md` (file targets, embeds, the index), `page-deletion.md` ("Deleted
   items"), `page-history.md` (revisions show the current version of a file), `folder-roles.md` (the functions of
   files), `optimistic-locking.md` (the version of a file), `markdown-editor.md` (images in live preview, files in
   the picker, no upload, the lifted limit), `search.md` (files by name), `mcp.md` (`list_folder`,
   `read_file_details`, the instructions, `delete_tab`), `container-image.md` (the volume, `HIPPOWIKI_FILES_DIR`,
   `HIPPOWIKI_FILE_SIZE_LIMIT`, the backup of the database first and then the directory, "What the environment has
   to provide", the smoke test); and `architecture.md` (the feature `files`, the addresses, the upload route outside
   the proxy, the headers of files, `src/instrumentation.ts`), `testing.md` (the directories of files of the tests,
   `createFile()`, images made in the tests) and `tech.md` (sharp).
2. Remove "Attachments and images" from `roadmap.md`, and add what this plan left for later: S3-compatible storage,
   uploads from the editor and through MCP, the content of files through MCP, the text of PDFs in search, Range
   requests, and the cleanup of unused blobs; point the intro of `attachments-ideas.md` to `files.md` and these
   entries instead of the removed one.
3. Check that `README.md` has the commands and variables a developer needs, and that its summary of what the
   prototype can do covers files.
4. Delete this step file and `spec/attachments-requirements.md`. The requirement IDs leave the comments of the code
   and the tests: each is replaced by the section of `files.md` or of the extended spec that holds the rule now, or
   dropped with its sentence kept.
5. Update the spec catalog in `CLAUDE.md`: add `spec/files.md`, remove this step file and the requirements file, and
   change the entries whose question changes (`page-deletion.md`, `attachments-ideas.md`).

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
