# MCP Folder Roles – Requirements

Status: approved

## Goal

An AI app reaches the wiki through MCP only for one folder and with one role, at an address of its own per folder and
role, such as `/mcp/<folder-uuid>/reader` or `/mcp/<folder-uuid>/writer`. The role of the address is the most the app
may do, and never more than the user's own role on the folder, so that a user can give an AI agent less than their own
access, for example read-only access to a folder in which they are a Writer. The Writer address adds tools to create
pages, replace their content, and move or rename them. Scopes disappear from OAuth and MCP: the address says what a
connection may do.

## Users and roles

- Accounts of the type user with a role on a folder (see `folder-roles.md`) connect AI apps to that folder.
- The role of an MCP address is Reader or Writer. Manager comes later; Owner is never available through MCP.
- A user may connect to an address whose role is at most the own role on the folder:
  - an Owner or a Manager: Writer or Reader (Manager later)
  - a Writer: Writer or Reader
  - a Reader: Reader only
- What a connection may do through MCP:

  | Through MCP                                                      | Reader address | Writer address |
  | ---------------------------------------------------------------- | :------------: | :------------: |
  | List the tabs and pages of the folder                            |       ✓        |       ✓        |
  | Read a page of the folder                                        |       ✓        |       ✓        |
  | Create a page in the folder or one of its tabs                   |                |       ✓        |
  | Replace the whole content of a page                              |                |       ✓        |
  | Move a page to another tab of the folder or out of it, rename it |                |       ✓        |

- Admins never use MCP, as today.

## Scenarios

- A Writer of the folder "Projects" opens the folder, opens "AI apps", copies the Reader address into an AI app and
  approves the connection on the consent page, which names "Projects" and Reader. The app lists and reads the pages of
  "Projects" and nothing else; it cannot change a page.
- The same user connects the Writer address of "Projects" and the Writer address of "Notes" in the same AI app. The
  app creates a page in "Notes" and replaces the content of a page in "Projects". `/account` lists the three
  connections, each with its folder and role, and all three work side by side.
- An Owner lowers that user to Reader on "Projects". The Writer connection to "Projects" is refused from the next
  request on, with a message that the role no longer allows the address; the Reader connection keeps working. When the
  Owner gives the Writer role back, the Writer connection works again.

## Requirements

### Addresses

- R1: The MCP server must be reachable only at the folder addresses `/mcp/<folder-uuid>/reader` and
  `/mcp/<folder-uuid>/writer`; the plain `/mcp` must no longer serve MCP.
  - Acceptance: a request to `/mcp` answers 404; a connected app works at a folder address.
- R13: A request to an address that is not a folder address, because the folder part is not a UUID or the role is not
  `reader` or `writer` (`owner` and `manager` included), must answer 404. A request to a folder address without a
  valid access token must answer 401 with the way to the authorization server, whether a folder of that UUID exists or
  not.
  - Acceptance: `/mcp/<uuid>/owner`, `/mcp/<uuid>/manager` and `/mcp/abc/reader` answer 404;
    `/mcp/<random uuid>/reader` without a token answers 401, like the address of an existing folder.
- R14: A request with a valid access token for its address, whose user has no role on the folder any more or a role
  below the role of the address, must answer 403 with a short message that the user's role on the folder does not
  allow this address. It must not ask the client to authorize again for more access.
  - Acceptance: the 403 carries no `insufficient_scope`; no tool runs.
- R20: A connection must keep working when its folder is renamed, because the address names the folder by its UUID.
  - Acceptance: after the folder is renamed, the connection lists and reads its pages, and `/account` shows the new
    name.

### Connections

- R2: A connection must be bound to exactly the one address, folder and role, it was approved for.
  - Acceptance: the access token of a connection to `/mcp/<A>/reader` is refused at `/mcp/<A>/writer` and at
    `/mcp/<B>/reader`.
- R3: A user must be able to hold several connections to different addresses at the same time, also from the same AI
  app.
  - Acceptance: connections to `/mcp/<A>/writer`, `/mcp/<A>/reader` and `/mcp/<B>/writer` all work side by side.
- R4: A user must be able to connect only to an address whose role is at most the own role on the folder.
  - Acceptance: a Reader cannot connect to the Writer address; a Writer, a Manager and an Owner can connect to both.
- R8: A new connection of an app must replace only the older connections of the same user to the same app at the
  same address; connections of that app to other addresses must stay.
  - Acceptance: connecting `/mcp/<A>/writer` again replaces the old `/mcp/<A>/writer` connection of that app and
    leaves its `/mcp/<A>/reader` and `/mcp/<B>/writer` connections working.
- R9: An authorization request that does not name the MCP address it connects to (the `resource` parameter) must be
  refused, and so must one that names an address that does not have the form of a folder address of this wiki (see
  R13). A well-formed folder address whose folder does not exist is answered by R18 instead, so that nothing tells
  which folders exist.
  - Acceptance: the consent page shows the error with the link "Return to <host>", which carries `invalid_target`;
    no code and no grant is made.
- R10: A connection whose role is above the user's current role on its folder, or whose user has no role on the
  folder any more, must be refused on every request while that lasts (see R14), and must work again once the role is
  high enough again. The connection itself stays.
  - Acceptance: after an Owner lowers a Writer to Reader, the Writer connection of that user is refused and the
    Reader connection works; after the role is raised to Writer again, the Writer connection works again; both stay
    listed on `/account`.
- R21: There must be no scopes any more: authorization requests, consent, grants and the metadata of OAuth and MCP
  name no scope, and a scope that a client sends is ignored.
  - Acceptance: the metadata documents list no scopes; a request with any `scope` is handled like one without.

### Consent page

- R11: The consent page must name the folder and the role the app asks for, and what that role allows through MCP.
  - Acceptance: connecting `/mcp/<uuid of Projects>/writer` shows "Projects" and Writer with what Writer allows.
- R18: The consent page must refuse a request for a folder that does not exist, for a folder without a role of the
  user, and for an address whose role is above the user's role, with one and the same message that no app can be
  connected to this address, and the link "Return to <host>", which carries `access_denied`. It offers no approval.
  - Acceptance: the three cases show the same page; no code and no grant is made.

### Connected apps

- R12: The list of connected apps on `/account` must show the folder name and the role of every connection.
  - Acceptance: two connections of the same app to different addresses appear as two entries, each with its folder
    and role.
- R16: A user must be able to hold up to 50 connected apps, expired ones included, instead of 20.
  - Acceptance: the 50th connection can be approved; at 50 the consent page asks to revoke one first.
- R17: The connections to the plain `/mcp` that exist before the update must be removed by the update; their users
  connect again to a folder address.
  - Acceptance: after the update `/account` lists none of them, and their tokens are refused.

### Read tools

- R15: The read tools must work on the folder of the connection only, without naming it: listing the tabs and pages
  of the folder, and reading a page by its tab, if it is in one, and its name. There must be no tool that lists
  folders, and no tool may reach another folder.
  - Acceptance: a Reader connection to "Projects" offers only these two read tools; nothing of another folder can be
    listed or read.
- R6: Reading a page must also give its version, which every change through MCP states (see `optimistic-locking.md`).
  - Acceptance: the version that `read_page` gives is accepted by a change of the page that nobody overtook.
- R22: The instructions that a client gets when it connects must name the folder and the role of the connection.
  - Acceptance: a Reader connection to "Projects" is told that it reads the folder "Projects" and cannot change it.

### Write tools

- R5: A Writer connection must offer, next to the read tools, three write tools; a Reader connection must not offer
  them.
  - Acceptance: the tools are listed for a Writer connection and not for a Reader connection; a call of one of them
    at a Reader address changes nothing.
- R23: Creating a page must take the content, the tab or none for a page placed directly in the folder, and an
  optional name. Without a name the page gets the name that the browser would suggest from its title. The content,
  the name and the tab follow the same rules as in the browser (see `pages.md` and `content-structure.md`); a Writer
  creates no tabs.
  - Acceptance: a page created without a name gets the suggested name; content without a title heading, a title that
    suggests no name and comes without a name, a taken name and a tab that does not exist are tool errors that say
    what to do next, and nothing is created.
- R24: Replacing the content of a page must take the page by its tab, if it is in one, and its name, the version it is
  based on, and the whole new content, which follows the same rules as in the browser.
  - Acceptance: the page has the new content and the title of its new heading; content without a title heading is a
    tool error and changes nothing.
- R25: Moving or renaming a page must take the page by its tab, if it is in one, and its name, the version it is based
  on, and the new tab or none and the new name; it stays in the folder of the connection.
  - Acceptance: the page is at its new place; a taken name and a tab that does not exist are tool errors and change
    nothing.
- R26: A change that is based on an older version than the stored one, or states no version, must be refused as in
  the browser, with a tool error that names who changed the page last and when, and tells the agent to read the page
  again.
  - Acceptance: two changes based on the same version: the first is stored, the second is refused and changes
    nothing.
- R27: A write tool must check the user's current role like every MCP request: a change by a connection whose role
  is too low changes nothing (see R14).
  - Acceptance: after the user is lowered to Reader, a write through the Writer connection is refused and the page
    stays as it was.

### Changes through MCP

- R19: A change through MCP must record the user of the connection as the last editor, as a change in the browser
  does; the page must not show that it came from an AI app. The server log must record that the change came through
  MCP, with the connection.
  - Acceptance: after a change through MCP the page names the user as the last editor and nothing else; the log line
    of the change names MCP and the connection.

### Finding the addresses

- R7: The folder must offer "AI apps" next to "Roles" to every role; it opens the view
  `/folders/<folder>?view=mcp`, which shows the full MCP addresses for the roles the user may use, each with a copy
  button and one sentence on what it allows.
  - Acceptance: a Reader sees only the Reader address, a Writer, a Manager and an Owner see both; the copied text is
    the full address.
- R28: Without `HIPPOWIKI_PUBLIC_URL`, where MCP and OAuth are off, the folder must not offer "AI apps", and its view
  must show the not-found page.
  - Acceptance: without the variable there is no "AI apps" entry and `?view=mcp` shows the not-found page.

## Scope

- In:
  - MCP addresses per folder and role, for Reader and Writer, instead of `/mcp`
  - connections bound to one address, checked against the current role on every request
  - the write tools: create a page, replace its whole content, move or rename it within the folder
  - removing scopes from OAuth, MCP and the connected apps
  - the folder view "AI apps" with the addresses
  - the consent page and `/account` naming folder and role, and the limit of 50 connected apps
- Not in:
  - the Manager role for MCP (later, "Manager role for MCP" in `roadmap.md`)
  - an exact search-and-replace in the content of a page (later, "Exact search-and-replace for MCP" in `roadmap.md`)
  - the Owner role for MCP, as a lasting rule
  - deleting and restoring pages, and creating or renaming tabs and folders through MCP (Manager and Owner functions)
  - a connection to several folders at once, or to all folders of a user
  - showing on a page that a change came through MCP
  - page history, and so undoing a change made by an AI agent
  - a search tool

## Effect on existing features

- MCP (`mcp.md`): `/mcp` is replaced by the folder addresses; MCP follows the folder roles instead of reading every
  folder, so the rule that the channel `mcp` ignores folder roles ends; `list_folders` goes, `list_folder` and
  `read_page` work on the folder of the connection, `read_page` gives the version; the server no longer only reads;
  new answers 403 and 404 at the folder addresses; the instructions name folder and role.
- OAuth (`oauth.md`): no scopes in the metadata, the authorization request, codes and grants; the `resource`
  parameter becomes required and must be a folder address, and the metadata of the protected resource is given per
  folder address; the consent page names folder and role and refuses a folder without the needed role; a new grant
  replaces only the older grants of the same client at the same address; the limit of 20 becomes 50.
- Connected apps (`connected-apps.md`): a connected app has a folder and a role instead of the scope `read`; the list
  on `/account` shows both; the limit of 20 becomes 50; the check of an access token checks the address and the
  current role instead of a scope, so `insufficient-scope` goes; the connections to `/mcp` are removed on the update.
- Folder roles (`folder-roles.md`): MCP follows the roles; pages change through MCP as well, so a write is no longer
  always one of the browser; the folder offers the view "AI apps" to every role.
- Optimistic locking (`optimistic-locking.md`): the MCP write tools exist and follow the rule; `read_page` shows the
  version.
- Roadmap (`roadmap.md`): "MCP rules for folder roles" is done by this feature; "MCP write tools" is partly done and
  no longer waits for page history; the tools of folders and tabs belong to "Manager role for MCP" and later.
- `README.md`: connecting an AI app uses the address from "AI apps" of a folder.

## Decisions

- A connection is bound to one address, so that a reduced role is a real limit: a token given to a reading agent can
  never write. Rejected: one connection that works at every address the user may use.
- The plain `/mcp` is removed, so that there is one kind of MCP address. Rejected: keeping `/mcp` as a reader of every
  folder with a role.
- The write tools are built now, before page history. Accepted: a change by an AI agent cannot be reverted until page
  history exists; the version check still keeps it from overwriting a newer change. Rejected: page history first.
- The folder shows its MCP addresses, because the folder UUID appears in no browser address. Rejected: only the README.
- A new connection replaces only the older connections of the same app at the same address, so that reconnecting
  does not pile up entries while connections to other addresses stay. Rejected: never replacing.
- A request without the `resource` parameter is refused, so that every grant knows its address; the MCP
  specification asks clients to send it. Rejected: picking a folder and a role on the consent page.
- A connection above the current role is refused but kept, so that nothing is deleted behind the user's back and a
  role given back restores it. Rejected: deleting the connection, and letting it work with the lower role, which
  would make the address say something else than what the connection can do.
- The consent page and `/account` both name the folder and the role, so that a user sees which agent may write
  where. Rejected: naming them on the consent page only.
- The read tools work on the folder of the connection without naming it, so that an agent cannot even try another
  folder. Rejected: the tools of today with a folder name and only one folder that answers.
- A role that no longer allows the address answers 403 without `insufficient_scope`, so that the user learns why and
  the client does not try to authorize again in a loop; an address that cannot exist answers 404, and every folder
  address without a token answers 401, so that a caller without a token learns nothing about which folders exist.
  Rejected: 404 for every refusal.
- The connections to the plain `/mcp` are removed on the update, because none of them names a folder address.
  Rejected: keeping them on `/account`, marked as no longer usable.
- The limit of connected apps per user is raised from 20 to 50, because a user now holds one connection per folder,
  role and app. Rejected: keeping 20.
- The consent page answers a missing folder, a missing role and a role too low alike, so that it tells nothing about
  which folders exist. Rejected: a message per case.
- A change through MCP shows only the user as the last editor, like a change in the browser; the log keeps the channel
  until page history can show it. Rejected: "via <app>" on the page.
- The MCP addresses are a view of the folder of their own, so that who has access (the roles view) and how to connect
  stay apart. Rejected: a section of the roles view.
- The name of a new page is optional for an agent and is then the name the browser would suggest, so that an agent
  needs to send only the content. Rejected: a name that is always required.
- Without the public URL the folder offers no "AI apps", like `/account` shows no apps then. Rejected: the view with a
  note.
- "Manager role for MCP" and "Exact search-and-replace for MCP" were added to `roadmap.md` during this conversation,
  on the user's explicit wish, as an exception to "What may change" of `requirements-workflow.md`.

## Open questions
