# Remove API Tokens – Steps

## Goal

API tokens go away: an AI assistant reaches the MCP server only through OAuth, as a connected app that the user
approved on the consent page and revokes on `/account`. Without `HIPPOWIKI_PUBLIC_URL` there is no MCP server, and the
update deletes the API tokens of existing installations. The plan is written from
`spec/remove-api-tokens-requirements.md` (status `approved`); every requirement ID is covered below.

## Scope

- In: removing API tokens from the account page, the MCP server and the data of existing installations (R1, R2, R3);
  `/mcp` off without a public URL (R4); `/account` as a list of connected apps (R5 to R9, R12); the limit of 20 for
  connected apps alone, with the wording at the limit on the consent page (R10); the README for operators (R11).
- In: renaming what is left, so that the code no longer speaks of tokens where it means grants: the model `ApiToken`
  becomes `OAuthGrant` and the module `src/features/tokens/` becomes `src/features/grants/`; the spec `api-tokens.md`
  is replaced by `connected-apps.md` in the wrap-up.
- In: the findings of `spec/review-report.md` that the removal fixes or changes, handled as "Fixing a finding of the
  review report" in `spec/step-plan-workflow.md` describes, in the step that fixes them.
- Not in: a replacement for scripts, CI jobs and MCP clients that cannot do OAuth with a browser (no device flow, no
  client credentials); any change to OAuth itself or to the MCP tools; on the consent page, anything but the wording
  at the limit; the other open findings of the "API tokens" area of the review report, which are only moved to the
  grants and reworded.

## Checklist

- [ ] MCP only through OAuth
- [ ] Account page of connected apps
- [ ] Remove API tokens from the data and the code
- [ ] Wrap-up

## Rules for this plan

- Every step that deletes or renames a file updates the pointers to it in `spec/`, `README.md` and `CLAUDE.md`, so
  that `npm run docs:check` passes. The full description of the feature as built is written in the wrap-up.
- The end-to-end server always runs with `HIPPOWIKI_PUBLIC_URL` (`playwright.config.ts`). What holds without the
  variable (R4, R12) is therefore covered by unit tests with a mocked environment, as in `src/features/mcp/http.test.ts`
  and `src/features/oauth/actions.test.ts`, and checked by hand with `npm run dev` without the variable.

## MCP only through OAuth

### Goal

`/mcp` accepts only the access token of a grant, and it answers 404 while `HIPPOWIKI_PUBLIC_URL` is not set (R2, R4).
The README describes only the connection through OAuth (the MCP part of R11).

### Build

- `src/features/mcp/http.ts`, `handleMcpRequest()`: without a public URL every request answers 404, whatever its
  method, origin or header, before anything else is looked at, in the shape of the OAuth endpoints that are off
  (`src/app/.well-known/oauth-authorization-server/route.ts`). With it everything works as before.
- `hasForeignOrigin()` keeps only the comparison with the public URL; the comparison with the `Host` header goes,
  because `/mcp` no longer runs without a public URL.
- `src/features/tokens/service.ts`, `authenticateToken()`: drop the API tokens and the option `acceptOAuth`. Only a
  value of the shape of an access token (`looksLikeAccessToken()` of `src/features/oauth/secret.ts`) is looked up, by
  `accessTokenHash`; every other value, a former API token `hw_…` included, is `missing-token` without a database
  lookup, so `/mcp` answers it with 401 and `WWW-Authenticate: Bearer` and the discovery parameters. The rest of the
  check (expiry of the grant and of the access token, first password, admin, scope, last use) stays as it is.
- The comments of `src/app/mcp/route.ts` and `src/features/mcp/http.ts` speak of the access token of a grant.
- `e2e/support/database.ts`: a helper `createGrant()` that inserts an OAuth client and a grant of the user given as
  `owner`, with an access token of which only the hash is stored, and returns the grant and the access token; its
  fields can be set like those of `createApiToken()`, for example an expired grant or access token, a last use or
  scopes without `read`.
- `README.md`, the section on the MCP server: only the connection through OAuth; MCP needs `HIPPOWIKI_PUBLIC_URL` and
  a client that connects through OAuth; no example with an `Authorization` header and no `hw_…`.
- `spec/review-report.md`: the finding "without a public URL, the `Origin` check lets DNS rebinding through" (area
  "MCP server") is fixed by the 404; delete it and bring the report in line as "Fixing a finding of the review report"
  describes (counts in "Summary", "Not covered by this review", which names that check, the "Reviewed" list of the
  area and "Standards coverage"). Update the rule of the `Origin` check in `spec/mcp.md` in the same change.

### Test

- Unit, `src/features/mcp/http.test.ts`: without a public URL `POST`, `GET` and `DELETE` answer 404, with and without
  a valid bearer token and with a foreign `Origin`, and `authenticateToken()` is not called; with it the 405, 403, 401,
  403 and 500 answers and the served request stay as before; an `Origin` is compared only with the public URL.
- Unit, `src/features/tokens/service.test.ts`: a value of the shape of an API token is `missing-token` without a
  database lookup; an access token is looked up by its hash; the tests of the other codes use access tokens.
- Integration, `integration/token-service.test.ts`: `authenticateToken()` refuses a stored API token with
  `missing-token` and accepts the access token of a grant; the existing cases of expiry, first password, admin, scope
  and last use run with grants.
- End-to-end, `e2e/mcp.spec.ts`: every test uses the access token of a grant from `createGrant()` instead of an API
  token; a former API token from `createApiToken()` gets 401 with `WWW-Authenticate: Bearer`; the tests of the admin,
  the first password, the expiry, the missing scope, the last use and the revoked grant keep their meaning with
  grants.
- End-to-end specs to run: `e2e/mcp.spec.ts`, `e2e/oauth.spec.ts`, `e2e/access.spec.ts`.
- Manual check: with `npm run dev` and `HIPPOWIKI_PUBLIC_URL` unset, `curl -si -X POST http://localhost:3000/mcp`
  answers 404, also with an `Authorization` header.

## Account page of connected apps

### Goal

`/account` of a user is the list of the user's connected apps and nothing else, and API tokens can no longer be
created (R1, R5 to R9, R12); the account page of an admin stays as it is (R8).

### Build

- `src/app/account/page.tsx`:
  - No "New token" button and no create dialog; `?action=create` shows the not-found page (`ACTIONS` holds only
    `revoke`).
  - A section "Connected apps" with the user's grants, newest first, without any text about tokens or scopes.
  - The revoke dialog is opened by `?action=revoke&app=<id>`. The parameter `token`, a malformed, an unknown and
    another user's id, and `app` without `revoke` show the not-found page.
  - Without `HIPPOWIKI_PUBLIC_URL` (`issuer()` of `src/features/oauth/issuer.ts` is `null`) a user sees the user name
    only, like an admin, and every action and every `app` is not found (R12). The grants stay stored.
- `src/features/tokens/service.ts`: `listTokens()` lists only grants (`clientId` not `null`) and returns `null` for an
  admin and while OAuth is off; `revokeToken()` deletes only a grant of the actor and refuses while OAuth is off, like
  for an admin. Delete `createToken()` and what only it uses.
- `src/features/tokens/actions.ts`: delete `createToken`; `revokeToken` shows the not-found page while OAuth is off.
  Delete the form of a new token in `forms.ts`, the name and scope rules of a new token and `generateToken()`. The
  expiry choices of `schema.ts` stay, because the consent page uses them.
- `src/features/tokens/components/`: delete `CreateTokenDialog.tsx`. The list shows each app with its name, the
  connection time, the expiry or "Expired", the last use or "never", and "Revoke"; no scope chips and no "Connected
  app" chip. Without apps it says "No app is connected yet." and nothing else (R6). The revoke dialog speaks only of
  the connected app.
- `src/lib/addresses.ts`: `revokeTokenPath()` becomes `revokeAppPath()` with the parameter `app`.
- `README.md`: how to connect an app, since the page no longer explains it (R6).

### Test

- Unit, `src/features/tokens/service.test.ts` and `queries.test.ts`: the list holds only grants, is `null` for an admin
  and without a public URL; `revokeToken()` deletes no API token row and refuses without a public URL.
- Unit, `src/features/tokens/actions.test.ts`: `revokeToken` shows the not-found page without a public URL, for an
  admin, and for an unknown or another user's id; the tests of `createToken` are deleted.
- Integration, `integration/token-service.test.ts`: listing and revoking touch only the grants of the actor; the
  tests of creating a token are deleted.
- End-to-end, `e2e/account.spec.ts`, rewritten with grants from `createGrant()` and `connect()` of
  `e2e/support/oauth.ts`:
  - a user without apps sees the user name and exactly "No app is connected yet."; the name in the header leads there;
    the page shows no "New token" and no text about tokens or scopes (R1, R5, R6);
  - `/account?action=create` shows the not-found page (R1);
  - the list shows the apps newest first with their name, connection time, expiry or "Expired", last use or "never"
    (R5);
  - "Revoke" opens the dialog at `?action=revoke&app=<id>`; after the confirmation the app is gone from the list and
    the database, and its access token gets 401 at `/mcp` and its refresh token is refused (R7, R9); "Cancel" keeps it;
  - the address with `token=<id>` of an own grant, a malformed, an unknown and another user's id, and `app` without
    `revoke` show the not-found page; a user sees only their own apps (R9);
  - an admin sees the user name only and the not-found page for `create`, for `revoke` and for an `app` (R8).
- End-to-end, `e2e/hydration.spec.ts`: the test of the create dialog is deleted; the revoke dialog of an app at the
  address with `app=` is locked until hydration.
- End-to-end specs to run: `e2e/account.spec.ts`, `e2e/hydration.spec.ts`, `e2e/oauth.spec.ts`, `e2e/mcp.spec.ts`.
- Manual check: with `npm run dev` and `HIPPOWIKI_PUBLIC_URL` unset, a user with a grant sees only the user name on
  `/account`, and `/account?action=revoke&app=<id>` shows the not-found page; with the variable set again the grant is
  listed and can be revoked (R12).

## Remove API tokens from the data and the code

### Goal

The update deletes every API token and keeps every grant working (R3); what is left of the token code is renamed to
grants; the consent page speaks of apps at the limit (R10); the README tells operators what the update does (R11).

### Build

- `prisma/schema.prisma`: the model `ApiToken` becomes `OAuthGrant`, without `tokenHash`, with a required `clientId`;
  the relation of `User` is renamed. Its comments speak only of grants.
- A migration `remove_api_tokens`, written by hand (`npm run db:migrate -- --name remove_api_tokens --create-only`,
  see `architecture.md`), with a comment that says what it does and why:
  1. delete every row without a client, which is an API token; nothing is logged (R11);
  2. drop the check constraint `ApiToken_token_or_grant`, the unique index of `tokenHash` and the column;
  3. make `clientId` required;
  4. rename the table to `OAuthGrant` with its primary key, indexes and foreign keys, so that the names are those
     Prisma gives the new model and the grants keep their ids, hashes and dates.
- `src/features/tokens/` becomes `src/features/grants/`: `service.ts` with `listGrants()`, `revokeGrant()`,
  `authenticateAccessToken()` and `MAX_GRANTS_PER_USER = 20`, `queries.ts`, `actions.ts`, `forms.ts`, `schema.ts` with
  the grant id, and the components `ConnectedAppList.tsx` and `RevokeAppDialog.tsx`. The types and names speak of
  grants and apps instead of tokens.
- What OAuth used from the token module moves to OAuth: the secret helpers of `src/features/tokens/secret.ts`
  (`generateSecret()`, `hashToken()`, the secret pattern) to `src/features/oauth/secret.ts`, the expiry choices of a
  grant to `src/features/oauth/schema.ts`; `src/features/tokens/secret.ts` and its `hw_` prefix are deleted.
- `src/features/oauth/service.ts`, `queries.ts`, `actions.ts`, `ConsentForm.tsx`: use `oauthGrant` and
  `MAX_GRANTS_PER_USER`; `isTokenLimitReached()` becomes `isGrantLimitReached()`. At the limit the consent page says
  that the user already has the most connected apps allowed and has to revoke an app on the account page first,
  with no "Approve" (R10); the refusal at the token endpoint speaks of apps as well. The limit counts as before
  without the grants that the new one replaces.
- `src/lib/db-errors.ts`: drop `API_TOKEN_HASH`; the constraint of the access token hash gets the new index name.
- `src/features/mcp/http.ts` and `src/features/services.test.ts` import the grant service.
- `e2e/support/database.ts`: delete `createApiToken()`; the tests that used it, such as the limit tests of
  `e2e/oauth.spec.ts` and the former API token of `e2e/mcp.spec.ts` (which now sends a value of that shape without a
  stored row), use `createGrant()`. `resetTestDatabase()` and `emptyTestDatabase()` name the new table where they
  name tables.
- `README.md`: API tokens are gone, the update deletes the existing ones, and MCP needs `HIPPOWIKI_PUBLIC_URL` and a
  client that connects through OAuth (R11); the introduction no longer mentions API tokens.
- `spec/review-report.md`, area "API tokens", as "Fixing a finding of the review report" describes:
  - the suggestion "the format of a token does not let secret scanners recognise a leak" is fixed by the removal:
    delete it, and move what it asked for to "Reviewed" with what the removal does;
  - the question "creating an API token or approving an OAuth grant needs no new authentication" keeps only the grant;
  - the other findings of the area keep their substance and get the new locations and the words of grants and access
    tokens; the threat model, the assets and the "Reviewed" lists no longer speak of API tokens; the counts in
    "Summary" follow.
- Pointers in `spec/` to the renamed and deleted files are updated (see "Rules for this plan").

### Test

- Unit: the tests of `src/features/tokens/` move with the code to `src/features/grants/` and use the new names;
  `src/features/oauth/secret.test.ts` covers the moved secret helpers; the tests of the consent form and of the OAuth
  actions check the wording at the limit and that there is no "Approve".
- Integration: `integration/token-service.test.ts` becomes `integration/grant-service.test.ts`;
  `integration/oauth-service.test.ts` uses `oauthGrant`, and its limit tests count 20 connected apps, the replaced
  grants of the same client not counted (R10); `integration/db-errors.test.ts` uses the new index name.
- End-to-end, `e2e/oauth.spec.ts`: a user with 20 connected apps sees on the consent page that an app has to be
  revoked first, in words of apps, and has no "Approve"; a grant that replaces older grants of the same client is
  counted without them (R10).
- End-to-end specs to run: the complete suite, because the step changes `prisma/schema.prisma`, its migrations and
  `e2e/support/`.
- `npm run db:migrate` on a database with all migrations applied creates no further migration: the hand-written SQL
  gives exactly the schema.
- Manual check of the update (R3), on the development database before the new migration is applied: insert an API
  token row with SQL next to a grant made through the consent page, apply the migration, then check that no row without
  a client is left, that the grant is listed on `/account`, that its access token is served at `/mcp` and that its
  refresh token works, and that the migration printed no log line about the deletion.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/connected-apps.md`, which replaces `spec/api-tokens.md` (see "Feature
   specs" in `step-plan-workflow.md`): the own account page with the list of connected apps, revoking, the limit of 20,
   no apps for admins, the account page without a public URL, and the check of an access token with its codes. Move
   the rules and decisions of the requirements file that still hold into it (the deletion on the update, MCP off
   without a public URL, the `app` parameter, the short message of an empty list, the name only without a public URL,
   the limit for apps alone) and its "Current limits" (no access for clients without OAuth). Delete
   `spec/api-tokens.md` and bring in line `mcp.md`, `oauth.md`, `container-image.md`, `users-and-login.md`,
   `folder-roles.md` and the other specs that point to it or speak of API tokens; update `architecture.md`,
   `testing.md` (`createGrant()` instead of `createApiToken()`) or `tech.md` where conventions changed.
   In `spec/review-report.md`, the nit "`api-tokens.md` says `/mcp` checks the token 'for every request'" is fixed by
   the wording of the new spec: delete it as "Fixing a finding of the review report" describes, and rename the area
   "API tokens" after what is left.
2. Remove the feature from `roadmap.md`: it has no entry there. Bring in line the entries that point to
   `api-tokens.md` or speak of API tokens, such as the check of Claude Code with an API token on the deployment, and
   add a replacement for clients without OAuth (device flow, client credentials) as a candidate.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and the requirements file of the feature, if there is one.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file and the requirements file.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
- No file in `spec/`, `README.md` or `CLAUDE.md` mentions API tokens, `hw_` or `api-tokens.md`, except where the
  update that deleted the tokens is described.
