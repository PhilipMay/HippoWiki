# Folder Roles – Steps

## Goal

Every user gets a role per folder (Reader, Writer, Manager or Owner) that decides what the user sees and does with
that folder in the browser. Whoever creates a folder owns it and gives the other users their roles; admins see the
folder names and the roles on an overview of their own, but never get a role and never see content. Written from the
approved requirements in `spec/folder-roles-requirements.md`; the IDs in brackets name the requirements a step covers.

## Scope

- In: the four roles per user and folder, their effect in the browser, creating folders with the creator as Owner,
  the roles view of a folder, Owners giving, changing and removing roles, the admin overview `/folder-roles`, the
  logging of role changes, the update of existing installations.
- Not in: rules for MCP (it keeps reading every folder of a user); roles for admins; groups of users; public content
  without a login; a folder that loses its last Owner through a deactivated or deleted account; an audit log beyond
  the log lines of the role changes.

## Checklist

- [ ] Roles in the database
- [ ] Folders by role
- [ ] Functions by role
- [ ] Roles view
- [ ] Give role
- [ ] Change and remove roles
- [ ] Admin overview
- [ ] Wrap-up

## Roles in the database

### Goal

Store one role per user and folder, make sure the database never holds a role of an admin, and give every user of an
existing installation the Owner role on every existing folder. Nothing in the app reads the roles yet. [R1, R2, R9]

### Build

- A new feature `src/features/folder-roles/`:
  - `roles.ts` (no server-only imports, so Client Components and the routes can use it): the roles in their order
    (`reader`, `writer`, `manager`, `owner`), their labels ("Reader", "Writer", "Manager", "Owner"), and
    `includesRole(role, needed)`, which says whether a role includes everything of another (R1). The functions of the
    matrix in the requirements are named here once, each with the lowest role that may do it, so that the services and
    the routes ask for a function ("delete a page") instead of repeating roles.
  - `schema.ts`: the Zod schema of a role and the parsing of a role from a form or a caller.
- `prisma/schema.prisma`: the enum `FolderRoleType` and the model `FolderRole` (`id`, `folderId`, `userId`, `role`,
  `createdAt`, `updatedAt`), unique on `folderId` and `userId`, so a user holds at most one role per folder (R1). Its
  foreign keys restrict deleting (`onDelete: Restrict`), like the other keys of the content, so no role disappears by
  a cascade and no folder or user with a role is deleted by accident. An index on `userId` for the folder list of a
  user.
- The migration `prisma/migrations/<timestamp>_add_folder_roles/`, written by hand where Prisma cannot (see "Database"
  in `architecture.md`):
  - Every existing account of the type `user` becomes Owner of every existing folder; admins get nothing (R9). On an
    empty database, as in the tests and on the first start of the container image, this inserts nothing.
  - A trigger refuses every insert and every update of `FolderRole` whose user is an admin, with a `check_violation`,
    so that no code, command or crafted request can give an admin a role (R2). The type of an account never changes
    (the trigger of `20261115120000_add_user_types`), so the check at insert and update is enough.
- `src/lib/db-errors.ts`: a constant for the unique index of `FolderRole` and a helper that recognises the error of the
  admin trigger, so the service can tell both apart from other errors.
- `prisma/seed.ts`: the known user `alice` is Owner of the sample folder, as an existing installation would be after
  the update.
- `e2e/support/database.ts`:
  - `createFolderRole({ folder, user, role })` inserts a role.
  - `createFolder()` takes `roles`, a list of users and roles. Without it, the known user `alice` is Owner of the new
    folder when that user exists in the database (the end-to-end tests run as `alice`), so that every existing spec
    keeps its access once the next step checks roles; the integration tests, which start from empty tables, give roles
    explicitly where a test needs them. `createTab()` and `createPage()` create their folder with the same default.
- `README.md`: nothing new unless a command changes.

### Test

- Unit: `src/features/folder-roles/roles.test.ts` for the order, `includesRole()` for every pair of roles and the
  lowest role of every function of the matrix; `schema.test.ts` for valid and invalid roles.
- Integration (`integration/db-errors.test.ts`): a second role of the same user on the same folder is recognised by
  the new constant and by no other; inserting and updating a role of an admin is refused by the trigger and recognised
  by its helper; a role of a user who is not an admin is stored.
- Manual: apply the migration to the development database with the seed data of before this step and check with
  `npm run db:psql` that every user is Owner of every folder and the admin has no role (R9).
- The complete end-to-end suite runs, because the step changes `prisma/schema.prisma`, a migration and `e2e/support/`.

## Folders by role

### Goal

A user sees exactly the folders with a role on them: the folder list shows only those, with the own role, and every
address of another folder, its tabs, pages and deleted pages shows the not-found page. Creating a folder makes its
creator Owner. MCP keeps reading every folder. [R4, R6, R8, R17, R18, R21, R2 for creating folders]

### Build

- `src/features/folder-roles/service.ts`: `folderRoleOf(actor, folderId)`, the role of the actor on a folder or `null`,
  read from the database on every call, so that a change takes effect with the next request (R23). The folders and
  pages services use it; nothing caches a role in the session.
- The reads and writes of the content tell the browser from MCP: they take the channel of the call (`browser` or
  `mcp`) as a required part of the actor, so that no call can leave it out. For `browser` a folder without a role of
  the actor does not exist; for `mcp` the reads keep today's rule, every folder for a user and nothing for an admin
  (R8). The MCP tools in `src/features/mcp/tools.ts` pass `mcp`, the queries and actions `browser`. MCP has no writes,
  so the writes accept only `browser`.
- `src/features/folders/service.ts`:
  - `listFolders()` returns only the folders with a role of the actor, each with that role (R4, R17); for `mcp` all
    folders, without a role.
  - `getFolderByName()` and `getTab()` return `null` for a folder without a role and carry the actor's role, so a route
    can decide what to offer (R4).
  - `createFolder()` stores the folder and the Owner role of its creator in one transaction (R6); an admin still gets
    `not-allowed` before anything else, so creating a folder never makes an admin its Owner (R2, R27). A taken name
    stays `name-taken`, also for a folder the actor cannot see (R18).
  - Every other write of a folder or tab answers `not-allowed` without a role on the folder; the role each write needs
    follows in the next step.
- `src/features/pages/service.ts`: every read returns `null` (a list included) and every write `not-allowed` for a
  folder without a role of the actor, the deleted pages included (R4). The check comes after the admin check and before
  any other database work that could tell whether an item exists.
- `src/features/folders/components/FolderList.tsx`: a column with the own role (R17). `src/app/folders/page.tsx`: when
  the user has no folder, a short hint that there are no folders yet, that the user can create one or ask an Owner of a
  folder for a role, next to "New folder" (R21).
- `src/app/folders/[folder]/page.tsx`: the folder names the own role of the user (R17).
- The actions map `not-allowed` to `notFound()` as today, so a form of a folder without a role answers like one of a
  folder that does not exist.
- Logging: a refused write logs the actor and the folder, like the refusals of an admin.

### Test

- Unit: the folders, pages and folder-roles services for the role check before every read and write, the channel
  `mcp` that ignores roles, and what is logged; `createFolder()` writes the folder and the Owner role together. The
  queries and actions tests for the channel they pass. `src/features/mcp/tools.test.ts` for the channel `mcp`.
  `src/features/services.test.ts` loads the folder-roles service.
- Integration (`integration/folder-service.test.ts`, `integration/page-service.test.ts`): the list holds only the
  folders with a role, with the role, by name; a folder, tab, page and deleted page without a role are `null`; a new
  folder has its creator as Owner and no other role; a write without a role changes nothing; for `mcp` every folder
  is listed and read.
- End-to-end, new `e2e/folder-roles.spec.ts`:
  - A user without a role on a folder sees it neither in `/folders` nor at any address of the folder, its tabs, pages,
    "All pages" and deleted pages, with and without an action or a view; each shows the not-found page (R4).
  - A user with no role on any folder sees the hint and "New folder"; after creating a folder the user is its Owner,
    sees it in the list with "Owner", and the hint is gone (R6, R21).
  - The folder list and the folder show the own role, for each of the four roles (R17).
  - Creating a folder with the name of a folder the user cannot see shows that the name is taken, and nothing else of
    that folder shows (R18).
  - A crafted form of a folder without a role (create a page, rename the folder) shows the not-found page and writes
    nothing.
- End-to-end, `e2e/mcp.spec.ts`: a token of a user without a role on a folder still lists and reads it (R8).
- `e2e/folders.spec.ts` and the other specs of the content keep passing with the default Owner role of `createFolder()`.

## Functions by role

### Goal

A user sees and does with a folder exactly what the role matrix gives the role: buttons are shown by role, and an
action, view or form beyond the role answers like one that does not exist. [R3, R5, R1]

### Build

- The services check the lowest role of each function from `roles.ts`, after the admin and before everything else but
  the parsing of the actor:
  - Writer: create a page, edit its content, move or rename it.
  - Manager: delete a page; list, read and restore deleted pages; create and rename a tab.
  - Owner: rename the folder.
  - Reader: every other read of the folder, its tabs and pages.
    A missing role is `not-allowed` for a write and `null` for a read.
- The routes ask the role that the folder read returns and offer only what it includes (R5):
  - Folder: "Rename" for an Owner; "Deleted pages" and "New tab" for a Manager; "New page" for a Writer; "All pages"
    for every role.
  - Tab: "Rename" for a Manager, "New page" for a Writer.
  - Page: "Edit" and "Move or rename" for a Writer, "Delete" for a Manager.
  - `/deleted-pages/<folder>` and its pages, with "Restore", for a Manager.
  - An action of the address that the role does not include (`?action=edit` for a Reader, `?action=rename` on a folder
    for a Manager, …) shows the not-found page, before the content is read, like an unknown action.
- The routes decide with `includesRole()` and the functions of `roles.ts`, so that the service and the route can never
  disagree about a role.

### Test

- Unit: the services for each function and each role: allowed from its lowest role up, refused below, with the log line
  of the refusal. `roles.test.ts` already covers the matrix itself.
- Integration: a Reader's write, a Writer's delete and restore, and a Manager's rename of the folder change nothing.
- End-to-end, `e2e/folder-roles.spec.ts`, one test per role that walks the matrix (R3, R5):
  - Reader: reads the folder, a tab, a page and "All pages"; sees no "New page", "Edit", "Move or rename", "Delete",
    "Deleted pages", "New tab" or "Rename"; `?action=new`, `?action=edit`, `?action=move-or-rename`, `?action=delete`,
    `?action=new-tab`, `?action=rename` and `/deleted-pages/<folder>` show the not-found page; a crafted form of each
    write shows the not-found page and writes nothing.
  - Writer: creates, edits, moves and renames a page; has no "Delete", "Deleted pages", "New tab" or "Rename".
  - Manager: deletes a page, sees it in the deleted pages, reads and restores it, creates and renames a tab; has no
    "Rename" of the folder, and its address and form answer not found.
  - Owner: renames the folder.
- The specs of the routes the step changes keep passing: `folders`, `tabs`, `pages`, `create-page`, `edit-page`,
  `move-or-rename-page`, `delete-page`, `deleted-pages`, `restore-page`, `all-pages`, `hydration`, `access`.

## Roles view

### Goal

Every user with a role on a folder sees who has which role on it, in the view `?view=roles`. [R13, R14, R20]

### Build

- `src/features/folder-roles/service.ts`: `listFolderRoles(actor, folderId)`: every user with a role on the folder and
  the role, Owners first, then Managers, Writers and Readers, each group by user name (R20); `null` for an admin and
  for a user without a role (R13).
- `queries.ts` of the feature, and a component `FolderRoleList` in `src/features/folder-roles/components/`.
- `src/app/folders/[folder]/page.tsx`: the view `roles` with a breadcrumb back to the folder, and a "Roles" button on
  the folder for every role (R14). The view has no actions; a view together with an action is invalid, as today.
- `src/lib/addresses.ts`: a helper for the address of the view.

### Test

- Unit: the service for the admin, a user without a role and a malformed id; the query like the other queries;
  `src/lib/addresses.test.ts` for the new address.
- Integration: the order of R20 with two Owners, a Writer and two Readers; `null` without a role.
- End-to-end, `e2e/folder-roles.spec.ts`: a Reader opens "Roles" from the folder and sees every user with a role in
  the order of R20 and no control to change them (R13, R14, R20); a user without a role opening the view sees the
  not-found page. `e2e/access.spec.ts`: the view leads to the login page without a login.

## Give role

### Goal

An Owner gives a user who has no role on the folder a role, from a list that never offers an admin. [R7, R10, R15,
R24, R2, R22 for giving]

### Build

- `src/features/folder-roles/service.ts`:
  - `listRoleCandidates(actor, folderId)`: every account of the type `user` without a role on the folder, by name;
    `null` for anyone but an Owner of the folder.
  - `giveRole(actor, folderId, input)` with the user name and the role: `not-allowed` for an admin and for anyone but
    an Owner of the folder (R7); `user-not-found` for an unknown name and for an admin, so that a crafted form with the
    name of an admin gives no role and the trigger of the first step is only the second line (R2); `role-taken` when
    the user already has a role (the unique index); otherwise the role, Owner included (R10).
  - Every role given is logged with the folder, the user, no old role, the new role and the Owner (R22).
- `forms.ts`, `actions.ts` (redirects to the folder on success, like every dialog), and a Client Component
  `GiveRoleDialog` with the list of users and the role, locked until hydration. When nobody is left, the dialog says so
  and offers only "Cancel" (R24).
- `src/app/folders/[folder]/page.tsx`: the action `give-role`, only for an Owner (any other role and no role: the
  not-found page); "Give role" in the roles view for an Owner. Saving and cancelling lead to the folder (R15).

### Test

- Unit: the service for each code and the log line; the form parser; the action for each code (`not-allowed` maps to
  `notFound()`), the revalidation and the redirect to the folder.
- Integration: giving a role stores it; a second role of the same user gives `role-taken`; an admin's name gives
  `user-not-found` and stores nothing; a Manager gives nothing; the candidates leave out admins and users with a role.
- End-to-end, `e2e/folder-roles.spec.ts`:
  - An Owner gives a Writer role from the roles view, lands on the folder, and the roles view shows the user (R15).
  - The list of the dialog has no admin and no user with a role (R2, R15).
  - An Owner makes another user Owner; that user then sees "Give role" (R10).
  - With every user already holding a role, the dialog shows the hint and no "Save" (R24).
  - A Manager, a Writer and a Reader see no "Give role", and `?action=give-role` shows them the not-found page (R7).
  - A crafted form with the name of an admin is refused and gives no role (R2); a crafted form of a Manager writes
    nothing (R7).
- `e2e/hydration.spec.ts`: the dialog stays locked until hydration. `e2e/access.spec.ts`: the action leads to the
  login page without a login.

## Change and remove roles

### Goal

In the roles view an Owner changes and removes the role of every user listed, the own one and those of other Owners
included, while the folder always keeps an Owner. A change takes effect with the next request of the user it concerns.
[R7, R11, R12, R16, R19, R22, R23]

### Build

- `src/features/folder-roles/service.ts`:
  - `changeRole(actor, folderId, userId, role)` and `removeRole(actor, folderId, userId)`: `not-allowed` for an admin
    and for anyone but an Owner of the folder (R7); `role-not-found` when the user has no role (any more);
    `last-owner` when the change would leave the folder without an Owner (R12).
  - The check of the last Owner and the write run in one transaction that locks the folder's roles, so that two Owners
    who lower each other at the same time cannot leave the folder without one.
  - Every change and removal is logged with the folder, the user, the old and the new role and the Owner; a refused
    change of the last Owner is logged as well (R22).
- `actions.ts`: change and remove in the roles view. A change of another user's role takes effect at once, without a
  confirmation, and stays in the roles view (R16, R19). A change of the own role first asks for a confirmation (a
  dialog in the roles view, locked until hydration); afterwards an Owner who still has a role stays in the roles view,
  one without a role lands on `/folders` (R19). `last-owner` shows the message that a folder needs at least one Owner.
- `FolderRoleList` shows a role choice and "Remove" per user for an Owner, and nothing to change for every other role.

### Test

- Unit: the service for each code and each log line, the refused last Owner included; the action for each code, the
  confirmation of the own role and where each outcome leads.
- Integration: a change and a removal are stored; the last Owner is refused and stays Owner; two Owners who lower each
  other at the same time (`Promise.all`) leave exactly one Owner; a Manager changes nothing.
- End-to-end, `e2e/folder-roles.spec.ts`:
  - An Owner changes a Writer to a Manager and removes a Reader with one click each; the roles view shows the new state
    (R16, R19).
  - An Owner lowers another Owner to Writer (R11).
  - On a folder with two Owners, an Owner lowers the own role to Reader after confirming, stays in the roles view and no
    longer sees the controls of an Owner (R11, R19); an Owner who removes the own role confirms and lands on
    `/folders`, where the folder is missing (R19).
  - The only Owner tries to lower and to remove the own role; the role stays and the message says that a folder needs
    at least one Owner (R12).
  - A Manager sees no controls, and a crafted form of a Manager changes nothing (R7).
  - With a second browser context logged in as another user: an Owner removes that user's role, and the user's next
    click in the folder shows the not-found page; an Owner makes that user a Manager, and the user's next page shows
    "Delete" (R23).
- `e2e/hydration.spec.ts`: the controls and the confirmation stay locked until hydration.

## Admin overview

### Goal

An admin sees the names of all folders and who has which role on each on `/folder-roles`, and nothing else of the
content; an admin changes no role and creates no folder. [R25, R26, R27, R2]

### Build

- `src/features/folder-roles/service.ts`: `listAllFolderRoles(actor)`: every folder by name with its users and roles in
  the order of R20, and no time of the last change or last editor; `null` for a user.
- `queries.ts` and the route `src/app/folder-roles/page.tsx`, without actions and views and without controls (R26);
  the not-found page for a user (R25). `src/lib/addresses.ts`: its address.
- `src/components/AppHeader.tsx`: the entry "Folder roles" for an admin only.
- The writes of the roles already answer `not-allowed` for an admin (R26), and so does creating a folder (R27);
  `/folders` already shows an admin the not-found page, so no "New folder" is offered.

### Test

- Unit: the service for an admin and a user; the query; `src/lib/addresses.test.ts` for the address.
- Integration: the overview lists every folder with its roles in the order of R20, also folders without a role of
  any user, and returns exactly the declared fields.
- End-to-end, `e2e/folder-roles.spec.ts` with the admin's login: "Folder roles" in the header leads to the overview
  with every folder, its users and roles (R25); every address under `/folders` and `/deleted-pages` still shows the
  not-found page (R25); a crafted form to give, change or remove a role and one to create a folder, submitted with the
  admin's login, change nothing (R26, R27); no folder shows an admin in its roles (R2). With a user's login, the header
  has no "Folder roles" and `/folder-roles` shows the not-found page (R25).
- `e2e/access.spec.ts`: `/folder-roles` leads to the login page without a login.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/folder-roles.md` (see "Feature specs" in `step-plan-workflow.md`), and move
   the rules and decisions of the requirements file that still hold into it. Bring the existing specs in line, as
   "Effect on existing features" of the requirements lists: `content-structure.md` ("Overview", "Actions and views",
   "Routes", "Only users see content", "Current limits"), `pages.md` and `page-deletion.md` ("Current limits", who may
   delete and restore), `users-and-login.md` ("Account types", "Decisions", "Current limits"), `mcp.md` (MCP shows a
   user folders that the browser hides) and `architecture.md` (the feature `folder-roles`, the channel of a content
   read, the role check in the services, the new trigger under "Database"); `testing.md` for the default role of
   `createFolder()` and `createFolderRole()`.
2. Remove the feature from `roadmap.md`: "Folder rights", "Assigning and removing rights", "Own rights list" and
   "Rights overview for all folders" under "Rights"; add "MCP rules for folder roles" there, and the folder that loses
   its last Owner to the item that brings deactivating or deleting accounts.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and the requirements file of the feature.
5. Update the spec catalog in `CLAUDE.md`: add `spec/folder-roles.md`, remove this step file and the requirements
   file.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
