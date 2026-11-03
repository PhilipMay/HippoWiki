# Users and Rights

This document defines who can do what, and how users are linked and deactivated. The tables are in
[Entities](entities.md#user), the login is in [Authentication](authentication.md), and the responses to rejected
operations are in [Rejected Operations](request-checks.md#rejected-operations). Rules marked (service) can not be
expressed by table constraints, so the service layer enforces them.

## General Rules

- rights are assigned per folder, not per tab or md_document
- a user with no right on a folder has no access to it
- rights are ordered, `read` < `write` < `manage`, and each right includes the lower ones
- the system has exactly one [admin](#admin), who has no access to content, see [Admin Operations](#admin-operations)
- an AI agent acts as the account it logged in with and has no rights of its own, see
  [AI Agents](authentication.md#ai-agents)
- the admin can connect only through REST, and history and revert exist only on REST, for every right, see
  [MCP](mcp.md#admin-account)
- no leaks: services must filter by the current user everywhere, so an unreadable md_document never leaks through a
  list, and later through a search snippet

## Rights on Folders

A user with no right on the folder gets 404 for every row, and lists leave the folder out. What deleting does is defined
in [Entities](entities.md#deleting-and-restoring-content), and what can be moved where in
[Folders, Tabs and MD Documents](entities.md#folders-tabs-and-md-documents).

| Operation in a folder                                                                   | `read` | `write` | `manage` |
| --------------------------------------------------------------------------------------- | ------ | ------- | -------- |
| See the folder (ID and name) and find it in the folder list                             | yes    | yes     | yes      |
| Read its tabs and md_documents                                                          | yes    | yes     | yes      |
| Read the folder history, with metadata only for tabs and md_documents that are not live | yes    | yes     | yes      |
| Read the history of a live md_document and the content of its revisions                 | yes    | yes     | yes      |
| Add a md_document to a tab                                                              | 403    | yes     | yes      |
| Update the content of a md_document                                                     | 403    | yes     | yes      |
| Add a tab                                                                               | 403    | yes     | yes      |
| Rename a tab or a md_document                                                           | 403    | 403     | yes      |
| Move a md_document to another tab                                                       | 403    | 403     | yes      |
| Delete a md_document or a tab, except for the default tab                               | 403    | 403     | yes      |
| List deleted md_documents and tabs, and restore them                                    | 403    | 403     | yes      |
| Read the history of a md_document that is not live and the content of its revisions     | 403    | 403     | yes      |
| Revert a md_document or a folder                                                        | 403    | 403     | yes      |

The current right applies to all revisions, also to those from before the user got it. The content and the history of a
deleted folder can not be read with any right, so the folder has to be restored first. The admin holds no right, see
[Admin Operations](#admin-operations).

### Combined Updates

One [update of a md_document](rest.md#md-documents) can change its content, name and tab together:

- with only `content_md` present it needs `write`
- with `name` or `tab_id` present it needs `manage`, also when the value would not change, because the right check comes
  before the item is read, see [Check Order](request-checks.md#check-order) (service)

## Own Account

- every user can read their own user and their [own rights](#assigning-and-listing-rights), on REST and on MCP
- the own user has only the ID, name, `is_admin` and `created_at`, so no `auth_subject`
- every response names a user as ID and name together, so `created_by` needs no lookup
  - a name appears only next to something the user can already read, so nothing can be enumerated, and there is no route
    that turns an ID into a name
  - a deactivated user keeps their name here, because [the name stays reserved](#deactivating-users)

## Admin Operations

The [admin](#admin) can do these, only on REST. The responses for other users are in
[Admin Operations](request-checks.md#admin-operations).

- users:
  - create users, each linked to a Keycloak account
  - list all users, including deactivated users, and read one user
  - change or remove the linked Keycloak account of other users
  - deactivate other users, and reactivate users
- folders: create and rename folders, delete them, list deleted folders and restore them
- rights: assign and delete the rights of a folder, list them, and list all rights of all folders

The admin has no access to content:

- the admin sees every live folder in the folder list and can read it, which shows the folder itself and nothing in it
- apart from that the admin behaves like a user with no right, so its tabs, md_documents, history and revert get 404
- a right can not be assigned to the admin, because it would give the admin access to content (service)
- to read content, the person who is the admin assigns a right to their normal account. This separates the accounts and
  is not a security boundary: the admin can assign a right to any account, and
  [changes of rights are logged](authentication.md#login-protection-and-audit)

The other limits are in [Admin](#admin), [User Linking](#user-linking) and [Deactivating Users](#deactivating-users).

## Assigning and Listing Rights

- assigning a right replaces the existing row, so `assigned_by` and `assigned_at` describe the current assignment
- deleting a right removes the row
- all users can see their own rights with the folder name
  - this list is always empty for the admin
  - deleted folders are left out
  - each entry has the folder and the right only
- the rights of a folder and all rights of all folders show the rows that the admin assigns and deletes. Rows on deleted
  folders are left out

## User Linking

Keycloak accounts and HippoWiki users are connected only through `users.auth_subject`, see
[Authentication](authentication.md#user-linking).

- the admin creates the account in Keycloak first, then creates the HippoWiki user with the ID of that account
- creating a user requires `auth_subject`, and only the admin is created without one (service)
- `auth_subject` has 1 to 255 characters. The service checks this, because "" would otherwise hit the check constraint
  and become a 500
- the admin can change or remove `auth_subject` of another user, and removing it blocks that user on the next request
  (service)
- nobody can change `auth_subject` of the admin through REST, because it could lock the admin out (service)

## Deactivating Users

- users can not be deleted, only deactivated and reactivated
- the admin can deactivate any other user, but not their own user, because it would lock them out (service)
- deactivating sets `deactivated_at`, and the credential check then rejects the user on the next request, see
  [Token Check](authentication.md#token-check)
  - the link and the rights stay, and apply again after reactivation
  - deactivating and reactivating are idempotent, and `deactivated_at` keeps its first value
  - reactivating an active user succeeds and changes nothing, which is always the case for the admin
  - a deactivated user can still get rights and a changed link from the admin
  - a deactivated user stays linked, so their Keycloak account stays taken. To link it to a new user, the admin first
    removes it from the deactivated user
- the name of a user stays reserved, also while they are deactivated, so the history stays unambiguous
- what a user did stays: their content stays attributed to them
- users can not be renamed, which keeps the admin in place, and `is_admin` of a user never changes after creation
  (service)

## Admin

- system initialization creates the admin, a user named `admin` with `is_admin` set to true
  - `hippowiki init` runs it, see [Deployment](deployment.md)
  - it is idempotent: an existing admin is left alone, and a concurrent run is caught by the unique name
  - it leaves the admin unlinked, because it runs before anyone can log in
- `hippowiki link-admin <subject>` sets the link. It is the only way to change this link, and it needs shell access to
  the server
  - it is idempotent: linking the same subject again changes nothing, and a subject that another user already has is
    rejected
- the admin has one link, so several administrators or admin scripts have to share one account. This is accepted for
  now, see [Ideas](roadmap.md#ideas)
- a lost password is reset in the Keycloak console
- credential changes can not lock the admin out for good: if its account is disabled, deleted or lost in Keycloak, the
  operator enables it or links another account with the same command
- the admin can never be deactivated (service)
- before system initialization, and until an account is linked to the admin, nobody can authenticate, so every request
  to a non-public route gets 401

## Implementation Notes

- Assigning a right uses `ON CONFLICT DO UPDATE SET access_right, assigned_by, assigned_at = now()`.
  - The statement sets `assigned_at` itself, because `DEFAULT now()` does not fire on the update.
  - Delete and insert is not an alternative, because two concurrent first assignments would then hit the primary key.
