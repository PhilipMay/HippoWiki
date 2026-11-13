# HippoWiki – API Tokens

The API tokens as built: every user creates long-lived tokens for scripts and tools, such as an MCP client, sees them
and revokes them on the own account page `/account`. A token stands for its user, limited to the scopes chosen at
creation, until it expires or is revoked. The MCP server at `/mcp` accepts them (see `mcp.md`). The apps that a user
connected through OAuth are grants in the same list (see `oauth.md`). Users and the login are described in
`users-and-login.md`.

Code: `src/features/tokens/` (`schema.ts`, `secret.ts`, `service.ts` with `authenticateToken()`, `forms.ts`,
`queries.ts`, `actions.ts`, the list and the dialogs in `components/`), the route `src/app/account/` and the link in
`src/components/AppHeader.tsx`. The model is `ApiToken` in `prisma/schema.prisma`. Tests: `e2e/account.spec.ts`,
`integration/token-service.test.ts`, and the unit tests next to the code, such as
`src/features/tokens/service.test.ts`.

## Tokens

- A token is the prefix `hw_` followed by 256 random bits of a cryptographic source in base64url
  (`src/features/tokens/secret.ts`). The prefix lets secret scanners and people recognise a token of HippoWiki.
- A token is shown exactly once, in the dialog that created it. It is not part of an address or of a stored page and
  is gone after a reload; the dialog closes only through its link, so that it cannot be lost by a stray click.
- Only the SHA-256 hash of a token is stored. Neither the token nor its hash is ever logged.
- A token has a name of 1 to 50 characters, without surrounding spaces, to tell it apart from the others. Names need
  not be unique.
- A user holds at most 20 tokens, expired ones and grants included (`MAX_TOKENS_PER_USER` in
  `src/features/tokens/service.ts`). Tokens and grants created at the same time cannot get past the limit.
- Deleting a user deletes the user's tokens.

## Grants

- A grant is the access that a user gave an app through OAuth, such as the connector of an AI assistant. It is a row
  of the same table as a token: it is listed on `/account`, counted in the limit and revoked like a token. How it
  comes about, and how its access token and refresh token work, is described in `oauth.md`.
- A grant is named after its app and has only the scope `read`. There is no token to show for it: the app holds its
  tokens itself.
- A row is either a token or a grant, never both; a check constraint of the database makes sure of it.
- The list marks a grant as a connected app. Revoking it ends its access token and its refresh token at once.

## Scopes and expiry

- A token has the scope `read`, `write` or both; at least one. `write` does not include `read`. The "New token" form
  starts with `read` ticked. The scopes are defined in `src/features/tokens/schema.ts`.
- A token expires 30, 90 or 365 days after its creation; the form starts with 90 days. There are no other dates and
  no tokens that never expire.
- An expired token stays in the list, marked as expired, until it is revoked, and counts towards the limit.

## The own tokens only

- Every user sees and revokes only their own tokens, the admin included. The service takes the acting user first and
  only ever touches the actor's own tokens.
- Revoking deletes the token after a confirmation; tools that use it stop working at once. It cannot be undone.
- The list shows each token with its name, scopes, creation time, expiry or "Expired", and its last use or "never".
  The last use is written at most once a minute per token, so it is exact to the minute.

## The check of a bearer token

- `authenticateToken(headers, scope)` in `src/features/tokens/service.ts` is the way for a caller other than the
  browser to find out which user a request acts for. It reads `Authorization: Bearer <token>`; the scheme is matched
  without regard to case, as RFC 6750 allows. The adapter of `/mcp` calls it for every request.
- With the option `acceptOAuth` it also accepts the access token of a grant, which is refused when it or its grant
  has expired. The option is off unless a caller asks for it, so only `/mcp` accepts such tokens, and only while
  OAuth is on. Without the option an access token does not look like a token.
- It returns the actor of the token's user, the same `id` and `name` that the session of that user gives, or one of
  these codes:
  - `missing-token`: no header, another scheme, or a value that does not look like a token. The database is not
    asked and nothing is logged.
  - `invalid-token`: an unknown or expired token, or one whose user still has the first password, who may do nothing
    but change it.
  - `insufficient-scope`: a valid token without the scope that was asked for.
  - `failed`: the database could not be read.
- A caller answers `missing-token` and `invalid-token` with 401 and `WWW-Authenticate: Bearer`, and
  `insufficient-scope` with 403.
- A refused token is logged with the reason and, where it is known, the token id.
- A failure to write the last use is logged and does not refuse the request.

## Own account page

- `/account` shows the user name and the user's tokens and connected apps, newest first, with "New token". The user name in the header
  links there, except while the first password is still to change, because the address would only lead to the
  password change.
- `?action=create` opens the "New token" dialog, `?action=revoke&token=<id>` the "Revoke token" dialog of a token of
  the user. Any other action, a view, a `token` without `revoke` and a token id that is malformed, unknown or another
  user's show the not-found page.
- Like every other page, `/account` needs a login.

## Decisions

- A token is hashed with SHA-256 and not with Argon2 like a password: it has 256 random bits, so there is nothing to
  guess, and a fast hash can be looked up directly by its value.
- A token is not a session of Better Auth ("Bearer token sessions" in `roadmap.md`): it has scopes and a lifetime of
  its own and is created on purpose by the user, while a session is the login of one browser.
- Revoking deletes the row instead of marking it, so a revoked token cannot come back by mistake and the limit counts
  only tokens that still exist.
- The limit counts expired tokens too, so that the tokens of a user stay few and the user cleans up the list.
- The token of a user with the first password is refused, because `requireUser()` lets such a user do nothing but
  change it; a token must not be a way around that.
- The last use is written at most once a minute and with a conditional write, so that a burst of requests does not
  write on every one.
- The check of a bearer token lives in the token service, not in `src/proxy.ts`, so that the MCP route decides itself
  how it answers; `src/proxy.ts` only lets `/mcp` pass and does not look at the header.
- A grant is a row of the tokens and not a table of its own, so that a user sees and revokes everything that acts for
  them in one list and one limit covers both (see "Decisions" in `oauth.md`).

## Current limits

- only the MCP server accepts a token; there is no other API
- a password change does not end the tokens of a user; only revoking and expiry do
- deactivating a user does not exist yet; when it comes, it must stop the user's tokens as well (see `roadmap.md`)
- no renaming of a token, no change of its scopes or its expiry, and no warning before a token expires
- expired tokens are not deleted by themselves
- the admin cannot see or revoke the tokens of other users
- no CORS, no rate limits of requests with a token and no audit log
- no change of the own password on `/account` (see "Own password change" in `roadmap.md`)
