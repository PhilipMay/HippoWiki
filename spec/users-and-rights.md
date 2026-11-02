# Users and Rights

This document defines who can do what, and how users are linked, deactivated and deleted. The tables are in
[Entities](entities.md#user), the login is in [Authentication](authentication.md), and the responses to rejected
operations are in [Rejected Operations](request-checks.md#rejected-operations). Rules marked (service) can not be
expressed by table constraints, so the service layer enforces them.

## General Rules

- rights are assigned per folder, not per tab or md_document
- a user with no right on a folder has no access to it, unless they are an admin, see
  [Admin Operations](#admin-operations)
- rights are ordered, `read` < `write` < `manage`, and each right includes the lower ones
- the system has exactly one [root admin](#root-admin)
- an AI agent acts as the account it logged in with and has no rights of its own, see
  [AI Agents](authentication.md#ai-agents)
- admins can connect only through REST, and history and revert exist only on REST, for every right, see
  [MCP](mcp.md#admin-accounts)
- no leaks: services must filter by the current user everywhere, so an unreadable md_document never leaks through a
  list, and later through a search snippet

## Rights on Folders

A user with no right on the folder gets 404 for every row, and lists leave the folder out. What deleting does is defined
in [Entities](entities.md#deleting-and-restoring-content), and what can be moved where in
[Folders, Tabs and MD Documents](entities.md#folders-tabs-and-md-documents).

| Operation in a folder                                                                   | `read` | `write` | `manage` | admin |
| --------------------------------------------------------------------------------------- | ------ | ------- | -------- | ----- |
| See the folder (ID and name) and find it in the folder list                             | yes    | yes     | yes      | yes   |
| Read its tabs and md_documents                                                          | yes    | yes     | yes      | yes   |
| Read the folder history, with metadata only for tabs and md_documents that are not live | yes    | yes     | yes      | yes   |
| Read the history of a live md_document and the content of its revisions                 | yes    | yes     | yes      | yes   |
| Add a md_document to a tab                                                              | 403    | yes     | yes      | yes   |
| Update the content of a md_document                                                     | 403    | yes     | yes      | yes   |
| Add a tab                                                                               | 403    | yes     | yes      | yes   |
| Rename a tab or a md_document                                                           | 403    | 403     | yes      | yes   |
| Move a md_document to another tab                                                       | 403    | 403     | yes      | yes   |
| Delete a md_document or a tab, except for the default tab                               | 403    | 403     | yes      | yes   |
| List deleted md_documents and tabs, and restore them                                    | 403    | 403     | yes      | yes   |
| Read the history of a md_document that is not live and the content of its revisions     | 403    | 403     | yes      | yes   |
| Revert a md_document or a folder                                                        | 403    | 403     | yes      | yes   |
| Read the history of a deleted folder and the revisions in it                            | 404    | 404     | 404      | yes   |

The current right applies to all revisions, also to those from before the user got it.

## Admin Operations

A user with `is_admin` set can do these, only on REST. The responses for non-admins are in
[Admin Operations](request-checks.md#admin-operations).

- users:
  - create users, each linked to a Keycloak account, and create a user as an admin directly
  - list all users, including deactivated and deleted users
  - change or remove the linked Keycloak account of other users, except for the root admin
  - deactivate and delete other users, except for the root admin, and reactivate users
  - change the `is_admin` flag of other users, except for the root admin
- folders: create and rename folders, delete them, list deleted folders and restore them
- rights: assign and delete the rights of a folder, list them, and list all rights of all folders

An admin has an implicit `manage` right on all live folders:

- it comes from `is_admin` and is not stored as rows, so it makes every live folder visible and sufficient
- an assigned right of an admin has no effect while `is_admin` is true, and applies again if the flag is removed

An admin can not change their own `is_admin` flag (service). The other limits are in [Root Admin](#root-admin),
[User Linking](#user-linking) and [Deactivating and Deleting Users](#deactivating-and-deleting-users).

## Assigning and Listing Rights

- assigning a right replaces the existing row, so `assigned_by` and `assigned_at` describe the current assignment
- deleting a right removes the row
- all users can see their own full rights with the folder name
  - this list shows effective rights: an admin gets `manage` on every live folder, and their stored rows are ignored
  - deleted folders are left out
  - each entry has the folder and the right only, because an implicit right has no `assigned_by` or `assigned_at`
- the rights of a folder and all rights of all folders show the stored rows that admins assign and delete, including
  rows that have no effect while the user is an admin. Rows on deleted folders and rows of deleted users are left out

## User Linking

Keycloak accounts and HippoWiki users are connected only through `users.auth_subject`, see
[Authentication](authentication.md#user-linking).

- an admin creates the account in Keycloak first, then creates the HippoWiki user with the ID of that account
- creating a user requires `auth_subject`, and only the root admin is created without one (service)
- `auth_subject` has 1 to 255 characters. The service checks this, because "" would otherwise hit the check constraint
  and become a 500
- an admin can change or remove `auth_subject` of another user, and removing it blocks that user on the next request
  (service)
- an admin can not change their own `auth_subject`, because it could lock them out (service)
- nobody can change `auth_subject` of the root admin through REST, because an admin could otherwise take over the root
  admin (service)

## Deactivating and Deleting Users

- an admin can deactivate or delete another user, but not the root admin and not their own user, because it would lock
  them out (service)
- deactivating sets `deactivated_at`, and the credential check then rejects the user on the next request, see
  [Token Check](authentication.md#token-check)
  - the link and the rights stay, and apply again after reactivation
  - deactivating and reactivating are idempotent, and `deactivated_at` keeps its first value
  - reactivating an active user succeeds and changes nothing, which is always the case for the root admin and the
    admin's own user
  - a deactivated user can still get rights and a changed link from an admin
- deleting is final, and a deleted user can not be restored or reactivated (service)
  - in one transaction it sets `deleted_at`, clears `auth_subject` and removes the folder right rows of the user
  - the cleared `auth_subject` lets the same Keycloak account be linked to a new user
  - the name stays reserved, so the history stays unambiguous
  - a user can be deleted without being deactivated first
- every other operation on a deleted user fails as if the user did not exist, also when the user is the target of a
  right (service)
- a deleted user stays in the list of all users, with both timestamps, so that an ID in the history can be turned into a
  name
- what a user did stays: their content stays attributed to them, and the rights they assigned stay in force
- a right assigned while its user is being deleted can leave a row behind. This is accepted, because the row has no
  effect, and the rights lists leave out rows of deleted users
- users can not be renamed, which keeps the root admin in place, and `is_root` of a user never changes after creation
  (service)

## Root Admin

- system initialization creates the root admin, a user named `admin` with `is_root` and `is_admin` set to true
  - `hippowiki init` runs it, see [Deployment](deployment.md)
  - it is idempotent: an existing root admin is left alone, and a concurrent run is caught by the unique name
  - it leaves the root admin unlinked, because it runs before anyone can log in
- `hippowiki link-root-admin <subject>` sets the link. It is the only way to change this link, and it needs shell access
  to the server
  - it is idempotent: linking the same subject again changes nothing, and a subject that another user already has is
    rejected
- a lost password is reset in the Keycloak console
- credential changes can not lock the root admin out for good: if its account is disabled, deleted or lost in Keycloak,
  the operator enables it or links another account with the same command
- the root admin can never be deleted or deactivated, and its `is_admin` flag can never be removed (service)
- apart from that the root admin has the same rights as any other admin
- after system initialization at least one admin always exists, because the root admin always stays an admin
  - this also holds under concurrent transactions and needs no lock: admins who demote, deactivate or delete each other
    at the same time can not affect the root admin
  - before system initialization, and until an account is linked to the root admin, nobody can authenticate, so every
    request to a non-public route gets 401

## Implementation Notes

- Assigning a right uses `ON CONFLICT DO UPDATE SET access_right, assigned_by, assigned_at = now()`.
  - The statement sets `assigned_at` itself, because `DEFAULT now()` does not fire on the update.
  - Delete and insert is not an alternative, because two concurrent first assignments would then hit the primary key.
