# HippoWiki – Page Deletion

The soft delete of pages as built: a deleted page disappears from the wiki but keeps its content, can be looked at in
the deleted pages of its folder and can be restored from there. Pages themselves are described in `pages.md`, folders,
tabs and addresses in `content-structure.md`.

Code: `src/features/pages/` (`deletePage`, `restorePage`, `listDeletedPages` and `getDeletedPage` in `service.ts`,
`softDeleteData()` in `writes.ts`, which the delete of a tab stores for its pages as well, the dialogs and lists in
`components/`), routes under `src/app/deleted-pages/`. Tests: `e2e/delete-page.spec.ts`,
`e2e/deleted-pages.spec.ts`, `e2e/restore-page.spec.ts`, `integration/page-service.test.ts`.

## Deleting

- A page is deleted from its page address with "Delete" (`?action=delete`), after a confirmation. Deleting leads to
  the folder or tab the page was in. Deleting needs the role Manager or Owner on the folder (see `folder-roles.md`).
- A deleted page keeps its content and its folder, but forgets its tab: the wiki only knows which folder it belongs to.
- Pages are also deleted together with their tab (see "Deleting a tab" in `content-structure.md`): each of them becomes
  a deleted page as if it had been deleted on its own, without a check of its version, with the user who deleted the
  tab as its last editor and so as the user who deleted it.
- A delete is refused when the page was changed after the dialog was opened; the dialog then stays open with a message,
  and confirming again deletes the page (see `optimistic-locking.md`).
- Pages are deleted through MCP as well, by a Manager connection of an AI app, on their own with `delete_page`, based
  on a version, and together with their tab with `delete_tab`, with the user of the connection as the user who deleted
  them (see `mcp.md`). Deleted pages, reading one and restoring stay in the browser: no tool lists, reads or
  restores a deleted page. Only the list of tools holds this rule: the reads of the service would give a Manager
  connection the deleted pages, so a new tool must not call them.

## Deleted pages are invisible

- A deleted page is missing from every list of the wiki (folder contents, tab, "All pages") and its old address shows
  the not-found page. There are no redirects.
- Its name is free at once: a new page of the same name can be created at the same place. Deleted pages never block a
  name, and two deleted pages of a folder may share one.
- A deleted page cannot be edited, moved or renamed; trying it answers as for a page that does not exist.
- Like all content, deleted pages are for users only: an admin sees no deleted page and restores none (see "Only users
  see content" in `content-structure.md`).
- The deleted pages of a folder, reading one and restoring it need the role Manager or Owner on the folder; for every
  other role their addresses show the not-found page (see `folder-roles.md`).

## Deleted pages of a folder

- The folder address links a Manager and an Owner to "Deleted pages", `/deleted-pages/<folder>`: the deleted pages of the folder, newest
  first, with name, title, time of deletion, the user who deleted it and, in a column "Via" right after "Deleted by",
  how it was deleted: `web` in the browser, `mcp` through MCP, also for a page deleted with its tab (see "Last editor"
  in `content-structure.md`). The list does not show where in the folder a page was.
- `/deleted-pages/<folder>/<id>` shows a deleted page read-only, with the time of deletion, the user who deleted it
  and how ("Deleted <time> by mike via mcp"), "Restore" as its only action and "History". A deleted page is addressed
  by its id, because its name need not be unique and it has no `.md` address.
- A deleted page keeps its history. Its views `?view=history`, `?view=revision` and `?view=compare` show it read-only,
  without "Revert" (see `page-history.md`); deleting, restoring and deleting a tab record no revision, so a restored
  page has its whole history again.
- Everything else under `/deleted-pages` (an unknown folder or id, a page of another folder or one that is not deleted,
  `/deleted-pages` alone, any other view or action) shows the not-found page.

## Restoring

- `?action=restore` on a deleted page asks for a name and a place in the page's own folder, directly in the folder or
  in one of its tabs. The name is prefilled with the old name.
- No place is preselected: the page's old place is not known, and the user has to choose one.
- Restoring checks the name like moving a page (`content-structure.md`); the content is neither validated nor
  touched. It leads to the page's new address.
- Restoring is not checked against a change in the meantime (see `optimistic-locking.md`).
- Restoring makes the logged-in user the last editor of the page, with the channel `web` (see "Last editor" in
  `content-structure.md`): a restored page shows the user who restored it "via web", also when it was deleted through
  MCP.

## Decisions

- A deleted page loses its tab, because its place inside the folder is forgotten. As a result no unique index on page
  names covers it: the index on the names of pages placed directly in a folder leaves out deleted pages, and the one
  on the names within a tab never sees a page without a tab. So the name is free at once.
- Deleted pages have addresses of their own under `/deleted-pages`, named for what it holds. Tabs are deleted for good
  and get none, and so will folders (see "Deleting folders" in `roadmap.md`).
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
  and cannot be restored (see "Deleting folders" in `roadmap.md`). Tabs are deleted for good; the pages of a deleted
  tab are restored one by one, not all at once.
- Only a Manager and an Owner of the folder delete and restore pages; a Writer cannot undo a page created by mistake.
- Deleted pages cannot be listed, read or restored through MCP, also by a Manager connection that deleted them.
- A deleted page cannot be removed for good; there is no emptying of all deleted pages and no automatic cleanup after a
  retention period. Neither is planned.
- A page is restored only into its own folder, as a lasting rule.
