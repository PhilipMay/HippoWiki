# HippoWiki – MCP Server

The MCP server as built: AI assistants read the wiki through the Model Context Protocol (MCP) at `/mcp`, acting as a
user. A tool that can send a header, such as Claude Code, Cursor or VS Code, uses an API token (see `api-tokens.md`);
the connectors of claude.ai and ChatGPT connect through OAuth (see `oauth.md`). The server only reads.

Code: `src/features/mcp/` (`tools.ts` with the tools, `http.ts` with the adapter of the route), the route
`src/app/mcp/route.ts` and the exception for it in `src/proxy.ts`. The protocol is spoken by the MCP SDK
(`@modelcontextprotocol/server`, see `tech.md`).

Tests: `e2e/mcp.spec.ts`, `e2e/oauth.spec.ts` for the access tokens of OAuth, and the unit tests next to the code,
`src/features/mcp/tools.test.ts` and `src/features/mcp/http.test.ts`.

## The endpoint

- `/mcp` speaks Streamable HTTP without sessions: every request is answered on its own, with a JSON body. There is no
  SSE stream, no session id and no subscription.
- Every MCP message is a `POST`. `GET` and `DELETE`, with which a client would open a stream or end a session, answer 405.
- Clients of the current protocol and clients of the protocol of 2025, which open with `initialize`, are both served.
- The endpoint works without `HIPPOWIKI_PUBLIC_URL`. The variable only adds OAuth and turns the addresses that the
  tools give out into full URLs.
- A request with an `Origin` header that is not the wiki's own is refused with 403, before the token is looked at.
  With `HIPPOWIKI_PUBLIC_URL` the origin must be exactly that address; without it, its host must be the host the
  request was sent to. Only browsers send the header, so an MCP client is not affected.
- `src/proxy.ts` lets `/mcp` pass without a session cookie, because its callers have none. That makes it public to
  the proxy only: the adapter refuses every request without a valid token.

## The tokens it accepts

- Every request needs a bearer token with the scope `read`: an API token of a user, or, with OAuth on, the access
  token of a grant. The check is `authenticateToken()` of the token service (see `api-tokens.md`).
- The caller acts as the user of the token. What that user may read, the caller may read; today that is everything,
  because there are no rights yet (see `users-and-login.md`).
- What a client gets instead of an answer of the protocol:
  - 401 with `WWW-Authenticate: Bearer` without a token, and with `error="invalid_token"` for a token that is
    unknown, expired or of a user who still has the first password. With OAuth on, the header also names the metadata
    of the protected resource (`resource_metadata`) and the scope `read`, so that a connector finds the authorization
    server.
  - 403 with `error="insufficient_scope"` and `scope="read"` for a valid token without the scope.
  - 500 when the token could not be checked.
- A use through `/mcp` shows as the last use of the token on `/account`.
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
  and call the services of the folders and pages, as the queries of the GUI do. They import nothing from Next.js or
  React, like a service (`src/features/services.test.ts`).
- A missing folder or page is a tool error, because the model drives the tools and can recover; a protocol error
  would only reach the program around the model.
- The `Origin` check is a second line of defence against a page that makes its host name resolve to the address of
  the wiki (DNS rebinding). The first line is the token: `/mcp` reads no cookie, so a page of another site has
  nothing to send along.
- `/mcp` is an address of its own and not under `/api/`: MCP clients are configured with the address, and the
  metadata of the protected resource names it.

## Current limits

- read only: no tools that create or change folders, tabs and pages, and no search tool (see `roadmap.md`)
- no resources and no prompts of the protocol, only tools
- no SSE, no sessions, no notifications and no subscriptions
- no rate limits of MCP requests
- no CORS: a client that runs in a browser on another origin cannot call `/mcp`
- a caller reads everything, like every logged-in user; when folder rights come, the tools must follow them
