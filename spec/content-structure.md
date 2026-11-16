# HippoWiki – Content Structure

The content structure as built: folders, optional tabs inside a folder and Markdown pages, and the addresses they have.
What a page itself is (its content, derived title, editor and rendering) is described in `pages.md`, deleting and
restoring pages in `page-deletion.md`, and who sees and does what with a folder in `folder-roles.md`.

Code: `src/features/folders/` (folders and tabs), `src/features/pages/` (pages), `src/lib/names.ts` (the name rule),
`src/lib/addresses.ts` (building and parsing addresses), the models `Folder`, `Tab` and `Page` in
`prisma/schema.prisma`, and the routes under `src/app/folders/` and `src/app/deleted-pages/`. Tests:
`e2e/folders.spec.ts`, `e2e/tabs.spec.ts`, `e2e/all-pages.spec.ts`, `e2e/create-page.spec.ts`,
`e2e/move-or-rename-page.spec.ts`, `e2e/access.spec.ts`, `src/lib/names.test.ts`, `src/lib/addresses.test.ts`,
`integration/folder-service.test.ts`, `integration/page-service.test.ts`, `integration/db-errors.test.ts`. The last
editor: the writes of `src/features/folders/service.ts` and `src/features/pages/service.ts`, the relation
`lastEditedBy` of `Folder`, `Tab` and `Page` in `prisma/schema.prisma` and the migration
`prisma/migrations/20261116103037_init/`.

## Overview

Content has three levels:

- **Folder**: the top level. A folder groups related content, such as one project, team or topic. Folders are also the
  unit that roles are given on: a user sees only the folders with a role of their own (see `folder-roles.md`).
- **Tab**: an optional section inside a folder, such as "guides", "meetings" or "archive".
- **Page**: a Markdown document. A page lives either directly in a folder or in one tab of that folder, and so always in
  exactly one folder.

There is no deeper nesting: no folders inside folders and no tabs inside tabs. A new folder has no tabs; a folder may
hold pages directly and have tabs at the same time.

- The database guarantees that a page's tab belongs to the page's folder: a composite foreign key from the page's tab
  and folder to the tab's id and folder. A tab of another folder is refused like a tab that no longer exists.
- No folder, tab or page is deleted by a cascade: every foreign key between them restricts deleting.

## Names

- Folders, tabs and pages each have a name, which is also their part of the address. The rule is in
  `src/lib/names.ts`: lowercase letters and digits in groups joined by single hyphens, and so never a dot.
- No name is reserved: all content lives under `/folders`, and actions are in the query string.
- Names are unique only where they meet, each guaranteed by a unique index in the database:
  - folder names across the wiki
  - tab names within their folder
  - page names within their tab
  - the names of pages placed directly in a folder among those pages only, leaving out deleted pages
- Tab names and the names of pages placed directly in the folder are separate: a tab `guides` and a page `guides`
  placed directly in the same folder exist side by side, because `.md` keeps their addresses apart.
- A taken name is refused at the name field; no suffix is added automatically. The same name is free at another place.
- A name never changes automatically. The page title is separate from the name (see `pages.md`).

## Addresses

- All content lives under the fixed prefix `/folders`; deleted pages live under `/deleted-pages` (see
  `page-deletion.md`). The rest of the root belongs to the app (`/api` today).
- The addresses:
  - `/folders`: the list of folders
  - `/folders/<folder>`: a folder
  - `/folders/<folder>/<tab>`: a tab
  - `/folders/<folder>/<page>.md`: a page placed directly in a folder
  - `/folders/<folder>/<tab>/<page>.md`: a page in a tab
  - `/deleted-pages/<folder>` and `/deleted-pages/<folder>/<id>`: the deleted pages of a folder and a deleted page
- The `.md` belongs to the address, not to the name. A segment that ends in the lowercase `.md` is a page, any other is
  a tab.
- Every address maps to at most one item. A malformed name, an unknown folder, tab or page, and a page of another
  folder or tab show the not-found page. Pages have no address outside `/folders`.
- A rename or move changes the address, deleting a page removes it. There are no redirects from the old address; it
  shows the not-found page. Renaming a folder changes the addresses of its deleted pages as well.

## Actions and views

- An action is given in the query string as `?action=<action>` and opens a dialog or the editor on top of the content
  of its address:

  | Address      | Action           | Opens                                                    |
  | ------------ | ---------------- | -------------------------------------------------------- |
  | `/folders`   | `new`            | the "New folder" dialog                                  |
  | folder       | `new`            | the editor for a new page, the folder itself preselected |
  | folder       | `rename`         | the "Rename folder" dialog                               |
  | folder       | `new-tab`        | the "New tab" dialog                                     |
  | folder       | `give-role`      | the "Give role" dialog (see `folder-roles.md`)           |
  | tab          | `new`            | the editor for a new page, the tab preselected           |
  | tab          | `rename`         | the "Rename tab" dialog                                  |
  | page         | `edit`           | the edit form (see `pages.md`)                           |
  | page         | `move-or-rename` | the "Move or rename page" dialog                         |
  | page         | `delete`         | the "Delete page" dialog                                 |
  | deleted page | `restore`        | the "Restore page" dialog                                |

- A folder address also has the views `?view=all`, the list of all its pages, and `?view=roles`, who has which role on
  the folder (see `folder-roles.md`).
- A page address with an action may also carry the notice `?action=<action>&notice=changed`: the editor or dialog of
  the action is shown again after a change was refused, because the page was changed after it was opened (see
  `optimistic-locking.md`). A notice without an action, and an unknown, empty or repeated notice, show the not-found
  page.
- An action or view is offered only to the roles that may use it; one beyond the user's role shows the not-found page,
  before the content is read, like an unknown one (see `folder-roles.md`).
- Each address accepts only its own actions and views. An unknown, empty or repeated action or view, one of another
  address, and a view together with an action show the not-found page.
- Saving leads to the address of the item as stored, never to one built from submitted values. Cancelling and the
  Escape key lead to the address without the query string.

## Routes

- `/` redirects to `/folders`; the app bar links to `/folders`.
- `/folders`: the folders with a role of the user, with their last update and the own role, and a "New folder"
  button; without any folder a hint that the user can create one or ask an Owner of a folder for a role.
- `/folders/<folder>`: the folder with the own role, the buttons the role includes ("Rename" for an Owner, "All pages"
  and "Roles" for every role, "Deleted pages" and "New tab" for a Manager, "New page" for a Writer), and one list of
  its contents: first the pages placed directly in the folder, then its tabs.
- `/folders/<folder>?view=all`: all pages of the folder, with their tab.
- `/folders/<folder>?view=roles`: the roles view (see `folder-roles.md`).
- `/folders/<folder>/<tab>`: the tab with "Rename" for a Manager and "New page" for a Writer, and the pages of the
  tab.
- Page addresses are described in `pages.md`, the addresses under `/deleted-pages` in `page-deletion.md`.
- Every address below a folder has a breadcrumb back to the folder list and the folder.

## Changing the structure

- Folders and tabs are created and renamed in a name dialog. Pages are created in the editor and get their name and
  place in the "Save page" dialog.
- A new page can be created in any place of its folder: directly in the folder or in one of its tabs. The place the
  editor was opened for is preselected.
- A page is moved and renamed in one dialog, which stores name and place together: a page can be renamed, moved within
  its folder (into a tab, back to the folder, to another tab), or both. The current place is preselected.
- Moving or renaming does not validate or touch the content.
- Moving or renaming a page is refused when the page was changed after the dialog was opened; the dialog then shows
  the name and place as stored (see `optimistic-locking.md`). Renaming a folder or a tab is not checked: the last save
  wins.
- After every write, all addresses under `/folders` and `/deleted-pages` show the new state.

## Only users see content

- Folders, tabs, pages and deleted pages are for users only (see "Account types" in `users-and-login.md`), and in the
  browser only for the users with a role on the folder, as far as the role allows (see `folder-roles.md`). An admin
  reaches no content through any address, form, action or MCP tool; an admin sees the names of the folders and who has
  which role on them only on the overview `/folder-roles`.
- Every address under `/folders` and `/deleted-pages` shows an admin the not-found page, with and without an action
  or a view, also for items that exist, so that it reveals nothing, not even whether an item exists. A form of the
  content that an admin submits shows the not-found page and writes nothing. The same holds for a user and a folder
  without a role.
- The check lives in the folders and pages services: every read and write takes the acting user and the channel of the
  call. For an admin every read returns nothing and every write is refused and logged, before anything else is checked
  and without asking the database; then the role of a user is checked (see `folder-roles.md`).

## Last editor

- Every folder, tab and page records the user who last edited it, and creating it counts as an edit. The writes that
  set it:
  - folder: created, renamed
  - tab: created, renamed
  - page: created, content edited, moved or renamed, deleted, restored
- Each of these writes stores its user in the same write that changes the item's time of the last change, so that
  time and name always describe the same change. A write that fails changes neither. The same write counts the
  version of a page up, which the page's later changes are checked against (see `optimistic-locking.md`).
- A change inside a folder or tab is no edit of it: creating, moving, deleting or restoring a page and creating a tab
  leave the time of the last change and the last editor of the folder and the tab as they are. Renaming a folder
  leaves those of its tabs and pages as they are.
- The user is the one who is logged in. Every content write takes the acting user; a write by a user that does not
  exist fails and writes nothing.
- Content that an admin edited before the account types came keeps showing that admin's name as its last editor.
- The last editor is shown by user name, as plain text, next to the time of the last change (see "Lists and order",
  `pages.md` and `page-deletion.md`).
- Only the last editor is stored: not who created an item, and no history of editors.

## Lists and order

- Folders, tabs and pages are listed by name, in the order of the database's collation.
- The contents of a folder show its pages by name, then its tabs by name.
- The list of all pages of a folder is ordered by name and then by tab; among pages of the same name, the one placed
  directly in the folder comes first.
- Deleted pages are missing from all of these lists.
- Lists show names and metadata only, never page content.
- Every list shows the time of the last change of each item and its last editor: the folder list, the contents of a
  folder (its pages and its tabs), the pages of a tab and the list of all pages of a folder.

## Decisions

- Content lives under the fixed prefix `/folders` and actions in the query string, so that no name has to be reserved
  for a route of the app.
- The `.md` suffix tells pages from tabs in an address, so that a tab and a page placed directly in the folder may
  share a name.
- The last editor changes on exactly the writes that change the time of the last change, in the same write, so that a
  reader sees who made the change whose time is shown. Counting a change inside a folder or tab as an edit of it was
  rejected: the folder or tab itself did not change.
- The content stored before the last editor was recorded got the admin (the user named `admin`) as its last editor. No
  editor was rejected, because it would make the editor optional, which every read and view would then have to
  handle, for content that only an old installation has. An "unknown" placeholder user was rejected, because it would
  be an account that nobody owns and that the user list would show. Migrating content without an admin fails and is
  rolled back.
- The last editor is required, so that every item always has one.
- A content address shows an admin the not-found page instead of a page that says admins cannot see content, so that
  it reveals nothing, not even whether an item exists. Rejected: a page that says admins cannot see content.
- The key from an item to its last editor restricts deleting (`onDelete: Restrict`), like the other keys of the
  content: a user who has edited content cannot be deleted by accident, and no content loses its editor.

## Current limits

- Folders and tabs cannot be deleted. Deleted pages cannot be removed for good (see `page-deletion.md`).
- MCP reads every folder of a user, also one without a role (see `folder-roles.md`).
- A page cannot be moved to another folder, a tab cannot be moved to another folder.
- No redirects from old addresses after a rename or move.
- No history, no links between pages, no search.
- Changes of the same folder or tab at the same time are not told apart: the last save wins. Pages are protected (see
  `optimistic-locking.md`).
