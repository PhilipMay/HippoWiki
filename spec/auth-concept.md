# Auth Concept

## Rules

- the system has exactly one root admin, see [Entity Rules](entity-rules.md#root-admin)
- user rights are assigned on the level of folders - not on the level of tabs or md_documents
- authentication: see [Authentication](authentication.md) for the login method and [Auth Middleware](auth-middleware.md) for rejecting requests
- AI agents: an agent acts as the account it logged in with and has no rights of its own, see [Authentication](authentication.md#ai-agents)
- no leaks: services must filter by the current user everywhere, so an unreadable md_document never leaks through a list, and later through a search snippet
- denied requests: which response a denied request gets (404 or 403) is defined in [Request Checks](request-checks.md)

## Rights on md_documents, tabs and folders

These rights exist:

- read
  - can see the folder (ID and name) and find it in the folder list
  - can read all tabs of the folder
  - can read all md_documents of the folder
- write
  - can do everything that can be done with read
  - can add md_documents to a tab in a folder the user has this right on
  - can update the content of md_documents which are part of the folder the user has this right on
  - can add tabs to the folder the user has this right on
- manage
  - can do everything that can be done with read
  - can do everything that can be done with write
  - can change the name of tabs in the folder the user has this right on
  - can change the name of md_documents which are in the folder the user has this right on
  - can move md_documents to another tab in the folder the user has this right on

Notes:

- at the moment a delete operation is not available - this will change later
- implicit default access: a user with no assigned right has no access
- all users can see their own full rights with folder name
  - this list shows effective rights: an admin gets `manage` on every folder, and their stored rows are ignored
  - each entry has the folder and the right only, because an implicit right has no `assigned_by` or `assigned_at`
- what can be moved where is limited by the [entity rules](entity-rules.md#folders-tabs-and-md-documents)

## Admin Rights

These are the operations allowed for users with `is_admin == True`:

- create new users, each linked to a Keycloak account
- a user can be created as an admin directly
- change or remove the linked Keycloak account of other users, except for the root admin, see [Entity Rules](entity-rules.md#user-linking)
- create new folders
- rename folders
- assign user rights for folders
- delete user rights for folders
- can list the rights of a folder
- can list all rights of all folders
- can list all users
- an admin has an implicit "manage" right on all folders
  - it comes from `is_admin` and is not stored as rows
  - an assigned right of an admin has no effect while `is_admin` is true, and applies again if the flag is removed
- an admin can change the `is_admin` flag of other users, except for the root admin
- an admin can not change the `is_admin` flag of its own user

Notes:

- the responses to these operations for non-admins, and to rejected `is_admin` changes, are defined in [Request Checks](request-checks.md)
- at the moment a user can not be deleted or deactivated - this will change later
- Listing rights: the rights of a folder and all rights of all folders show the stored rows that admins assign and delete, including rows that have no effect while the user is an admin
