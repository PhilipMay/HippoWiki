# Attachments – Requirements

Status: approved

## Goal

Users of a folder can upload images and PDFs to the wiki, show them in pages and link to them, and keep and find them
as documents of the folder. Each file is an item of its own in the folder, next to the pages, with an address that
returns the file itself and a page in the app that shows its details and the actions on it. Today a page can show no
image of its own and point to no document, so screenshots, diagrams and manuals live outside the wiki.

## Users and roles

Users with a role on a folder work with its files in the browser, with the same split of roles as for pages (see
`folder-roles.md`):

| Function                                                                      | Reader | Writer | Manager | Owner |
| ----------------------------------------------------------------------------- | :----: | :----: | :-----: | :---: |
| See the files of the folder, open them, their details page and their versions |   ✓    |   ✓    |    ✓    |   ✓   |
| Upload a file or a new version, revert to an earlier version, move or rename  |        |   ✓    |    ✓    |   ✓   |
| Delete a file                                                                 |        |        |    ✓    |   ✓   |
| See the deleted files of the folder and restore one                           |        |        |    ✓    |   ✓   |

- AI apps list the files of the folder of their connection and read their details through MCP, with the role of the
  connection; they do not read the content of a file, and they do not upload, change or delete a file on its own.
  A Manager connection that deletes a tab deletes its files with it, as in the browser (R20).
- Admins see no content, and so no files, as for pages.

## Scenarios

- A writer documents a setup procedure: they upload two screenshots and a PDF manual into the tab of the guide, show
  the screenshots in the page and link the manual. A reader opens the page, sees the screenshots and opens the manual in
  the browser.
- A team keeps its contracts as PDFs in a tab "contracts" of its folder. A member opens the tab, sees the files next to
  the pages, opens one and reads its details: size, who uploaded it and when.
- An AI app connected to the folder lists its files, finds the manual among them and gives its user the address of the
  PDF and the pages that link it.

## Requirements

### Files as items of a folder

- R1: A file must be an item of its own, placed either directly in a folder or in one tab of that folder, like a page,
  and not part of a page.
  - Acceptance: a file can be uploaded directly into a folder and into a tab; it exists without any page that shows or
    links it; a page that shows it can be deleted and the file stays.
- R2: The first version must accept only these types: PNG, JPEG, GIF, WebP and PDF.
  - Acceptance: each of the five types can be uploaded; a file of any other type is refused with a message that names
    the accepted types, and nothing is stored.
- R21: The name of a file must follow the name rule of pages (lowercase letters and digits in groups joined by single
  hyphens) followed by a dot and the lowercase extension of its type, and must be unique among the files of its place,
  directly in the folder or in one tab. The upload must suggest the name from the name of the uploaded file, and the
  user must be able to change it before the upload is stored.
  - Acceptance: uploading `Network Diagram (v2).PNG` suggests `network-diagram-v2.png`; a name with upper case, a
    space or a second dot is refused at the name field with the rule; a file `setup.png` and a page `setup` exist side
    by side at the same place; a second file `setup.png` at the same place leads to the question of R15.
- R36: A JPEG must be stored with the extension `.jpg`; a JPEG uploaded with `.jpeg` must be accepted and suggested
  with `.jpg`.
  - Acceptance: uploading `photo.jpeg` suggests `photo.jpg`; a name ending in `.jpeg` is refused at the name field with
    the rule.

### Addresses

- R3: Every file must have an address that returns the file itself, which a page uses to show or link it and which a
  browser can open: `/files/<folder>/<name.ext>` for a file placed directly in a folder and
  `/files/<folder>/<tab>/<name.ext>` for a file in a tab.
  - Acceptance: opening the address shows the image, or the PDF in the viewer of the browser; a page that shows the file
    loads it from this address.
- R4: Every file must have a details page in the app, `/folders/<folder>/<name.ext>` for a file placed directly in a
  folder and `/folders/<folder>/<tab>/<name.ext>` for a file in a tab, that shows its details and the actions on it,
  among them moving, renaming and deleting, each for the roles that may use it.
  - Acceptance: the address shows the details of the file and offers move, rename and delete to the roles that may use
    them, and to no other role.
- R32: A file opened at its own address must never run code in the wiki: the browser must be told the type that the
  wiki determined from the content of the file, never the type the uploader claimed, and must not run any script or
  load anything else from it. Files are served from the host of the wiki itself.
  - Acceptance: a file whose content is HTML or SVG but whose name ends in `.png` is refused at upload; every response
    of a file address tells the browser to run nothing in it; a PDF opens in the viewer of the browser.
- R33: The details page must show a preview of an image (for a PDF a button "Open"), the name and place, the type, the
  size, the width and height of an image, the number of versions, the last change with who made it and when, the link
  to copy (`![[…]]` for an image, `[[…]]` for a PDF), the pages that show or link it (R14), and the buttons "Open" and
  "Download".
  - Acceptance: each of these is on the details page of an image and of a PDF, without the preview, width and height
    for a PDF; "Download" saves the file under its name; "Open" opens the address of the file.
- R7: Both addresses of a file must answer a user without a role on its folder, and an address of a file that does not
  exist, with the not-found page, so that nobody learns from an address whether a file exists.
  - Acceptance: a user without a role on the folder gets the not-found page at both addresses of an existing file, the
    same as at the addresses of a file that does not exist; so does an admin.
- R28: The address of a file must answer only a logged-in user with a role on its folder, checked on every request as
  for pages; no address of a file works without a login, and removing a role ends the access to its files with the
  next request.
  - Acceptance: without a login the address of a file shows no file; after the Owner removes a user's role, the next
    request of that user for a file of the folder gets the not-found page.

### Roles

- R8: Every role on a folder must be able to see its files and open them, their details pages and their versions; a
  Writer, a Manager and an Owner must be able to upload files and new versions, revert, move and rename files; only a
  Manager and an Owner must be able to delete a file and to see and restore deleted files.
  - Acceptance: a Reader sees and opens files but is offered no upload, move, rename or delete, and its forms for them
    change nothing; a Writer is offered upload, move and rename but not delete; a Manager and an Owner are offered all
    four.

### Lists

- R9: The view of a folder and the view of a tab must list their files in a section "Files" below their pages, each
  file with its name, its type, its size and its last change.
  - Acceptance: a file placed directly in a folder is listed in the section "Files" of the folder, a file in a tab in
    the section of the tab; the lists of pages are unchanged; each file in the list leads to its details page.
- R38: Without files, the section "Files" of a folder or tab must not be shown; a Writer, a Manager and an Owner still
  see "Upload file".
  - Acceptance: a folder without files looks as it does today, with "Upload file" added for these roles; after the
    first upload the section appears.

### Uploading

- R10: A Writer, a Manager and an Owner must be able to upload a file with a button "Upload file" in the view of a
  folder and of a tab, into that folder or tab.
  - Acceptance: the button is shown to these roles only; the uploaded file is listed in the section "Files" of the
    folder or tab it was uploaded into.
- R11: The page editor must offer no upload in the first version: a page shows or links a file that already exists by
  its link, written in the content.
  - Acceptance: pasting or dropping a file into the editor uploads nothing; the toolbar has no upload button.
- R25: A file must be at most 25 MB by default, and the operator must be able to set another limit with a setting of
  the server. A larger file must be refused with a message that names the limit, and nothing is stored.
  - Acceptance: a file of 25 MB is stored, one of a byte more is refused with the limit in the message; after the
    operator sets 50 MB, a file of 30 MB is stored.
- R26: The upload dialog must offer to remove the location and the other metadata of a photo, such as the camera and
  the time it was taken, switched on by default; with it on, the stored image carries none of it and shows upright, as
  the camera held it.
  - Acceptance: a phone photo with a GPS position uploaded with the option on has no position or camera data at its
    address and shows upright; uploaded with the option off, it is stored as uploaded; a PDF is stored as uploaded,
    and the option is not offered for it.

### Storage

- R27: The contents of files must be kept in a directory that the operator mounts into the container, and the
  operator must be told in the documentation of the image what to mount, and that the directory is backed up together
  with the database, the database first.
  - Acceptance: with the directory mounted, uploaded files survive a restart and a new version of the image; a backup
    of the database followed by a copy of the directory restores every file.
- R39: Without the mounted directory, the wiki must start and work as before, but must not offer "Upload file" and
  must log a warning for the operator; when the directory is full, an upload must be refused with a message, and
  nothing of it may remain stored.
  - Acceptance: started without the directory, pages work, no "Upload file" is shown, and the log holds the warning;
    an upload that does not fit on the disk is refused with a message and leaves no file and no part of one.

### Showing and linking files in pages

- R12: A page must show a file with `![[target]]` and link to it with `[[target]]`, each with an optional label after
  the first `|`, where the target names the file as wiki links name pages: `[[name.ext]]` for a file placed directly
  in the folder and `[[tab/name.ext]]` for a file in a tab of the same folder.
  - Acceptance: `![[guides/diagram.png]]` shows the image of that name in the tab `guides`; `[[guides/report.pdf]]`
    and `[[guides/report.pdf|Manual]]` are links to that PDF, the second with the text "Manual"; a target without an
    extension still names a page, so `[[guides/setup]]` stays a link to a page.
- R13: A link or embed of a file must follow the rules of wiki links: the same from every page of the folder, never
  into another folder, plain text in code and after a backslash, and shown as missing, in the same way as a missing
  page, when no file of that name and place exists or the file is deleted.
  - Acceptance: a link to a file that does not exist, to a deleted file and to a file of another folder shows as
    missing; `` `![[guides/diagram.png]]` `` in a code span is text.
- R22: An image shown with `![[…]]` must appear at its own size, at most as wide as the text of the page, with the label
  as its alt text, or its name without a label, and a click on it must open the file itself in a new browser tab.
  - Acceptance: a small image keeps its size, a wide one is scaled down to the width of the text; a screen reader reads
    the label; a click opens the address of the file in a new tab.
- R23: `![[…]]` of a PDF must show the same as `[[…]]`: a link to the file, with the label as its text, or the name of
  the file without one. A link to a file leads to the address of the file itself.
  - Acceptance: `![[guides/report.pdf]]` and `[[guides/report.pdf]]` both show a link with the text `report.pdf` that
    opens the PDF in the viewer of the browser; neither shows the PDF inside the page.
- R31: For a Writer, a Manager and an Owner a link or embed of a missing file in a place that exists must lead to the
  "Upload file" dialog of the folder or tab it names, with the name of the link filled in; for a Reader it is marked
  text, as a link to a missing page.
  - Acceptance: a Writer clicks `[[guides/manual.pdf]]` of a missing file and gets the upload dialog of the tab
    `guides` with the name `manual.pdf`; a Reader sees marked text without a link.
- R14: The details page of a file must list the pages of the folder that show or link it.
  - Acceptance: a page with `![[guides/diagram.png]]` and one with `[[guides/diagram.png]]` are both listed on the
    details page of that file; a page whose link was removed is no longer listed after its save.

### Editor and search

- R29: Live preview in the page editor must show an image of `![[…]]` under its line, and the picker that opens on
  `[[` must offer the files of the folder as well as its pages, each file marked as a file; choosing a file inserts its
  link.
  - Acceptance: in live preview `![[guides/diagram.png]]` shows the image below the line; typing `[[dia` offers
    `guides/diagram.png` marked as a file, and choosing it inserts `[[guides/diagram.png]]`.
- R30: The search of a folder must find files whose name matches the words of the search, listed together with the
  pages it finds, each file marked as a file and leading to its details page. The text inside PDFs is not searched in
  the first version.
  - Acceptance: a search for `diagram` in a folder with the file `guides/network-diagram.png` lists that file; a
    search for a word that appears only inside a PDF finds nothing.
- R41: Links and embeds of files must count toward the limit of 5,000 wiki links per page, together with the links to
  pages.
  - Acceptance: a page with 4,000 links to pages and 1,001 links or embeds of files is refused at save with the error
    of the limit.

### Versions

- R15: Uploading a file under the name of a file that exists at the same place must, after a question, store a new
  version of that file instead of a second file: pages show the new version at once, and the earlier versions are
  kept.
  - Acceptance: the upload asks whether to store a new version; confirmed, the file has two versions, its address
    returns the new one, and the pages that show it show the new one; cancelled, nothing is stored.
- R34: The details page must offer a Writer, a Manager and an Owner the button "Upload new version", which stores the
  chosen file as the newest version of this file; it must be of the same type as the file.
  - Acceptance: uploading a new PNG to a PNG file adds a version; a PDF chosen for a PNG file is refused with a message;
    a Reader is offered no button.
- R35: A revision of a page and a deleted page must show a file that they embed in its current version, as a link
  shows the current title of a page.
  - Acceptance: after a new version of an image, an old revision of a page that embeds it shows the new version.
- R16: The details page of a file must show its versions, each with who uploaded it and when, open each one, and let a
  Writer, a Manager and an Owner revert the file to an earlier version, which stores that version again as the newest.
  - Acceptance: after a revert to version 1 of a file with two versions, the file has three versions and returns the
    content of version 1; a Reader sees the versions but is offered no revert.

### Renaming and moving

- R17: A Writer, a Manager and an Owner must be able to rename a file and move it into another tab of its folder or
  directly into the folder; every link and embed of the file in the pages of the folder must be changed to the new name
  and place in the same step, as for pages, and the dialog must say how many pages it changes.
  - Acceptance: after renaming `guides/diagram.png` to `guides/network.png`, every page of the folder that showed or
    linked the file shows or links it under the new name; the dialog named the number of these pages; the file keeps
    its versions.
- R18: Renaming a tab must change the links and embeds of the files in that tab, as it changes the links of its pages.
  - Acceptance: after renaming the tab `guides` to `manuals`, `![[guides/diagram.png]]` reads
    `![[manuals/diagram.png]]` in every page of the folder.
- R42: A rename, a move, a delete and a new version of a file must be refused when the file was changed after the
  dialog was opened; the dialog then shows the file as it is now with a message, and confirming again applies the
  change, as for pages.
  - Acceptance: a user opens "Move or rename" of a file, another uploads a new version meanwhile; the first rename is
    refused with the message, and confirmed again it is stored.

### Deleting and restoring

- R19: Deleting a file must be a soft delete, as for pages: the file disappears from the lists and its addresses show
  the not-found page, but a Manager or an Owner can see it among the deleted items of the folder and restore it, with
  its versions.
  - Acceptance: a deleted file is missing from the section "Files", both its addresses show the not-found page, links to
    it show as missing; a Manager restores it, and it is listed again with all its versions.
- R24: The deleted pages of a folder must list its deleted files as well, in one list with the deleted pages, and
  restoring a file must ask for a name and a place in its folder, with the old name prefilled, as for pages. A deleted
  file opens there read-only, with its details, its versions and "Restore" as its only action, as a deleted page does.
  - Acceptance: a deleted file and a deleted page appear in the same list of the folder, each marked as a file or a
    page; restoring the file asks for name and place; a taken name is refused at the name field; the
    deleted file shows its details and versions and offers only "Restore".
- R37: That list must be called "Deleted items", in its button and its heading, and live at `/deleted-items/<folder>`,
  a deleted page or file at `/deleted-items/<folder>/<id>`, instead of under `/deleted-pages`.
  - Acceptance: the folder offers a Manager the button "Deleted items", which leads to `/deleted-items/<folder>` with
    the heading "Deleted items"; the deleted pages and files of the folder are listed there.
- R20: Deleting a tab must delete its files in the same way as its pages: each as a soft delete that a Manager or an
  Owner can restore.
  This holds in the browser and for `delete_tab` through MCP: a Manager connection deletes a tab that holds files, and
  its files go to the deleted items of the folder with its pages; the result of `delete_tab` names the deleted files
  next to the deleted pages, and its description says before the call that the files of the tab are deleted with it.
  - Acceptance: after deleting a tab with two files, both are among the deleted items of the folder and can be
    restored; the same after `delete_tab` of a Manager connection, whose result names both files.
- R40: The old addresses under `/deleted-pages` must show the not-found page, as an address does after every rename in
  the wiki.
  - Acceptance: `/deleted-pages/<folder>` and `/deleted-pages/<folder>/<id>` show the not-found page.

### MCP

- R5: An AI app must be able to list the files of the folder of its connection and read the details of one, through
  MCP, for every role of a connection: its name and place, type, size, the width and height of an image, its last
  change, its address and the pages that show or link it. MCP must never return the content of a file in the first
  version.
  - Acceptance: a Reader, a Writer and a Manager connection list the files of their folder and read the details of
    one; no result holds the content of an image or a PDF; no connection reaches the files of another folder.
- R6: MCP must offer no way to upload, change, move, rename or delete a file on its own in the first version. The one
  exception is `delete_tab` of a Manager connection, which deletes the files of the tab with its pages (R20).
  - Acceptance: no tool of any connection uploads, changes, moves, renames or deletes a single file; `delete_tab` is
    the only tool after which a file is deleted, and only together with its tab.
- R43: The MCP tool `search_pages` must find files whose name matches the words of the search, as the search in the
  browser does (R30), each result marked as a file with its details and without its content.
  - Acceptance: through MCP a search for `diagram` returns the file `guides/network-diagram.png` marked as a file, with
    the same files as the search in the browser.

## Scope

- In: images (PNG, JPEG, GIF, WebP) and PDFs as items of folders and tabs; showing and linking them in pages; a
  details page per file with versions; a section "Files" in the views of folders and tabs; uploading from those
  views; finding files by name in search; listing files and reading their details through MCP.
- Not in: other file types; uploading, changing, moving, renaming or deleting a file on its own through MCP;
  uploading from the page editor (paste, drop or a toolbar button); a limit on the total size of files per folder or
  per user, which belongs to the roadmap entry "Rate limits and quotas"; S3-compatible storage, which comes in a later
  step; links to files that work without a login; searching the text inside PDFs; the content of files through MCP; a
  host of its own for files; a list of the files that no page shows or links, which belongs to the roadmap entry
  "Broken links and orphaned pages"; redirects from the old addresses under `/deleted-pages`.

## Effect on existing features

- Addresses: `/files` becomes a new prefix for the files themselves, next to `/folders` and `/deleted-items`. Under
  `/folders` a segment with the extension of a file becomes the details page of a file; today a segment that does not
  end in `.md` is always a tab (see "Addresses" in `content-structure.md`). Tab names have no dot, so no existing
  address changes its meaning.
- Folder and tab views: a section "Files" below the pages, and a button "Upload file" for a Writer (see "Routes" in
  `content-structure.md`).
- Roles: new functions in the table of `folder-roles.md`.
- Optimistic locking: changes of files are told apart as those of pages (see `optimistic-locking.md`).
- Wiki links: a target may name a file by its extension, and `![[…]]` shows a file. Today embeds are not part of the
  syntax and `![[setup]]` is the character `!` followed by a link (see "Syntax and target" in `wiki-links.md`); that
  stays so for a target without an extension. The index of links, the missing display and the updates on a move,
  a rename and a tab rename cover files too.
- Deleted pages: the deleted items of a folder include its deleted files, and deleting a tab deletes its files (see
  `page-deletion.md` and "Deleting a tab" in `content-structure.md`). The list is renamed "Deleted items" and moves
  from `/deleted-pages` to `/deleted-items`, a new prefix next to `/folders` and `/files` (see "Addresses" in
  `content-structure.md`); the results of `delete_page` and `delete_tab` through MCP name the new address (see
  `mcp.md`). `delete_tab` through MCP deletes the files of the tab with its pages and names them in its result.
- Pages: "no attachments" in the current limits of `pages.md` is lifted.
- Markdown editor: live preview shows images, and the picker on `[[` offers files (see `markdown-editor.md`, whose
  current limits say images stay their Markdown text).
- Search: the results of a folder list files by their name, in the browser and through `search_pages` (see
  `search.md` and "Search through MCP" there).
- MCP: new read tools for files (see `mcp.md`).
- Container image: a directory for the contents of files to mount, a setting for the size limit, and a backup that
  holds the directory as well as the database (see `container-image.md`).

## Decisions

- Files are items of their own, not attached to a page: a file can be used by several pages and kept as a document of
  the folder without any page. Rejected: files attached to one page, as in Confluence and BookStack, which move and are
  deleted with their page.
- Files sit next to pages, directly in a folder or in a tab, so that tabs, roles and the deletion of tabs apply to them
  as to pages. Rejected: a files area of its own with subfolders, as the file manager of Wiki.js, which is a second
  structure; files at the folder level only, which makes one long list in a large folder.
- Embedding in pages and keeping documents weigh the same: both shape the first version.
- The first version accepts only images and PDFs, the smallest set to secure. Rejected for now: Office and text files
  as downloads; any type as a download.
- Every file has two addresses: the file itself, and a page with its details and actions, as MediaWiki and GitHub do.
- AI apps only read files through MCP in the first version. Rejected for now: uploads of small files through MCP, as
  Wiki.js offers; no MCP tools at all.
- `delete_tab` through MCP deletes the files of the tab with its pages, as deleting a tab does in the browser, so that
  deleting a tab works the same way everywhere; the delete is soft, and a Manager or Owner restores each file with its
  versions in the browser. Rejected: refusing `delete_tab` for a tab that holds files, which would make what the tool
  does depend on what the tab holds and leave a tab of files that no AI app can delete; moving the files of the tab
  into the folder.
- The roles follow those of pages: every role reads, a Writer uploads, moves and renames, a Manager or Owner deletes.
  Rejected: deleting by a Writer, which lets a Writer remove a document that pages rely on; uploading by Managers
  only.
- The file itself is served under a prefix of its own, `/files`, and its details page under `/folders` next to the
  pages, so that the files can get strict security headers of their own, or another host later. Rejected: the file at
  the address of its details page with `?raw`; the file by its id, which survives renames but cannot be read.
- Files are listed in a section "Files" below the pages, so that the lists of pages stay as they are. Rejected: one
  list of pages and files; a separate view "Files".
- Files are uploaded only from the views of folders and tabs in the first version. Rejected for now: uploading from
  the editor by paste, drop and a toolbar button; uploading only from the editor.
- Pages show and link files with the syntax of wiki links, `![[…]]` and `[[…]]`, so that the index of links, the
  missing display and the updates on renames work for files as for pages. Rejected: plain Markdown to `/files`
  addresses, which is not tracked; both syntaxes side by side.
- Uploading under a taken name stores a new version after a question, and the old versions stay with a revert.
  Rejected: replacing without a history, as Wiki.js and BookStack do; refusing the name.
- Deleting a file is a soft delete with a restore, as for pages, also when its tab is deleted. Rejected: deleting for
  good; moving the files of a deleted tab into the folder.
- Renaming and moving a file update its links in the pages of the folder, as for pages. Rejected: links that break, as
  in Wiki.js; files that can be neither renamed nor moved.
- File names follow the name rule of pages plus a lowercase extension, suggested from the uploaded file name, so that
  they are safe in links and addresses. Rejected: the original file name with spaces and upper case; a generated
  name.
- An image fits the width of the text, its label is its alt text, and a click opens the file in a new tab. Rejected
  for now: a caption under the image; an enlarged view over the page.
- `![[…]]` of a PDF is a plain link, as `[[…]]`: embeds show images only. Rejected: a card with "Open" and "Download";
  a PDF viewer inside the page, which needs the security headers of the app relaxed for files.
- Deleted files are listed together with the deleted pages, and a restore asks for a name and a place, as for pages.
  Rejected: a list of their own; a restore to the old place without asking.
- A file is at most 25 MB by default, which the operator can change. Rejected: 10 MB, too small for many manuals;
  100 MB, larger uploads and more disk by default.
- No limit on the total size per folder or per user yet: it belongs to the roadmap entry "Rate limits and quotas".
- The contents of files are kept on a directory the operator mounts, and S3-compatible storage follows later.
  Rejected for now: both from the first version on, more to build and test; inside the database, which makes the
  database and its backups grow with every file.
- The upload dialog offers to remove the metadata of photos, on by default, so that an author who uploads a phone
  photo does not publish where it was taken unless they choose to. Rejected: always removing it; always keeping it.
- The address of a file answers only logged-in users with a role on its folder, checked on every request, so that
  removing a role ends access at once. Rejected: short-lived links that work without a login; public secret links,
  which cannot be withdrawn.
- Live preview shows images, and the picker on `[[` offers files. Rejected: the picker only; neither.
- A missing file link leads a Writer to the upload dialog with the name filled in, as a missing page link leads to the
  editor of a new page. Rejected: marked text only; the view of the tab.
- Search finds files by name; the text of PDFs comes later. Rejected for now: the text of PDFs in the first version;
  no files in search.
- A file opened at its own address never runs code, as a firm requirement, and files are served from the host of the
  wiki. Rejected for now: a host of its own for files, which needs a second host name and certificate.
- AI apps read only the details of files in the first version, never their content. Rejected for now: images as
  images and PDFs as their text; PDFs as files, which some clients refuse.
- New versions are uploaded from the details page as well as by an upload under the same name, and old revisions of
  pages show the current version of a file. Rejected: same-name uploads only; old revisions with the version of their
  time.
- The details page shows the full set of details with a preview and the link to copy. Rejected: a basic set without
  a preview.
- A JPEG is stored as `.jpg`, so that a link has one spelling. Rejected: `.jpeg`; both side by side.
- The list of deleted pages becomes "Deleted items" at `/deleted-items/<folder>`, since it holds files too. Rejected:
  keeping the name "Deleted pages"; a new name at the old address.
- Without files the section "Files" is not shown, so that folders and tabs look as today. Rejected: a hint "No files
  yet".
- Without the mounted directory the wiki works but offers no upload, and logs a warning. Rejected: refusing to start,
  which would make every existing installation fail after the update until the directory is mounted.
- The old addresses under `/deleted-pages` show the not-found page, as after every rename. Rejected: a redirect,
  which would be the only one of the wiki.
- Links and embeds of files count toward the 5,000 wiki links of a page, since they share the index of links.
  Rejected: a limit of their own.
- A list of unused files comes later, with the list of orphaned pages. Rejected for now: such a list in the first
  version.
- Changes of the same file at the same time are refused as for pages. Rejected: the last change wins.
- `search_pages` through MCP finds files by name as the browser does, so that both find the same. Rejected: pages
  only through MCP.

## Open questions
