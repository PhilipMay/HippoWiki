# Users

This document defines accounts, the admin, passwords and how users are deactivated. How clients log in is in
[Connectors](connectors.md), and the login itself is in [OAuth Server](oauth-server.md).

## Own Account

- every user can read their own user and their [own rights](rights.md#assigning-and-listing-rights), on REST and on MCP
- the own user has only the ID, name, `is_admin` and `created_at`
- every response names a user as ID and name together, so `created_by` needs no lookup
  - a name appears only next to something the user can already read, so nothing can be enumerated, and there is no route
    that turns an ID into a name
  - a deactivated user keeps their name here, because [the name stays reserved](#deactivating-users)

## Admin

- system initialization creates the admin, a user named `admin` with `is_admin` set to true
  - `hippowiki init` runs it, see [Deployment](deployment.md)
  - it is idempotent: an existing admin is left alone, and a concurrent run is caught by the unique name
  - it sets no password, because a password must not pass through a deployment step
- `hippowiki set-admin-password` sets the password of the admin. It is the only way to change it, and it needs shell
  access to the server
  - it asks for the password on the terminal, so the password stays out of the shell history and the process list
  - it can be run again at any time, and also clears a [wait after failed logins](oauth-server.md#login-protection)
- the admin uses REST through a [script client](connectors.md#scripts) or, later, the Web GUI
- there is one admin account, so several administrators or admin scripts have to share it. This is accepted for now, see
  [Ideas](roadmap.md#ideas)
- changes can not lock the admin out for good: if the password or a script client is lost, the operator sets a new one
  with the same commands
- before system initialization, and until the admin has a password or a script client, nobody can administer the system.
  Before initialization nobody can authenticate either, so every request to a non-public route gets 401

## Admin Operations

The admin can do these, only on REST. The responses for other users are in
[Responses to Admin Operations](request-checks.md#responses-to-admin-operations).

- users:
  - create users, each with a one-time password
  - list all users, including deactivated users, and read one user
  - reset the password of other users
  - deactivate other users, and reactivate users
- folders: create and rename folders, delete them, list deleted folders and restore them
- rights: assign and delete the rights of a folder, list them, and list all rights of all folders

The admin has no access to content:

- the admin sees every live folder in the folder list and can read it, which shows the folder itself and nothing in it
- apart from that the admin behaves like a user with no right, so its tabs, md_documents, history and revert get 404
- to read content, the person who is the admin assigns a right to their normal account. This separates the accounts and
  is not a security boundary: the admin can assign a right to any account, and
  [changes of rights are logged](authentication.md#audit)

## Passwords

A user is an account: there are no external accounts to link, and a user logs in with their name and password on the
[login page](oauth-server.md#login-page). How passwords are stored and protected is in
[Login Protection](oauth-server.md#login-protection).

- the admin never chooses a password for another user. Creating a user generates a random one-time password, which the
  response holds once, and which the admin passes on
- a one-time password works only for setting a new password, see [Login Page](oauth-server.md#login-page)
- a password reset by the admin replaces the password with a new one-time password, ends the tokens of the user and
  clears a wait after failed logins (service)
- a user changes their own password on the login page, which ends all their tokens (service)
- the [rules for a new password](limits.md#limits-at-a-glance) are only its length and that it is not the name of the
  user, because rules on character types lead to weaker passwords (service)
- the hash is in its own table, so it never comes along with a user row, see
  [User Password Table](database.md#user-password-table)
- a lost password has no self-service, because HippoWiki stores no email. A person goes to the admin, and the admin to
  the shell

## Deactivating Users

- users can not be deleted, only deactivated and reactivated
- the admin can deactivate any other user
- deactivating sets `deactivated_at` and [ends the tokens of the user](oauth-server.md#ending-tokens). The credential
  check then rejects the user on the next request, see [Token Check](authentication.md#token-check)
  - the password and the rights stay, and apply again after reactivation, when the user has to log in again
  - deactivating and reactivating are idempotent, and `deactivated_at` keeps its first value
  - reactivating an active user succeeds and changes nothing, which is always the case for the admin
  - a deactivated user can still get rights and a password reset from the admin
- the name of a user stays reserved, also while they are deactivated, so the history stays unambiguous
- what a user did stays: their content stays attributed to them
- users can not be renamed, which keeps the admin in place, and `is_admin` of a user never changes after creation
  (service)

## Rejected User and Right Operations

These rules reject an operation, whatever the rights of the user. The last column names the row in the
[check order](request-checks.md#check-order).

| Rule                                                                                        | Domain error                              | REST | Check             |
| ------------------------------------------------------------------------------------------- | ----------------------------------------- | ---- | ----------------- |
| reset the password of the admin through REST, because it could lock the admin out (service) | `ForbiddenError`                          | 403  | Target rules      |
| deactivate the admin, because it would lock them out (service)                              | `ForbiddenError`                          | 403  | Target rules      |
| assign a right to the admin, because it would give the admin access to content (service)    | `ForbiddenError`                          | 403  | Target rules      |
| delete a right that does not exist                                                          | `NotFoundError`                           | 404  | Target lookup     |
| rename a user                                                                               | none, there is no such route              | 405  | Routing           |
| send `is_admin` when creating a user                                                        | none, the request model has no such field | 422  | Schema validation |
| create a user named `admin`                                                                 | `NameConflictError`                       | 409  | Conflicts: name   |
| create a user with the name of a deactivated user                                           | `NameConflictError`                       | 409  | Conflicts: name   |
