# HippoWiki – Connected Apps

The connected apps as built: every account of the type user sees the AI apps it connected through OAuth on the own
account page `/account`, and revokes them there. A connected app is a grant:
it stands for its user at one MCP address of a folder, limited to the folder and the role of that address and never
more than the user's current role on the folder, until it expires or is revoked. How a grant comes about, and how its
access token and refresh token work, is described in `oauth.md`; the MCP server at the folder addresses, which accepts
the access tokens, in `mcp.md`. An admin has no connected apps and cannot get any. Users and the login are described in
`users-and-login.md`.

Code: `src/features/grants/` (`schema.ts`, `service.ts` with `authenticateAccessToken()`, `forms.ts`, `queries.ts`,
`actions.ts`, the list and the dialog in `components/`), the route `src/app/account/` and the link in
`src/components/AppHeader.tsx`. The model is `OAuthGrant` in `prisma/schema.prisma`. Tests: `e2e/account.spec.ts`,
`e2e/mcp-access.spec.ts`, `e2e/oauth.spec.ts`, `integration/grant-service.test.ts`, and the unit tests next to the code,
such as `src/features/grants/service.test.ts`.

## Connected apps

- A connected app is a grant of the user to an OAuth client at one MCP address: a folder and a role, Reader, Writer or
  Manager. Owner is never the role of a connected app.
  It is named after its client. There are no scopes. The app holds its access token and refresh token itself; only
  their SHA-256 hashes are stored, and neither a token nor a hash is ever shown or logged.
- One app connected to two addresses is two connected apps, each with its own tokens.
- A user holds at most 50 connected apps, expired ones included (`MAX_GRANTS_PER_USER` in
  `src/features/grants/limits.ts`). A new grant that replaces older grants of the same client at the same address is
  counted without them (see "Grants" in `oauth.md`). At the limit the consent page asks the user to revoke an app on the account page
  first and offers no approval; grants made at the same time cannot get past the limit.
- A grant lasts 30, 90 or 365 days, as the user chose on the consent page, where 90 days are preselected
  (`GRANT_LIFETIMES` and `DEFAULT_GRANT_LIFETIME` in `src/features/oauth/schema.ts`). There are no other dates and no grants
  that never end. An expired grant stays in the list, marked as expired, until it is revoked, and counts towards the
  limit.
- Deleting a user, the client or the folder deletes its grants.

## The own apps only

- Every user sees and revokes only their own apps. The service takes the acting user first and only ever touches
  the actor's own grants; nobody, the admin included, sees or revokes the apps of another user.
- Revoking deletes the grant after a confirmation; its access token and its refresh token stop working at once. It
  cannot be undone: the app has to be connected again.
- The list shows each app with its name, the current name of its folder and its role, the time it was connected, its
  expiry or "Expired", and its last use or "never", newest first. The last use is written at most once a minute per grant (`LAST_USE_INTERVAL_MS` in
  `src/features/grants/service.ts`), so it is exact to the minute.

## No apps for admins

- An admin has no grants and cannot get any: the grant service answers the list of an admin with nothing and refuses
  to revoke for an admin, writes nothing and logs it. The consent page of OAuth refuses an admin as well (see
  `oauth.md`).
- The check of an access token refuses every access token whose account is an admin, so that MCP refuses an admin
  even if such a grant existed (see "The check of an access token").
- No admin task is reachable with an access token: grants are for the content only, through MCP, and admin tasks are
  done only in the browser with the session of an admin (see "Account types" in `users-and-login.md`).

## Without a public URL

- Without `HIPPOWIKI_PUBLIC_URL` there is no OAuth and no MCP server (see `oauth.md` and `mcp.md`): no app can connect
  and no grant can be used (`isOAuthOn()` in `src/features/oauth/issuer.ts`). The grant service then answers the list
  of every user with nothing and refuses to revoke, and the action that revokes shows the not-found page.
- The grants stay stored. Once the variable is set again, they are listed, can be revoked and work again.

## The check of an access token

- `authenticateAccessToken(headers, address)` in `src/features/grants/service.ts` is the way for a caller other than
  the browser to find out which user a request to an MCP address acts for. It reads `Authorization: Bearer <token>`;
  the scheme is matched without regard to case, as RFC 6750 allows. The adapter of the MCP addresses calls it for every
  `POST` from an allowed origin while OAuth is on, with the folder and the role of the address (see `mcp.md`).
- It accepts only the access token of a grant. Any other value, a refresh token and a code included, does not look
  like an access token.
- It returns the actor of the grant's user, the same `id`, `name` and type that the session of that user gives, and the
  connection of the grant, its id, folder and role, or one of these codes:
  - `missing-token`: no header, another scheme, or a value that does not look like an access token. The database is
    not asked and nothing is logged.
  - `invalid-token`: an unknown access token, one that or whose grant has expired, one whose user still has the
    first password, who may do nothing but change it, one whose user is an admin, who has no grants, or one of a grant
    to another address, another folder or another role (logged as `other-address`).
  - `role-too-low`: a valid access token for the address whose user has no role on the folder any more, or a role
    below the role of the grant. The user's current role is read on every request. The grant stays and works again
    once the role is high enough again.
  - `failed`: the database could not be read.
- A caller answers `missing-token` and `invalid-token` with 401 and `WWW-Authenticate: Bearer`, and `role-too-low`
  with 403 without a challenge.
- A refused access token is logged with the reason and, where it is known, the grant id; `role-too-low` also with the
  folder, the role of the grant and the user's role.
- The last use is written only for an accepted access token.
- A failure to write the last use is logged and does not refuse the request.

## Own account page

- `/account` shows the user name and the list of "Connected apps", each with its folder and role; it speaks of apps,
  not of tokens. Without apps it says only that no app is connected yet: how to connect one is in the README and in
  the view "AI apps" of a folder. The user name in the
  header links there, except while the first password is still to change, because the address would only lead to the
  password change.
- `?action=revoke&app=<id>` opens the "Revoke app" dialog of an app of the user. Any other action, a view, the
  parameter `token`, an `app` without `revoke` and an id that is malformed, unknown or another user's show the
  not-found page.
- Like every other page, `/account` needs a login.
- `/account` of an admin, and of every user while `HIPPOWIKI_PUBLIC_URL` is not set, shows the user name only, with
  no list; every action and every `app` shows the not-found page.

## Decisions

- An AI app reaches the MCP server only through OAuth, as an app the user approved, not with a token the user
  copies by hand: one way in instead of two, no long-lived secret on the clipboard, and less code to keep secure.
  Headless clients and clients without OAuth lose access, accepted by the user; a later feature can bring a
  replacement (see `roadmap.md`).
- An access token is hashed with SHA-256 and not with Argon2 like a password: it has 256 random bits, so there is
  nothing to guess, and a fast hash can be looked up directly by its value.
- A grant is not a session of Better Auth (see "Access for clients without OAuth" in `roadmap.md`): it has an address and a lifetime
  of its own and is approved on purpose by the user, while a session is the login of one browser.
- Revoking deletes the row instead of marking it, so a revoked grant cannot come back by mistake and the limit counts
  only grants that still exist.
- The limit of connected apps leaves room for one connection per folder, role and app, and it counts expired grants
  too, so that an AI app that registers again on every connect cannot pile up rows and the user cleans up the list.
  Rejected: no limit, and keeping 20.
- The consent page and `/account` both name the folder and the role, so that a user sees which agent may write where.
  Rejected: naming them on the consent page only.
- The revoke address names `app` instead of `token`, so that the address matches what the page shows. Rejected:
  keeping `token`.
- The message of an empty list is short, without an MCP address; the view "AI apps" of a folder and the README explain
  how to connect. Rejected: the addresses and instructions on the account page.
- While `HIPPOWIKI_PUBLIC_URL` is not set, `/account` shows the user name only, because no app can connect and no
  grant can be used. Rejected: the list with a note, which would keep old grants revocable while they cannot be used
  anyway.
- The access token of a user with the first password is refused, because `requireUser()` lets such a user do nothing
  but change it; an access token must not be a way around that.
- Admins have no grants, because the only thing a grant reaches is the content through MCP, which admins do not see.
  The check of an access token looks at the type of the account as well, as a second line behind "admins have no
  grants", so that a leaked access token can never act for an admin.
- The last use is written at most once per interval and with a conditional write, so that a burst of requests does
  not write on every one.
- The check of an access token lives in the grant service, not in `src/proxy.ts`, so that the MCP route decides itself
  how it answers; `src/proxy.ts` only lets the addresses below `/mcp` pass and does not look at the header.
- A connection above the current role is refused but kept, so that nothing is deleted behind the user's back and a
  role given back restores it (see "Decisions" in `mcp.md`).

## Current limits

- no access for scripts, CI jobs and AI apps that cannot do OAuth with a browser: no device flow and no client
  credentials (see `roadmap.md`)
- only the MCP server accepts an access token; there is no other API
- a password change ends the grants of a user only when the user chooses so at the change of the own password; the
  forced password change never does, and otherwise only revoking and expiry do
- deactivating a user does not exist yet; when it comes, it must stop the user's grants as well (see `roadmap.md`)
- no renaming of an app and no warning before a grant expires
- expired grants are not deleted by themselves
- an admin cannot see or revoke the apps of users
- no CORS, no rate limits of requests with an access token and no audit log
