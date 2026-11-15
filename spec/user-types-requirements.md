# User Types – Requirements

Status: approved

## Goal

Every account is of one of two types: an admin manages the accounts and never sees the content of the wiki, and a user
works with folders, tabs and pages and never manages accounts. This separates running the wiki from reading it, so that
whoever manages the accounts does not get access to the content on the way. It also allows more than one admin, and
lets every user see who has an account and who is an admin.

## Users and roles

- Admin: logs in, changes the own first password, sees the list of all accounts and creates new accounts of either
  type. Sees no folder, tab or page, not even their names, has no API tokens and connects no apps.
- User: logs in, changes the own first password, and reads and changes all folders, tabs and pages, the deleted pages
  included. Holds API tokens and connected apps and uses the wiki through MCP. Sees the list of all accounts with their
  type and creation time, but creates no accounts.
- The type of an account is chosen when the account is created and never changes. A person who needs both jobs has two
  accounts.

## Scenarios

- An admin creates an account for a new colleague, keeps the preselected type "User", and passes the generated first
  password on. The colleague logs in, changes the password and works in the folders.
- An admin creates a second admin, so that accounts can still be managed when the first one is away. The second admin
  logs in, lands on the user list and sees no folders.
- A user needs an account for a new colleague, opens "Users" in the header, sees which accounts are admins, and asks
  one of them.
- An operator updates an existing installation. The account `admin` is now an admin and no longer sees the content;
  every other account is a user. The operator logs in as `admin` and creates a user account for themselves to keep
  working in the wiki.

## Requirements

### Types

- R1: Every account must have exactly one type, admin or user, and the type must never change after the account is
  created.
  - Acceptance: every account in the user list shows one type; no page, form or command offers to change it, and a
    crafted request that tries it changes nothing.
- R2: There must be any number of admins.
  - Acceptance: an admin creates a second admin, who can then list and create accounts.

### Creating accounts

- R3: An admin must choose the type of a new account in the "New user" dialog, together with its name. "User" must be
  preselected, and the dialog must say that the type cannot be changed later.
  - Acceptance: the dialog offers "User" and "Admin" with "User" chosen when it opens, and says that the type is
    final; the new account has the chosen type and appears with it in the user list. Everything else of the dialog
    stays as today: a generated first password, shown once, changed at the first login.
- R14: A request to create an account that names no type or an unknown one must be refused, and nothing must be
  created.
  - Acceptance: such a request shows an error at the type field of the dialog; no account and no password are created,
    and no type is chosen in its place.
- R15: The log line of a new account must name its type and the admin who created it.
  - Acceptance: after an admin creates an account, the log has one line with the new name, its type and the name of
    the admin; no password is logged.
- R4: The admin setup on the first start must create the account `admin` as an admin, as today with only
  `HIPPOWIKI_ADMIN_PASSWORD`. Admins created later may have any valid user name.
  - Acceptance: after the first start `admin` is an admin; an admin named `maria` created in the dialog can manage
    accounts like `admin`.

### The user list

- R16: Every account must be able to open the user list `/users` from the header entry "Users". An admin must see
  each account's name, type, creation time and whether its password change is pending; a user must see each account's
  name, type and creation time only.
  - Acceptance: an admin and a user both see every account, admins included, in the same order as today; the column
    of the pending password change and the button "New user" are shown to admins only.
- R8: A user must not create accounts.
  - Acceptance: a user sees no "New user"; `/users?action=create` shows a user the not-found page; a crafted request
    of a user to create an account creates nothing.

### What an admin can reach

- R5: An admin must be able to see the user list and create accounts, and nothing of the content: no folder, tab, page
  or deleted page, not even their names.
  - Acceptance: an admin who opens any address under `/folders` or `/deleted-pages`, with or without an action or a
    view, sees the not-found page, also for folders and pages that exist; no form or action of the content works for
    an admin.
- R6: An admin must have no API tokens and no connected apps, and must not be able to create them.
  - Acceptance: `/account` of an admin shows the user name and no token list and no "New token"; a request of an admin
    to create a token is refused; `/mcp` gives an admin nothing to read.
- R11: An admin who reaches the OAuth consent page with a valid request must be told that admin accounts cannot connect
  apps, and must be able to return to the app with a refusal.
  - Acceptance: the consent page of an admin shows this message instead of the consent form, with the link "Return to
    <host>" that carries the OAuth error `access_denied` to the app, like the other errors of the page; no grant is
    created. An unknown client or a foreign redirect address is answered as today, without sending the browser
    anywhere.
- R12: The login, the forced password change and `/` must lead an admin to the user list `/users`, and the header of an
  admin must show "Users", the user name and "Log out", but no "Folders".
  - Acceptance: an admin who logs in lands on `/users`, also after changing the first password; `/` leads an admin to
    `/users`; the header of an admin has no "Folders" entry. For a user they lead to `/folders` as today, and the
    header of a user shows "Folders" and "Users".
- R13: A way back after the login (`next`) to an address under `/folders` or `/deleted-pages` must lead an admin to
  `/users` instead.
  - Acceptance: an admin who logs in at `/login?next=/folders/team`, with or without a first password to change, lands
    on `/users`; a user lands on `/folders/team` as today.

### What a user can reach

- R7: A user must be able to do everything with folders, tabs, pages and deleted pages that every account can do today,
  and keep API tokens, connected apps and MCP.
  - Acceptance: the existing content, token, MCP and OAuth behaviour is unchanged for a user.

### Existing installations

- R9: When the feature is installed, the account `admin` must become an admin and every other account a user.
  - Acceptance: after the update `admin` sees the user list with every account and no content; every other account
    sees the content as before.
- R10: When the feature is installed, the API tokens and connected apps of the account `admin` must be removed.
  - Acceptance: after the update `admin` has no tokens and no grants, and a token that `admin` held before is refused
    by `/mcp`.

## Scope

- In: the two types, the choice of the type when creating an account, what each type can reach, more than one admin,
  the user list for every account, and the update of existing installations.
- Not in: changing the type of an account; password reset by the admin and deactivating users (both stay in
  `roadmap.md`); rights per folder; a name for the first admin other than `admin`; a filter of the user list; an MCP
  tool that lists accounts.

## Effect on existing features

- Users and login (`users-and-login.md`): the admin is no longer the one account named `admin` but every account of
  the type admin. These rules change: there is exactly one admin; the admin sees and changes all content; the decision
  on the fixed name `admin`; `/users` and the header entry "Users" are for the admin only (now every account sees the
  list, and only "New user" is for admins); a login leads every account to `/folders`.
- Content structure, pages and page deletion: an admin reaches none of it. Content that an admin edited before keeps
  showing that admin's name as its last editor.
- API tokens: an admin has none; the tokens and grants of `admin` are removed on the update.
- MCP and OAuth: `/mcp` serves users only, and the consent page refuses admins with `access_denied`.

## Decisions

- An admin sees no content at all, not even folder names, as the cleanest line between running the wiki and reading
  it. Whether admins see folder names is decided again when rights per folder come. Rejected: an admin who sees the
  folder list without its contents.
- Admins have no API tokens and no connected apps, because the only thing a token reaches today is the content through
  MCP. Rejected: tokens for admins that every request would refuse.
- The feature covers only the type split. Password reset by the admin and deactivating users stay features of their
  own.
- The first admin keeps the name `admin`, so that the admin setup still needs only `HIPPOWIKI_ADMIN_PASSWORD`; the type,
  not the name, decides what an account may do. Rejected: a setting for the name of the first admin.
- A content address shows an admin the not-found page, so that it reveals nothing, not even whether an item exists.
  Rejected: a page that says admins cannot see content.
- The consent page tells an admin why no app can be connected and leads back to the app with a refusal, so that the
  connector does not wait for an answer that never comes. Rejected: the not-found page.
- The "New user" dialog preselects "User", because most accounts are users and an admin is then created on purpose.
  Rejected: no preselection.
- An admin starts on the user list, the only page with work for an admin, also when the login carries a way back to
  the content, so that the login does not end on the not-found page. Rejected: starting on `/account`, and following
  the way back to the not-found page.
- Every account sees the user list with the types, so that users know who works in the wiki and whom to ask for an
  account. The list is the same page for both types, so that there is one list to keep. Rejected: a user list for
  admins only, and a separate page for users.
- Users see the name, type and creation time, but not whether a password change is pending, because that column marks
  the accounts that still use a generated first password. Rejected: the same columns as admins, and name and type only.
  Accepted: every user sees every login name, admins included; the waits after failed logins hold back guesses for
  any name (see `users-and-login.md`).
- A request with no or an unknown type is refused instead of creating a user, so that a broken or crafted request is
  noticed. Rejected: falling back to "User".
- The log names the type of a new account and its creator, so that a new admin is easy to spot.
- MCP keeps reading content only. Rejected for now: a tool that lists accounts.

## Open questions
