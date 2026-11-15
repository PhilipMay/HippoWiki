# Folder Roles – Requirements

Status: approved

## Goal

Today every user reads and changes all content. Folder roles decide per folder and per user what a user may see and do
with that folder in the browser, so that a folder can be kept to the people who work on it, and only some of them may
change it. Whoever creates a folder owns it and decides who else gets which role.

## Users and roles

- Folder roles apply to accounts of the type user only. An admin gets no role and still sees no tabs, pages or deleted
  pages, but sees the names of the folders and who has which role on them (see "Account types" in
  `users-and-login.md`).
- Folder roles apply to the browser only. MCP keeps its current behaviour until its own rules are defined.
- There are four roles: Reader, Writer, Manager and Owner. Each role includes everything the role before it may do.
- A role is given per user and per folder: a user may be Reader of one folder, Manager of another and have no role on
  a third.
- Every user may create a folder, and becomes its Owner.
- Only an Owner of a folder gives other users roles on that folder.

What each role may do with a folder in the browser:

| Function                                                             | Reader | Writer | Manager | Owner |
| -------------------------------------------------------------------- | :----: | :----: | :-----: | :---: |
| See the folder in the folder list, open it, its tabs and "All pages" |   ✓    |   ✓    |    ✓    |   ✓   |
| Read pages                                                           |   ✓    |   ✓    |    ✓    |   ✓   |
| Create a page, edit its content                                      |        |   ✓    |    ✓    |   ✓   |
| Move or rename a page                                                |        |   ✓    |    ✓    |   ✓   |
| Delete a page                                                        |        |        |    ✓    |   ✓   |
| See the deleted pages of the folder, read and restore one            |        |        |    ✓    |   ✓   |
| Create or rename a tab                                               |        |        |    ✓    |   ✓   |
| Rename the folder                                                    |        |        |    ✓    |   ✓   |
| Give, change and remove roles on the folder                          |        |        |         |   ✓   |

Not tied to a folder, and so open to every user without a role, as today: creating a folder, the user list, the own
account page with its tokens and connected apps, the consent page of OAuth, the password change and logging out.

## Scenarios

- Anna creates the folder `project-x` and is its Owner. Anna makes Ben a Writer and Carla a Reader. Ben writes and
  edits pages there; Carla reads them but sees no "Edit", "New page" or "Delete". David has no role and does not see
  `project-x` at all; its address shows David the not-found page.
- Ben moves a page into the wrong tab and wants it deleted, but deleting needs a Manager. Anna, as the Owner, deletes
  it, and restores it later from the deleted pages of the folder.

## Requirements

### Roles

- R1: Every user must have at most one role per folder: Reader, Writer, Manager or Owner, and each role must include
  everything the roles before it may do.
  - Acceptance: a Manager can do everything a Writer and a Reader can do; a user never holds two roles on one folder.
- R2: An admin must have no role on any folder and must not be offered as someone to give a role to.
  - Acceptance: the "Give role" dialog lists no admin; no folder shows an admin in its roles view.

### Seeing and changing content

- R3: A user must see and do with a folder exactly what the matrix in "Users and roles" gives their role on it, and
  nothing more.
  - Acceptance: for each role, each function of the matrix works when it has a ✓ and is refused when it has none.
- R4: A user without a role on a folder must not see it: it is missing from the folder list, and every address of the
  folder, its tabs, pages and deleted pages shows the not-found page.
  - Acceptance: a user without a role sees neither the folder name in `/folders` nor any of its content; its
    addresses answer like those of a folder that does not exist.
- R5: A function the role does not include must not be offered, and its address or form must answer like one that
  does not exist and change nothing.
  - Acceptance: a Reader sees no "New page", "Edit", "Move or rename", "Delete", "Deleted pages", "New tab" or
    "Rename"; opening `?action=edit` on a page as a Reader shows the not-found page; a form submitted without the
    right role writes nothing.
- R17: Every user must see their own role on each folder: in a column of the folder list and on the folder itself.
  - Acceptance: the folder list shows "Reader", "Writer", "Manager" or "Owner" next to each folder; the folder names
    the role of the user who is looking at it.
- R21: A user with no role on any folder must see on `/folders` a short hint that there are no folders yet, that they
  can create one or ask an Owner of a folder for a role, next to the "New folder" button.
  - Acceptance: a new user opens `/folders` and sees the hint and "New folder"; once the user has a role, the hint is
    gone.

### Creating folders

- R6: Every user must be able to create a folder and must become its Owner when it is created.
  - Acceptance: a user with no role on any folder creates a folder, is its Owner and sees it in the folder list.

### Seeing roles

- R13: Every user with a role on a folder must be able to see which users have which role on it.
  - Acceptance: a Reader sees the list of users and roles of the folder but no control to change it; a user without
    a role sees nothing of it.
- R14: The folder must offer "Roles" to every user with a role on it, leading to the view
  `/folders/<folder>?view=roles`: every user with a role on the folder and their role.
  - Acceptance: a Reader opens "Roles" from the folder and sees every user with a role on it; the address of the view
    shows a user without a role the not-found page.
- R20: The roles view must list Owners first, then Managers, Writers and Readers, and the users of each role by user
  name.
  - Acceptance: a folder with two Owners, a Writer and two Readers shows them in that order, each group sorted by
    name.

### Giving roles

- R7: Only an Owner of a folder must be able to give, change and remove roles on that folder.
  - Acceptance: an Owner gives a user a role, changes it and removes it; a Manager, Writer or Reader is not offered
    this, and their attempt changes nothing.
- R10: A folder must be able to have several Owners, and an Owner must be able to give the Owner role to another user.
  - Acceptance: an Owner makes another user Owner; both can then give, change and remove roles on the folder.
- R11: All Owners of a folder must be equal: an Owner must be able to lower or remove every role on the folder, their
  own and those of other Owners included.
  - Acceptance: an Owner lowers another Owner to Writer; on a folder with two Owners, an Owner lowers their own role
    to Reader and then no longer sees the controls of an Owner.
- R12: A folder must always keep at least one Owner: lowering or removing the role of its last Owner must be refused
  with a message that says why.
  - Acceptance: the only Owner of a folder tries to lower or remove their own role; the role stays Owner and the
    message says that a folder needs at least one Owner.
- R15: In the roles view an Owner must be offered "Give role", which opens a dialog on the folder address
  (`?action=give-role`): the Owner picks a user from a list of all users of the type user who have no role on the
  folder yet, and a role. Saving and cancelling lead to the folder, like every other dialog.
  - Acceptance: the list leaves out admins and users who already have a role on the folder; after saving, the Owner
    is on the folder, and the roles view shows the user with the role. A user without the Owner role who opens
    `?action=give-role` sees the not-found page.
- R24: When every user of the type user already has a role on the folder, the "Give role" dialog must say so and
  offer only "Cancel".
  - Acceptance: in a wiki where every user has a role on the folder, the dialog shows the hint and no "Save".
- R16: In the roles view an Owner must be able to change and remove the role of each user listed, within the rule of
  R12.
  - Acceptance: an Owner changes a Writer to a Manager and removes a Reader; the roles view shows the new state.
- R19: Changing or removing the role of another user must take effect at once, without a confirmation. Lowering or
  removing the own role must ask for a confirmation first; when the Owner then has no role left, they must land on
  `/folders`.
  - Acceptance: an Owner removes a Reader with one click; an Owner who removes their own role is asked first, and
    after confirming lands on `/folders`, where the folder is missing. An Owner who lowers their own role to Writer
    stays in the roles view of the folder and no longer sees the controls of an Owner.
- R23: A change of a role must take effect with the next request of the user it concerns, without a new login.
  - Acceptance: an Owner removes Carla's role while Carla has the folder open; Carla's next click in the folder shows
    the not-found page. An Owner makes Ben a Manager; Ben's next page shows "Delete".

### Admins

- R25: An admin must be able to see the names of all folders and which user has which role on each, on one overview
  page of its own, and nothing else of the content: no tab, page or deleted page, no time of the last change and no
  last editor.
  The overview lives at `/folder-roles`, reached through the header entry "Folder roles", which only admins get. A
  user sees no such entry, and the address shows a user the not-found page.
  - Acceptance: an admin opens "Folder roles" and sees every folder by name with its users and their roles, in the
    order of R20; every address under `/folders` and `/deleted-pages` still shows an admin the not-found page; a user
    who opens `/folder-roles` sees the not-found page.
- R26: An admin must only look at the roles: the overview offers no way to give, change or remove a role.
  - Acceptance: the overview has no controls; a form of the roles that an admin submits changes nothing.
- R27: An admin must not be able to create a folder.
  - Acceptance: an admin is offered no "New folder"; a form to create a folder that an admin submits creates
    nothing.

### Folder names

- R18: Folder names must stay unique across the wiki. Creating or renaming a folder with the name of a folder the user
  cannot see must be refused as "name taken", as today.
  - Acceptance: a user without a role on `project-x` tries to create a folder named `project-x`; it is refused with
    the message that the name is taken, and nothing else of `project-x` shows.

### Logging

- R22: Every change of a role must be logged: the folder, the user whose role changed, the old and the new role, and
  the Owner who made the change. A refused change of the last Owner must be logged as well.
  - Acceptance: giving, changing and removing a role each write one log line with these facts; a refused attempt to
    lower the last Owner writes one log line that says so.

### MCP

- R8: MCP must keep its current behaviour: a token or connected app of a user reads every folder, as today,
  regardless of the user's roles.
  - Acceptance: a user without a role on a folder still lists and reads it through MCP.

### Existing installations

- R9: After the update, every existing user must be Owner of every existing folder.
  - Acceptance: after the update every user sees and can do everything they could do before, and can give and take
    roles on every existing folder.

## Scope

- In: the four roles per user and folder, their effect in the browser, creating folders with the creator as Owner,
  the roles view of a folder, Owners giving, changing and removing roles, the admin overview `/folder-roles`, the
  logging of role changes, the update of existing installations.
- Not in: rules for MCP (defined later); roles for admins; groups of users; public content without a login; a folder
  that loses its last Owner. Today no account can be deactivated or deleted, so no folder can lose its last Owner.
  The feature that brings deactivating or deleting accounts must solve this.

## Effect on existing features

- `content-structure.md`, "Current limits" and "Only users see content": every user no longer reads and changes all
  content; a user sees only the folders with a role, and changes only what the role allows.
- `content-structure.md`, "Actions and views" and "Routes": the folder address gets the view `?view=roles` and the
  action `give-role`, and the folder offers "Roles" and shows the user's own role; the folder list gets a column with
  the own role and a hint when it is empty. Which buttons a folder, tab or page shows depends on the role.
- `pages.md` and `page-deletion.md`, "Current limits": the same for pages and deleted pages. Deleting and restoring
  pages need a Manager.
- `content-structure.md`, "Only users see content": changes for admins. An admin sees the names of all folders and
  their roles on the admin overview, no longer nothing at all, not even the names. Every address under `/folders` and
  `/deleted-pages` still shows an admin the not-found page.
- `users-and-login.md`, "Account types" and "Current limits": a user no longer reads and changes all folders, tabs,
  pages and deleted pages. An admin sees the folder names and their roles. This settles the point in "Decisions" that
  whether admins see folder names is decided again when rights per folder come.
- `mcp.md`: unchanged, but MCP then shows a user folders that the browser hides (see "Decisions").

## Decisions

- Roles are cumulative, so that a user needs only one role per folder and the matrix is easy to explain. Rejected:
  separate rights, several per user and folder.
- Deleting pages, the deleted pages list and restoring need a Manager. Rejected: a Writer who deletes and restores,
  and a Writer who deletes while only a Manager restores.
- MCP stays as it is until its own rules are defined. Accepted: until then a user reads through MCP folders on which
  they have no role, which the browser hides. Rejected: MCP reads only folders with a role, and MCP shows no content.
- A Manager renames the folder, although a rename changes every address in it. Rejected: renaming the folder for
  Owners only.
- A folder may have several Owners, and all Owners are equal, so that a folder does not depend on one person. The last
  Owner stays, so that no folder is left without anyone who can give roles: no admin can step in, because admins change
  no roles. Rejected: exactly one Owner, Owners who change only the roles of others, and no protection of the last
  Owner.
- Every user with a role sees who has which role on the folder, so that they know who works in it and whom to ask.
  Rejected: the list for Owners only, and for Managers and Owners.
- The roles of a folder are shown in a view of the folder and changed in dialogs, so that everything about a folder
  lives under its address, like its other actions. Rejected: a page of its own outside `/folders`.
- An Owner picks the user from a list instead of typing the name, so that no name is mistyped. The list reveals
  nothing new: every user already sees every user name on `/users`. Rejected: typing the user name.
- Folder names stay unique across the wiki, so that every address keeps meaning one folder. Accepted: "name taken"
  tells a user that a folder of that name exists although they cannot see it; nothing else of it leaks, and names have
  to be guessed one by one. Rejected: names unique only among the folders a user sees.
- Every user sees their own role in the folder list and on the folder, so that missing buttons are explained.
  Rejected: the own role only in the roles view.
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
- A folder that loses its last Owner is left to the feature that brings deactivating or deleting accounts, since no
  account can lose its access today. Rejected: solving it now.
- Admins see the folder names and the roles, on one overview page of their own, so that whoever manages the accounts
  can tell who has access to what. They still see no tabs, pages or deleted pages, change no roles and create no
  folders, so that an admin can never give themselves access to the content. Rejected: admins who see no folder names
  at all, the folder list and the roles views under `/folders` for admins, the folders and roles of each user on the
  user list, admins who change roles, and admins who create folders with a user as the first Owner.
- The admin overview shows no time of the last change and no last editor. The user left this to what is simpler to
  build: fewer columns, and admins learn less about the activity in the content. Rejected: the time of the last
  change and the last editor next to each folder.
- The admin overview is a page of its own, `/folder-roles`, with a header entry for admins, outside `/folders`,
  whose addresses stay closed to admins. Users cannot open it, because it would show them folders without a role.
  Rejected: a view of the user list.
- Saving and cancelling the "Give role" dialog lead to the folder, like every other dialog, so that the rule for
  dialogs has no exception. Rejected: back to the roles view.
- On the update every existing user becomes Owner of every existing folder, so that nobody loses access on the day of
  the update. Rejected: the last editor as the only Owner, and the last editor as Owner with every other user as
  Writer.

## Open questions
