# HippoWiki – MCP Server

The MCP server as built: AI apps work with the wiki through the Model Context Protocol (MCP), each connection for one
folder and with one role, at an address of its own per folder and role, `/mcp/<folder-uuid>/reader` or
`/mcp/<folder-uuid>/writer`. A client, such as Claude Code or the connectors of claude.ai and ChatGPT, connects through
OAuth (see `oauth.md`) and sends the access token of its grant. The role of the address is the most the app may do,
and never more than the user's current role on the folder, so that a user can give an AI agent less than their own
access. A Reader connection reads the folder; a Writer connection also creates pages, replaces their content and moves
or renames them. A user finds the addresses of a folder in its view "AI apps" (see `content-structure.md`).

Code: `src/features/mcp/` (`tools.ts` with the tools, `http.ts` with the adapter of the route, `queries.ts` and
`components/` for the view "AI apps"), the route `src/app/mcp/[[...path]]/route.ts` and the exception for it in
`src/proxy.ts`. The roles of MCP are `MCP_ROLES` and `mcpRolesFor()` in `src/features/folder-roles/roles.ts`, the
actor of MCP `inMcp()` in `src/features/folder-roles/service.ts`. The protocol is spoken by the MCP SDK
(`@modelcontextprotocol/server`, see `tech.md`).

Tests: `e2e/mcp.spec.ts`, `e2e/oauth.spec.ts` for the access tokens of OAuth, `e2e/ai-apps.spec.ts` for the view "AI
apps", `integration/grant-service.test.ts`, `integration/page-service.test.ts`, and the unit tests next to the code,
`src/features/mcp/tools.test.ts`, `src/features/mcp/http.test.ts` and `src/features/mcp/queries.test.ts`.

## The addresses

- The MCP server answers only at the folder addresses `/mcp/<folder-uuid>/reader` and `/mcp/<folder-uuid>/writer`. The
  folder is named by its id, which never changes, so a connection keeps working when its folder is renamed.
- Every other address below `/mcp`, the plain `/mcp`, the roles `owner` and `manager`, a part that is no UUID in lower
  case and any further segment included, answers 404.
- The role of an address is Reader or Writer. A user may connect to an address whose role is at most the own role on
  the folder: a Reader to the Reader address, a Writer, a Manager and an Owner to both. Manager and Owner are no roles
  of MCP.

## The endpoint

- Every folder address speaks Streamable HTTP without sessions: every request is answered on its own, with a JSON
  body. There is no SSE stream, no session id and no subscription.
- Every MCP message is a `POST`. `GET` and `DELETE`, with which a client would open a stream or end a session, answer 405.
- Clients of the current protocol and clients of the protocol of 2025, which open with `initialize`, are both served.
- Without `HIPPOWIKI_PUBLIC_URL` there is no OAuth and therefore no MCP server: every request below `/mcp` answers 404,
  like the endpoints of OAuth, before its path, its method, its headers or its token are looked at. With the variable
  the addresses that the tools give out are full URLs.
- A request with an `Origin` header that is not exactly `HIPPOWIKI_PUBLIC_URL` is refused with 403, before the token
  is looked at; the host the request was sent to is not enough. Only browsers send the header, so an MCP client is
  not affected.
- `src/proxy.ts` lets `/mcp` and every address below it pass without a session cookie, because their callers have
  none. That makes them public to the proxy only: the adapter answers every address that is no folder address with
  404 and refuses every request without a valid token.

## The connections

- Every request needs a bearer token: the access token of a grant. Any other value, a former API token included,
  counts as no token. The check is `authenticateAccessToken()` of the grant service (see "The check of an access token"
  in `connected-apps.md`). There are no scopes.
- A connection is bound to exactly the one address, folder and role, its grant was approved for. Its access token is
  no token at any other address, another role of the same folder included.
- A user holds connections to several addresses at the same time, also from the same app; each is a grant of its own.
- On every request the user's current role on the folder must include the role of the connection. A connection whose
  user has no role on the folder any more, or a role below the role of the connection, is refused while that lasts and
  works again once the role is high enough again; the connection itself stays.
- The adapter then reads the folder of the connection with the actor of MCP, for its current name; a folder that
  cannot be read, such as one deleted in the meantime, is answered like a role that is too low.
- `/mcp` serves users only. Every access token of an admin is refused, because the check of an access token looks at
  the type of the account (see "No apps for admins" in `connected-apps.md`); such a request reaches no tool.
- What a client gets instead of an answer of the protocol, in this order:
  - 404 for an address that is no folder address;
  - 405 and 403 as described in "The endpoint";
  - 401 with `WWW-Authenticate: Bearer` without a token, and with `error="invalid_token"` for a token that is unknown,
    expired, of another address, of a user who still has the first password or of an admin. The header names the
    metadata of the protected resource at the address (`resource_metadata`), so that a client finds the authorization
    server. Every folder address answers so, whether a folder of that id exists or not;
  - 403 with a short JSON message that the user's role on the folder does not allow the address, for a valid token
    whose role is too low. It carries no `insufficient_scope` and no challenge, so that the client does not authorize
    again, and no tool runs;
  - 500 when the token could not be checked.
- A use through MCP shows as the last use of the connected app on `/account`; a refused request writes none.
- A token is never logged and never part of an answer.

## The actor of MCP

- The adapter hands the tools the actor of MCP: the user of the token together with the connection of its grant, the
  grant id, the folder and the role (`inMcp()`).
- The services give an actor of MCP the lower of the user's current role and the role of the connection on the folder
  of the connection, and no role on every other folder. Every other folder, also one on which the user has a role,
  reads like one that does not exist, and every write there is `not-allowed`. The rules of the folders and pages
  services are otherwise the same as in the browser (see `folder-roles.md`).
- A Writer connection never reaches a function of a Manager, such as deleting a page or the deleted pages, because
  its role is at most Writer.

## Tools

A Reader connection gets the two read tools, a Writer connection also the three write tools. A tool that the
connection does not get is not listed, and a call of it changes nothing.

Read tools, which say so to the client (`readOnlyHint`):

- `list_folder`: the tabs and the pages of the folder of the connection, without arguments. The pages placed directly
  in the folder come first, then the pages in tabs, tab by tab; each page has its name, its title, its tab (none for a
  page placed directly in the folder), its address and its last change.
- `read_page`: one page of the folder by its tab, if it is in one, and its name: the title, the Markdown content, the
  address, the last change, the last editor and its version (see `optimistic-locking.md`).

Write tools, for a Writer connection only, each with the hints of a tool that writes:

- `create_page`: a new page with the given content, directly in the folder or in one of its existing tabs, named by
  its tab name. The name is optional; without one the page gets the name the browser suggests for its title. A Writer
  creates no tabs.
- `replace_page_content`: the whole content of a page, found by its tab and name, based on a version; the title
  follows the new title heading.
- `move_or_rename_page`: a page to another tab of the folder, or directly into it, with a new name, based on a
  version. It stays in the folder of the connection.

What holds for all of them:

- They work on the folder of the connection without naming it; a folder argument is no argument of any tool. There is
  no tool that lists folders, and no tool reaches another folder.
- They are tools of the content only. There is no tool for accounts, and no admin task is reachable through MCP, now
  or later: admin tasks are done only in the browser, with the session of an admin, so that a leaked token can never
  manage accounts.
- The content, the names and the tabs of a write follow the same rules as in the browser (see `pages.md` and
  `content-structure.md`). Content without a title heading, a title that suggests no name and comes without a name, a
  name that breaks the name rule, a taken name and a tab that does not exist are tool errors that say what to do next,
  and nothing is changed.
- Every change of a page states the version that `read_page` gave. A change based on an older version, or on none, is
  refused as in the browser, with a tool error that names who changed the page last and when and tells the agent to
  read the page again; nothing is changed.
- A change whose role is too low, because the role was lowered meanwhile, is `not-allowed` and changes nothing.
- A change through MCP records the user of the connection as the last editor, as a change in the browser does. The
  page does not show that it came from an AI app; the server log of the change names the channel `mcp` and the grant.
- Every write tool returns the page as stored: its name, title, tab, address and new version.
- An address is the path of the folder, tab or page; with `HIPPOWIKI_PUBLIC_URL` it is the full URL, which a person
  can open.
- A deleted page is never listed, read or changed; it is answered like a page that does not exist.
- A page or tab that does not exist is a tool error with a message that says what to do next, not a protocol error, so
  that the model reads it and tries again.
- A failure of the database is a tool error with a general message. The error itself is logged and not passed on.
- A result is given twice: as structured data and as the same data in text.
- The instructions that a client gets when it connects name the folder and the role of the connection, say what the
  role allows, and say in one paragraph how the folder is organised: tabs and pages. A Reader connection is told that
  it reads the folder and cannot change it; a Writer connection is told the write tools and that every change states
  the version.

## Decisions

- A connection is bound to one address, so that a reduced role is a real limit: a token given to a reading agent can
  never write. Rejected: one connection that works at every address the user may use.
- The plain `/mcp` was removed, so that there is one kind of MCP address. Rejected: keeping `/mcp` as a reader of every
  folder with a role.
- The address names the folder by its id, so that a connection survives a rename. The folder therefore shows its
  addresses in the view "AI apps", because the id appears in no browser address. Rejected: only the README.
- A connection above the current role is refused but kept, so that nothing is deleted behind the user's back and a
  role given back restores it. Rejected: deleting the connection, and letting it work with the lower role, which would
  make the address say something else than what the connection can do.
- A role that no longer allows the address answers 403 without `insufficient_scope`, so that the user learns why and
  the client does not try to authorize again in a loop; an address that cannot exist answers 404, and every folder
  address without a token answers 401, so that a caller without a token learns nothing about which folders exist.
  Rejected: 404 for every refusal.
- The tools work on the folder of the connection without naming it, so that an agent cannot even try another folder.
  Rejected: the tools with a folder name and only one folder that answers.
- The write tools were built before page history. Accepted: a change by an AI agent cannot be reverted until page
  history exists; the version check still keeps it from overwriting a newer change. Rejected: page history first.
- The name of a new page is optional for an agent and is then the name the browser would suggest, so that an agent
  needs to send only the content. Rejected: a name that is always required.
- A change through MCP shows only the user as the last editor, like a change in the browser; the log keeps the channel
  until page history can show it. Rejected: "via <app>" on the page.
- The Owner role is never a role of MCP, as a lasting rule: the functions of an Owner, renaming the folder and its
  roles, stay in the browser.
- The protocol is spoken by the official SDK and not written by hand: the protocol has several revisions that a
  server has to serve side by side, and the SDK follows them.
- The endpoint has no sessions and no streams, so that it holds nothing in memory between requests, works behind
  every reverse proxy and needs no long-lived connections. None of the tools reports progress or sends a notification.
- The SDK answers the clients of the protocol of 2025 as a stream. The adapter therefore serves them with a
  transport of the SDK that answers in JSON, and hands only the clients of the current protocol to the handler of
  the SDK, which is set to answer in JSON and to accept no subscriptions.
- The adapter is the place where the caller is found from the token; the tools know nothing about HTTP or tokens
  and call the services of the folders and pages with the actor of MCP, as the queries of the GUI do with the actor of
  the browser. The handler of the SDK is created once and gets the actor and the folder of each request through the
  authentication information that it passes on to the factory of the server. The tools import nothing from Next.js or
  React, like a service (`src/features/services.test.ts`).
- A missing page or tab is a tool error, because the model drives the tools and can recover; a protocol error would
  only reach the program around the model.
- The `Origin` check is a second line of defence against a page that makes its host name resolve to the address of
  the wiki (DNS rebinding). The first line is the token: the MCP addresses read no cookie, so a page of another site
  has nothing to send along. The check compares with the public URL only: such a page sends its own host name as
  `Host` and `Origin`, so comparing the two would let it through.
- MCP is off without `HIPPOWIKI_PUBLIC_URL`, rather than the variable being required: the wiki keeps running for
  browsers on installations without it, and the variable switches MCP and OAuth on together. Rejected: refusing to
  start without it, which would break installations on update; addresses that refuse every request, which a client
  cannot resolve.
- The MCP addresses are not under `/api/`: MCP clients are configured with the address, and the metadata of the
  protected resource names it.
- Admins never use MCP, and MCP gets no admin tools: this is a lasting rule, not a limit of today. Rejected: admin
  tools in MCP. A tool that lists accounts for users would be a user task and could come later.

## Current limits

- no Manager role for MCP: no deleting and restoring of pages, no deleted pages, and no creating or renaming of tabs
  through MCP (see "Manager role for MCP" in `roadmap.md`)
- no exact search-and-replace in a page: a change replaces the whole content (see "Exact search-and-replace for MCP" in
  `roadmap.md`)
- no connection to several folders at once, or to all folders of a user
- no page history, so a change made by an AI agent cannot be undone, and the page does not show that it came through
  MCP
- no search tool
- no resources and no prompts of the protocol, only tools
- no SSE, no sessions, no notifications and no subscriptions
- no rate limits of MCP requests
- no CORS: a client that runs in a browser on another origin cannot call an MCP address
- no tool that lists the accounts
