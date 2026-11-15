# User Types – Steps

## Goal

Every account is either an admin or a user, chosen when the account is created and never changed. An admin manages
the accounts and sees no content, has no tokens and no connected apps; a user works with the content and holds tokens
and apps, but creates no accounts. There can be any number of admins, and every account sees the user list with the
types.

The requirements are in `spec/user-types-requirements.md` (status `approved`); every requirement ID is covered by a
step below.

## Scope

- In: the type of an account and its update for existing installations, the user list for every account, where the
  login leads each type and the header of each type, no content for admins, the choice of the type in the "New user"
  dialog, more than one admin, no tokens and no connected apps for admins, `/mcp` and the consent page refusing admins.
- Not in: changing the type of an account; password reset by the admin and deactivating users; rights per folder; a
  name for the first admin other than `admin`; a filter of the user list; an MCP tool that lists accounts; any admin
  task through MCP or a token.

## Checklist

- [x] Account types in the database
- [ ] The user list for every account
- [ ] Where the login leads
- [ ] No content for admins
- [ ] Choosing the type of a new account
- [ ] No tokens and no apps for admins
- [ ] Wrap-up

## Account types in the database

### Goal

Every account has a type, admin or user, that the database keeps from its creation on, and the type, not the name,
decides who is an admin. Existing installations get their types: `admin` becomes an admin without tokens and grants,
every other account a user (R1, R4, R9, R10, R19).

### Build

- `prisma/schema.prisma`: an enum `UserType` with `admin` and `user`, and a required column `type` on `User` without a
  default, so that every write that creates a user has to name it. The comment of `username` no longer says that the
  admin is the user named `admin`.
- A migration written by hand (see "Database" in `architecture.md`), in this order:
  - create the enum and add the column as nullable;
  - set `admin` for the account named `admin` and `user` for every other account (R9);
  - make the column `NOT NULL`;
  - delete the rows of `ApiToken` (tokens and grants) and of `OAuthCode` of the account named `admin` (R10);
  - a trigger on `User` that raises an error when an `UPDATE` changes `type` (`NEW.type IS DISTINCT FROM OLD.type`),
    so that no code and no command can change a type (R19). Writes of Better Auth that do not touch the type, such as
    the update of `updatedAt`, pass.
- `src/features/users/user-type.ts`, without server-only imports and without the list of common passwords, so that
  Client Components and `src/lib/addresses.ts` can import it: `USER_TYPES`, the type `UserType` and `isAdmin(user)`,
  which now decides by `user.type`. `ADMIN_NAME` stays in `schema.ts` as the name of the first admin only.
- `src/lib/auth.ts`: `type` as an additional field of the user (`input: false`, like `mustChangePassword`), so that
  Better Auth reads it with the session; check that it reads the enum column as a string.
- `SessionUser` (auth service) and `Actor` (users service) get `type`; `toSessionUser()` takes it from the Better Auth
  user, and a user without a known type is refused like a missing session (the safe side). `authenticateToken()`
  returns the type with the actor.
- `src/features/users/records.ts`: `newUserData()` takes `type`. `ensureAdmin()` creates `admin` with the type admin
  and, as today, leaves an existing account named `admin` as it is, its type included (R4, R19). `createUser()` creates
  users of the type `user` until "Choosing the type of a new account".
- `prisma/known-users.ts`: each known user gets its type (`KNOWN_ADMIN` admin, `KNOWN_USER` user). `prisma/seed.ts`
  sets the type when it creates a known user and never in the update of its upsert; the sample folder and pages get
  `alice` as their last editor, because admins no longer edit content.
- `e2e/support/database.ts`: `createUser()` takes `type`, `user` by default; `resetTestDatabase()` creates the known
  users with their types. `e2e/smoke.spec.ts` checks the types of the known users.
- Every place that builds an `Actor` or a `SessionUser`, in code and tests, adds the type.

### Test

- Unit: `toSessionUser()` with each type and with a missing or unknown type; `isAdmin()` decides by the type, not by
  the name (an admin named `maria`, a user named `admin` in a test double); `newUserData()` writes the type;
  `ensureAdmin()` creates the admin with the type admin; `authenticateToken()` returns the type.
- Integration (`integration/user-service.test.ts`): `ensureAdmin()` creates `admin` as an admin and leaves an existing
  `admin` as it is; a Prisma update that changes the type of a user is refused by the database and changes nothing,
  also for a user created by `createUser()`; an update of another field of the user passes. `integration/auth-service.test.ts`:
  the session user of a login carries the type.
- End-to-end: `e2e/smoke.spec.ts` (types of the known users); `e2e/users.spec.ts`, `e2e/login.spec.ts` and
  `e2e/access.spec.ts` pass with the admin found by its type. The step changes `prisma/schema.prisma`, a migration and
  `e2e/support/`, so the complete suite runs.
- Manual, on the development database: seed it, give `admin` a token and a grant and `alice` a token, run
  `npm run db:migrate`, then check with `npm run db:psql` that `admin` is an admin with no rows in `ApiToken` and
  `OAuthCode`, that `alice` is a user with her token, and that `UPDATE "User" SET type = 'user'` is refused.

## The user list for every account

### Goal

Every account opens the user list from the header and sees every account with its type and creation time; only an
admin sees whose password change is pending and the button "New user", and only an admin creates accounts (R1, R8,
R16).

### Build

- Users service: `listUsers(actor)` returns every account for every actor, in the same order as today, with name,
  type and creation time. The pending password change is part of the result only for an admin, so that it never
  reaches the page of a user (for example a `UserSummary` with `mustChangePassword` for admins and a list entry without
  it for users, as types of the service). `createUser()` stays for admins only (`not-allowed`).
- `src/app/users/page.tsx`: the list for every logged-in account; the button "New user" and `?action=create` only for
  an admin, the not-found page for a user (R8).
- `UserList`: a column with the type ("Admin" or "User") for everyone, the mark of the pending password change only
  when the entries carry it.
- `AppHeader`: the entry "Users" for every account whose password change is done.
- Move `becomeNormalUser()` from `e2e/users.spec.ts` into `e2e/support/auth.ts` as `becomeUser(context, storageState)`,
  so that later steps can submit a form with the login of the admin as well.

### Test

- Unit: `listUsers()` for an admin and for a user, with and without the pending password change; the query passes the
  actor.
- Integration: `listUsers()` returns every account with its type for both types, and the pending password change only
  for an admin.
- End-to-end (`e2e/users.spec.ts`): an admin sees every account with its type, creation time and pending password
  change; a user sees every account, admins included, with type and creation time, in the same order, without the
  column of the pending password change and without "New user"; `/users?action=create` shows a user the not-found
  page; a submission of the form with the login of a user creates nothing (as today); both types have the header entry
  "Users". The step changes `e2e/support/`, so the complete suite runs.

## Where the login leads

### Goal

An admin lands on the user list after the login, after the first password change and on `/`, also when the way back
points to the content, and the header of an admin has no "Folders"; a user lands where a user lands today (R12, R13).

### Build

- `src/lib/addresses.ts`: `landingPath(next, user)`, a pure function: for an admin, a way back that is `/` or lies
  under `/folders` or `/deleted-pages` (judged by its path, not by its query string) becomes `/users`; every other way
  back, and every way back of a user, stays as it is. It takes the type from `user-type.ts`, so `addresses.ts` stays
  free of server-only imports.
- Use it wherever a login or a password change leads on: the login action (`logIn`), the login page for a user who is
  logged in already, the password change page and its action (`changeFirstPassword`, also for `not-required`), and
  `src/app/page.tsx`, which leads an admin to `/users` and a user to `/folders`.
- `AppHeader`: "Folders" only for a user; an admin has "Users", the user name and "Log out".

### Test

- Unit: `landingPath()` for both types with `/`, `/folders`, `/folders/team`, `/folders/team?action=create`,
  `/deleted-pages/team`, `/folderstuff`, `/users`, `/account` and `/oauth/authorize?…`; the login action and the
  password change action redirect an admin to `/users` and a user to the way back.
- End-to-end: `e2e/login.spec.ts`: an admin who logs in lands on `/users`, also at `/login?next=/folders/team`; a user
  lands on `/folders/team`; an admin who is logged in already and opens `/login` goes to `/users`.
  `e2e/change-password.spec.ts`: a new admin (created with `createUser({ type: "admin" })`) lands on `/users` after the
  first password change, also with a way back to `/folders/team`. `e2e/access.spec.ts`: `/` leads an admin to `/users`
  and a user to `/folders`. `e2e/users.spec.ts`: the header of an admin has no "Folders", the one of a user has
  "Folders" and "Users". The root layout renders the header, so the complete suite runs.

## No content for admins

### Goal

An admin reaches no folder, tab, page or deleted page, not even their names, through any address, form or action,
while a user keeps everything (R5, R7). The check lives in the services, as "Reads and writes" in `architecture.md`
asks.

### Build

- The folders and pages services: every function takes the actor as its first argument, the reads included.
  - A read returns `null` for an admin and does not ask the database; the lists change their type to `… | null`. For
    a user nothing changes.
  - A write returns `not-allowed` for an admin as its first check, before ids and input, logs a warning with the actor
    id and writes nothing, like `createUser()`. The error types of the writes (`CreateFolderError` and the others) get
    the code.
  - The check is `isAdmin()` from `user-type.ts`; pure helpers such as `directPagesFirst()` stay without an actor.
- The queries of folders and pages pass the user of `requireUser()`; every route under `/folders` and
  `/deleted-pages` shows the not-found page when a read returns `null`, for every action and view of the address.
- The actions of folders and pages map `not-allowed` to `notFound()`.
- The MCP tools pass their actor to the reads as well and answer `null` and `not-allowed` like a missing item.
  `/mcp` refuses admins only in "No tokens and no apps for admins"; until then an admin token reaches tools that show
  nothing.

### Test

- Unit: every read and write of both services for an admin (`null` or `not-allowed`, no database call, the warning of
  a write) and for a user (unchanged); every query passes the actor; every action maps `not-allowed` to the not-found
  page; the MCP tools with a `null` read.
- Integration (`integration/folder-service.test.ts`, `integration/page-service.test.ts`): the existing cases with a
  user actor, and one read and one write per service with an admin actor that returns `null` or `not-allowed` and
  changes nothing.
- End-to-end:
  - `e2e/access.spec.ts`, with the saved login of the admin: every kind of address under `/folders` and
    `/deleted-pages` that the spec lists, with and without an action or a view, shows the not-found page, also for a
    folder, tab, page and deleted page that exist; this replaces the test "the content opens".
  - Crafted requests: a user opens the form, the browser gets the login of the admin (`becomeUser()`), and the
    submission shows the not-found page and writes nothing, for creating a folder (`e2e/folders.spec.ts`), editing a
    page (`e2e/edit-page.spec.ts`) and restoring a page (`e2e/restore-page.spec.ts`).
  - Every other content spec passes unchanged for a user (R7). The step changes the services every content page
    reads, so the complete suite runs.

## Choosing the type of a new account

### Goal

An admin chooses the type of every new account in the "New user" dialog, with "User" preselected and a note that the
type is final; a request without a valid type creates nothing; the log names the type and the admin who created the
account; and a second admin can manage accounts like `admin` (R2, R3, R4, R14, R15, R19).

### Build

- `src/features/users/schema.ts`: `userInputSchema` gets `type`, an enum of `USER_TYPES` without a default, with its
  own message for a missing or unknown type (R14).
- `src/features/users/forms.ts`: `parseUserFormData()` reads the field `type`; a missing field and a file count as
  missing. The form state keeps the type of the created user.
- Users service: `createUser(actor, { name, type })` stores the type; the log line of a new account names the new user
  name, its type and the user name of the admin, and never the password (R15).
- `CreateUserDialog`: a radio group "User" and "Admin" with "User" checked when the dialog opens, and the note that
  the type cannot be changed later. The radio buttons are controlled, so the form calls its action in `onSubmit`
  inside `startTransition` (see "UI" in `architecture.md`); they stay disabled until hydration. The error of the type
  is shown at the radio group. After the creation the dialog names the type with the user name.
- No page, dialog, action or service function offers to change a type (R19); the dialog only chooses it once.

### Test

- Unit: `userInputSchema` with each type, without a type and with an unknown one; `parseUserFormData()` with the
  field missing, empty, unknown and a file; `createUser()` stores the given type and logs name, type and the admin's
  name without the password; the action maps the field error of the type.
- Integration: `createUser()` creates an admin and a user with their types; a second admin created this way lists
  users and creates a user (R2, R4).
- End-to-end (`e2e/users.spec.ts`):
  - the dialog opens with "User" checked and says that the type is final; a new user and a new admin appear with
    their types in the list;
  - a crafted submission without a type and with an unknown type shows the error at the type, keeps the dialog open
    and creates no account (R14);
  - the type chosen before a name error is kept when the name is corrected;
  - the whole chain for a new admin named `maria`: logs in, changes the password, lands on `/users`, sees no
    "Folders", creates a user (R2, R4).
- End-to-end (`e2e/hydration.spec.ts`): the radio buttons of the dialog are disabled until hydration.
- Manual: the log line of a created admin names the type and the creating admin, and no password.

## No tokens and no apps for admins

### Goal

An admin has no API tokens and no connected apps and cannot get any; `/mcp` refuses every token of an admin; the
consent page tells an admin that admin accounts cannot connect apps and leads back to the app with a refusal; no admin
task is reachable with a token. A user keeps tokens, apps and MCP as they are (R6, R7, R11, R17, R18).

### Build

- Token service: `listTokens(actor)` returns `null` for an admin; `createToken()` and `revokeToken()` return
  `not-allowed` for an admin and write nothing.
- `authenticateToken()` refuses a token or access token whose account is an admin with `invalid-token`, and logs the
  reason `admin`, next to the check of the first password, so that `/mcp` answers 401 with `error="invalid_token"`
  even if such a token existed (R17).
- `src/app/account/page.tsx`: for an admin the user name only, no token list and no "New token";
  `?action=create` and `?action=revoke` show an admin the not-found page. The token actions map `not-allowed` to
  `notFound()`.
- OAuth service: `createCode()` refuses an admin with `refused` and the error `access_denied`, after the checks of the
  client and the redirect address, and writes no code.
- `loadConsent()`: for an admin with an otherwise valid request it returns `refused` with the message that admin
  accounts cannot connect apps and the address of the client with `access_denied`, `state` and `iss`; an unknown
  client or a foreign redirect address stays `untrusted` as today (R11).
- R18: the MCP tools stay content tools only; the creation of accounts stays an action that needs the session of an
  admin. Nothing to build beyond the checks above; the tests show it.

### Test

- Unit: the token service for an admin (`null`, `not-allowed`, nothing written); `authenticateToken()` with a token and
  an access token of an admin; the account actions map `not-allowed`; `createCode()` for an admin; `loadConsent()`
  for an admin with a valid request, an unknown client and a foreign redirect address; the MCP adapter answers 401 and
  `invalid_token` for an admin; the list of MCP tools has no tool for accounts.
- Integration (`integration/token-service.test.ts`, `integration/oauth-service.test.ts`): an admin cannot create a
  token or a code; a token and a grant inserted for an admin are refused by `authenticateToken()`.
- End-to-end:
  - `e2e/account.spec.ts`: `/account` of an admin shows the name and no token list and no "New token";
    `?action=create` is not found for an admin; a crafted submission of the "New token" form with the login of the
    admin creates no token. The tests that used the admin as "another user" use a second user from `createUser()`.
  - `e2e/mcp.spec.ts`: a token that is inserted for an admin with `createApiToken()` gets 401 and
    `error="invalid_token"` and reaches no tool; `tools/list` of a user offers no tool for accounts; a request with
    the bearer token of a user to `/users?action=create` without a session cookie leads to the login page and creates
    nothing (R18).
  - `e2e/oauth.spec.ts`: an admin on the consent page with a valid request sees the message and "Return to <host>",
    which brings `access_denied` to the client, and no code or grant is created; an admin with an unknown client sees
    the error of today without being sent anywhere; the flow of a user is unchanged.
  - `e2e/hydration.spec.ts` and the other specs that use tokens pass for a user.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs" in `step-plan-workflow.md`), or extend an
   existing feature spec, and move the rules and decisions of the requirements file that still hold into it; update
   `architecture.md`, `testing.md` or `tech.md` where conventions changed.
   - `users-and-login.md` is extended: the two types and their fixed choice, more than one admin, the admin setup,
     the user list for every account, where the login leads each type, the header, the log line, the update of
     existing installations and the decisions of the requirements file.
   - `content-structure.md`, `pages.md` and `page-deletion.md`: an admin reaches none of it; the last editor keeps an
     admin's name.
   - `api-tokens.md`, `mcp.md` and `oauth.md`: no tokens and grants for admins, the refusal at `/mcp` and on the
     consent page, and the lasting rule that admin tasks never go through MCP or a token.
   - `container-image.md`: the admin setup creates `admin` as an admin; what the update does to an existing
     installation.
   - `architecture.md`: `Actor` and `SessionUser` carry the type, content reads take the actor, `user-type.ts`,
     `landingPath()`, the trigger that keeps the type and the examples of "Reads and writes"; `testing.md`:
     `becomeUser()` and the `type` of `createUser()`.
2. Remove the feature from `roadmap.md` ("Admin without content access" and "Several admin accounts").
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and the requirements file of the feature, if there is one.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file and the requirements file.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
