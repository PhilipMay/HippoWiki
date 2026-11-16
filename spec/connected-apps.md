# HippoWiki – Connected Apps

The connected apps as built: every account of the type user sees the apps it connected through OAuth, such as the
connector of an AI assistant, on the own account page `/account`, and revokes them there. A connected app is a grant:
it stands for its user, limited to the scope `read`, until it expires or is revoked. How a grant comes about, and how
its access token and refresh token work, is described in `oauth.md`; the MCP server at `/mcp`, which accepts the access
tokens, in `mcp.md`. An admin has no connected apps and cannot get any. Users and the login are described in
`users-and-login.md`.

Code: `src/features/grants/` (`schema.ts`, `service.ts` with `authenticateAccessToken()`, `forms.ts`, `queries.ts`,
`actions.ts`, the list and the dialog in `components/`), the route `src/app/account/` and the link in
`src/components/AppHeader.tsx`. The model is `OAuthGrant` in `prisma/schema.prisma`. Tests: `e2e/account.spec.ts`,
`e2e/mcp.spec.ts`, `e2e/oauth.spec.ts`, `integration/grant-service.test.ts`, and the unit tests next to the code,
such as `src/features/grants/service.test.ts`.

## Connected apps

- A connected app is a grant of the user to an OAuth client. It is named after its client and has only the scope
  `read`. The app holds its access token and refresh token itself; only their SHA-256 hashes are stored, and neither a
  token nor a hash is ever shown or logged.
- A user holds at most 20 connected apps, expired ones included (`MAX_GRANTS_PER_USER` in
  `src/features/grants/service.ts`). A new grant that replaces older grants of the same client is counted without
  them (see "Grants" in `oauth.md`). At the limit the consent page asks the user to revoke an app on the account page
  first and offers no approval; grants made at the same time cannot get past the limit.
- A grant lasts 30, 90 or 365 days, as the user chose on the consent page. There are no other dates and no grants
  that never end. An expired grant stays in the list, marked as expired, until it is revoked, and counts towards the
  limit.
- Deleting a user, or the client, deletes its grants.

## The own apps only

- Every user sees and revokes only their own apps. The service takes the acting user first and only ever touches
  the actor's own grants; nobody, the admin included, sees or revokes the apps of another user.
- Revoking deletes the grant after a confirmation; its access token and its refresh token stop working at once. It
  cannot be undone: the app has to be connected again.
- The list shows each app with its name, the time it was connected, its expiry or "Expired", and its last use or
  "never", newest first. The last use is written at most once a minute per grant, so it is exact to the minute.

## No apps for admins

- An admin has no grants and cannot get any: the grant service answers the list of an admin with nothing and refuses
  to revoke for an admin, writes nothing and logs it. The consent page of OAuth refuses an admin as well (see
  `oauth.md`).
- The check of an access token refuses every access token whose account is an admin, so that `/mcp` refuses an admin
  even if such a grant existed (see "The check of an access token").
- No admin task is reachable with an access token: grants are for the content only, through MCP, and admin tasks are
  done only in the browser with the session of an admin (see "Account types" in `users-and-login.md`).

## Without a public URL

- Without `HIPPOWIKI_PUBLIC_URL` there is no OAuth and no MCP server (see `oauth.md` and `mcp.md`): no app can connect
  and no grant can be used. The grant service then answers the list of every user with nothing and refuses to revoke.
- The grants stay stored. Once the variable is set again, they are listed, can be revoked and work again.

## The check of an access token

- `authenticateAccessToken(headers, scope)` in `src/features/grants/service.ts` is the way for a caller other than
  the browser to find out which user a request acts for. It reads `Authorization: Bearer <token>`; the scheme is
  matched without regard to case, as RFC 6750 allows. The adapter of `/mcp` calls it for every `POST` from an allowed
  origin while OAuth is on (see `mcp.md`).
- It accepts only the access token of a grant. Any other value, a refresh token, a code and a former API token
  included, does not look like an access token.
- It returns the actor of the grant's user, the same `id`, `name` and type that the session of that user gives, or one
  of these codes:
  - `missing-token`: no header, another scheme, or a value that does not look like an access token. The database is
    not asked and nothing is logged.
  - `invalid-token`: an unknown access token, one that or whose grant has expired, one whose user still has the
    first password, who may do nothing but change it, or one whose user is an admin, who has no grants.
  - `insufficient-scope`: a valid access token whose grant lacks the scope that was asked for.
  - `failed`: the database could not be read.
- A caller answers `missing-token` and `invalid-token` with 401 and `WWW-Authenticate: Bearer`, and
  `insufficient-scope` with 403.
- A refused access token is logged with the reason and, where it is known, the grant id.
- A failure to write the last use is logged and does not refuse the request.

## Own account page

- `/account` shows the user name and the list of "Connected apps"; it speaks of apps, not of tokens or scopes.
  Without apps it says only that no app is connected yet: how to connect one is in the README. The user name in the
  header links there, except while the first password is still to change, because the address would only lead to the
  password change.
- `?action=revoke&app=<id>` opens the "Revoke app" dialog of an app of the user. Any other action, a view, the
  parameter `token`, an `app` without `revoke` and an id that is malformed, unknown or another user's show the
  not-found page.
- Like every other page, `/account` needs a login.
- `/account` of an admin, and of every user while `HIPPOWIKI_PUBLIC_URL` is not set, shows the user name only, with
  no list; every action and every `app` shows the not-found page.

## Decisions

- An AI assistant reaches the MCP server only through OAuth, as an app the user approved, not with a token the user
  copies by hand: one way in instead of two, no long-lived secret on the clipboard, and less code to keep secure.
  Headless clients and clients without OAuth lose access, accepted by the user; a later feature can bring a
  replacement (see `roadmap.md`).
- An access token is hashed with SHA-256 and not with Argon2 like a password: it has 256 random bits, so there is
  nothing to guess, and a fast hash can be looked up directly by its value.
- A grant is not a session of Better Auth ("Bearer token sessions" in `roadmap.md`): it has a scope and a lifetime of
  its own and is approved on purpose by the user, while a session is the login of one browser.
- Revoking deletes the row instead of marking it, so a revoked grant cannot come back by mistake and the limit counts
  only grants that still exist.
- The limit of 20 stays for connected apps alone, and counts expired grants too, so that a connector that registers
  again on every connect cannot pile up rows and the user cleans up the list. Rejected: no limit.
- The revoke address names `app` instead of `token`, so that the address matches what the page shows. Rejected:
  keeping `token`.
- The message of an empty list is short, without the address of `/mcp`; the README explains how to connect.
  Rejected: the address and instructions on the page.
- While `HIPPOWIKI_PUBLIC_URL` is not set, `/account` shows the user name only, because no app can connect and no
  grant can be used. Rejected: the list with a note, which would keep old grants revocable while they cannot be used
  anyway.
- The access token of a user with the first password is refused, because `requireUser()` lets such a user do nothing
  but change it; an access token must not be a way around that.
- Admins have no grants, because the only thing a grant reaches is the content through MCP, which admins do not see.
  The check of an access token looks at the type of the account as well, as a second line behind "admins have no
  grants", so that a leaked access token can never act for an admin.
- The last use is written at most once a minute and with a conditional write, so that a burst of requests does not
  write on every one.
- The check of an access token lives in the grant service, not in `src/proxy.ts`, so that the MCP route decides itself
  how it answers; `src/proxy.ts` only lets `/mcp` pass and does not look at the header.

## Current limits

- no access for scripts, CI jobs and MCP clients that cannot do OAuth with a browser: no device flow and no client
  credentials (see `roadmap.md`)
- only the MCP server accepts an access token; there is no other API
- a password change does not end the grants of a user; only revoking and expiry do
- deactivating a user does not exist yet; when it comes, it must stop the user's grants as well (see `roadmap.md`)
- no renaming of an app and no warning before a grant expires
- expired grants are not deleted by themselves
- an admin cannot see or revoke the apps of users
- no CORS, no rate limits of requests with an access token and no audit log
- no change of the own password on `/account` (see "Own password change" in `roadmap.md`)
