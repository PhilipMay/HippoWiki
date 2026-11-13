# API Tokens – Steps

## Goal

Every user can create long-lived API tokens for scripts and tools, such as an MCP client, see them and revoke them on
a page of their own account. A token stands for its user, is limited to the scopes chosen at creation and ends on its
own after 30, 90 or 365 days. This plan builds the tokens and the check of a bearer token; the MCP server is the first
caller of the check.

## Scope

- In:
  - A model `ApiToken`: owner, name, scopes, expiry, last use, creation time and the SHA-256 hash of the token. The
    token itself is never stored.
  - A new feature `src/features/tokens/` with `schema.ts`, `service.ts`, `forms.ts`, `queries.ts`, `actions.ts` and
    `components/`.
  - Creating a token with a name, the scopes `read` and `write` (at least one; `read` ticked by default) and an expiry
    of 30, 90 or 365 days (90 by default). The token is shown exactly once.
  - Listing the own tokens with name, scopes, creation time, expiry (or "Expired") and last use.
  - Revoking an own token, which deletes it.
  - The check of a bearer token, `authenticateToken(headers, scope)` in the token service: it returns the `Actor` of
    the token's user, or a code for a missing or bad token and for a missing scope.
  - The own-account page `/account`: the user name and the token section. The user name in the header links there.
  - At most 20 tokens per user, expired ones included.
- Not in:
  - Any route or endpoint that accepts a token, and any change to `src/proxy.ts`: the MCP plan adds the first one.
  - "Bearer token sessions" of the roadmap: a token is not a Better Auth session.
  - Ending tokens on a password change: only revoking and expiry end a token.
  - Tokens that never expire, and expiry dates other than the three choices.
  - Seeing or revoking the tokens of other users, also for the admin.
  - Changing the own password on `/account` (the roadmap item "Own password change").
  - OAuth, CORS, rate limits of requests with a token, an audit log.

## Checklist

- [x] Token model and service
- [ ] Check of a bearer token
- [ ] Own-account page
- [ ] Wrap-up

## Token model and service

### Goal

Tokens can be created, listed and revoked through the token service, with every rule of the scope checked there.

### Build

- `prisma/schema.prisma`: model `ApiToken` with a UUID id, `userId` (relation to `User`, `onDelete: Cascade` like the
  sessions), `name`, `scopes` (a list of strings), `tokenHash` (unique), `expiresAt`, `lastUsedAt` (nullable) and
  `createdAt`, times as `timestamptz(3)`, an index on `userId`. Migration
  `npm run db:migrate -- --name add_api_tokens`.
- `src/lib/db-errors.ts`: a constant for the unique index on `tokenHash`, as `testing.md` asks for every unique
  constraint.
- `src/features/tokens/schema.ts`: the token id (`parseTokenId`), the scopes `read` and `write`, the expiry choices
  `30d`, `90d`, `365d` with `90d` as default, and the input schema for a new token: a trimmed name of 1 to 50
  characters, at least one scope, no scope twice, one of the expiry choices. Field errors for name, scopes and expiry.
- `src/features/tokens/secret.ts` (server only): generates a token as the prefix `hw_` followed by 32 random bytes of
  `node:crypto` in base64url, and hashes a token with SHA-256. A token has 256 bits, so a slow hash such as Argon2 is
  not needed, and a lookup by hash is safe.
- `src/features/tokens/service.ts`, all functions take the acting user first and only ever touch the actor's own
  tokens:
  - `listTokens(actor)`: the actor's tokens, newest first, with the fields of the list, never the hash.
  - `createToken(actor, input)`: checks the actor's id, validates the input, refuses with `limit-reached` when the
    actor holds 20 tokens, computes `expiresAt` from the expiry choice, stores the hash and returns the stored token
    together with the token itself. The token leaves the service this once and is never logged.
  - `revokeToken(actor, id)`: deletes the token only if it belongs to the actor (`deleteMany` with id and user, count
    checked); `token-not-found` otherwise, also for a malformed id and the token of another user, which are told
    apart from each other in the log only.
  - Codes: `invalid-input`, `limit-reached`, `token-not-found`, `failed`; each write declares its own error type.
  - Logging as `architecture.md` describes: created and revoked tokens with user id and token id, never the token or
    its hash.
- `src/features/services.test.ts`: add the token service.

### Test

- Unit: `src/features/tokens/schema.test.ts` (names, scopes, expiry choices, ids); `secret.test.ts` (prefix, length,
  alphabet, two tokens differ, the hash is the SHA-256 of the token); `service.test.ts` (malformed ids never reach the
  database, invalid input writes nothing, the limit, the computed expiry with fake timers, what is stored, the codes
  of database errors, what is logged and that no token and no hash is logged).
- Integration: `integration/token-service.test.ts`: create, list and revoke on real data; a user sees only their own
  tokens and cannot revoke another user's; the 21st token is refused; deleting a user deletes its tokens; the read
  returns exactly the declared fields (`toStrictEqual`). `integration/db-errors.test.ts`: a case for the new unique
  constraint.
- End-to-end: none, nothing in the app uses the service yet; the step changes `prisma/schema.prisma`, so the complete
  `npm run test:e2e` runs (see "When a step is done" in `workflow.md`).

## Check of a bearer token

### Goal

A caller other than the browser, such as the MCP server, can find out from the `Authorization` header which user a
request acts for, with what scope.

### Build

- `authenticateToken(headers, scope)` in `src/features/tokens/service.ts`, returning `Result<Actor, ...>`:
  - Reads `Authorization: Bearer <token>` from the `Headers`; the scheme is matched without regard to case, as
    RFC 6750 allows. A missing header, another scheme or a value that does not look like a token gives
    `missing-token` without asking the database.
  - Looks up the hash of the token. An unknown token, an expired one and one whose user still has the first password
    give `invalid-token`. The first password counts as invalid because `requireUser()` lets such a user do nothing
    but change it.
  - A token without the asked scope gives `insufficient-scope`. `write` does not include `read`.
  - Sets `lastUsedAt` at most once a minute per token (a conditional `updateMany`), so that a burst of requests does
    not write on every one. A failure of this write is logged and does not refuse the request.
  - Logs a refused token with the reason and the token id when it is known, never the token; a missing header is not
    logged.
  - A failing database read gives `failed`.
- The comment of the function says what the MCP route will do with the codes: `missing-token` and `invalid-token` as
  401 with `WWW-Authenticate: Bearer`, `insufficient-scope` as 403.

### Test

- Unit: `service.test.ts`: the parsing of the header (missing, other scheme, lowercase `bearer`, extra spaces, a value
  without the prefix), each code, the throttle of `lastUsedAt` with fake timers, a failing `lastUsedAt` write that
  still returns the actor, what is logged and that no token is logged.
- Integration: `integration/token-service.test.ts`: a created token authenticates with the right scope and returns the
  same actor as the session of its user would (`id`, `name`); refused once it is revoked, once it has expired (clock
  set past `expiresAt`), for a user with the first password, and for a scope it lacks; `lastUsedAt` is set by the first
  use and not again within the minute.
- End-to-end: none, no route calls it yet.

## Own-account page

### Goal

Every logged-in user manages their own tokens at `/account`.

### Build

- `src/lib/addresses.ts`: `accountPath(action?)`, and the address of the revoke dialog of a token,
  `/account?action=revoke&token=<id>`.
- `src/features/tokens/queries.ts`: `listTokens()` (`connection()`, `requireUser()`, service).
- `src/features/tokens/forms.ts` and `actions.ts`:
  - `createToken`: parses the form (name, scope checkboxes, expiry radio buttons) and returns the created token in its
    form state without redirecting, like `createUser`: the token is not part of an address or a stored page.
  - `revokeToken`: bound to the id; on success revalidates `/account` and redirects there; `token-not-found` shows the
    not-found page.
  - Every code gets its form state, messages in `actions.ts`.
- `src/app/account/page.tsx`: `requireUser()` first; the heading with the user name, the token list and a "New token"
  button. Actions `create` and `revoke`; `revoke` needs a `token` parameter that is a token of the user, otherwise the
  page is not found, as for any other action or view.
- Components in `src/features/tokens/components/`:
  - `TokenList`: name, scopes, created, expires or "Expired", last used or "Never"; a revoke link per token; an empty
    state.
  - `CreateTokenDialog`: name, scope checkboxes, expiry choice; after creating, the token with a copy button and the
    warning that it is shown only this once; closes only through its link once the token is shown, like
    `CreateUserDialog`. Controlled checkboxes and radio buttons, so the action is called in `onSubmit` inside
    `startTransition` (see "UI" in `architecture.md`).
  - `RevokeTokenDialog`: names the token and says that tools using it stop working at once.
  - All controls locked until hydration (`useHydrated()`).
- `src/components/AppHeader.tsx`: the user name links to `/account`, but not while the first password is still to
  change (that address would only lead to the password change).

### Test

- Unit: `forms.test.ts` (the parser: missing fields, files, unknown scopes and expiry); `actions.test.ts` (without a
  user no service call, every code's form state, revalidation and redirect on revoke, a malformed id never reaches the
  service); `queries.test.ts` (order of `connection()`, `requireUser()` and the service); `addresses.test.ts` for the
  new addresses.
- End-to-end, new `e2e/account.spec.ts`:
  - the page shows the user name and an empty list; the header link leads there
  - creating a token with the defaults shows it once, with the `hw_` prefix; after closing it is listed with `read`,
    90 days and "Never" used, and the token is not on the page any more; the database holds only its hash
  - field errors: empty name, too long name, no scope; the entered values stay
  - the 21st token is refused with a message
  - an expired token is listed as "Expired"
  - revoking asks first; after confirming, the token is gone from the list and the database
  - another user's token id in the revoke address, a malformed id and an unknown action show the not-found page
  - a user sees only their own tokens; the admin as well
- `e2e/access.spec.ts`: `/account` and `/account?action=create` lead to the login page without a login.
- `e2e/hydration.spec.ts`: the "New token" dialog is locked until hydration.
- The specs that test the header (`e2e/login.spec.ts`, `e2e/users.spec.ts`, `e2e/change-password.spec.ts`) run as
  well, because `AppHeader.tsx` changes.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/api-tokens.md` (see "Feature specs" in `workflow.md`), or extend an existing
   feature spec; update `architecture.md`, `testing.md` or `tech.md` where conventions changed. Here: the feature
   `tokens` in "Layout" of `architecture.md`, `authenticateToken()` as the way a caller other than the browser finds
   its actor in "Login and sessions", and `/account` in "Addresses and actions"; in `users-and-login.md` the header
   link and, under "Current limits", that the tokens of a user are not ended by a password change and that ending them
   on deactivating a user comes with that feature.
2. Remove the feature from `roadmap.md`: "Long-lived API tokens" and "Own account view"; add to "Deactivating and
   reactivating users" that it must stop the user's tokens.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file.

### Test

- The commands in "When a step is done" in `spec/workflow.md` pass.
