# Remove API Tokens – Requirements

Status: approved

## Goal

API tokens go away. An AI assistant connects to the MCP server only through OAuth, as a connected app that the user
approved on the consent page and can revoke on the own account page. That leaves one way in instead of two, no
long-lived secret that a user copies by hand, and less code and fewer findings to keep secure.

## Users and roles

- A user connects apps through OAuth as before and, while MCP is on, sees their connected apps on `/account` and
  revokes them there. A user can no longer create, see or use an API token.
- An admin has no tokens and no connected apps, as before; nothing changes for an admin.
- An operator switches MCP on by setting `HIPPOWIKI_PUBLIC_URL`. Without it the wiki works for browsers, and there is
  no MCP server and no OAuth.

## Scenarios

- A user adds the wiki as a connector in an AI assistant, logs in, approves it on the consent page and reads pages
  through MCP. Later the user opens `/account`, sees the app in the list of connected apps and revokes it.
- An operator updates an installation where users had API tokens. After the update the tokens are gone, a tool that
  used one gets 401, and its user connects it again through OAuth.
- An operator runs the wiki without `HIPPOWIKI_PUBLIC_URL`. The wiki works in the browser, `/mcp` is not found, and
  `/account` shows only the user name.

## Requirements

### No API tokens

- R1: A user must not be able to create an API token: `/account` has no "New token" button and no dialog for it.
  - Acceptance: `/account` of a user shows no "New token"; `/account?action=create` shows the not-found page; no
    request to the wiki creates an API token.
- R2: `/mcp` must accept only the access token of a grant. A value in the shape of a former API token is answered
  like any other value that is not a valid token.
  - Acceptance: a request to `/mcp` with a former API token answers 401 with `WWW-Authenticate: Bearer`; a request
    with a valid access token of a grant is served as before.

### Existing tokens

- R3: The update must delete every API token of every user. Grants of connected apps stay and keep working.
  - Acceptance: after the update an installation has no API token; a tool that used one gets 401; every grant is
    still listed on `/account` and its access and refresh tokens still work.

### MCP without a public URL

- R4: Without `HIPPOWIKI_PUBLIC_URL`, `/mcp` must answer 404, like the endpoints of OAuth. The wiki works for
  browsers as before.
  - Acceptance: without the variable every request to `/mcp` answers 404; with it `/mcp` works with grants as before.
- R12: Without `HIPPOWIKI_PUBLIC_URL`, `/account` of a user must show the user name only, like the page of an admin:
  no list, and every action is not found. Grants kept from a time with the variable stay stored and show again, and
  can be revoked, once it is set again.
  - Acceptance: without the variable a user with grants sees only the user name, and `/account?action=revoke&app=<id>`
    with the id of an own grant shows the not-found page; with the variable set again the grants are listed.

### Own account page

- R5: While MCP is on, `/account` of a user must show the user name and a list of "Connected apps", newest first,
  each with its name, creation time, expiry or "Expired", last use or "never", and "Revoke". The page must not speak
  of tokens or scopes.
  - Acceptance: the list shows the user's grants with these columns and no scopes; no text on the page mentions API
    tokens.
- R6: Without connected apps, the page must say "No app is connected yet." instead of the list, with no address
  and no instructions; the README explains how to connect an app.
  - Acceptance: a user without grants sees exactly that message instead of an empty list.
- R7: Revoking a connected app must work as before: after a confirmation the grant is deleted, and its access token
  and refresh token stop working at once.
  - Acceptance: after "Revoke" and the confirmation the app is gone from the list and the client's access token gets
    401 at `/mcp`.
- R9: The revoke dialog must be opened by `/account?action=revoke&app=<id>`. The former address with `token=<id>`,
  and an id that is malformed, unknown or another user's, must show the not-found page.
  - Acceptance: "Revoke" opens the dialog at the address with `app=`; the address with `token=`, a malformed, an
    unknown and a foreign id show the not-found page.

- R8: `/account` of an admin must stay as it is: the user name only, and every action is not found.
  - Acceptance: an admin sees the user name, no list, and the not-found page for every action.

### Limit

- R10: A user must hold at most 20 connected apps, expired ones included. At the limit the consent page must ask the
  user to revoke an app first, in words of apps, not tokens, and must not let the user approve.
  - Acceptance: a user with 20 connected apps sees on the consent page that an app has to be revoked first and has
    no "Approve"; a new grant that replaces older grants of the same client is counted without them, as today.

### Information for operators

- R11: The README must say that API tokens are gone, that the update deletes the existing ones, and that MCP needs
  `HIPPOWIKI_PUBLIC_URL` and a client that connects through OAuth. The update itself must not log the deletion.
  - Acceptance: the section on the MCP server in the README describes only the connection through OAuth and says
    this; no example with an `Authorization` header is left.

## Scope

- In: removing API tokens from the account page, the MCP server and the data of existing installations; the account
  page as a list of connected apps; `/mcp` off without a public URL.
- Not in: scripts, CI jobs and MCP clients that cannot do OAuth with a browser lose access to the wiki and get no
  replacement (no device flow, no client credentials). No change to OAuth itself or to the MCP tools; the consent
  page changes only in the wording at the limit (R10).

## Effect on existing features

- API tokens (`api-tokens.md`): tokens, their scopes `write` and the choice of scopes, their prefix, their dialog and
  their check are removed; what remains is the list of connected apps on `/account`, its limit of 20 for connected
  apps alone, and the check of an access token.
- MCP (`mcp.md`): `/mcp` accepts only access tokens of grants, and it is off without `HIPPOWIKI_PUBLIC_URL`. Today
  the endpoint works without the variable.
- OAuth (`oauth.md`): "Without the variable … `/mcp` accepts only API tokens" changes to "`/mcp` answers 404".
- Container image (`container-image.md`): "Without it the wiki runs as before: the MCP server at `/mcp` works with
  API tokens" changes: without the variable there is no MCP server.
- Users and login (`users-and-login.md`): a user "holds API tokens and connected apps" changes to connected apps
  only.
- README: the section on the MCP server and the introduction describe API tokens today (see R11).

## Decisions

- MCP is off without a public URL, rather than the public URL being required: the wiki keeps running for browsers on
  installations without the variable, and the variable switches MCP and OAuth on together. Rejected: refusing to
  start without it, which would break installations on update; a `/mcp` that refuses every request, which a client
  cannot resolve.
- Existing tokens are deleted on the update, rather than left to expire: one clean cut, without keeping the check of
  API tokens alive for up to a year.
- Headless clients and clients without OAuth lose access, accepted by the user; a later feature can bring a
  replacement.
- The limit of 20 stays, now for connected apps alone, so that a connector that registers again on every connect
  cannot pile up rows. Rejected: no limit.
- The revoke address names `app` instead of `token`, so that the address matches what the page shows. Rejected:
  keeping `token`.
- The operator learns of the deletion from the README, not from a log line of the update. Rejected: a log line with
  the number of deleted tokens.
- The message of an empty list is short, without the address of `/mcp`; the README explains how to connect.
  Rejected: the address and instructions on the page.
- While MCP is off, `/account` shows the user name only, because no app can connect and no grant can be used.
  Rejected: the list with a note, which would keep old grants revocable while they cannot be used anyway.

## Open questions

None.
