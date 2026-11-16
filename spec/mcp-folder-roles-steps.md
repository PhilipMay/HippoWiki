# MCP Folder Roles – Steps

## Goal

An AI app reaches the wiki through MCP only for one folder and with one role, at an address of its own per folder and
role, `/mcp/<folder-uuid>/reader` or `/mcp/<folder-uuid>/writer`. The role of the address is the most the app may do,
and never more than the user's current role on the folder, so that a user can give an AI agent less than their own
access. The Writer address adds tools to create pages, replace their content and move or rename them. Scopes disappear
from OAuth and MCP: the address says what a connection may do.

The requirements are in `spec/mcp-folder-roles-requirements.md` (approved); every requirement ID below refers to it.

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

## Checklist

- [ ] Grants for a folder address
- [ ] MCP at the folder addresses
- [ ] Read tools on the folder of the connection
- [ ] Write tools
- [ ] The view "AI apps"
- [ ] Wrap-up

## Grants for a folder address

### Goal

Every authorization request names the folder address it connects to, the consent page names the folder and the role,
and the grant keeps both instead of a scope. Covers R4, R8, R9, R11, R12, R16, R17, R18 and R21. Until the next step
the plain `/mcp` keeps serving every grant of a user, as it does today; nothing is pushed in between.

### Build

- Addresses and roles:
  - `src/lib/addresses.ts`: `mcpFolderPath(folderId, role)` builds `/mcp/<folder-uuid>/<role>`.
  - `src/features/folder-roles/roles.ts`: the roles of MCP addresses (`MCP_ROLES`: `reader`, `writer`) and the MCP
    roles a user's role allows (`mcpRolesFor(role)`: Reader for a Reader; Reader and Writer for a Writer, a Manager and
    an Owner), with a unit test. Manager and Owner are never MCP roles in this feature.
  - `src/features/oauth/issuer.ts` and `src/features/oauth/schema.ts`: `parseMcpResource(value)` gives the folder id and
    the role of a value that is exactly `<HIPPOWIKI_PUBLIC_URL>/mcp/<uuid>/<reader|writer>` as `mcpFolderPath()` writes
    it, and `null` for anything else (the plain `/mcp`, `owner`, `manager`, no UUID, another host, a trailing slash, a
    query). `mcpResourceOf(folderId, role)` builds it. `mcpResource()`, `GRANT_SCOPES` and `GrantScope` go, and `scope`
    is no longer one of the parameters that the consent form carries.
- Database: in `prisma/schema.prisma`, `OAuthGrant` and `OAuthCode` lose `scopes` and get `folderId`, a relation to
  `Folder`, and `role` (`FolderRoleType`), with an index on the folder. A new migration
  `prisma/migrations/<timestamp>_mcp_folder_addresses/`, finished by hand (see "Database" in `architecture.md`):
  - it deletes every grant and every code before it adds the columns, because all of them name the plain `/mcp` (R17);
  - a check constraint keeps `role` of both tables to `reader` and `writer`;
  - deleting a folder deletes its grants and codes (`onDelete: Cascade`), like those of a user and of a client: a
    grant is no content, and no feature deletes folders yet.
- OAuth service (`src/features/oauth/service.ts`):
  - `checkAuthorizationRequest()` takes the actor. After the checks of today, a `resource` that is missing or not a
    folder address is refused with `invalid_target` (R9). Then an admin gets the admin refusal as today. Then the
    folder must exist and the user's current role on it must include the role of the address (`includesRole()`);
    a missing folder, a folder without a role of the user and a role too low are refused alike with `access_denied`
    and one description that no app can be connected to this address (R4, R18). A valid request carries the address:
    the folder with its id and name, and the role.
  - `createCode()` stores the folder and the role in the code; `exchangeCode()` gives them to the grant. A `resource`
    sent to the token endpoint must be the address of the code or of the grant (`invalid_target` otherwise), at the
    exchange and at a refresh.
  - `replacedGrants()` also matches the folder and the role, so that a new grant replaces only the older grants of the
    same client at the same address (R8). `isGrantLimitReached()` takes the address for the same reason.
  - `MAX_GRANTS_PER_USER` in `src/features/grants/service.ts` becomes 50 (R16).
  - No scopes anywhere: `TokenSet` loses them, the token endpoint answers without `scope`, the metadata of the
    authorization server and of the protected resource lose `scopes_supported` (R21).
- Grant service (`src/features/grants/service.ts`): `authenticateAccessToken(headers)` takes no scope any more, and
  `insufficient-scope` goes; the adapter of `/mcp` drops its 403 and the `scope` of its challenge. `GrantSummary`
  gets the folder name and the role of the grant.
- Consent page (`src/features/oauth/queries.ts`, `src/features/oauth/actions.ts`, `ConsentForm`): the consent shows the
  folder name, the role and in one sentence what the role allows through MCP, instead of what `read` allows (R11).
  The refusals of R18 show the page with the link "Return to <host>", like the other refused requests.
- `/account` (`ConnectedAppList`): every entry shows its folder and role, so that two connections of the same app to
  different addresses are two entries (R12).
- Test helpers: `authorizeUrl()` and `exchange()` of `e2e/support/oauth.ts` send a folder address as `resource` and no
  `scope`; `createGrant()` of `e2e/support/database.ts` takes a folder and a role instead of scopes.

### Test

- Unit tests: `parseMcpResource()` and `mcpResourceOf()` with every case named above; `mcpRolesFor()`; the mapping of
  the new refusals in `src/features/oauth/queries.test.ts` and `src/features/oauth/actions.test.ts`.
- `integration/oauth-service.test.ts`:
  - a request without `resource`, with the plain `/mcp`, with `owner` and with a value that is no folder address is
    refused with `invalid_target`; no code and no grant is made (R9)
  - a missing folder, a folder without a role of the user and a Reader asking for the Writer address get the same
    refusal with `access_denied`; no code and no grant is made (R18, R4)
  - a Writer, a Manager and an Owner get codes for both addresses (R4); the grant has the folder and the role
  - connecting `/mcp/<A>/writer` again replaces the old grant of that client there and leaves its grants at
    `/mcp/<A>/reader` and `/mcp/<B>/writer` (R8)
  - the 50th grant can be made, the 51st is `limit-reached`, replaced grants not counted (R16)
  - a request with any `scope` is handled like one without (R21)
  - an exchange and a refresh with the `resource` of another address are refused with `invalid_target`
- `integration/grant-service.test.ts`: the list gives the folder name and the role of every grant.
- `e2e/oauth.spec.ts`: the consent page of `/mcp/<uuid of Projects>/writer` shows "Projects", Writer and what Writer
  allows (R11); the three cases of R18 show the same page, whose link carries `access_denied`; a request without
  `resource` shows the error with a link that carries `invalid_target` (R9); the metadata documents list no scopes
  (R21).
- `e2e/account.spec.ts`: two connections of the same app to different addresses are two entries, each with folder and
  role (R12); with 50 connected apps the consent page asks to revoke one first (R16).
- `e2e/mcp.spec.ts`: the test of a grant without the scope `read` goes; the other tests use grants with a folder and a
  role.
- Manual check: a database with grants of today has none after `npm run db:migrate`, and `/account` lists none (R17).
- The schema and its migration change, so the complete end-to-end suite runs (see "When a step is done" in
  `step-plan-workflow.md`).

## MCP at the folder addresses

### Goal

The MCP server answers only at `/mcp/<folder-uuid>/reader` and `/mcp/<folder-uuid>/writer`, and a connection works only
at the address it was approved for and only while the user's current role on the folder allows that address. Covers
R1, R2, R3, R10, R13 and R14, and the part of R20 that the address names the folder by its UUID.

### Build

- Route: `src/app/mcp/route.ts` becomes `src/app/mcp/[[...path]]/route.ts`, which hands the request and its path
  segments to `handleMcpRequest()`. The matcher of `src/proxy.ts` lets `/mcp` and every address below it pass, so that
  the adapter answers them itself.
- Adapter (`src/features/mcp/http.ts`), in this order:
  1. without `HIPPOWIKI_PUBLIC_URL` 404, as today;
  2. a path that is not `<uuid>/<reader|writer>` 404, the plain `/mcp`, `owner`, `manager` and a part that is no UUID
     included (R1, R13);
  3. anything but `POST` 405, a foreign `Origin` 403, as today;
  4. the token: without a valid token for the address 401 with `WWW-Authenticate: Bearer`, `error="invalid_token"`
     where a token was sent, and the `resource_metadata` of the address, whether a folder of that UUID exists or not
     (R13); a token of another address is `invalid_token` as well (R2);
  5. a role that no longer allows the address 403 with a short JSON message that the user's role on the folder does
     not allow this address, without `insufficient_scope` and without a challenge, and no tool runs (R14).
- Grant service: `authenticateAccessToken(headers, address)` takes the folder id and the role of the address. A grant
  of another address is `invalid-token` (logged as `other-address` with the grant id). Then the user's current role on
  the folder (`folderRoleOf()` of the folder-roles service) must include the role of the grant; otherwise the new code
  `role-too-low`, logged with the grant id, the folder and both roles (R10, R14). The grant itself stays. The last use
  is written only for an accepted request. A valid result gives the actor and the connection: the grant id, the folder
  id and the role.
- Metadata of the protected resource (`protectedResourceMetadata()` in `src/features/oauth/http.ts`): served at
  `/.well-known/oauth-protected-resource/mcp/<uuid>/<role>` for every folder address, existing folder or not, naming
  that address as the resource. The plain `/.well-known/oauth-protected-resource`, the one followed by `/mcp` and every
  other path answer 404, because there is no resource at `/mcp` any more.
- The tools stay as they are in this step; the next step confines them to the folder of the connection.
- Test helpers: `listFoldersStatus()` of `e2e/support/oauth.ts` calls a folder address.

### Test

- `src/features/mcp/http.test.ts`: the order of the answers; 404 for `/mcp`, `owner`, `manager` and `abc`; 401 with the
  `resource_metadata` of the address and no `scope`; 403 for `role-too-low` without `insufficient_scope`.
- `src/features/oauth/http.test.ts`: the metadata per folder address and 404 for the other paths.
- `integration/grant-service.test.ts`: a token is refused at another folder and at another role (R2); after the role
  is lowered below the role of the grant, or removed, the result is `role-too-low` and the grant stays; after the role
  is raised again the token works (R10); the last use is not written for a refused request.
- `e2e/mcp.spec.ts`:
  - `/mcp` answers 404; a connected app works at its folder address (R1)
  - `/mcp/<uuid>/owner`, `/mcp/<uuid>/manager` and `/mcp/abc/reader` answer 404; `/mcp/<random uuid>/reader` without a
    token answers 401 like the address of an existing folder (R13)
  - the access token of a connection to `/mcp/<A>/reader` is refused at `/mcp/<A>/writer` and at `/mcp/<B>/reader`
    (R2)
  - connections to `/mcp/<A>/writer`, `/mcp/<A>/reader` and `/mcp/<B>/writer` all work side by side (R3)
  - after an Owner lowers a Writer to Reader, the Writer connection answers 403 without `insufficient_scope` and no tool
    runs, while the Reader connection works; after the role is raised again the Writer connection works; both grants
    are still there (R10, R14)
  - after the folder is renamed the connection still works (R20)
- `e2e/oauth.spec.ts`: a connector finds the authorization server from the 401 of a folder address; the metadata of a
  folder address names it; `/.well-known/oauth-protected-resource` and the one followed by `/mcp` answer 404.
- `e2e/access.spec.ts`: the folder addresses of MCP are public to the proxy and answer for themselves.
- `src/proxy.ts` changes, so the complete end-to-end suite runs.

## Read tools on the folder of the connection

### Goal

Through MCP a user reads only the folder of the connection, with the lower of the role of the connection and the own
current role, and the read tools work on that folder without naming it. Covers R6 (the version), R15, R20 and R22.

### Build

- Actor of MCP (`src/features/folder-roles/service.ts`): `inMcp(user, connection)` builds an actor with the channel
  `mcp` and its connection (grant id, folder id, role). The role checks of the service (`folderRoleOf()`,
  `roleOnFolderOfTab()`, `roleOnFolderOfPage()`, `readerOf()`, `readableFolderWhere()`, `roleSelection()`,
  `mayReadFolder()`, `mayReadTab()`) give an actor of MCP the lower of the user's current role and the role of the
  connection on the folder of the connection, and no role on every other folder. The rule that the channel `mcp`
  ignores folder roles ends; the services that call these functions need no change of their own.
- Folder service: a read of a folder by its id for the adapter and the tools, if none fits already.
- Adapter: after the token check it reads the folder of the connection with the actor of MCP, for its name, and answers
  like R14 if it is gone; it passes the actor, the connection and the folder name to `createWikiServer()`.
- Tools (`src/features/mcp/tools.ts`):
  - `list_folders` goes (R15).
  - `list_folder` takes no arguments and lists the tabs and pages of the folder of the connection, as today.
  - `read_page` takes the tab, if any, and the page name, and gives the version of the page next to what it gives
    today (R6).
  - The instructions are built per connection: they name the folder and the role and say what the role allows; a
    Reader connection is told that it reads the folder and cannot change it (R22). The text no longer mentions
    `list_folders`.
  - The tool errors no longer name a folder argument; a missing page names the tab and points to `list_folder`.

### Test

- `src/features/mcp/tools.test.ts`: the two read tools and their inputs; `read_page` gives the version; the
  instructions name the folder and the role.
- `src/features/folder-roles/service.test.ts`, `integration/folder-role-service.test.ts`,
  `integration/folder-service.test.ts` and `integration/page-service.test.ts`: an actor of MCP reads the folder of its
  connection with the lower of the two roles; another folder on which the user has a role reads like one that does not
  exist; a user without a role on the folder of the connection reads nothing.
- `e2e/mcp.spec.ts`: a Reader connection to "Projects" offers only `list_folder` and `read_page`, lists and reads the
  pages of "Projects", and nothing of another folder can be listed or read (R15); the test that a grant reads a folder
  without a role of its user is replaced by one that it cannot; `read_page` gives the version (R6); `initialize` tells
  a Reader connection that it reads "Projects" and cannot change it (R22); after the folder is renamed the connection
  lists and reads its pages under the new name (R20).
- `e2e/account.spec.ts`: after the folder is renamed `/account` shows the new name (R20).
- `src/features/folder-roles/service.ts` changes the reads of every content page, so the end-to-end specs of the
  content run: `folders`, `tabs`, `pages`, `all-pages`, `create-page`, `edit-page`, `move-or-rename-page`,
  `delete-page`, `deleted-pages`, `restore-page`, `folder-roles`, `access` and `mcp`.

## Write tools

### Goal

A Writer connection creates pages in the folder of the connection, replaces their whole content and moves or renames
them, by the same rules as the browser and with the version check of `optimistic-locking.md`. Covers R5, R6 (the
acceptance), R19 and R23 to R27.

### Build

- Page service (`src/features/pages/service.ts`): `createPage()`, `updatePageContent()` and `moveOrRenamePage()` take
  the actor of the browser or of MCP; `deletePage()`, `restorePage()` and the writes of folders and tabs keep the actor
  of the browser only. The role check is the one of the previous step, so a Reader connection, another folder and a
  lowered role give `not-allowed` and change nothing (R5, R27). The user stays the last editor (R19). The log line of
  every write names the channel and, for MCP, the grant id (R19). `StoredPage` gets the version, so that a tool can
  give it back.
- Tools (`src/features/mcp/tools.ts`), registered only for a Writer connection (R5), each with a description that says
  what it changes and the annotations of a tool that writes:
  - `create_page`: the content, the tab or none for a page placed directly in the folder, and an optional name.
    Without a name the page gets `deriveName()` of its title, the name the browser suggests. The tab is looked up by
    name in the folder of the connection. Content without a title heading, a title that suggests no name and comes
    without a name, a name that breaks the name rule, a taken name and a tab that does not exist are tool errors that
    say what to do next, and nothing is created (R23). A Writer creates no tabs.
  - `replace_page_content`: the tab, if any, the page name, the version and the whole new content; the title comes from
    the new heading; content without a title heading is a tool error (R24).
  - `move_or_rename_page`: the tab, if any, the page name, the version, the new tab or none, and the new name, within
    the folder of the connection; a taken name and a tab that does not exist are tool errors (R25).
  - `page-changed`, and a version that is missing or not valid, give a tool error that names who changed the page last
    and when, and tells the agent to read the page again (R26).
  - `not-allowed` gives a tool error that the role on the folder does not allow the change.
  - Every result gives the page as stored, with its name, title, tab, address and new version.
- The instructions of a Writer connection name the write tools and that every change states the version that
  `read_page` gave.

### Test

- `src/features/mcp/tools.test.ts`: the write tools are registered for a Writer connection and not for a Reader
  connection; their input schemas; every error code is mapped to its tool error.
- `src/features/pages/service.test.ts`: the log line of a write through MCP names `mcp` and the grant id (R19).
- `integration/page-service.test.ts`: an actor of MCP creates, saves and moves pages in the folder of its connection;
  a Reader connection, another folder and a lowered role give `not-allowed` and change nothing; the user is the last
  editor.
- `e2e/mcp.spec.ts`:
  - the write tools are listed for a Writer connection and not for a Reader connection; a call of one at a Reader
    address changes nothing (R5)
  - a page created without a name gets the suggested name; content without a title heading, a title that suggests no
    name without a name, a taken name and a tab that does not exist are tool errors, and nothing is created (R23)
  - replacing the content gives the page the new content and the title of its new heading; content without a title
    heading is a tool error and changes nothing (R24)
  - moving and renaming puts the page at its new place; a taken name and a missing tab are tool errors and change
    nothing (R25)
  - the version that `read_page` gives is accepted (R6); of two changes based on the same version the first is stored
    and the second is refused with who changed the page last and when, and changes nothing (R26)
  - after the user is lowered to Reader, a write through the Writer connection is refused and the page stays as it
    was (R27)
  - after a change through MCP the page in the browser names the user as the last editor and nothing else (R19)
- Manual check: the server log of a change through MCP names `mcp` and the grant id (R19).
- The writes of the page service change, so the end-to-end specs of the page writes run: `create-page`, `edit-page`,
  `move-or-rename-page`, `delete-page`, `restore-page`, `folder-roles` and `mcp`.

## The view "AI apps"

### Goal

The folder shows the MCP addresses that the user may use, so that the folder UUID, which appears in no browser
address, can be copied into an AI app. Covers R7 and R28.

### Build

- `src/features/mcp/queries.ts`: `listMcpAddresses(folder, role)` gives, for the roles of `mcpRolesFor()`, the full
  address (`HIPPOWIKI_PUBLIC_URL` and `mcpFolderPath()`) with the role; `null` without the public URL.
- Folder route `src/app/folders/[folder]/page.tsx`: the view `mcp` next to `all` and `roles`, with the browser title
  "AI apps – <folder>"; the button "AI apps" next to "Roles" for every role, only with the public URL. The view has a
  breadcrumb back to the folder and lists each address with its role, one sentence on what it allows through MCP, and
  a copy button. Without the public URL `?view=mcp` shows the not-found page (R28).
- A small Client Component for the address with its copy button, locked until hydration (see "UI" in
  `architecture.md`); the copied text is the full address.
- `folderMcpPath(folder)` in `src/lib/addresses.ts` builds the address of the view, like `folderRolesPath()`.

### Test

- Unit tests: `listMcpAddresses()` for every role and without the public URL; the new address helper.
- New `e2e/ai-apps.spec.ts`: a Reader sees only the Reader address, a Writer, a Manager and an Owner see both; the
  copied text is the full address (R7); the view together with an action shows the not-found page.
- `e2e/hydration.spec.ts`: the copy button stays disabled without JavaScript.
- `e2e/access.spec.ts`: `?view=mcp` without a login leads to the login page.
- Manual check: without `HIPPOWIKI_PUBLIC_URL` the folder offers no "AI apps" and `?view=mcp` shows the not-found page
  (R28); the end-to-end server always runs with the variable.
- The end-to-end specs that run: `ai-apps`, `folders`, `folder-roles`, `hydration` and `access`.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs" in `step-plan-workflow.md`), or extend an
   existing feature spec, and move the rules and decisions of the requirements file that still hold into it; update
   `architecture.md`, `testing.md` or `tech.md` where conventions changed. For this feature, as "Effect on existing
   features" of the requirements lists it:
   - `mcp.md`: the folder addresses instead of `/mcp`, the answers 404, 401 and 403, the actor of MCP with its
     connection, the read tools without `list_folders`, the version, the write tools, the instructions per connection,
     the log of a change through MCP; its "Current limits" and "Decisions"
   - `oauth.md`: no scopes, the required `resource` as a folder address, the metadata per folder address, the consent
     page with folder and role and its refusals, the replacement per address, the limit of 50
   - `connected-apps.md`: folder and role instead of the scope `read`, the list on `/account`, the limit of 50, the
     check of an access token by address and current role with `role-too-low`, the removal of the connections to `/mcp`
   - `folder-roles.md`: MCP follows the roles, writes through MCP, the view "AI apps"
   - `content-structure.md`: the view `?view=mcp` among the actions and views of a folder
   - `optimistic-locking.md`: the MCP write tools follow the rule, `read_page` gives the version
   - `architecture.md`: the actor of MCP and its connection, the writes that take it, the route
     `src/app/mcp/[[...path]]/route.ts`, the matcher of `src/proxy.ts`, the addresses
   - `testing.md`: `e2e/mcp.spec.ts` calls the folder addresses, `e2e/ai-apps.spec.ts`
2. Remove the feature from `roadmap.md`: "MCP rules for folder roles" is done; "MCP write tools" keeps only what is
   left (the tools of folders and tabs, which belong to "Manager role for MCP" and later) and no longer waits for page
   history or a scope `write`.
3. Check that `README.md` has all the commands a developer needs, and that "MCP server" says that an AI app connects
   with an address from "AI apps" of a folder.
4. Delete this step file and the requirements file of the feature, if there is one.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file and the requirements file.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
