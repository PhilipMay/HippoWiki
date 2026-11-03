# Users

This document defines accounts, the admin, how users are linked to Keycloak and how they are deactivated. How clients
log in is in [Connectors](connectors.md), and how tokens are checked is in [Authentication](authentication.md).

## Own Account

- every user can read their own user and their [own rights](rights.md#assigning-and-listing-rights), on REST and on MCP
- the own user has only the ID, name, `is_admin` and `created_at`, so no `auth_subject`
- every response names a user as ID and name together, so `created_by` needs no lookup
  - a name appears only next to something the user can already read, so nothing can be enumerated, and there is no route
    that turns an ID into a name
  - a deactivated user keeps their name here, because [the name stays reserved](#deactivating-users)

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
- before system initialization, and until an account is linked to the admin, nobody can authenticate, so every request
  to a non-public route gets 401

## Admin Operations

The admin can do these, only on REST. The responses for other users are in
[Responses to Admin Operations](request-checks.md#responses-to-admin-operations).

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
- to read content, the person who is the admin assigns a right to their normal account. This separates the accounts and
  is not a security boundary: the admin can assign a right to any account, and
  [changes of rights are logged](authentication.md#login-protection-and-audit)

## User Linking

Keycloak accounts and HippoWiki users are connected only through `users.auth_subject`, which holds the `sub` claim of
the Keycloak account.

- Keycloak usernames and HippoWiki names are not compared, because a match by name would break when a username changes
  or is reused
- the admin creates the account in Keycloak first, then creates the HippoWiki user with the ID of that account
- only the admin is created without `auth_subject` (service)
- the admin can change or remove `auth_subject` of another user, and removing it blocks that user on the next request
  (service)
- a valid token with no linked user gets 401, and so does a valid token of a deactivated user

## Deactivating Users

- users can not be deleted, only deactivated and reactivated
- the admin can deactivate any other user
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

## Rejected User and Right Operations

These rules reject an operation, whatever the rights of the user. The last column names the row in the
[check order](request-checks.md#check-order).

| Rule                                                                                               | Domain error                              | REST | Check              |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---- | ------------------ |
| change the `auth_subject` of the admin through REST, because it could lock the admin out (service) | `ForbiddenError`                          | 403  | Target rules       |
| deactivate the admin, because it would lock them out (service)                                     | `ForbiddenError`                          | 403  | Target rules       |
| assign a right to the admin, because it would give the admin access to content (service)           | `ForbiddenError`                          | 403  | Target rules       |
| delete a right that does not exist                                                                 | `NotFoundError`                           | 404  | Target lookup      |
| rename a user, or send `is_admin`                                                                  | none, the request model has no such field | 422  | Schema validation  |
| create a user without `auth_subject`                                                               | none, the request model requires it       | 422  | Schema validation  |
| set an `auth_subject` of "" or one that is [too long](limits.md#limits-at-a-glance)                | `DomainValidationError`                   | 422  | Domain validation  |
| create a user named `admin`                                                                        | `NameConflictError`                       | 409  | Conflicts: name    |
| create a user with the name of a deactivated user                                                  | `NameConflictError`                       | 409  | Conflicts: name    |
| set an `auth_subject` that another user already has                                                | `SubjectConflictError`                    | 409  | Conflicts: subject |
