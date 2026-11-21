# HippoWiki – Attachments: Research and Ideas

Research into how comparable wikis and content management systems handle images and file attachments such as PDFs,
and what that suggests for HippoWiki. This file is input for the requirements of the feature (see
`requirements-workflow.md`), not a requirement and not a description of something built. The roadmap entry is
"Attachments and images" in `roadmap.md`; the specs whose "Current limits" it would lift are `pages.md` ("no
attachments") and `markdown-editor.md` (images not shown in live preview).

The research was done on 2026-11-20 from the documentation and the source code of the systems. Every fact that could
not be confirmed from a primary source is marked as unverified. The sources are listed at the end, grouped by topic.

## In short

- Almost every wiki stores the bytes outside its database, on a local disk by default and in an S3-compatible
  storage as an option, and keeps the metadata in its database. Wiki.js is the exception: it keeps the bytes in
  PostgreSQL (`bytea`) by default.
- Most modern wikis tie an attachment to one page (Confluence, BookStack, XWiki, Docmost, Outline, Notion). MediaWiki
  keeps files global, DokuWiki and Wiki.js 3 in folders next to the pages.
- Wiki.js 3, the system closest to HippoWiki, is described as a whole in "Wiki.js 3 in detail".
- Embedding is done by name (MediaWiki `[[File:x.png]]`, DokuWiki `{{ns:x.png}}`, Obsidian `![[x.png]]`), by an
  opaque id (Outline, Joplin, GitHub, GitLab) or by a relative path (Typora, MkDocs). Embedding by name needs an index
  of uses and an update of the references on a rename, which HippoWiki already has for wiki links.
- Security is the largest part of the work. Nearly every wiki in the comparison has had stored XSS through uploaded
  files, mostly SVG and files served with a type the uploader chose. The defence that holds is a set of response
  headers on every file (`nosniff`, `Content-Disposition: attachment`, CSP `sandbox`), the type decided by the server
  from the bytes, and an allowlist of the few types that are shown inline.
- MCP has no standard way to upload a file yet. Real servers hand out a short-lived upload address together with a
  `curl` command, accept small files as base64 in a tool argument, or fetch a public URL. For reading, images work as
  `image` content in the Claude clients and Cursor, while PDFs are better returned as extracted text.
- Suggested direction for HippoWiki, discussed below: attachments belong to a page, have versions, are embedded with an
  extension of the wiki link syntax (`![[diagram.png]]`), are checked against the role of the folder on every request,
  and are stored as immutable blobs named by their SHA-256 behind a small storage interface: a volume first, an
  S3-compatible storage later.

## The systems compared

| System           | Where the bytes are by default        | Other stores                     | Scope                   | Versions of a file             | Key of a stored file                          | Default size limit |
| ---------------- | ------------------------------------- | -------------------------------- | ----------------------- | ------------------------------ | --------------------------------------------- | ------------------ |
| MediaWiki        | disk (`images/`)                      | Swift, S3 (extension)            | global (`File:`)        | yes, revertible                | name, in directories from the MD5 of the name | 100 MiB            |
| Confluence DC    | disk (shared home)                    | S3 (since 8.1)                   | page                    | yes, no revert                 | content id and version                        | 100 MB             |
| Confluence Cloud | not documented                        | none                             | page                    | yes, no revert                 | not documented                                | 100 MB             |
| DokuWiki         | disk (`data/media`)                   | none                             | namespace               | yes (attic), restorable        | namespace path and name                       | from PHP           |
| Wiki.js 2        | PostgreSQL `bytea`, disk cache        | sync to disk, Git, S3 and others | global asset folders    | no, overwritten                | SHA-1 of the path                             | 5 MB               |
| Wiki.js 3        | PostgreSQL `bytea`, disk cache        | disk, S3, Azure, GCS, Git, SFTP  | tree next to pages      | no, overwritten                | UUID, or the path in the tree on a target     | 10 MB              |
| BookStack        | disk                                  | S3                               | page                    | no, replaced                   | date and random name                          | 50 MB              |
| Outline          | S3 (code default), disk               | disk                             | document                | no                             | user, UUID and file name                      | 1 MB (code)        |
| XWiki            | disk                                  | S3 (extension, since 17.10)      | page                    | yes, rolled back with the page | page and name                                 | unverified         |
| Docmost          | disk                                  | S3, Azure                        | page (and space)        | no, replaced                   | workspace and UUID v7                         | 50 MB              |
| Notion           | its own S3                            | none                             | block in a page         | unverified                     | not documented, URLs valid one hour           | 5 MB free plan     |
| Obsidian         | files in the vault                    | none                             | vault folder of choice  | through Sync only              | path                                          | none (Sync: 5 MB)  |
| GitHub, GitLab   | Git repository of the wiki            | object storage for uploads       | wiki or project         | Git history                    | random id per upload                          | 10–100 MB          |
| Gitea            | disk                                  | MinIO/S3, Azure                  | issue, comment, release | no                             | UUID                                          | 100 MB             |
| HedgeDoc 2       | disk                                  | S3, Azure, Imgur, WebDAV         | many notes (join table) | no                             | UUID v7                                       | unverified         |
| Joplin           | files of the client, server: database | disk, S3 (server)                | note                    | no                             | 32-hex id                                     | unverified         |

## Wiki.js 3 in detail

Wiki.js 3 was read in its source code: the branch `scarlett` at its commit of 2026-11-12, a Fastify server with Drizzle
on PostgreSQL, a Vue front end with a Monaco editor, and an MCP server of its own. It is the system closest to
HippoWiki (PostgreSQL, Markdown, an MCP server, OAuth for AI apps), so it is described here as a whole. File and
function names are those of the Wiki.js repository.

### Where the bytes are

- Six storage targets ship: `db` (the bytes in the row of the asset), `disk`, `git`, `s3` (also every service with the
  S3 API), `azure`, `gcs` and `sftp`. The database target is on for every site and cannot be turned off; it is what
  every site starts with.
- Writing and reading are two separate settings:
  - A target stores the content types it is set for, and an upload goes to every target that claims its type. The
    types are `image`, `document`, `other` and `large`; what counts as large is one threshold per site, so that, for
    example, videos go to S3 while thumbnails stay in the database. A write must succeed on every target, or the
    upload fails.
  - Each type is served from one nominated target, and from the database when none is nominated. A read falls back to
    every other target holding the type, the database last.
- An object store can serve a file directly: the wiki answers with a redirect to a signed address of the store
  (5 minutes by default, at most 7 days), so that the bytes never pass through the server. The signed address carries
  no rule of the wiki; whoever holds it reads the file until it expires.
- `disk`, `git` and `sftp` keep the same tree as the wiki, `<locale>/<folders>/<file>`, with pages and files side by
  side; an object store uses the same path as its key. So a file is named on a target by its place in the tree, not by
  its id, and a rename moves it on every target (on an object store as a copy, then a delete).
- The `git` target keeps the history of the files in Git, commits each change with its author, and pulls changes of
  the remote back into the wiki, deletions included.
- Thumbnails (320 by 200 pixels, WebP) always stay in the database, so that a slow target never slows down the file
  manager.
- Serving goes through two caches that can be deleted at any time: the path and metadata of an asset in memory for 60
  seconds, and its bytes on a local disk under the data path, at most 512 MB by default, swept when a quarter of that
  has been written.
- A database target can move its files to another target afterwards ("offload"): each file is written to the other
  targets, read back to check it, and only then removed from its row.

### Metadata and place

- An asset has two rows with the same id:
  - The row of the tree, shared with pages and folders (`tree`, with an `ltree` column for the folder path): name,
    folder, locale, title and a copy of the size, type and dimensions for listings.
  - The row of `assets`: file name, extension, kind (`document`, `image`, `other`), MIME type, size in bytes, metadata
    (`jsonb`, the width and height of an image), times, author, site, the bytes (`data`, only while the database
    stores the type) and the thumbnail (`preview`).
- Files live in folders next to pages, not under a page. Pages and files share one name space: an upload with an
  extension that the site uses for pages (`md`, `html`, `txt` by default) is refused, and a file may not take the name
  under which a page is stored.
- The pasted files of a page land in the folder of the page by default; the site setting `uploads.pastedDestination`
  can send them to a subfolder of each page or to one folder for all.
- No version of a file is kept. A second upload under the same name follows the site setting
  `uploads.conflictBehavior`: `overwrite` (the default) replaces the bytes under the same id, `reject` refuses it,
  `new` stores it as `name-1.ext`. Wiki.js says itself that the replaced bytes are gone.
- Deleting a file deletes it at once and on every target, without a trash. Deleting a folder deletes the files in it.

### Names and types

- The file name is cleaned on every upload (`sanitizeFileName`): no directory part, lowercase, NFC, spaces and
  underscores become hyphens, only letters, digits, combining marks, dots and hyphens remain, no runs of dots, no
  leading dot or hyphen, and at most the byte length of a path segment, cut from the stem so that the extension
  stays.
- The MIME type comes from the extension of the cleaned name (the package `mime`), not from the request; only a file
  without a known extension keeps the type the client sent. The bytes are not checked against the type, except for
  SVG.
- An SVG must be a valid SVG and is sanitized on upload (`uploadScanSVG`, on by default) with an allowlist of
  elements and attributes of its own, built on cheerio.

### Serving and security

- Files are served at `/_files/<folders>/<name.ext>`, by their path, which is also what pages write. A thumbnail is
  served at `/_thumb/`.
- Every request checks the permission `read:assets` of the groups of the user for the path of the file, with the same
  rules as pages; a file the user may not read is answered as one that does not exist. Uploading needs
  `write:assets` on the target folder, renaming, moving and deleting `manage:assets`.
- The check of the upload runs before the body is read, so that nobody can make the server buffer a file only to
  refuse it. The body is the raw file, not a multipart form, read into memory up to `uploadMaxFileSize` (10 MB by
  default).
- Every file is served with `X-Content-Type-Options: nosniff` and, except a PDF, with
  `Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox`, which makes a file
  opened at its own address harmless. A PDF goes without the policy, because Chromium does not show a PDF in a
  sandboxed document, and its viewer runs no script in the origin of the page.
- `forceAssetDownload` (on by default) sends every file except images as a download.
- Caching: `Cache-Control: private, max-age=600, must-revalidate` and an `ETag` of the id and the time of the last
  change, because a path can lead to different bytes after a delete and a new upload.
- The image of a live note is the exception: it lives under a random name in a folder of its own and is readable by
  everybody who may read live notes and knows the address.
- What Wiki.js does not do, as far as the code shows: check the magic bytes, remove EXIF or GPS data (the original is
  stored as uploaded; only the thumbnail is encoded again), or set limits of sharp for untrusted input beyond its
  defaults. sharp is an optional extension: without it there are no thumbnails and no dimensions.

### Linking and embedding

- The editors write standard Markdown with a path from the root of the site, `![name](/folder/photo.png)` or
  `[name](/folder/report.pdf)`; the renderer turns it into `/_files/…` at render time, and also resolves a path
  relative to the page, so that Markdown imported from a repository keeps working.
- Image sizes use `markdown-it-imsize` (`![](x.png =200x)`) and attributes `markdown-it-attrs` (`{.class}`).
- The links of a page are kept in an index (`pageLinks`), file links included with the kind `asset`. But a file that
  is renamed or moved leaves the pages that point to it pointing at nothing: Wiki.js updates no file links, and its
  own comment on the file route says so. A page whose links break is warned about for page moves only.

### The editor

- Pasting or dropping files into the Markdown editor uploads nothing at first. Each file becomes a pending asset
  behind a `blob:` address of the browser, and the editor inserts `![name](blob:…)` for an image and `[name](blob:…)`
  for any other file at the cursor, one per line, so that the image shows at once.
- On save, a dialog uploads the pending files one by one, named `<page>-<file name>`, into the folder of the page,
  then replaces each `blob:` address in the text with the stored path, as targeted edits that keep the undo history,
  and only then saves the page. A failed upload stops the save with a message.
- Uploads are refused while a user only suggests an edit, because a suggestion is not a save.
- The live notes are the exception: they have no save, so their images upload at once, with a placeholder decoration
  that the editor moves with every edit.
- A file manager lists the files of a folder with thumbnails and offers upload, rename, move, delete and an image
  editor (crop, rotate, colors, redaction), whose operations the server replays with sharp on the original.

### MCP

- Wiki.js writes its MCP server by hand, without the SDK. Three tools for files exist and are off by default
  (`mcp.tools.assets`), "binary content in a context window is expensive, and an upload is the one write that is not
  text a person can read in a diff":
  - `list_assets`: the files and subfolders of one folder, each file with id, path, the link for a page, type, size
    and dimensions.
  - `get_asset`, by id or path: the metadata as text, and a PNG, JPEG, GIF or WebP image of at most 1 MB as `image`
    content, or a text file (Markdown, CSV, JSON, SVG and the like) as text within the size limit of a result; every
    other file as metadata and its link only.
  - `upload_asset`: folder, file name, MIME type and the content as `base64` or as `text`, at most 3 MB decoded. It
    calls the upload route in the same process, so that the permission, the reserved extensions and the conflict
    setting hold as in the browser, and returns the link to write into the page. Its description advises a Mermaid
    block over an uploaded picture of a diagram, because it stays text a person can review.
- Every change through MCP is marked as done through MCP in the history and the audit log, as in HippoWiki.

### What HippoWiki can take from it, and where it would differ

- Take: the cleaning of file names; the type decided by the server; `nosniff` and the sandbox CSP on every file, PDFs
  excepted; `private` caching with an `ETag`; the permission checked before the body is read; files answered as
  missing when not readable; small MCP tools that return images as `image` content, text files as text and
  everything else as metadata, with a base64 upload of a few megabytes; the Mermaid advice.
- Take as an option: a pending upload held in the browser until the page is saved. It needs no pending rows on the
  server and leaves no unused file when the user discards the changes, but the page and its files are not saved in
  one step, the `blob:` address must never reach the server, and a lost tab loses the files.
- Differ: Wiki.js keeps no versions and no trash for files, and breaks pages when a file is renamed or moved. With
  HippoWiki's history, soft delete and link updates of wiki links, versions of attachments, a soft delete and embeds
  that are updated on a rename are the consistent choice.
- Differ: the many storage targets with separate settings for writing and reading are much more than one container
  needs; one store at a time is enough for HippoWiki.
- Differ: Wiki.js checks neither the magic bytes nor removes the metadata of photos; HippoWiki should do both.

## Storage: disk, database or object storage

### What others do

- MediaWiki, Confluence Data Center, DokuWiki, BookStack, XWiki, Docmost, Gitea, GitLab and HedgeDoc keep the bytes on
  a local disk by default; nearly all of them offer S3-compatible storage as an option. Confluence stopped supporting
  attachments in its database.
- Wiki.js keeps the bytes in PostgreSQL: version 2 in a table of its own (`assetData`, `bytea`) with a disk cache in
  front, version 3 in a `bytea` column of `assets` with a thumbnail in a second column, and the database as the
  storage every site starts with. Joplin Server keeps its items in the database by default and can move them to disk
  or S3 with a fallback driver for the migration.
- Keys: MediaWiki spreads files over directories named from the MD5 of the file name (`a/ab/Name.jpg`), Confluence
  from the content id. The newer systems name each file by a UUID (Outline, Docmost, Gitea, HedgeDoc 2, Wiki.js 3).
  MediaWiki keys deleted files by the SHA-1 of their content; GitLab and Gitea store a SHA-256 of each upload.
- None of them deduplicates the files in use by their content, as far as could be verified.

### The trade-offs

- PostgreSQL `bytea` (Prisma `Bytes`):
  - The file and its metadata are written in one transaction, and one backup holds everything; nothing can drift
    apart.
  - A value is TOASTed in chunks of about 2 kB and limited to 1 GB. Most operations read or write the whole value at
    once, so there is no real streaming, and Prisma hands the whole value through memory.
  - Backups and `pg_dump` grow and slow down with the files; the database needs more memory and disk.
- PostgreSQL large objects: up to 4 TB with seeking, but not deleted with their row (`lo_manage` and `vacuumlo` are
  needed), skipped by `pg_dump` with `-n` or `-t` unless `-b` is given, not replicated logically, and not supported by
  Prisma, so only raw SQL could use them.
- A local volume: streaming, the cache of the operating system and a size limited only by the disk. But the files and
  the database can drift apart (files without a row, rows without a file), the volume is backed up next to the
  database, a consistent backup needs coordination, and more than one container needs shared storage. HippoWiki's
  container is meant to run `--read-only` (see "Checks on the deployment" in `review-report.md`), so the volume and a
  place for temporary files must be mounted.
- S3-compatible storage: scales on its own and can serve files directly through presigned addresses. It adds a second
  service next to the single container, has the same drift and orphan problems as a volume, and needs its own access
  rules.
  - MinIO removed its admin console from the community edition in 2025, and its GitHub repository is archived and no
    longer maintained (the exact dates of the end of its binaries are unverified). SeaweedFS (Apache-2.0) and Garage
    (needs about 1 GB of memory; its license, AGPL-3.0, is unverified) are maintained alternatives. Any S3-compatible
    service works through the same API, so HippoWiki need not choose one.

### Ideas for HippoWiki

- The metadata always lives in PostgreSQL, in tables of their own, written with Prisma like every other row.
- The bytes sit behind a small storage interface with three functions: store a stream, read a stream (with a range),
  delete. A first driver writes to a directory on a volume, a second one to an S3-compatible bucket. The roadmap entry
  already names both.
- Each stored file is an immutable blob named by the SHA-256 of its bytes, as content-addressed stores do. This gives:
  - versions for free: a new version is a new blob, and an old version is never overwritten;
  - a safe order of writes without a transaction across two stores: the blob is written first (writing it twice does
    no harm), then the rows in one database transaction; a failure in between leaves only an unused blob;
  - deduplication of the same file uploaded twice, such as a logo on several pages;
  - a strong `ETag`, so that a browser revalidates a file with a cheap 304;
  - a backup without a coordinated snapshot: `pg_dump` first, then a copy of the blobs, because a blob that a row of
    the dump names is never changed. Only the cleanup deletes blobs, and only those that no row names after a waiting
    time longer than a backup takes.
- The cleanup of unused blobs runs at the start of the container, like the search index of `container-image.md`, or
  on a timer, and logs what it deletes.
- Rejected for now: the bytes in PostgreSQL. It is the simplest store for one container, and Wiki.js shows that it
  works, but it makes the database and its backups grow with every image, and Prisma cannot stream. A size limit per
  file of a few megabytes would make it workable; it stays an option for the first step if the volume turns out to be
  a burden for operators.

## Metadata

### What others store

- MediaWiki (`image` table): name, size, width, height, metadata including EXIF (serialized), bit depth, media type,
  MIME type, description, uploader, time and SHA-1. Old versions in `oldimage`, deleted files in `filearchive`, uses in
  `imagelinks`, and a description page that is an ordinary wiki page.
- Confluence: an attachment is a row of its content table with the page as parent, and earlier versions linked to it;
  the file size is a content property.
- Outline: key, content type, size, access, last access, expiry, team, document (may be empty while a document is
  written) and user.
- Docmost: file name, path, size, extension, MIME type, kind, creator, page, space, workspace, times and a soft delete.
- Gitea: UUID, repository, issue, release, comment, uploader, name, size, SHA-256, download count and time.
- Wiki.js 3: UUID, file name, extension, kind (document, image, other), MIME type, size, metadata (`jsonb`), the bytes
  and a thumbnail, author and site; the name and place of an asset are kept in the same tree as pages and folders.

### Ideas for HippoWiki

Three tables, in words:

- An attachment: its id, its folder and its page, its name (see below), its kind (image, PDF, other), the time it was
  created, its last editor and the channel (`web` or `mcp`, as for pages in `content-structure.md`), its version
  counter for optimistic locking (see `optimistic-locking.md`), and the soft delete of `page-deletion.md`.
- A version of an attachment: its number, the blob, the time, the user and the channel of the upload, and an optional
  comment.
- A blob: its SHA-256, its size, its MIME type as decided by the server, and for an image its width and height. Its
  metadata, such as EXIF, is removed rather than stored (see "Images").

The name:

- The name follows the name rule of tabs and pages for its stem (lowercase letters, digits and single hyphens), plus a
  lowercase extension from the allowlist of types, such as `network-diagram.png`. The browser suggests it from the
  name of the uploaded file, as the save dialog suggests the name of a page from its title (`deriveName()` of
  `pages.md`).
- This removes the classic problems of file names in one step: path traversal, NUL bytes, Unicode lookalikes, the
  right-to-left override (U+202E) that disguises an extension, double extensions and quoting in `Content-Disposition`.
- The name of an uploaded file without a usable stem, such as a pasted screenshot, becomes a stem with the time, as in
  Obsidian (`pasted-image-20261120-142305.png`).
- The original file name is not kept; the name is the one the user saw and could change.

## Scope: who owns an attachment

### The options

- Global, like MediaWiki: does not fit HippoWiki, whose roles and MCP connections are per folder.
- Per folder or tab, like DokuWiki namespaces, the tree of Wiki.js 3 or the Obsidian vault: files next to the pages, shared by every page of
  the folder. Their lifecycle is their own: nothing deletes them when the pages that use them are deleted, and an
  unused file is found only by a list of unused files.
- Per page, like Confluence, BookStack, XWiki, Docmost and Outline: the attachment moves with its page, is deleted and
  restored with it, and the page shows its own files. A file used by several pages lives on one of them and is
  referenced from the others.

### Ideas for HippoWiki

- An attachment belongs to one page, and through it to one folder, whose roles decide who sees and changes it.
- Moving or renaming the page keeps its attachments; deleting the page deletes them with it, as a soft delete, and
  restoring the page restores them. A page is never deleted for good (see "Current limits" in `pages.md`), so its
  attachments stay stored as long as the page does.
- Another page of the same folder embeds the attachment by naming its page (see "Embedding and linking"). No page
  embeds an attachment of another folder, as no wiki link leads into another folder.
- Moving a page to another folder does not exist today; if it comes, its attachments move with it.
- A new page has no id before its first save, so an upload in the editor of a new page needs a place to wait. Outline
  stores such an attachment without a document and links it when the document is saved. HippoWiki could do the same:
  an upload in a new page is kept as a pending attachment of the user and the folder, and the save of the page takes
  it over; a pending attachment that no save took over is deleted after a day. The simpler alternative: uploads only
  in the editor of a page that exists, and a hint to save the new page first.

## Versions, history and deletion

### What others do

- MediaWiki, Confluence, DokuWiki and XWiki keep the earlier versions of a file when one of the same name is uploaded
  again. MediaWiki and DokuWiki revert to an earlier version; Confluence cannot. XWiki rolls back the attachments
  together with a revert of the page by default.
- Wiki.js, BookStack, Docmost and Outline overwrite: the old bytes are gone.
- Removing an embed from a page never deletes the file (Confluence says so explicitly). Unused files are found through
  lists (MediaWiki "Unused files", BookStack's cleanup of unused images) or deleted when no page references them
  (Joplin after 90 days, Outline when the last document using it is deleted for good). GitLab keeps uploads until the
  project is deleted.

### Ideas for HippoWiki

- Uploading a file with the name of an existing attachment of the page asks whether it is a new version or a new name.
  A new version is a new blob; the attachment keeps its name, so every embed shows the new version at once.
- The history of an attachment lists its versions with user, channel, time and size, and a Writer reverts to an
  earlier version, which, as for pages, stores a new version with the old blob (see `page-history.md`).
- Embeds always show the current version, also in an old revision of a page. A revert of the page does not revert its
  attachments. Rolling them back with the page, as XWiki does, would make a revert change more than its page, against
  the rule that the history of a page is its content.
- Deleting an attachment on its own is a soft delete that a Manager or Owner restores, like a page. Who may delete is
  an open question (see "Roles").
- A list of the attachments of a folder that no page embeds, next to the planned list of broken links of `roadmap.md`,
  helps to clean up.

## Embedding and linking

### What others do

| System         | Image                                                  | Link to a file                   | Size and alignment                        | Reference                        |
| -------------- | ------------------------------------------------------ | -------------------------------- | ----------------------------------------- | -------------------------------- |
| MediaWiki      | `[[File:x.png\|thumb\|200px\|Caption]]`                | `[[Media:x.pdf]]`                | `200px`, `left`, `center`, `thumb`        | global name                      |
| DokuWiki       | `{{ns:x.png?200\|Caption}}`                            | `{{ns:x.pdf\|Label}}`            | `?200x50`, spaces in the braces for align | namespace and name               |
| Obsidian       | `![[x.png\|300]]`                                      | `[[x.pdf]]`, `![[x.pdf#page=3]]` | width or `100x145` after `\|`             | name or path in the vault        |
| Outline        | `![alt](url "title =WxH")`                             | `[title size](url)`              | in the title of the image                 | `/api/attachments.redirect?id=…` |
| Joplin         | `![](:/<id>)`                                          | `[name](:/<id>)`                 | none                                      | 32-hex id                        |
| GitHub, GitLab | `![x](https://…/user-attachments/…)`, `/uploads/<…>/x` | ordinary Markdown link           | raw HTML                                  | random id per upload             |
| Typora, MkDocs | `![x](images/x.png)`                                   | ordinary Markdown link           | attributes (MkDocs Material: `{ width }`) | relative path                    |

- MediaWiki and DokuWiki list the pages that use a file ("File usage", the usage view of the DokuWiki media manager);
  MediaWiki also lists the most wanted files that do not exist. Obsidian and the DokuWiki Move plugin rewrite the
  references when a file is renamed. Systems with ids need no rewrite.
- Captions: MediaWiki shows the caption under `thumb` images, Outline uses the alt text, Zettlr and the markdown-it
  plugin for implicit figures turn an image alone in a paragraph into a figure with its alt text or title as caption.

### Ideas for HippoWiki

Three ways to write an embed:

- An extension of the wiki links, as in Obsidian: `![[diagram.png]]` shows an attachment of the own page,
  `![[setup/diagram.png]]` one of the page `setup` placed directly in the folder, `![[guides/setup/diagram.png]]` one of
  a page in the tab `guides`; `[[report.pdf]]` without `!` is a link to the file. It is unambiguous, because a page
  name has no dot and an attachment name always has its extension: today such a target breaks the name rule and shows
  as a link that cannot be created (see `wiki-links.md`).
- Plain Markdown with a relative address, as in Typora and MkDocs: `![Diagram](diagram.png)`. It is understood by
  every Markdown tool and by AI apps without instructions, but its meaning depends on the address of the page, which
  ends in `.md`, so a page in a tab and one placed directly in the folder would need different paths, and a move of the
  page would have to rewrite them.
- An opaque id, as in Outline and Joplin: `![Diagram](/files/<id>)`. Nothing ever needs a rewrite, but neither a person
  nor an AI app reads which file is meant, and an export of the pages as Markdown files would have to translate every
  reference.

The wiki link extension fits best, because HippoWiki has everything it needs already:

- the index of links stores the embeds too, so the view of an attachment lists the pages that use it, and the page of
  a missing file can be listed;
- a move or rename of a page, a tab rename and a rename of an attachment update the embeds in the same write, as they
  update wiki links (see "Updates on a move or rename" in `wiki-links.md`);
- a missing attachment shows as missing, like a missing page, and for a Writer leads to the upload;
- the picker on `[[` gets a sibling on `![[` with the attachments of the page and of the folder;
- the instructions of MCP already teach the grammar of wiki links, and one more sentence covers embeds.

Details to decide:

- The label after `|` is the alt text of an image and the text of a link to a file, so that every image can have a
  text for screen readers. Size: either a number after a second `|` (`![[diagram.png|Network diagram|400]]`) or no size
  at all, and every image shown at most as wide as the text. Obsidian puts the size in the place of the label, which
  would collide with the label of HippoWiki.
- A caption: an image alone in a paragraph could show its label as caption under it, as the implicit figures of
  markdown-it do.
- Plain Markdown images with a relative address to an attachment, `![x](/folders/…)`, keep working as images of the
  wiki itself (`pages.md`), but are not indexed and not rewritten.

## How files are shown

### What others do

- Images: `<img>` with lazy loading; MediaWiki renders thumbnails at 1.5 and 2 times the size and adds `srcset`;
  MediaWiki and MkDocs Material open a lightbox on click; Docmost reads width and height before the upload so that the
  page does not jump when the image loads.
- PDFs: Outline shows them with `<embed>`, Docmost with an `<iframe>`, Obsidian with a bundled PDF.js. MediaWiki
  renders page images on the server with Ghostscript. Confluence deprecated its view-file macros for a thumbnail with a
  full-screen preview. Confluence Data Center now serves attachments as downloads, because they "can be active
  content".
- Audio and video: DokuWiki, Obsidian and Joplin show players; they need Range requests to seek.
- Other files: a link or a card with name, type and size.

### Ideas for HippoWiki

- Images embed as `<img>` with `loading="lazy"` and the stored width and height, so that the page does not jump; a
  click opens the image alone in a new tab. A second, smaller rendition for large photos (for example 1600 pixels
  wide) keeps pages light; `srcset` can come later.
- The image optimizer of Next.js (`/_next/image`) is not used: the app does not use it today (see `architecture.md`
  and the finding about it in `review-report.md`), and it does not forward the cookie that an attachment behind the
  login needs. sharp, which Next.js brings already (see "License check in CI" in `roadmap.md`), does the work.
- PDFs and other files embed as a card with name, type, size and "Open" and "Download". Opening a PDF shows it in the
  viewer of the browser in a new tab. An inline viewer in the page is left out at first: it needs `frame-ancestors`
  opened for the attachment addresses, and a bundled PDF.js has had its own XSS (CVE-2024-4367).
- Audio and video are left out at first, or shown as downloads; with them come Range requests.
- An attachment section below the content of a page, or a view `?view=attachments`, lists the files of the page with
  name, size, version, last change and the pages that embed it, with upload, new version, rename and delete for the
  roles that may.

## The editor

### What others do

- Paste, drop and an upload button are the common ways in (GitHub, Confluence, Outline, Docmost, Obsidian, Typora).
- While a file uploads, the editor shows a placeholder at the place of the drop: GitHub inserts text such as
  `![Uploading image.png…]()` (described second-hand only), Outline and Docmost insert a node with a preview of the
  local file, HyperMD (CodeMirror 5) marks the inserted text. The placeholder is found again by an id after other edits,
  replaced when the upload is done, and removed with a message when it fails (the upload example of ProseMirror is the
  model).
- Files are uploaded at once, before the page is saved, in every system looked at.

### CodeMirror 6

- `EditorView.domEventHandlers` with `paste` and `drop` receives the files (`clipboardData.files`,
  `dataTransfer.files`); the handler that returns `true` stops the default. `view.posAtCoords()` gives the position
  of a drop, `dropCursor()` shows it.
- A placeholder can be a widget decoration in a `StateField` whose positions are mapped through every change; when the
  upload is done, the embed is inserted at the mapped position as one change, and nothing happens if the placeholder
  was removed meanwhile.
- Images in live preview: ink-mde adds a block widget with the image under the line of the Markdown, Zettlr replaces
  the Markdown by the image unless the cursor is in it. Block widgets must come from a `StateField`, not from a view
  plugin, should have no vertical margin, and must ask for a new measure when the image has loaded and changes height.

### Ideas for HippoWiki

- An "Insert file" button in the toolbar, paste of files and drop of files. The rule "pasting adds plain text" of
  `markdown-editor.md` stays for text; a pasted file is new.
- The file uploads at once, independent of "Save". A widget shows its name and progress at the place of the cursor or
  drop, without changing the text; when the upload is done, `![[name.png]]` (or `[[name.pdf]]` for other files) is
  inserted there as one change that one undo reverts. This keeps the rule that the editor never changes the Markdown
  on its own, because the user started the change, and no half-written placeholder text can be saved.
- When the user discards the changes, the uploaded file stays as an attachment of the page that no content embeds, and
  shows in the attachment list; the pending upload of a new page is cleaned up as described in "Scope".
- The alternative of Wiki.js: files wait in the browser behind `blob:` addresses and are uploaded on "Save", just
  before the page (see "Wiki.js 3 in detail"). It suits a new page without any rows on the server, but a lost tab
  loses the files, and the page and its files are still two writes.
- Live preview shows an image as a block widget under its line, as ink-mde does, and the Markdown of the embed only on
  the lines of the cursor, as for other marks; a file other than an image shows as a card. A missing attachment is
  marked like a missing wiki link.
- Typing `![[` opens a picker of the attachments of the page and the folder, like the picker on `[[`.
- On a phone, the upload button opens the file picker of the system, which offers the camera for `accept="image/*"`.
- A name already taken in the page is answered in a small dialog: new version or new name.

## Security

### What went wrong elsewhere

- Wiki.js: SVG uploaded by an editor ran scripts when opened directly (CVE-2021-25993, CVE-2021-43842); the sanitizer
  added as a fix was bypassed with a fake MIME type (CVE-2021-43855).
- Docmost: whether a file was shown inline was decided by its extension, its type taken from the upload; an HTML file
  named `payload.jpg` ran as HTML (CVE-2026-33193).
- Outline: with local storage on the domain of the app, an attachment bypassed the CSP (CVE-2025-58351); the fix and
  the workaround were `Content-Security-Policy: sandbox` on the file responses.
- Confluence: path traversal in the download of all attachments led to code execution (CVE-2019-3398, exploited in the
  wild); HTML saved as `.png` with an unusual MIME type that was missing from a deny list was rendered by iOS Safari.
- MediaWiki: a series of bypasses of its SVG filter (CVE-2014-2242, CVE-2015-2932 to 2935, CVE-2017-0366).
- XWiki and DokuWiki: SVG with scripts (CVE-2021-43841, CVE-2024-33103). XWiki no longer shows SVG inline.
- BookStack: PHP uploaded as an image (CVE-2020-5256), and a missing permission check of its attachment API (2026).
- Gitea: attachments authorized by the repository in the address instead of the repository they belong to, so that a
  private attachment could be fetched through a public repository (CVE-2026-20912, CVE-2026-78433).

The lessons: the server decides the type, from the bytes and the extension, never from what the client sends; deny
lists of types fail, allowlists hold; sanitizers wear down over time; and the role is checked against the folder the
attachment belongs to, never against the address it was requested through.

### Ideas for HippoWiki

Types:

- An allowlist of types, each checked by its magic bytes and its extension: PNG, JPEG, GIF and WebP as images; PDF;
  plain text and CSV; the Office formats (DOCX, XLSX, PPTX) and OpenDocument as downloads. ZIP and executables are not
  accepted; OWASP advises against archives.
- SVG is the hardest type. Options: refuse it at first; accept it as a download only; or render it to PNG with sharp,
  which moves the risk to librsvg (CVE-2023-38633 read local files through a crafted SVG). Sanitizing with DOMPurify
  alone is not enough, as MediaWiki's history shows.

Every file response:

- `X-Content-Type-Options: nosniff` (already set for every address by `next.config.ts`, see "Security headers" in
  `architecture.md`);
- the type decided at upload, `application/octet-stream` for anything not on the inline list;
- `Content-Disposition: attachment` with the name as `filename` and `filename*`. An `<img>` loads an image whatever its
  disposition, so images can be embedded and still download when someone opens their address directly (to be checked
  in an end-to-end test in every browser). Only PDFs are sent `inline`, so that the browser opens them in its viewer;
- `Content-Security-Policy: default-src 'none'; sandbox` replacing the CSP of the app for these responses, so that a
  file opened directly can run no script on the origin of the wiki. Chrome may not show a PDF under `sandbox` (Jira
  leaves PDFs out of it; reports differ on current Chrome), to be checked;
- `Cross-Origin-Resource-Policy: same-origin` and `Cache-Control: private, no-cache` with the SHA-256 of the blob as
  `ETag`, so that no shared cache keeps a file and a browser asks again on every view, which a 304 answers cheaply and
  which ends access at once when a role is removed.

A separate origin for files, as GitHub (`githubusercontent.com`) and the MediaWiki manual advise, is the strongest
protection, but needs a second host name and certificate, and a way to authorize without the session cookie, such as
signed addresses. With the headers above and no active type shown inline, the same origin is a defensible start; a
separate origin can be an option for operators later.

Access:

- Every request for a file checks the session and the role of the user on the folder the attachment belongs to, in the
  service, as for every other read (see "Reads and writes" in `architecture.md`). A missing file, a missing role and a
  deleted attachment give the same 404.
- No public or unguessable addresses that work without the login: GitHub had them for private repositories until 2023
  and could not withdraw the old ones.
- Admins see no attachments, like all content.

Images:

- sharp reads width and height, turns the image upright by its EXIF orientation, and removes all metadata, including
  the GPS position of photos, which has leaked home addresses on other sites. Removing metadata means encoding the
  image again; whether the original is kept for download is an open question.
- sharp gets the limits of untrusted input: `limitInputPixels` (default 268 megapixels, lower for a wiki), never
  `unlimited`, `failOn: 'warning'`, only the first frame and page, `sharp.block()` for every loader that is not on the
  allowlist, and few images processed at the same time.
- ImageMagick and Ghostscript are not used: ImageTragick and the history of both.

Uploads in the browser:

- A route handler, not a Server Action: a Server Action takes at most 1 MB by default
  (`experimental.serverActions.bodySizeLimit`) and reads the whole body into memory.
- The proxy of Next.js (`src/proxy.ts`) buffers the body of every request it runs on, up to
  `experimental.proxyClientMaxBodySize` (10 MB by default), and silently cuts a longer body without an error. The
  upload route is therefore left out of the matcher, as `/mcp` is, and checks the session itself, or the limit is
  raised.
- The handler reads `request.body` as a stream into a temporary file, counts the bytes and hashes them while it reads,
  and stops at the limit; `Content-Length` is checked first but not trusted.
- Route handlers have no check against CSRF of their own, unlike Server Actions: the handler refuses an `Origin` that
  is not the address of the wiki and a `Sec-Fetch-Site` of `cross-site`.

Limits and abuse:

- A limit per file (others: GitHub 10 MB for images and 25 MB for other files, BookStack and Docmost 50 MB, Confluence
  and GitLab 100 MB), a limit per folder, a check of the free space of the volume before a write, a limit on uploads
  per user and time, and Range requests with one range only.
- The limits are environment variables with defaults, read when the server runs (see `container-image.md`).
- Malware scanning with ClamAV needs 3 to 4 GB of memory and is not part of BookStack, Wiki.js or Outline (as far as
  could be found); Nextcloud and XWiki offer it as an add-on. For HippoWiki it would be an optional `clamd` reached
  over the network, later.

## MCP

### What the protocol offers

- The current revision, 2026-07-28, which the MCP server of HippoWiki serves (see `mcp.md`), has these content types
  in tool results: `text`, `image` and `audio` (base64 with a MIME type), `resource_link` (an address with name and
  type) and an embedded `resource` with `text` or `blob`. It has resources (`resources/list`, `resources/read`,
  templates), which the client, not the model, decides to read.
- It has no way to upload a file. Proposals for it were closed (SEP-1306, SEP-2356, SEP-2631); a draft extension
  `io.modelcontextprotocol/files` marks file arguments in the input schema and lets the server ask the client to
  upload the bytes to an address it names (`upload_required`), but no client implements it, as far as could be found.
- The spec advises "stateful handles": the server returns an opaque id, accepts it later as an ordinary argument and
  checks the authorization again on every call.

### What the clients do with files

- Claude Code passes `image` content to the model, also an embedded resource whose blob is an image; other blobs, such
  as PDFs, are saved to a file and the model gets a line with its path. Its limits: 25,000 tokens per result by
  default (`MAX_MCP_OUTPUT_TOKENS`), 16 MiB per HTTP response.
- claude.ai and Claude Desktop show text and image results; several reports say a PDF as an embedded blob is refused
  as an invalid result (whether fixed is unverified). A result may have about 150,000 characters.
- Cursor attaches images to the chat. ChatGPT reportedly passes image blocks on as empty objects in developer mode
  (unverified).
- Resources and `resource_link` are supported unevenly: Claude Code reads them through a tool of its own, Cursor and
  VS Code document gaps. A server should not rely on them.
- An image costs about one token per 28 by 28 pixels on Claude: about 1,600 tokens at most at a long edge of 1,568
  pixels; base64 does not cost the model anything, only the transport.

### How real servers handle files

- Outline (with the same SDK as HippoWiki): `create_attachment` takes type, name and size, creates the row, and returns
  an upload address with its headers, a ready `curl` command and the address of the attachment for the document.
  Reading an attachment returns metadata and a short-lived signed address, not the bytes.
- Atlassian (Confluence, Jira): an upload tool that prepares the upload and returns a `curl` command; download tools
  that return an address and a command to save the file.
- Notion: a short-lived upload address (20 MiB in one part) and a suggested Markdown for the page; a second tool
  fetches a public HTTPS address, without redirects, headers or private addresses, within one minute and 5 or 50 MiB.
- Slack: get an upload address, post the bytes, complete the upload.
- Google Drive: base64 in a tool argument. The reference filesystem server returns images as `image` and other files
  as embedded blobs. The GitHub server returns a `resource_link` with a download address for files of 1 MB and more.
- ChatGPT apps: `_meta["openai/fileParams"]` marks arguments that ChatGPT fills with an address of a file the user
  gave it, which the server downloads.

### Ideas for HippoWiki

Reading, for every connection:

- `read_page` lists the attachments of the page, with name, kind, MIME type, size, version and address, so that an
  agent sees them without another call; `list_folder` may give the number per page.
- `read_attachment` by tab, page and name: an image as `image` content, reduced on the server to a long edge of 1,568
  pixels, so that it stays within the limits of every client; a PDF as its text, extracted on the server, with the
  number of pages and an optional range of pages; any other file as its metadata only. A text file as text, cut at a
  limit.
- The text of a PDF and the content of images are written by users of the wiki and can carry hidden instructions
  (white text in a PDF, text that appears only when an image is scaled down). The note of "Prompt injection" in
  `mcp.md` is extended to attachments and goes first in the result of `read_attachment`.
- Resources with a scheme of their own, such as `hippowiki://…`, can come later; the tools work without them.

Uploading, for a Writer and a Manager connection:

- Small files inline: `upload_attachment` takes tab, page, name, MIME type and the bytes as base64. The body of an MCP
  request is limited by the SDK to 4 MiB (`maxRequestBodySize`), so a file of at most about 2 MiB fits after base64.
  Useful for what the model writes itself, such as an SVG or a CSV; a model cannot reliably produce the base64 of a
  file it does not hold, and each character is an output token.
- Larger files through an upload address: `create_attachment_upload` takes tab, page, name, MIME type and size, checks
  the role and the limits, and returns a one-time address under `HIPPOWIKI_PUBLIC_URL`, the headers, a `curl` command,
  the time it expires and the embed to insert. The address is bound to the grant, the page, the name, the size and the
  type, works once, expires after minutes, and is never logged. This works for agents with a shell, such as Claude
  Code; chat clients such as claude.ai have no way to send a file today.
- No fetching of addresses that an agent names: it is the classic SSRF, and the deployment allows outgoing connections
  only to DNS and port 443 (see "Things to Check" in `roadmap.md`).
- Every upload returns the attachment as stored, its version, its address and the embed to insert, such as
  `![[diagram.png|Diagram]]`; the agent inserts it with `edit_page_content`. Uploading does not change the content of a
  page, so that an upload never needs the version of the page.
- A new version of an attachment states the version of the attachment it is based on, as every change of a page does
  (see `optimistic-locking.md`).
- A Manager connection may delete an attachment, like a page; a deleted attachment is never seen through MCP.
- Later: the draft extension `io.modelcontextprotocol/files` and the file arguments of ChatGPT, once clients use them.

What holds as for pages: the tools work only on the folder of the connection, are logged with one line without the
bytes, a name of the content or an upload address, record the user of the connection and the channel `mcp` as last
editor, and are registered only for the roles that may use them. The instructions of every connection state the
grammar of embeds next to that of wiki links.

## Roles

A proposal along the table of `folder-roles.md`:

| Function                                                                  | Reader | Writer | Manager | Owner |
| ------------------------------------------------------------------------- | :----: | :----: | :-----: | :---: |
| See the attachments of a page, open and download them, see their versions |   ✓    |   ✓    |    ✓    |   ✓   |
| Upload an attachment, upload a new version, revert to an earlier version  |        |   ✓    |    ✓    |   ✓   |
| Rename an attachment                                                      |        |   ✓    |    ✓    |   ✓   |
| Delete an attachment                                                      |        |   ?    |    ✓    |   ✓   |
| See deleted attachments and restore them                                  |        |        |    ✓    |   ✓   |

Deleting by a Writer is open: a Writer may remove any text of a page, which the history undoes, but not delete a page;
an attachment with its versions is closer to a page.

## Search

- Others: Confluence and MediaWiki (CirrusSearch) index the text of PDFs and Office files; Docmost only in its
  Enterprise edition; Joplin runs OCR on images and PDFs.
- For HippoWiki: the names of attachments are found by the search of their page at first. The text of PDFs, extracted
  once at upload and stored with the blob, can join the text of search later (see `search.md`), within the limits of
  the content. OCR is out of scope.

## Further aspects

- Backups: the database and the blobs are backed up together, the database first (see "Storage"). The roadmap entry
  "Database backups" grows by the volume.
- Import and export of Markdown files (in `roadmap.md`): a page and its attachments export to a file and a directory
  of the same name. `![[…]]` embeds are read by Obsidian and Foam; other tools would need them turned into relative
  Markdown images at export.
- Public content (in `roadmap.md`): attachments of public pages would be public too, and need the same headers.
- Quotas per user and per folder belong with "Rate limits and quotas" of `roadmap.md`.
- Operations: the volume belongs to the user `node` of the image; the container with `--read-only` needs it and a
  place for temporary uploads; the free space is worth a metric.
- Licenses: sharp and libvips (LGPL-3.0) are in the image already; pdfjs-dist, for extracting the text of PDFs, is
  Apache-2.0; an S3 client such as the AWS SDK is Apache-2.0.
- Tests: end-to-end tests of upload, paste, drop, the headers of every type, a file opened directly, a role removed
  while a file is cached, and MCP reads and uploads; cost tests of the processing of large images and PDFs.

## Open questions

- Storage: a volume first and S3 later, or the bytes in PostgreSQL for a first step?
- Scope: attachments only per page, as suggested, or also per folder or tab?
- Embed syntax: the wiki link extension `![[…]]`, plain relative Markdown, or both? How are sizes written, if at all?
- New pages: pending uploads that the first save takes over, files held in the browser until the save as in Wiki.js,
  or uploads only in pages that exist?
- Which types at first: images and PDFs only, or Office files and text too? SVG refused, downloaded or rendered?
- Images: always encode again to remove metadata, or keep the original for download?
- PDFs: open in the viewer of the browser only, or also inline in the page?
- Limits: the size per file and per folder by default.
- Versions: kept for ever, or only a number of them?
- Delete: may a Writer delete an attachment?
- MCP: inline base64, upload addresses, or both in the first step?
- A separate origin for files as an option for operators?

## Sources

Storage and metadata:

- MediaWiki: https://www.mediawiki.org/wiki/Manual:Image_administration,
  https://www.mediawiki.org/wiki/Manual:Image_table, https://www.mediawiki.org/wiki/Manual:Filearchive_table,
  https://www.mediawiki.org/wiki/Manual:$wgMaxUploadSize
- Confluence: https://confluence.atlassian.com/doc/attachment-storage-configuration-166876.html,
  https://confluence.atlassian.com/doc/hierarchical-file-system-attachment-storage-704578486.html,
  https://confluence.atlassian.com/doc/manage-files-139415.html,
  https://support.atlassian.com/confluence-cloud/docs/manage-your-storage-usage
- DokuWiki: https://raw.githubusercontent.com/dokuwiki/dokuwiki/master/conf/dokuwiki.php,
  https://dokuwiki.org/config:mediarevisions, https://dokuwiki.org/plugin:move
- Wiki.js 3, read in its source (branch `scarlett`, commit of 2026-11-12): the assets model, the asset routes, the
  file route, the storage modules and their rules, the image helpers, the Markdown editor and its dialog for pending
  uploads, and the MCP tools for assets; on GitHub at https://github.com/requarks/wiki/tree/scarlett
- Wiki.js: https://github.com/requarks/wiki/blob/v2.5.315/server/db/migrations/2.0.0.js,
  https://github.com/requarks/wiki/blob/scarlett/backend/models/assets.ts,
  https://js.wiki/blog/2021-wiki-js-3-feature-preview-storage
- BookStack: https://www.bookstackapp.com/docs/admin/upload-config/,
  https://github.com/BookStackApp/BookStack/blob/development/app/Uploads/AttachmentService.php
- Outline: https://github.com/outline/outline/blob/main/server/models/Attachment.ts,
  https://github.com/outline/outline/blob/main/server/commands/documentPermanentDeleter.ts
- XWiki:
  https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-tools/xwiki-platform-tool-configuration-resources/src/main/resources/xwiki.cfg.vm
- Docmost: https://github.com/docmost/docmost/blob/main/apps/server/src/database/migrations/20240324T086700-attachments.ts
- Gitea: https://github.com/go-gitea/gitea/blob/main/custom/conf/app.example.ini
- GitLab: https://docs.gitlab.com/administration/uploads/, https://docs.gitlab.com/development/file_storage/
- HedgeDoc: https://docs.hedgedoc.org/configuration/
- Joplin: https://joplinapp.org/help/apps/attachments, https://github.com/laurent22/joplin/blob/dev/packages/server/README.md
- PostgreSQL: https://www.postgresql.org/docs/current/storage-toast.html,
  https://www.postgresql.org/docs/current/lo-intro.html, https://wiki.postgresql.org/wiki/BinaryFilesInDB
- MinIO: https://github.com/minio/minio,
  https://blocksandfiles.com/2025/06/19/minio-removes-management-features-from-basic-community-edition-object-storage-code/

Embedding and the editor:

- https://www.mediawiki.org/wiki/Help:Images, https://www.mediawiki.org/wiki/Extension:PdfHandler
- https://support.atlassian.com/confluence-cloud/docs/display-files-and-images/
- https://obsidian.md/help/embeds, https://obsidian.md/help/attachments
- https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files
- https://github.com/outline/outline/blob/main/shared/editor/commands/insertFiles.ts
- https://prosemirror.net/examples/upload/, https://codemirror.net/docs/ref/
- https://github.com/davidmyersdev/ink-mde, https://github.com/laobubu/HyperMD/blob/master/src/addon/insert-file.ts
- https://github.com/arve0/markdown-it-implicit-figures, https://mdit-plugins.github.io/img-size.html

Security:

- https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- https://web.dev/articles/securely-hosting-user-data
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox
- https://www.mediawiki.org/wiki/Manual:Security
- https://github.com/outline/outline/security/advisories/GHSA-gcj7-c9jv-fhgf
- https://securitylab.github.com/advisories/GHSL-2026-052_docmost/
- https://osv.dev/vulnerability/CVE-2021-43842, https://osv.dev/vulnerability/GHSA-9jq9-c2cv-pcrj
- https://confluence.atlassian.com/doc/confluence-security-advisory-2019-04-10-968660855.html
- https://blog.gitea.com/release-of-1.25.4/
- https://github.blog/changelog/2023-05-09-more-secure-private-attachments
- https://docs.gitlab.com/security/user_file_uploads/
- https://sharp.pixelplumbing.com/api-constructor, https://sharp.pixelplumbing.com/api-utility
- https://nvd.nist.gov/vuln/detail/CVE-2024-4367, https://nvd.nist.gov/vuln/detail/cve-2023-38633
- https://docs.clamav.net/manual/Installing/Docker.html
- The Next.js documentation of `serverActions` and `proxyClientMaxBodySize` in `node_modules/next/dist/docs/`

MCP:

- https://modelcontextprotocol.io/specification/2026-07-28/server/tools.md,
  https://modelcontextprotocol.io/specification/2026-07-28/server/resources.md,
  https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices.md
- https://github.com/modelcontextprotocol/experimental-ext-file-uploads/blob/main/specification/draft/file-uploads.md
- https://code.claude.com/docs/en/mcp, https://claude.com/docs/connectors/building/index.md
- https://platform.claude.com/docs/en/build-with-claude/vision
- https://github.com/outline/outline/blob/main/server/mcp/tools/attachments.ts
- https://developer.atlassian.com/cloud/rovo-mcp/guides/supported-tools/
- https://developers.notion.com/guides/mcp/tools-files-reference.md
- https://developers.openai.com/apps-sdk/reference
- https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html
- https://simonwillison.net/tags/markdown-exfiltration/
