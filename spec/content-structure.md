# HippoWiki – Content Structure

The content structure as built: folders, optional tabs inside a folder and Markdown pages, and the addresses they have.
What a page itself is (its content, derived title, editor and rendering) is described in `pages.md`, deleting and
restoring pages in `page-deletion.md`, and who sees and does what with a folder in `folder-roles.md`. Folders and tabs
also hold files, images and PDFs, which have addresses of their own (see "Addresses" and "Routes"; the files service is
`src/features/files/`). This spec owns
deleting a tab, renaming a folder or tab to its own name, moving or renaming a page to its own name and place, and the
last editor and the channel of every item.

Code: `src/features/folders/` (folders and tabs, with `renameFolder()`, `renameTab()` and `deleteTab()` in
`service.ts` and `actions.ts`, and the dialogs `NameDialog.tsx` and `DeleteTabDialog.tsx` in `components/`),
`src/features/pages/` (pages, with `moveOrRenamePage()` in `service.ts` and `MoveOrRenamePageDialog.tsx` in
`components/`), `src/lib/names.ts` (the name rule), `src/lib/addresses.ts` (building and parsing addresses),
`src/features/folders/folder-query.ts` and `src/features/pages/page-query.ts` (what an address shows, with its title
and the role of each action), the models `Folder`, `Tab` and `Page` in `prisma/schema.prisma`, and the routes under
`src/app/folders/` and `src/app/deleted-items/`. The last editor and the channel: the writes of
`src/features/folders/service.ts` and `src/features/pages/service.ts`, the actors in
`src/features/folder-roles/actors.ts`, `src/features/users/records.ts` (what the reads return of the last editor and
how the browser names it), the relation `lastEditedBy` and the field `lastEditedVia` of `Folder`, `Tab` and `Page` in
`prisma/schema.prisma`, and the migrations `prisma/migrations/20261116103037_init/` and
`prisma/migrations/20261117130000_change_channel/`.

Tests: `e2e/folders.spec.ts`, `e2e/tabs.spec.ts`, `e2e/upload-file.spec.ts`, `e2e/file-details.spec.ts`, `e2e/all-pages.spec.ts`, `e2e/create-page.spec.ts`,
`e2e/move-or-rename-page.spec.ts`, `e2e/delete-tab.spec.ts`, `e2e/access.spec.ts`, `e2e/mcp-write.spec.ts`,
`e2e/mcp-manager.spec.ts`, `e2e/folder-roles.spec.ts`, `e2e/hydration.spec.ts`, `src/lib/names.test.ts`,
`src/lib/addresses.test.ts`, `src/features/folders/folder-query.test.ts`, `src/features/pages/page-query.test.ts`,
`src/features/folders/service.test.ts`, `src/features/pages/service-writes.test.ts`,
`src/features/mcp/tools.test.ts`, `integration/folder-service.test.ts`, `integration/page-service.test.ts`,
`integration/db-errors.test.ts`.

## Overview

Content has three levels:

- **Folder**: the top level. A folder groups related content, such as one project, team or topic. Folders are also the
  unit that roles are given on: a user sees only the folders with a role of their own (see `folder-roles.md`).
- **Tab**: an optional section inside a folder, such as "guides", "meetings" or "archive".
- **Page**: a Markdown document. A page lives either directly in a folder or in one tab of that folder, and so always in
  exactly one folder.
- **File**: an image (PNG, JPEG, GIF, WebP) or a PDF, an item of its own next to the pages, placed directly in a folder
  or in one of its tabs like a page. Its name is a name of the name rule followed by the extension of its type, such
  as `diagram.png` (`FILE_NAME_PATTERN` in `src/lib/name-limits.ts`); it is unique among the files of its place, and a
  file `setup.png` and a page `setup` sit side by side.

There is no deeper nesting: no folders inside folders and no tabs inside tabs. A new folder has no tabs; a folder may
hold pages directly and have tabs at the same time.

- The database guarantees that a page's tab belongs to the page's folder: a composite foreign key from the page's tab
  and folder to the tab's id and folder. A tab of another folder is refused like a tab that no longer exists.
- No folder, tab or page is deleted by a cascade: every foreign key between them restricts deleting. A tab is deleted
  only after its pages have left it (see "Deleting a tab").

## Names

- Folders, tabs and pages each have a name, which is also their part of the address. The rule is in
  `src/lib/names.ts`: lowercase letters and digits in groups joined by single hyphens, and so never a dot, at most 80
  characters long (`NAME_MAX_LENGTH` in `src/lib/name-limits.ts`).
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

- All content lives under the fixed prefix `/folders`; deleted pages live under `/deleted-items` (see
  `page-deletion.md`). The rest of the root belongs to the other routes of the app (see `src/app/`).
- The addresses:
  - `/folders`: the list of folders
  - `/folders/<folder>`: a folder
  - `/folders/<folder>/<tab>`: a tab
  - `/folders/<folder>/<page>.md`: a page placed directly in a folder
  - `/folders/<folder>/<tab>/<page>.md`: a page in a tab
  - `/folders/<folder>/<name.ext>` and `/folders/<folder>/<tab>/<name.ext>`: the details page of a file placed directly
    in a folder or in a tab
  - `/files/<folder>/<name.ext>` and `/files/<folder>/<tab>/<name.ext>`: the file itself, which sends its content to the
    users with a role on its folder, `?version=<n>` an earlier version and `?download` as an attachment
  - `/deleted-items/<folder>` and `/deleted-items/<folder>/<id>`: the deleted items of a folder and a deleted page
- The `.md` belongs to the address, not to the name. A segment that ends in the lowercase `.md` is a page, one that is a
  file name with the lowercase extension of a type of file (`png`, `jpg`, `gif`, `webp`, `pdf`) is a file, any other
  is a tab. Names of tabs and pages have no dot, so no address of them changed its meaning with the files.
- The address of a file itself answers everything that sends no file with a plain 404, the same for a user without a
  role, an admin, a missing or deleted file, a version that does not exist and any other query, so that nobody learns
  from it whether a file exists. It runs nothing in the file (see "Security headers" in `architecture.md`).
- Every address maps to at most one item. A malformed name, an unknown folder, tab or page, and a page of another
  folder or tab show the not-found page. Pages have no address outside `/folders`.
- A rename or move changes the address, deleting a page or a tab removes it. There are no redirects from the old
  address; it shows the not-found page. Renaming a folder changes the addresses of its deleted pages as well.

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
  | tab          | `delete`         | the "Delete tab" dialog                                  |
  | folder, tab  | `upload`         | the "Upload file" dialog                                 |
  | file         | `upload-version` | the "Upload new version" dialog                          |
  | file         | `revert`         | the "Revert file" dialog over a version of the file      |
  | file         | `move-or-rename` | the "Move or rename file" dialog                         |
  | page         | `edit`           | the edit form (see `pages.md`)                           |
  | page         | `move-or-rename` | the "Move or rename page" dialog                         |
  | page         | `delete`         | the "Delete page" dialog                                 |
  | page         | `revert`         | the "Revert page" dialog over a revision of the page     |
  | deleted page | `restore`        | the "Restore page" dialog                                |

- A folder address has four views, which this list is the one place to name:
  - `?view=all`: all pages of the folder, with their tab (see "Lists and order");
  - `?view=roles`: who has which role on the folder (see "The roles view" in `folder-roles.md`);
  - `?view=mcp`: the MCP addresses of the folder for AI apps, which exists only while `HIPPOWIKI_PUBLIC_URL` is set
    (see "The view "AI apps"" in `folder-roles.md` and `mcp.md`);
  - `?view=search&q=<words>`: the results of a search in the whole folder for the words in `q` (see `search.md`). `q`
    belongs only to this view, which needs it once and with more than spaces; `q` on any other address under
    `/folders` and `/deleted-items` shows the not-found page.
- A page address and the address of a deleted page have the views of the history of the page: `?view=history`, the
  revisions of the page, `?view=revision&revision=<n>`, one revision, and `?view=compare&from=<n>&to=<n>`, a
  comparison of two revisions. The action `revert` needs `&revision=<n>`. These parameters belong only to their view
  or action; anywhere else they show the not-found page (see `page-history.md`).
- The action `upload` exists only while the files are on (see "Configuration" in `container-image.md`), and may carry
  `&name=<name.ext>`, a file name of the rule that the dialog proposes instead of the one the chosen file suggests; a
  malformed or repeated name shows the not-found page. The action `upload-version` of the details page of a file also
  exists only while the files are on, and `revert` needs `&version=<n>` of an earlier version; a revert to the current
  version would change nothing and shows the not-found page, as do `version` without `revert` and every view. These
  actions and `move-or-rename` may carry `&notice=changed` after a refused change (see "Files" in
  `optimistic-locking.md`).
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

- `/` redirects a user to `/folders` and an admin to `/users`; the app bar links a user to `/folders` (see
  `users-and-login.md`).
- `/folders`: the folders with a role of the user, with their last update and the own role, and a "New folder"
  button; without any folder a hint that the user can create one or ask an Owner of a folder for a role.
- `/folders/<folder>`: the folder with the own role, the buttons the role includes ("Rename" for an Owner, "All pages"
  and "Roles" for every role, "AI apps" for every role while `HIPPOWIKI_PUBLIC_URL` is set, "Deleted items" and
  "New tab" for a Manager, "Upload file" and "New page" for a Writer), and one list of its contents: first the pages
  placed directly in the folder, then its tabs; below them a section "Files" with the files placed directly in the
  folder. Its views are listed in "Actions and views".
- `/folders/<folder>/<tab>`: the tab with "Rename" and "Delete" for a Manager and "Upload file" and "New page" for a
  Writer, the pages of the tab and, below them, a section "Files" with its files. The contents list of the folder
  offers no deletion of its tabs.
- "Upload file" is offered only while the files are on. Its dialog takes the file, its name, which the name of the
  chosen file suggests by the name rule (`Network Diagram (v2).PNG` gives `network-diagram-v2.png`, `photo.jpeg`
  `photo.jpg`), and, for an image, "Remove location and camera data", on by default. Before it sends the file it asks
  whether the name is taken at the place; a taken name leads to the question whether to store the file as a new
  version of the file of that name, and cancelling stores nothing. A refused upload keeps the dialog open with its
  message at the field it belongs to. A stored upload leads to the details page of the file.
- The details page of a file shows its place, a preview of an image at most as wide as the text, its type, size, the
  width and height of an image, the number of its versions and its last change, "Open" (the file itself, in a new
  tab) and "Download", the link to copy into a page (`![[…]]` for an image, `[[…]]` for a PDF), the pages that show
  or link it (see "Backlinks" in `wiki-links.md`), and its versions,
  newest first, each with its number, when, by whom and how it was uploaded, its size and a link that opens it. A
  Writer also gets "Move or rename", "Upload new version", which takes a file of the same type, and "Revert" at every
  version but the
  current one, which stores that version again as the newest one, without a byte written; a version made by a revert
  names the version it went back to.
- Page addresses are described in `pages.md`, the addresses under `/deleted-items` in `page-deletion.md`.
- Every address below a folder has a breadcrumb back to the folder list and the folder.

## Changing the structure

- Folders and tabs are created and renamed in a name dialog. Pages are created in the editor and get their name and
  place in the "Save page" dialog.
- Tabs are created, renamed and deleted through MCP as well, by a Manager connection of an AI app, under the same
  rules and with the user of the connection as the last editor (see `mcp.md`). Folders are created and renamed only in
  the browser.
- A new page can be created in any place of its folder: directly in the folder or in one of its tabs. The place the
  editor was opened for is preselected.
- A page is moved and renamed in one dialog, which stores name and place together: a page can be renamed, moved within
  its folder (into a tab, back to the folder, to another tab), or both. The current place is preselected.
- A file is moved and renamed in the same way, from its details page, in the "Move or rename file" dialog: within its
  folder, with its name and place stored together and its versions kept. Its extension stays, because it fixes the
  type of the file: a name with another extension is refused at the name field. A move to the own name and place
  stores nothing, as for a page.
- Moving or renaming does not validate the content of the page and touches it only where it links to itself. A move
  or rename of a page or a file and a rename of a tab change the wiki links to them in every page of the folder that
  is not deleted, in the same write, and the "Move or rename page", "Move or rename file" and "Rename tab" dialogs say
  beforehand how many pages will be updated (see `wiki-links.md`).
- Moving or renaming a page or a file is refused when it was changed after the dialog was opened; the dialog then shows
  the name and place as stored (see `optimistic-locking.md`). Renaming a folder or a tab is not checked: the last save
  wins.
- After every write, all addresses under `/folders` and `/deleted-items` show the new state.

## Renaming to the same name

A rename of a folder or a tab to the name it already has changes nothing, in the browser and through `rename_tab`, so
that the time of the last change, the last editor and the channel name only who really changed the item. This section
is the rule for every caller; the other specs point here.

- The same: the name equals the stored name once its surrounding spaces are removed, as the name is checked before it
  is stored (" guides " for the tab `guides`). The comparison is with the name stored at the moment of the save, not
  with the name the item had when the dialog was opened: a tab renamed from `guides` to `news` while a "Rename tab"
  dialog for it was open, and then saved in that dialog as `news`, stores nothing and leads to the tab `news`.
- What it stores: nothing. The folder or tab keeps its time of the last change, its last editor and its channel.
- The order of the checks: those of every rename, the admin, the role, the name rule, and only then the comparison.
  Whoever may not rename, a folder or tab that does not exist and an invalid name are refused as with any other name.
- The answer: that of every rename. The browser leads to the address of the item without a notice, and `rename_tab`
  returns its usual result with the tab and its address.
- The log: a line of its own, with the item and the channel, not a rename.
- The dialogs: in "Rename folder" and "Rename tab", "Save" is disabled while the name in the field, without its
  surrounding spaces, is the name the item had when the dialog was opened. An empty field differs from the current
  name, so "Save" is enabled and the server answers that a name is required. "New folder" and "New tab" keep "Save"
  enabled for every name.

## Moving or renaming a page to its own name and place

A move or rename of a page to the name and the place it already has changes nothing, in the browser and through
`move_or_rename_page`, so that the last editor, the channel, the time of the last change and the version name only
real changes, and an editor or dialog that another user has open on the page is not refused for no reason. This
section is the rule for every caller; the other specs point here.

- The same: the place is the tab the page is in, or directly in the folder for a page in no tab, and the name equals
  the stored name once its surrounding spaces are removed (" setup " for the page `setup`). The comparison is with the
  name and place stored at the moment of the save, in the same write.
- What it stores: nothing. The page keeps its last editor, its channel, its time of the last change and its version,
  and no revision is recorded.
- The order of the checks: those of every move or rename, the admin, the role, the place, the name rule, the version
  it is based on, and only then the comparison. Whoever may not move the page, a deleted or missing page, a tab that
  does not exist, an invalid name and a save based on another version than the page has, or on none, are refused as
  with any other move (see `optimistic-locking.md`).
- The answer: that of every move. The browser leads to the page address without a notice, and `move_or_rename_page`
  returns the page as stored, with the version the call stated.
- The log: a line of its own, with the page and the channel, not a move or rename.
- The dialog: in "Move or rename page", "Save" is disabled while the name in the field, without its surrounding
  spaces, and the chosen place are those the page had when the dialog was opened, also after a refused move reloaded
  the dialog with the current name and place, until the user changes one of them. An empty field differs from the
  current name, so "Save" is enabled and the server answers that a name is required.

## Deleting a tab

This section is the rule for deleting a tab, in the browser and through `delete_tab`; the other specs point here.

- A Manager or an Owner of the folder deletes a tab from the tab address with "Delete" (`?action=delete`), after a
  confirmation in the "Delete tab" dialog. The dialog names the tab and the number of pages that will be deleted with
  it, as the tab held them when the dialog was opened, and says that the pages can be restored one by one and the tab
  itself not. Confirming leads to the folder; cancelling leads back to the tab.
- A Manager connection of an AI app deletes a tab through MCP with `delete_tab`, by the same rules (see `mcp.md`).
- The tab is deleted for good: it cannot be restored, it is not listed among deleted items, and its name is free at
  once for a new tab of the folder.
- Every page in the tab is soft deleted exactly as if it had been deleted on its own (see `page-deletion.md`): it keeps
  its content and its folder, forgets its tab, and is listed under "Deleted items" of the folder, from where it is
  restored one by one into a place of the folder. The user who deleted the tab becomes its last editor and so the user
  who deleted it, with the channel of the deletion; all pages of the tab get the same time of deletion, and their
  versions count up.
- The deletion takes the pages that are in the tab when it is confirmed, without checking their versions or for
  changes since the dialog was opened: a page added to the tab meanwhile goes with it, a page moved out meanwhile
  stays, and a page edited meanwhile is deleted with its latest content. A page created, moved or restored into the
  tab while it is being deleted either goes with it or is refused as written into a tab that does not exist; no page
  is ever left in a missing tab.
- Deleting is all or nothing: either the tab and all its pages are deleted, or nothing changes and the dialog stays open
  with a message.
- The dialog refers to the tab, not to its name: a tab renamed after the dialog was opened is still deleted.
- There is no limit on the number of pages of a deleted tab.
- A tab that no longer exists when the deletion is confirmed, because it was deleted meanwhile, keeps the dialog open
  with the message that the tab no longer exists and only the way back to the folder, and changes nothing. The
  deletion checks the role on the folder of the address, not on the folder of the tab, which a deleted tab no longer
  has.
- An editor or dialog still open on a page of the deleted tab answers its save or confirmation with the message that the
  page no longer exists. For an AI app the deleted tab is missing like one that never existed, also for `delete_tab`.
- Deleting a tab leaves the time of the last change and the last editor of the folder as they are.
- Every deletion of a tab is logged with the user, the folder, the tab, the number of pages deleted with it and the
  channel, through MCP also the grant; a refused deletion is logged like the other refused content writes.

## Only users see content

- Folders, tabs, pages and deleted pages are for users only (see "Account types" in `users-and-login.md`), and only
  for the users with a role on the folder, as far as the role allows, through MCP also as far as the role of the
  connection allows (see `folder-roles.md`). An admin reaches no content through any address, form, action or MCP
  tool; an admin sees the names of the folders and who has which role on them only on the overview `/folder-roles`.
- Every address under `/folders` and `/deleted-items` shows an admin the not-found page, with and without an action
  or a view, also for items that exist, so that it reveals nothing, not even whether an item exists. A form of the
  content that an admin submits shows the not-found page and writes nothing. The same holds for a user and a folder
  without a role.
- The check lives in the folders and pages services: every read and write takes the acting user and the channel of the
  call. For an admin every read returns nothing and every write is refused and logged, before anything else is checked
  and without asking the database; then the role of a user is checked (see `folder-roles.md`).
- The channel of the last change is shown only where the last editor is, so it is as hidden from admins as the last
  editor: the overview `/folder-roles` shows neither.

## Last editor

- Every folder, tab and page records the user who last edited it, and creating it counts as an edit. The writes that
  set it:
  - folder: created, renamed
  - tab: created, renamed
  - page: created, content edited, moved or renamed, deleted (on its own or with its tab), restored, and its wiki links
    updated by a move or rename of a page or a rename of a tab, whose user becomes its last editor (see
    `wiki-links.md`)
- Each of these writes stores its user in the same write that changes the item's time of the last change, so that
  time and name always describe the same change. A write that fails changes neither. The same write counts the
  version of a page up, which the page's later changes are checked against (see `optimistic-locking.md`).
- A write that changes nothing is no edit: a content save without a change (see "Saves without a change" in
  `pages.md`), a rename to the own name (see "Renaming to the same name") and a move or rename of a page to its own
  name and place (see "Moving or renaming a page to its own name and place").
- A change inside a folder or tab is no edit of it: creating, moving, deleting or restoring a page and creating or
  deleting a tab leave the time of the last change and the last editor of the folder and the tab as they are. Renaming
  a folder leaves those of its tabs and pages as they are.
- The user is the one who is logged in, through MCP the user of the connection. Every content write takes the acting
  user; a write by a user that does not exist fails and writes nothing.
- The last editor is shown by user name, as plain text, next to the time of the last change, followed by the channel
  (see "Channel"); through MCP, `read_page` and `list_folder` return both (see `mcp.md`).
- Only the last editor and the channel are stored with an item: not who created it and not which AI app or connection
  made a change. The revisions of a page keep the user and the channel of every content change (see
  `page-history.md`); folders and tabs have no history. Recording who created an item is not planned.

## Channel

- With the last editor, every folder, tab and page stores how it was last changed, its channel: `web` for a change in
  the browser, `mcp` for a change by an AI app through MCP. These are the only two values, and the same two name the
  channel of the actor of a read or write and of every line of the server log.
- The channel is set on exactly the writes that set the last editor, in the same write, so that time, name and
  channel always describe the same change; a write that fails changes none of them. For a deleted page it is how the
  page was deleted, also with its tab.
- Content stored before the channel was recorded got `web`, deleted pages included.
- The browser shows the channel after the user name, after the word "via" in lowercase: "by mike via mcp", in the
  page view, the lists, the history and the messages of a refused change (`editorWithChannel()` in
  `src/features/users/records.ts`). The two tables, the list of all pages and the deleted pages list, show it in a
  column of its own headed "Via".

## Lists and order

- Folders, tabs and pages are listed by name, in the order of the database's collation.
- The contents of a folder show its pages by name, then its tabs by name.
- The list of all pages of a folder is ordered by name and then by tab; among pages of the same name, the one placed
  directly in the folder comes first.
- The section "Files" of a folder or a tab lists its files by name, each with its type, its size and its last change,
  and is left out when the place holds no files.
- Deleted pages are missing from all of these lists.
- Lists show names and metadata only, never page content. The one exception is the results of a search, which show a
  piece of the text of each page around the match (see "Results" in `search.md`).
- Every list shows the time of the last change of each item, its last editor and the channel: the folder list, the
  contents of a folder (its pages and its tabs), the pages of a tab and the list of all pages of a folder. The list of
  all pages shows the channel in a column "Via" right after "Updated by".

## Decisions

Addresses:

- Content lives under the fixed prefix `/folders` and actions in the query string, so that no name has to be reserved
  for a route of the app.
- The `.md` suffix tells pages from tabs in an address, so that a tab and a page placed directly in the folder may
  share a name.
- A content address shows an admin the not-found page instead of a page that says admins cannot see content, so that
  it reveals nothing, not even whether an item exists. Rejected: a page that says admins cannot see content.
- Pages and tabs stay in their folder: they are moved only within it, as a lasting rule. Rejected: moving a page or a
  tab to another folder.

The last editor and the channel:

- The last editor changes on exactly the writes that change the time of the last change, in the same write, so that a
  reader sees who made the change whose time is shown. Counting a change inside a folder or tab as an edit of it was
  rejected: the folder or tab itself did not change.
- The last editor is required, so that every item always has one. Rejected: an optional editor, which every read and
  view would have to handle, and an "unknown" placeholder user, which would be an account that nobody owns and that
  the user list would show.
- The key from an item to its last editor restricts deleting (`onDelete: Restrict`), like the other keys of the
  content: a user who has edited content cannot be deleted by accident, and no content loses its editor.
- The channel is stored and shown so that readers can tell changes by AI apps from changes in the browser, and know
  what to check. Rejected: showing which AI app made a change, because the name of an app is chosen by the app itself
  and may be long or misleading, and two values are enough to tell AI changes apart.
- The channel is shown everywhere the last editor is, in the browser and through MCP, so that the two never tell
  different stories. Rejected: only the page header and the lists, only the page header, and the browser only.
- The channel follows the user name as "via <channel>". Rejected: the channel in brackets ("by mike (mcp)").
- Content stored before the channel was recorded got `web`, also where an AI app made the last change, because the
  past cannot be told apart and the channel is right from the next change on. Rejected: a third value such as
  "unknown" for old content.
- The two tables, the list of all pages and the deleted pages list, show the channel in a column of its own headed
  "Via", so that both look alike; the other places show it in the sentence. Rejected: the channel in the cell of the
  user, and the heading "Channel", a word the interface uses nowhere else.
- The channel is plain text, so that it reads the same on touch screens. Rejected: an explanation on hover.
- The channel is required, without a default, so that no write can leave it out.

Writes that change nothing:

- A rename of a folder or tab to its own name and a move or rename of a page to its own name and place store nothing,
  like a content save without a change (see "Saves without a change" in `pages.md`), in the browser and through MCP
  alike. Rejected: refusing them with a message; covering the browser only.
- They are checked in the order of every rename or move, the comparison last, so that they never tell someone without
  the role the current name. An unchanged move based on an older version is refused as changed, so that one rule
  holds for every change of a page. Rejected: comparing first; accepting an unchanged move without checking the
  version.
- They are answered as every rename or move is and logged in a line of their own. Rejected: a notice in the browser
  and a note in the result of `rename_tab` or `move_or_rename_page`; a tool error for `rename_tab`; no log line;
  logging them as a rename or a move.
- "Save" of the rename dialogs and of the "Move or rename page" dialog is disabled while nothing changed, with the name
  compared without its surrounding spaces, as the server does, so that the button and the server always agree.
  Rejected: keeping it enabled; comparing the exact text of the field; a hint such as "Enter a new name to save".
- A dialog compares with the name and place it was opened with, also after a refusal reloaded the "Move or rename
  page" dialog with the current page, so that "Save" is disabled then until the user enters the move again; the server
  compares with what is stored. Rejected: keeping "Save" enabled after the refusal; refusing a save after a rename
  meanwhile with a notice, which needs a version for folders and tabs.

Deleting tabs and folders:

- A tab is deleted for good instead of softly, because a tab holds no content of its own: its pages keep their content
  as deleted pages, and a new tab can be created at any time. Hard deletion is the lasting rule for tabs. Rejected: a
  soft delete of tabs with a list of deleted tabs and restoring them, now or later.
- Hard deletion is the lasting rule for folders as well, once they can be deleted: a folder is deleted for good after
  a warning, together with its tabs, its pages and its deleted pages (see "Deleting folders" in `roadmap.md`).
  Rejected: a soft delete of folders, a list of deleted folders and restoring them.
- The confirmation of a tab deletion names the number of pages, so that the user sees how much goes with the tab.
  Rejected: typing the tab name to confirm, and a confirmation without the number of pages.
- "Delete" is offered on the tab only, like "Delete" on a page, and leads to the folder. Rejected: a delete control
  next to each tab in the contents list of the folder.
- A tab deletion takes the pages that are in the tab when it is confirmed, without checking for changes since the
  dialog was opened: tabs have no version, renaming a tab is not checked either, and every page deleted this way can
  be restored. Rejected: refusing the deletion when the pages of the tab changed meanwhile.
- The pages of a deleted tab show nothing about their former tab, so that the rules of deleted pages do not change.
  Rejected: showing the name of the former tab.
- A renamed tab is still deleted, because the dialog refers to the tab and not to its name, like the deletion takes the
  pages that are there. Rejected: refusing the deletion after a rename.
- No limit on the number of pages of a deleted tab: the pages are only marked as deleted. Rejected: a maximum number of
  pages.
- A tab deleted meanwhile is answered with a message in the dialog, like a page deleted meanwhile. Rejected: the
  not-found page, which does not tell the user why. So the deletion checks the role on the folder of the address: a
  Manager learns that the tab is gone, while a user without the role is refused whether the tab exists or not.

## Current limits

- Folders cannot be deleted yet. A deleted tab cannot be restored; its pages are restored one by one. Deleted pages
  cannot be removed for good, which is not planned (see `page-deletion.md`).
- Renaming a tab that was deleted after the "Rename tab" dialog was opened shows the not-found page instead of a
  message that the tab no longer exists.
- No redirects from old addresses after a rename or move.
- No history of folders and tabs, and moves and renames of pages are not part of the history of a page, apart from
  the revisions of the wiki links they update (see `page-history.md`).
- Changes of the same folder or tab at the same time are not told apart: the last save wins. Pages are protected (see
  `optimistic-locking.md`).
