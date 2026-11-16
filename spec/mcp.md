# HippoWiki – MCP Server

The MCP server as built: AI assistants read the wiki through the Model Context Protocol (MCP) at `/mcp`, acting as a
user. A client, such as Claude Code or the connectors of claude.ai and ChatGPT, connects through OAuth (see
`oauth.md`) and sends the access token of its grant. The server only reads.

Code: `src/features/mcp/` (`tools.ts` with the tools, `http.ts` with the adapter of the route), the route
`src/app/mcp/[[...path]]/route.ts` and the exception for it in `src/proxy.ts`. The protocol is spoken by the MCP SDK
(`@modelcontextprotocol/server`, see `tech.md`).

Tests: `e2e/mcp.spec.ts`, `e2e/oauth.spec.ts` for the access tokens of OAuth, and the unit tests next to the code,
`src/features/mcp/tools.test.ts` and `src/features/mcp/http.test.ts`.

## The endpoint

- `/mcp` speaks Streamable HTTP without sessions: every request is answered on its own, with a JSON body. There is no
  SSE stream, no session id and no subscription.
- Every MCP message is a `POST`. `GET` and `DELETE`, with which a client would open a stream or end a session, answer 405.
- Clients of the current protocol and clients of the protocol of 2025, which open with `initialize`, are both served.
- Without `HIPPOWIKI_PUBLIC_URL` there is no OAuth and therefore no MCP server: every request to `/mcp` answers 404,
  like the endpoints of OAuth, before its method, its headers or its token are looked at. With the variable the
  addresses that the tools give out are full URLs.
- A request with an `Origin` header that is not exactly `HIPPOWIKI_PUBLIC_URL` is refused with 403, before the token
  is looked at; the host the request was sent to is not enough. Only browsers send the header, so an MCP client is
  not affected.
- `src/proxy.ts` lets `/mcp` pass without a session cookie, because its callers have none. That makes it public to
  the proxy only: the adapter refuses every request without a valid token.

## The tokens it accepts

- Every request needs a bearer token with the scope `read`: the access token of a grant. Any other value, a former API
  token included, counts as no token. The check is `authenticateAccessToken()` of the grant service (see
  `connected-apps.md`).
- The caller acts as the user of the token: the adapter hands that user to the tools, and the services decide what it
  may read. The tools pass the channel `mcp`, for which the services ignore folder roles: a user reads every folder
  through MCP, also one that the browser hides because the user has no role on it (see `folder-roles.md`).
- `/mcp` serves users only. Every access token of an admin is refused, because the check of an access token looks at
  the type of the account (see "No apps for admins" in `connected-apps.md`); such a request reaches no tool.
- What a client gets instead of an answer of the protocol:
  - 401 with `WWW-Authenticate: Bearer` without a token, and with `error="invalid_token"` for a token that is
    unknown, expired, of a user who still has the first password or of an admin. The header also names the metadata
    of the protected resource (`resource_metadata`) and the scope `read`, so that a client finds the authorization
    server.
  - 403 with `error="insufficient_scope"` and `scope="read"` for a valid token without the scope.
  - 500 when the token could not be checked.
- A use through `/mcp` shows as the last use of the connected app on `/account`.
- A token is never logged and never part of an answer.

## Tools

All tools only read, and say so to the client (`readOnlyHint`).

- `list_folders`: all folders, by name, each with its name, its address and its last change.
- `list_folder`: the tabs and the pages of one folder. The pages placed directly in the folder come first, then the
  pages in tabs, tab by tab; each page has its name, its title, its tab (none for a page placed directly in the
  folder), its address and its last change.
- `read_page`: one page by its folder, its tab if it is in one, and its name: the title, the Markdown content, the
  address, the last change and the last editor.

What holds for all of them:

- They are tools of the content only. There is no tool for accounts, and no admin task is reachable through MCP, now
  or later: admin tasks are done only in the browser, with the session of an admin, so that a leaked token can never
  manage accounts.
- An address is the path of the folder, tab or page; with `HIPPOWIKI_PUBLIC_URL` it is the full URL, which a person
  can open.
- A deleted page is never listed and never read; it is answered like a page that does not exist.
- A folder or page that does not exist is a tool error with a message that says what to do next, not a protocol
  error, so that the model reads it and tries again. So is a name that breaks the name rule: it never reaches a
  service.
- A failure of the database is a tool error with a general message. The error itself is logged and not passed on.
- A result is given twice: as structured data and as the same data in text.
- The instructions that a client gets when it connects say in one paragraph how the wiki is organised: folders, tabs
  and pages.

## Decisions

- The protocol is spoken by the official SDK and not written by hand: the protocol has several revisions that a
  server has to serve side by side, and the SDK follows them.
- The endpoint has no sessions and no streams, so that it holds nothing in memory between requests, works behind
  every reverse proxy and needs no long-lived connections. The read tools need neither: none of them reports progress
  or sends a notification.
- The SDK answers the clients of the protocol of 2025 as a stream. The adapter therefore serves them with a
  transport of the SDK that answers in JSON, and hands only the clients of the current protocol to the handler of
  the SDK, which is set to answer in JSON and to accept no subscriptions.
- The adapter is the place where the caller is found from the token; the tools know nothing about HTTP or tokens
  and call the services of the folders and pages with the caller as the actor, as the queries of the GUI do. The
  handler of the SDK is created once and gets the actor of each request through the authentication information that
  it passes on to the factory of the server. They import nothing from Next.js or
  React, like a service (`src/features/services.test.ts`).
- A missing folder or page is a tool error, because the model drives the tools and can recover; a protocol error
  would only reach the program around the model.
- The `Origin` check is a second line of defence against a page that makes its host name resolve to the address of
  the wiki (DNS rebinding). The first line is the token: `/mcp` reads no cookie, so a page of another site has
  nothing to send along. The check compares with the public URL only: such a page sends its own host name as `Host`
  and `Origin`, so comparing the two would let it through.
- `/mcp` is off without `HIPPOWIKI_PUBLIC_URL`, rather than the variable being required: the wiki keeps running for
  browsers on installations without it, and the variable switches MCP and OAuth on together. Rejected: refusing to
  start without it, which would break installations on update; a `/mcp` that refuses every request, which a client
  cannot resolve.
- `/mcp` is an address of its own and not under `/api/`: MCP clients are configured with the address, and the
  metadata of the protected resource names it.
- Admins never use MCP, and MCP gets no admin tools and no tokens with an admin scope: this is a lasting rule, not a
  limit of today. Rejected: admin tools in MCP. A tool that lists accounts for users would be a user task and could
  come later.

## Current limits

- read only: no tools that create or change folders, tabs and pages, and no search tool (see `roadmap.md`); the later
  write tools state the version of every page they change, as the page service requires of every caller (see
  `optimistic-locking.md`), and `read_page` does not show the version yet
- no resources and no prompts of the protocol, only tools
- no SSE, no sessions, no notifications and no subscriptions
- no rate limits of MCP requests
- no CORS: a client that runs in a browser on another origin cannot call `/mcp`
- a caller reads every folder, also one without a role of the user, which the browser hides; MCP gets rules for folder
  roles of its own later (see "MCP rules for folder roles" in `roadmap.md`)
- no tool that lists the accounts
