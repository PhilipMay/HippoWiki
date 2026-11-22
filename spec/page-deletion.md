# HippoWiki – Page Deletion

The soft delete of pages and files as built: a deleted page or file disappears from the wiki but keeps its content or
its versions, can be looked at in the deleted items of its folder and can be restored from there. Pages themselves are described in `pages.md`, folders,
tabs and addresses in `content-structure.md`.

Code: `src/features/pages/` (`deletePage`, `restorePage`, `listDeletedPages` and `getDeletedPage` in `service.ts`,
`softDeleteData()` in `writes.ts`, which the delete of a tab stores for its pages as well, the dialogs and lists in
`components/`, among them `DeletedItemsList.tsx`, the list of pages and files), `src/features/files/` (`deleteFile`,
`restoreFile`, `listDeletedFiles` and `getDeletedFile` in `service.ts`, `softDeleteFileData()` in `writes.ts`,
`deletedFileAddressOf()` in `file-query.ts`, `DeletedFileView.tsx` and `DeleteFileDialog.tsx`), routes under
`src/app/deleted-items/`. Tests: `e2e/delete-page.spec.ts`, `e2e/delete-file.spec.ts`, `e2e/deleted-items.spec.ts`,
`e2e/restore-page.spec.ts`, `integration/page-service.test.ts`, `integration/file-service.test.ts`.

## Deleting

- A page is deleted from its page address with "Delete" (`?action=delete`), after a confirmation. Deleting leads to
  the folder or tab the page was in. Deleting needs the role Manager or Owner on the folder (see `folder-roles.md`).
- A deleted page keeps its content and its folder, but forgets its tab: the wiki only knows which folder it belongs to.
- Pages are also deleted together with their tab, each as if it had been deleted on its own (see "Deleting a tab" in
  `content-structure.md`).
- A delete is refused when the page was changed after the dialog was opened; the dialog then stays open with a message,
  and confirming again deletes the page (see `optimistic-locking.md`).
- Pages are deleted through MCP as well, by a Manager connection of an AI app, on their own with `delete_page`, based
  on a version, and together with their tab with `delete_tab`, with the user of the connection as the user who deleted
  them. The deleted pages themselves stay in the browser (see "Tools" in `mcp.md`).

## Deleting a file

- A file is deleted from its details page with "Delete" (`?action=delete`), after a confirmation that says that pages
  showing or linking it will show it as missing. Deleting leads to the folder or tab the file was in and needs the role
  Manager or Owner on the folder (see `folder-roles.md`).
- A deleted file keeps its folder and all its versions, forgets its tab, and the user who deleted it becomes its last
  editor with the channel; its lock version counts up. Its name is free at once.
- Files are also deleted together with their tab, in the browser and through `delete_tab` of a Manager connection
  (see "Deleting a tab" in `content-structure.md`); no tool deletes a single file.
- A delete is refused when the file was changed after the dialog was opened, as for pages (see "Files" in
  `optimistic-locking.md`).
- A deleted file is invisible as a deleted page is: it is missing from the section "Files", both its addresses, the
  details page and the file itself, show the not-found page, and its links and embeds show as missing.

## Deleted pages are invisible

- A deleted page is missing from every list of the wiki (folder contents, tab, "All pages") and its old address shows
  the not-found page. There are no redirects.
- Its name is free at once: a new page of the same name can be created at the same place. Deleted pages never block a
  name, and two deleted pages of a folder may share one.
- Wiki links into a deleted page or a deleted tab show as missing for every role, and a restore changes no link: a
  page restored under its old name and place is found by its links again (see "Missing links" in `wiki-links.md`).
  A deleted page's own links are not updated by a rename while it is deleted.
- A deleted page cannot be edited, moved or renamed; trying it answers as for a page that does not exist.
- Like all content, deleted pages are for users only: an admin sees no deleted page and restores none (see "Only users
  see content" in `content-structure.md`).
- The deleted pages of a folder, reading one and restoring it need the role Manager or Owner on the folder; for every
  other role their addresses show the not-found page (see `folder-roles.md`).

## Deleted items of a folder

- The folder address links a Manager and an Owner to "Deleted items", `/deleted-items/<folder>`, one list under the
  heading "Deleted items" of the deleted pages and files of the folder, newest first, each with its name, whether it
  is a page or a file, the title of a page or the type of a file, the time of deletion, the user who deleted it and,
  in a column "Via" right after "Deleted by", how it was deleted, also for an item deleted with its tab (see "Channel"
  in `content-structure.md`). The list does not show where in the folder an item was.
- `/deleted-items/<folder>/<id>` shows a deleted page read-only, with the time of deletion, the user who deleted it
  and the channel, "Restore" as its only action and "History". A deleted page is addressed by its id, because its name
  need not be unique and it has no `.md` address.
- The same address shows a deleted file read-only, by its id: its type, size, width and height, the number of its
  versions, the time of deletion with the user and the channel, and its versions, none of which opens, with "Restore"
  as its only action. It has no other action, no view and no `version` or `notice`.
- A deleted page keeps its history. Its views `?view=history`, `?view=revision` and `?view=compare` show it read-only,
  without "Revert" (see `page-history.md`); deleting, restoring and deleting a tab record no revision, so a restored
  page has its whole history again.
- Everything else under `/deleted-items` (an unknown folder or id, a page of another folder or one that is not deleted,
  `/deleted-items` alone, any other view or action) shows the not-found page.
- The old addresses under `/deleted-pages`, the list and a deleted page alike, show the not-found page, for every role;
  there is no redirect, as after every rename in the wiki.

## Restoring

- `?action=restore` on a deleted page asks for a name and a place in the page's own folder, directly in the folder or
  in one of its tabs. The name is prefilled with the old name.
- No place is preselected: the page's old place is not known, and the user has to choose one.
- Restoring checks the name like moving a page (`content-structure.md`); the content is neither validated nor
  touched. It leads to the page's new address.
- Restoring is not checked against a change in the meantime (see `optimistic-locking.md`).
- A deleted file is restored in the same way, in the "Restore file" dialog: its name with the extension prefilled, no
  place preselected, a taken name refused at the name field, and an extension other than that of its type refused as
  well. It comes back with all its versions and leads to its details page.
- Restoring makes the logged-in user the last editor of the page or file, with the channel `web` (see "Last editor" and
  "Channel" in `content-structure.md`): a restored page shows the user who restored it via `web`, also when it was
  deleted through MCP.

## Decisions

- A deleted page loses its tab, because its place inside the folder is forgotten. As a result no unique index on page
  names covers it: the index on the names of pages placed directly in a folder leaves out deleted pages, and the one
  on the names within a tab never sees a page without a tab. So the name is free at once.
- Deleted pages have addresses of their own under `/deleted-items`, named for what it holds: the deleted items of a
  folder, so that other kinds of items can join the list. It was once `/deleted-pages`, which shows the not-found page
  now instead of a redirect, which would be the only one of the wiki. Tabs are deleted for good and get none, and so
  will folders (see "Deleting folders" in `roadmap.md`).
- Who deleted a page, and how, is its last editor and its channel; neither is stored on its own. This holds only as
  long as nothing writes to a deleted page; a later write to deleted pages has to keep the last editor and the channel
  of the deleted pages it touches. Deleting a
  tab writes only the pages of the tab, which are not deleted yet, and deleting a folder for good will remove its
  deleted pages instead of writing to them.
- A deleted page is restored only into its own folder, as a lasting rule, like pages are moved only within their
  folder (see `content-structure.md`). Rejected: restoring a page into another folder.
- Pages deleted before the channel was recorded show `web`, also when an AI app deleted them (see "Decisions" in
  `content-structure.md`).

## Current limits

- Folders cannot be deleted yet; once they can, a folder is deleted for good after a warning, with its deleted pages,
  and cannot be restored (see "Deleting folders" in `roadmap.md`). Tabs are deleted for good; the pages and files of
  a deleted tab are restored one by one, not all at once.
- The versions of a deleted file cannot be opened, and the blobs of deleted files are never removed.
- Only a Manager and an Owner of the folder delete and restore pages; a Writer cannot undo a page created by mistake.
- Deleted pages cannot be listed, read or restored through MCP, also by a Manager connection that deleted them (see
  `mcp.md`).
- A deleted page cannot be removed for good; there is no emptying of all deleted pages and no automatic cleanup after a
  retention period. Neither is planned.
- A page is restored only into its own folder, as a lasting rule.
