# HippoWiki – Page Deletion

The soft delete of pages as built: a deleted page disappears from the wiki but keeps its content, can be looked at in
the deleted pages of its folder and can be restored from there. Pages themselves are described in `pages.md`, folders,
tabs and addresses in `content-structure.md`.

Code: `src/features/pages/` (`deletePage`, `restorePage`, `listDeletedPages` and `getDeletedPage` in `service.ts`,
the dialogs and lists in `components/`), routes under `src/app/deleted-pages/`. Tests: `e2e/delete-page.spec.ts`,
`e2e/deleted-pages.spec.ts`, `e2e/restore-page.spec.ts`, `integration/page-service.test.ts`.

## Deleting

- A page is deleted from its page address with "Delete" (`?action=delete`), after a confirmation. Deleting leads to
  the folder or tab the page was in.
- A deleted page keeps its content and its folder, but forgets its tab: the wiki only knows which folder it belongs to.

## Deleted pages are invisible

- A deleted page is missing from every list of the wiki (folder contents, tab, "All pages") and its old address shows
  the not-found page. There are no redirects.
- Its name is free at once: a new page of the same name can be created at the same place. Deleted pages never block a
  name, and two deleted pages of a folder may share one.
- A deleted page cannot be edited, moved or renamed; trying it answers as for a page that does not exist.

## Deleted pages of a folder

- The folder address links to "Deleted pages", `/deleted-pages/<folder>`: the deleted pages of the folder, newest
  first, with name, title and time of deletion. The list does not show where in the folder a page was.
- `/deleted-pages/<folder>/<id>` shows a deleted page read-only, with "Restore" as its only action. A deleted page is
  addressed by its id, because its name need not be unique and it has no `.md` address.
- Everything else under `/deleted-pages` (an unknown folder or id, a page of another folder or one that is not deleted,
  `/deleted-pages` alone, any view or other action) shows the not-found page.

## Restoring

- `?action=restore` on a deleted page asks for a name and a place in the page's own folder, directly in the folder or
  in one of its tabs. The name is prefilled with the old name.
- No place is preselected: the page's old place is not known, and the user has to choose one.
- Restoring checks the name like moving a page (`content-structure.md`); the content is neither validated nor
  touched. It leads to the page's new address.

## Decisions

- A deleted page loses its tab, because its place inside the folder is forgotten. As a result no unique index on page
  names covers it: the index on the names of pages placed directly in a folder leaves out deleted pages, and the one
  on the names within a tab never sees a page without a tab. So the name is free at once.
- Deleted pages have addresses of their own under `/deleted-pages`, named for what it holds, so that deleted tabs and
  folders can get addresses there later.

## Current limits

- Folders and tabs cannot be deleted.
- A deleted page cannot be removed for good; there is no emptying of all deleted pages and no automatic cleanup.
- A page is restored only into its own folder.
- Who deleted a page is not recorded.
