# Auth Concept

## Rules

- root admin
  - the system has exactly one root admin, a user called `admin`
  - it is generated at system initialization
  - it can never be disabled or deleted
  - its admin role can never be removed
  - apart from that it has the same rights as any other admin
- user rights are assigned on the level of folders - not on the level of tabs or md_documents
- early rejection: an ASGI middleware rejects unauthenticated requests before the request body is read and before they reach the adapters or services, on both REST and MCP, on every route except the public ones listed in [Architecture](architecture.md)
- no leaks: services must filter by the current user everywhere, so an unreadable md_document never leaks through a search snippet
- denied requests: which response a denied request gets (404 or 403) is defined in [API](api.md)

## Rights on md_documents, tabs and folders

These rights exist:

- read
  - can read all tabs of the folder
  - can read all md_documents of the folder
- write
  - can do everything that can be done with read
  - can add md_documents to a tab in a folder the user has this right on
  - can update the content of md_documents which are part of the folder the user has this right on
  - can add tabs to the folder the user has this right on
- update
  - can do everything that can be done with read
  - can do everything that can be done with write
  - can change the name of tabs in the folder the user has this right on
  - can change the name of md_documents which are in the folder the user has this right on
  - can move md_documents to another tab in the folder the user has this right on

Notes:

- at the moment a delete operation is not available - this will change later
- implicit default access: a user with no assigned right has no access
- all users can see their own full rights with folder name
- a tab can never be moved to an other folder
- a md_document can never be moved to an other tab which is part of an other folder

## Admin Rights

These are the operations allowed for users with `is_admin == True`:

- create new users
- a user can be created as an admin directly
- create new folders
- rename folders
- assign user rights for folders
- delete user rights for folders
- can read all user rights
- can list all users
- an admin has an implicit "update" right on all folders
- an admin can change the `is_admin` flag of other users, except for the root admin
- an admin can not change the `is_admin` flag of its own user

Notes:

- at the moment a user can not be deleted or deactivated - this will change later, but never for the root admin
- Changing a right: assigning a right (to a user for a folder) replaces the user's existing one on that folder
- at least one admin always exists: the root admin
- users can not be renamed
