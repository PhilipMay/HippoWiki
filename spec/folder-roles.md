# HippoWiki – Folder Roles

Folder roles as built: every user has at most one role per folder, Reader, Writer, Manager or Owner, and the role
decides what the user sees and does with that folder in the browser. Whoever creates a folder owns it and gives the
other users their roles. Admins see the folder names and the roles on an overview of their own, but never get a role
and never see content. MCP keeps reading every folder of a user until it gets rules of its own.

Code: `src/features/folder-roles/` (`roles.ts` with the roles and the lowest role of every function, `service.ts` with
the reads and writes of roles and the role checks that the folders and pages services call, the queries, actions and
components of the roles view, the "Give role" dialog and the admin overview), the role checks in
`src/features/folders/service.ts` and `src/features/pages/service.ts`, the folder route
`src/app/folders/[folder]/page.tsx` (the view `roles` and the action `give-role`), the routes of tabs, pages and
deleted pages, the overview `src/app/folder-roles/page.tsx`, the model `FolderRole` in `prisma/schema.prisma` and the
migration `prisma/migrations/20261115210306_add_folder_roles/`.

Tests: `e2e/folder-roles.spec.ts`, `e2e/mcp.spec.ts`, `e2e/access.spec.ts`, `e2e/hydration.spec.ts`,
`integration/folder-role-service.test.ts`, `integration/folder-service.test.ts`, `integration/page-service.test.ts`,
`integration/db-errors.test.ts`, and the unit tests next to the code, such as `src/features/folder-roles/roles.test.ts`
and `src/features/folder-roles/service.test.ts`.

## Roles

- A role is given per user and per folder. A user holds at most one role per folder (a unique index), and a user
  without a role on a folder does not see it.
- The roles are cumulative: each includes everything of the roles before it. What each may do with its folder in the
  browser (`FUNCTION_ROLES` in `src/features/folder-roles/roles.ts` names the lowest role of each function):

  | Function                                                                      | Reader | Writer | Manager | Owner |
  | ----------------------------------------------------------------------------- | :----: | :----: | :-----: | :---: |
  | See the folder in the folder list, open it, its tabs, "All pages" and "Roles" |   ✓    |   ✓    |    ✓    |   ✓   |
  | Read pages                                                                    |   ✓    |   ✓    |    ✓    |   ✓   |
  | Create a page, edit its content                                               |        |   ✓    |    ✓    |   ✓   |
  | Move or rename a page                                                         |        |   ✓    |    ✓    |   ✓   |
  | Delete a page                                                                 |        |        |    ✓    |   ✓   |
  | See the deleted pages of the folder, read and restore one                     |        |        |    ✓    |   ✓   |
  | Create or rename a tab                                                        |        |        |    ✓    |   ✓   |
  | Rename the folder                                                             |        |        |         |   ✓   |
  | Give, change and remove roles on the folder                                   |        |        |         |   ✓   |

- Not tied to a folder, and so open to every user without a role: creating a folder, the user list, the own account
  page with its tokens and connected apps, the consent page of OAuth, the password change and logging out.
- A role is read from the database on every request and never kept in the session, so that a change takes effect with
  the next request of the user it concerns, without a new login.

## Admins never have a role

- An admin never has a role on any folder, as a general rule for this and every later feature: no page, form, dialog,
  MCP tool, command or update of an installation gives an admin a role.
- The services refuse it: the "Give role" dialog never lists an admin, a submitted name of an admin is answered like an
  unknown name, and creating a folder is refused for an admin before anything is written, so that no admin becomes an
  Owner.
- The database refuses it as a second line: a trigger of the migration refuses every insert and update of a role whose
  user is an admin. The type of an account never changes, so the check at insert and update is enough.

## What a user sees and does

- The folder list `/folders` shows only the folders with a role of the user, each with the own role. A user without a
  role on any folder sees a hint that there are no folders yet, that they can create one or ask an Owner of a folder
  for a role, next to "New folder".
- The folder names the own role of the user.
- Every address of a folder without a role, its tabs, pages and deleted pages, with and without an action or a view,
  shows the not-found page, like a folder that does not exist. A form of such a folder shows the not-found page and
  writes nothing.
- A function the role does not include is not offered, and its address or form answers like one that does not exist
  and changes nothing: a Reader sees no "New page", "Edit", "Move or rename", "Delete", "Deleted pages", "New tab" or
  "Rename", and `?action=edit` shows a Reader the not-found page.
- The checks live in the services, before anything else but the actor: a read without the needed role returns `null`
  and a write `not-allowed`, which the routes and actions show as the not-found page. A refused write is logged with
  the actor, the folder, tab or page, and the role, if any. A missing item and a missing role give the same answer, so
  that nothing tells whether an item of an id exists.
- Folder names stay unique across the wiki: creating or renaming a folder with the name of a folder the user cannot
  see is refused as "name taken", and nothing else of that folder shows.

## Creating folders

- Every user may create a folder and becomes its Owner; the folder and the role are stored in one write.
- An admin creates no folder: the "New folder" dialog is never offered, and a submitted form creates nothing.

## The roles view

- The folder offers "Roles" to every role: the view `/folders/<folder>?view=roles` lists every user with a role on the
  folder and the role, Owners first, then Managers, Writers and Readers, each group by user name.
- The view has a breadcrumb back to the folder and no actions; a view together with an action shows the not-found
  page, as everywhere. Without a role it shows the not-found page.

## Giving, changing and removing roles

- Only an Owner of a folder gives, changes and removes roles on it. A folder may have several Owners, and all are equal:
  an Owner may give the Owner role, and lower or remove every role, the own one and those of other Owners included.
- "Give role" in the roles view of an Owner opens a dialog on the folder address (`?action=give-role`): a user, picked
  from every account of the type user without a role on the folder, and a role, Reader at first. Saving and
  cancelling lead to the folder, like every dialog. With nobody left, the dialog says so and offers only "Cancel".
- In the roles view an Owner has a role choice and "Remove" per user. A change of another user's role takes effect at
  once, without a confirmation, and stays in the roles view. A change of the own role asks for a confirmation first;
  afterwards an Owner who still has a role stays in the roles view, one without a role lands on `/folders`.
- A folder always keeps at least one Owner: lowering or removing the role of its last Owner is refused with a message
  that a folder needs at least one Owner. The check and the write run in one transaction with the roles of the
  folder locked, so that two Owners who lower each other at the same time cannot leave the folder without one.
- The controls of the roles view and of the dialog are locked until hydration.
- Every role given, changed and removed is logged with the folder, the user, the old and the new role and the Owner
  who made the change; so is a refused change of the last Owner.

## The admin overview

- An admin sees every folder by name, with every user who has a role on it and the role in the order of the roles
  view, also a folder without any role, on `/folder-roles`, reached through the header entry "Folder roles", which
  only admins get.
- The overview shows nothing else of the content: no tab, page or deleted page, no time of the last change and no last
  editor. It has no actions, no views and no controls; an admin gives, changes and removes no role. Every address under
  `/folders` and `/deleted-pages` still shows an admin the not-found page.
- A user sees no "Folder roles", and `/folder-roles` shows a user the not-found page.

## MCP

- MCP keeps its behaviour: a token or connected app of a user reads every folder, regardless of the user's roles (see
  `mcp.md`). The reads of the content take the channel of the call, `browser` or `mcp`, as a required part of the
  actor, so that no caller can leave it out; MCP has no writes, so a write is always one of the browser.

## Existing installations

- The migration made every existing account of the type user Owner of every existing folder, so that nobody lost
  access on the day of the update; admins got no role. On an empty database it inserts nothing.

## Decisions

- Roles are cumulative, so that a user needs only one role per folder and the matrix is easy to explain. Rejected:
  separate rights, several per user and folder.
- Deleting pages, the deleted pages list and restoring need a Manager. Rejected: a Writer who deletes and restores,
  and a Writer who deletes while only a Manager restores.
- Only an Owner renames the folder, because a rename changes every address in it, those of its deleted pages
  included. Rejected: a Manager who renames the folder.
- MCP stays as it is until its own rules are defined. Accepted: until then a user reads through MCP folders on which
  they have no role, which the browser hides. Rejected: MCP reads only folders with a role, and MCP shows no content.
- A folder may have several Owners, and all Owners are equal, so that a folder does not depend on one person. The last
  Owner stays, so that no folder is left without anyone who can give roles: no admin can step in, because admins change
  no roles. Rejected: exactly one Owner, Owners who change only the roles of others, and no protection of the last
  Owner.
- Every user with a role sees who has which role on the folder, so that they know who works in it and whom to ask.
  Rejected: the list for Owners only, and for Managers and Owners.
- The roles of a folder are shown in a view of the folder and changed in dialogs and controls there, so that
  everything about a folder lives under its address. Rejected: a page of its own outside `/folders`.
- An Owner picks the user from a list instead of typing the name, so that no name is mistyped. The list reveals
  nothing new: every user already sees every user name on `/users`. Rejected: typing the user name.
- Folder names stay unique across the wiki, so that every address keeps meaning one folder. Accepted: "name taken"
  tells a user that a folder of that name exists although they cannot see it; nothing else of it leaks, and names have
  to be guessed one by one. Rejected: names unique only among the folders a user sees.
- Every user sees the own role in the folder list and on the folder, so that missing buttons are explained. Rejected:
  the own role only in the roles view.
- Only a change of the own role asks for a confirmation, because only that can lock the Owner out of the folder.
  Rejected: a confirmation for every removal, and no confirmation at all.
- The roles view lists the users by role, Owners first, so that a user sees at once whom to ask. Rejected: one list
  by user name.
- A user without any role gets a hint on `/folders`, because a new user otherwise sees an empty wiki without knowing
  why. Rejected: an empty list without a hint.
- Every change of a role is logged with who made it, so that a change of access can be traced until an audit log
  comes. Rejected: no logging.
- A change of a role takes effect with the next request, so that a removed user loses access at once. Rejected: roles
  read at the login, which would keep a removed user's access until the session ends.
- The "Give role" dialog with nobody left says so instead of disappearing, so that an Owner learns why nobody can be
  picked. Rejected: hiding "Give role".
- The dialog starts with Reader, so that more access is always chosen on purpose.
- Admins see the folder names and the roles, on one overview page of their own, so that whoever manages the accounts
  can tell who has access to what. They still see no tabs, pages or deleted pages, change no roles and create no
  folders, so that an admin can never give themselves access to the content. Rejected: admins who see no folder names
  at all, the folder list and the roles views under `/folders` for admins, the folders and roles of each user on the
  user list, admins who change roles, and admins who create folders with a user as the first Owner.
- Admins never get a role, so that the line between running the wiki and reading it holds: an account that manages
  the accounts can never reach the content through a role. A person who needs both jobs has two accounts, as with the
  account types. The database refuses such a role as well, so that no code and no command can give one. Rejected:
  roles for admins, given by an Owner or by an admin.
- The admin overview shows no time of the last change and no last editor: fewer columns, and admins learn less about
  the activity in the content. Rejected: the time of the last change and the last editor next to each folder.
- The admin overview is a page of its own, `/folder-roles`, with a header entry for admins, outside `/folders`, whose
  addresses stay closed to admins. Users cannot open it, because it would show them folders without a role.
  Rejected: a view of the user list.
- Saving and cancelling the "Give role" dialog lead to the folder, like every other dialog, so that the rule for
  dialogs has no exception. Rejected: back to the roles view.
- On the update every existing user became Owner of every existing folder, so that nobody lost access on the day of
  the update. Rejected: the last editor as the only Owner, and the last editor as Owner with every other user as
  Writer.
- A folder, tab or page that does not exist answers like one without a role, so that a write by id tells nothing about
  whether the id exists. Folders and tabs are never deleted and pages only softly, so a user meets this only with a
  crafted request; a page deleted in the meantime still shows that it no longer exists.
- The foreign keys of a role restrict deleting (`onDelete: Restrict`), like the other keys of the content, so that no
  role disappears by a cascade and no folder or user with a role is deleted by accident.

## Current limits

- no rules for MCP: a token or connected app of a user reads every folder, also one without a role (see "MCP rules
  for folder roles" in `roadmap.md`)
- no roles for admins, as a lasting rule
- no groups of users: every role is given to one user
- no public content without a login
- a folder that loses its last Owner through a deactivated or deleted account is not handled; today no account can be
  deactivated or deleted, so this cannot happen yet (see "Deactivating and reactivating users" in `roadmap.md`)
- no audit log beyond the log lines of the role changes
- the roles view and its controls need JavaScript; without it they stay locked
