# MCP Manager Role – Steps

## Goal

An AI app connected to the new Manager address of a folder, `/mcp/<folder-uuid>/manager`, manages the folder's
content: besides reading and writing pages, it deletes pages and creates, renames and deletes tabs. A user whose
current role on the folder is Manager or Owner can connect it; deleted pages, restoring, the roles and the Owners stay
in the browser. The plan is written from `spec/mcp-manager-role-requirements.md` (approved).

## Scope

- In: the Manager address per folder, connecting to it, the four tools `delete_page`, `create_tab`, `rename_tab` and
  `delete_tab`, the instructions of a Manager connection, and the texts of the view "AI apps", the consent page and
  `/account` for the role Manager.
- Not in: seeing, reading or restoring deleted pages through MCP; seeing roles or Owners through MCP; renaming the
  folder and changing roles through MCP; an Owner address, as a lasting rule; a confirmation of `delete_tab` beyond the
  warning in its description; turning an existing Reader or Writer connection into a Manager connection (the user
  connects the app again to the Manager address); no new limits: the limit of 50 connected apps per user and every
  limit of names and pages stay as they are.

## Checklist

- [x] The services take the actor of MCP for deleting pages and for tabs
- [x] The Manager address
- [x] The tools `delete_page`, `create_tab` and `rename_tab`
- [ ] The tool `delete_tab` and the instructions of a Manager connection
- [ ] Wrap-up

## The services take the actor of MCP for deleting pages and for tabs

### Goal

The services that delete a page and create, rename and delete a tab can be called with the actor of MCP, log the
channel of the call, and deleting a tab returns the pages deleted with it, so that the tools of the later steps only
have to call them. The browser works as before. This step prepares R6, R7, R8, R9, R13 and R14; no requirement is met
by it alone, because there is no Manager connection yet.

### Build

- `deletePage()` in `src/features/pages/service.ts` and `createTab()`, `renameTab()` and `deleteTab()` in
  `src/features/folders/service.ts` take a `ContentActor` instead of a `BrowserActor`. Their role checks already go
  through `folderRoleOf()`, `roleOnFolderOfTab()` and `roleOnFolderOfPage()`, which give an actor of MCP the lower of
  the user's role and the role of the connection on the folder of the connection and no role elsewhere; the checks
  themselves do not change. Update the comments that speak of the actor of the browser only.
- The log lines of the tab writes ("tab created", "tab renamed", "tab deleted") name the channel and, for MCP, the
  grant, as the writes of pages do. Move `channelOf()` out of `src/features/pages/service.ts` to a place both services
  import (next to `ContentActor` in `src/features/folder-roles/service.ts`) instead of copying it. "page deleted"
  already names them; "tab deleted" keeps the number of pages.
- `deleteTab()` returns, in `DeletedTab`, besides the folder and the number, the pages deleted with the tab, each with
  its name and title, by name. The list comes from the same write in the same transaction that deletes them (for
  example with `updateManyAndReturn()` of Prisma), so that it holds exactly the pages that went with the tab, also when
  a page is moved out of the tab at the same time. It has no limit.
- The browser action `deleteTab` in `src/features/folders/actions.ts` and the dialog keep working unchanged; they may
  keep using the number.

### Test

- Integration, `integration/folder-service.test.ts`: `deleteTab()` returns the name and title of every page deleted
  with the tab, by name, and no page for an empty tab; with an actor of MCP of a Writer connection on the folder,
  `createTab()`, `renameTab()` and `deleteTab()` are `not-allowed` and change nothing; with an actor of MCP whose
  connection is for another folder, they are refused as for a role that is too low.
- Integration, `integration/page-service.test.ts`: `deletePage()` with an actor of MCP of a Writer connection is
  `not-allowed`, and the page keeps its version and stays undeleted.
- Unit, `src/features/folders/service.test.ts` (or where the log lines of these writes are checked today): the tab
  writes log the channel `browser` for an actor of the browser.
- End-to-end, the specs of the browser callers whose services changed: `e2e/tabs.spec.ts`, `e2e/delete-tab.spec.ts`,
  `e2e/delete-page.spec.ts` and `e2e/deleted-pages.spec.ts`.

## The Manager address

### Goal

A user whose current role on a folder is Manager or Owner connects an AI app to `/mcp/<folder-uuid>/manager`; the view
"AI apps", the consent page and `/account` name the role Manager and what it allows; the connection works only while
the user's role is Manager or Owner. The Owner role stays no role of MCP. Until the next steps a Manager connection has
the tools of a Writer connection. Covers R1, R2, R3, R4 and the Owner part of R11.

### Build

- A migration `prisma/migrations/<timestamp>_mcp_manager_role/migration.sql` replaces the check constraints
  `OAuthGrant_mcp_role` and `OAuthCode_mcp_role` with ones that allow `reader`, `writer` and `manager`; `owner` stays
  refused. Update the comments of the role of `OAuthGrant` and `OAuthCode` in `prisma/schema.prisma`.
- `src/features/folder-roles/roles.ts`: `MCP_ROLES` becomes Reader, Writer and Manager; `mcpRolesFor()` gives a
  Manager and an Owner all three; `MCP_ROLE_ABILITIES` gets one sentence for Manager that names, besides what a Writer
  may do, deleting pages and creating, renaming and deleting tabs, deleting a tab with its pages included. The
  comments say that Owner is no role of MCP.
- The places that follow `MCP_ROLES` through `isMcpRole()` and `McpRole` need no new logic, only their comments
  brought in line ("the check constraint keeps the role to Reader and Writer" and "the roles Owner and Manager answer
  404"): `src/features/mcp/http.ts`, `src/features/oauth/schema.ts`, `src/features/oauth/service.ts`,
  `src/features/grants/service.ts` and `src/lib/addresses.ts`. Check that the consent page
  (`src/app/oauth/authorize/page.tsx`), the view "AI apps" (`src/app/folders/[folder]/page.tsx`,
  `src/features/mcp/queries.ts`) and `/account` show the Manager address and the label Manager without further change,
  and adjust them where not.
- `src/features/mcp/tools.ts`: the write tools are registered for every connection whose role includes Writer
  (`includesRole()`), so that a Manager connection gets them. `ROLE_ABILITIES` gets an entry for Manager that, until
  the step of `delete_tab`, says what a Writer connection may do.
- `e2e/support/oauth.ts`: `mcpAddress()` takes the role Manager.

### Test

- Unit, `src/features/folder-roles/roles.test.ts`: `MCP_ROLES`, `isMcpRole()` for `manager` (true) and `owner`
  (false), and `mcpRolesFor()` for every role: one address for a Reader, two for a Writer, three for a Manager and an
  Owner.
- Unit, `src/features/mcp/http.test.ts` and `src/features/oauth/http.test.ts`: the Manager address of a folder is a
  folder address with its metadata of the protected resource; `/mcp/<folder-uuid>/owner` still answers 404.
- Unit, `src/features/mcp/queries.test.ts`: the three addresses of a Manager and an Owner.
- Unit, `src/features/mcp/tools.test.ts`: a Manager connection gets the two read tools and the three write tools.
- Integration, `integration/db-errors.test.ts`: the check constraints accept `manager` and still refuse `owner`, for a
  grant and for a code.
- Integration, `integration/oauth-service.test.ts`: an authorization request for the Manager address is valid for a
  Manager and an Owner, and refused for a Reader and a Writer with the same refusal as any role that is too low; one
  for `owner` stays `invalid_target` (R1).
- Integration, `integration/grant-service.test.ts`: the access token of a Manager grant is accepted while its user is
  Manager or Owner, is refused as a role that is too low after the user was lowered to Writer or Reader or lost the
  role, and is accepted again once the user is Manager again (R4).
- End-to-end, `e2e/ai-apps.spec.ts`: a Manager and an Owner see three addresses, each with its sentence and a copy
  button; a Writer sees the Reader and Writer addresses, a Reader the Reader address only (R2).
- End-to-end, `e2e/oauth.spec.ts`: a Manager and an Owner approve a connection to the Manager address; the consent
  page shows the folder, "Manager" and the sentence that names deleting pages and tabs; the app then lists the folder
  through MCP (R1, R3). A Reader and a Writer who start a connection to the Manager address get the refusal "No app can
  be connected to this address" (R1). An authorization request for the Owner address is still refused (R1, R11).
- End-to-end, `e2e/account.spec.ts`: a connection to the Manager address is listed with the folder and "Manager" (R3).
- End-to-end, `e2e/mcp.spec.ts`: `/mcp/<folder-uuid>/owner` still answers 404, while the Manager address answers 401
  without a token (the test of the addresses that are no folder addresses is changed); a Manager connection answers
  403 with the message that the role does not allow the address after its user was lowered to Writer, to Reader and
  after the role was removed, and works again without connecting anew once the user is Manager again (R4).
- The migration changes a constraint, so the complete `npm run test:e2e` runs in this step (see "When a step is done"
  in `spec/step-plan-workflow.md`).

## The tools `delete_page`, `create_tab` and `rename_tab`

### Goal

A Manager connection deletes a page, creates a tab and renames a tab, exactly as the browser does, with results and
tool errors an agent can act on. Covers R6, R7, R8, the hints of R10, R14 and R13 for these tools, and the part of R5
and R11 that concerns them.

### Build

In `src/features/mcp/tools.ts`, registered after the write tools and only for a connection whose role is Manager:

- `delete_page`: takes the page by its tab, if it is in one, its name and the version that `read_page` gave (the
  arguments of the other page writes). It finds the page with `getPage()` and calls `deletePage()` of the pages
  service. `not-allowed` is the message that the role does not allow the change, `page-not-found` the existing tool
  error of a missing page (also for a page deleted meanwhile), `page-changed` the existing message with who changed the
  page last and when, and `failed` the general message of a failed write. The result names the deleted page (name,
  title, the tab it was in), the full address of the deleted pages of the folder (`deletedPagesPath()` with the public
  URL) and that a Manager or Owner can restore it there in the browser. Hints: writes, destructive, not idempotent,
  closed world.
- `create_tab`: takes the name of the new tab and calls `createTab()` of the folders service on the folder of the
  connection. A name that breaks the name rule is a tool error with the rule, a taken name one that says a tab of that
  name exists and to choose another or use it; `folder-not-found` is the existing answer of a folder that cannot be
  read any more. The result names the tab and its address. Hints: writes, not destructive.
- `rename_tab`: takes the current name of the tab and the new name, finds the tab with `getTab()` and calls
  `renameTab()` without a version, as the browser does. An unknown tab, a name that breaks the name rule and the name of
  another tab are tool errors that say what to do next. The result names the tab and its new address. Hints: writes,
  not destructive.
- Every new tool runs through `run()` with the general message of a failed write, so that a failure of the database is
  logged and not passed on (R14).
- The tool error of a missing tab tells a Manager connection to create it with `create_tab`, and the other roles, as
  now, that tabs are created in the browser.
- Each tool has an output schema, gives its result as structured data and as text, and has a description that says
  what it changes and what it returns, like the existing tools.

### Test

- Unit, `src/features/mcp/tools.test.ts`: the three tools are registered for a Manager connection with their inputs,
  output schemas and hints (destructive on `delete_page`, write hints on all three); they are not registered for a
  Writer or a Reader connection, and a call of one through such a connection reaches no service (R5). Every error code
  of the services gives its tool error and changes nothing; `delete_page` without a version passes `null` on, which
  the service refuses as changed; the results with the full URL and with the path only; a failing database is logged
  and answered with the general message (R14).
- Integration, `integration/page-service.test.ts` and `integration/folder-service.test.ts`: with an actor of MCP of a
  Manager connection, `deletePage()`, `createTab()` and `renameTab()` work and record the user as the last editor or
  the user who deleted the page; with the same actor whose user was lowered to Writer they are `not-allowed` and change
  nothing (R14, the role lowered between the check of the request and the write).
- Unit, the service tests that check the log lines: a write with an actor of MCP logs the channel `mcp` and the grant
  (R13).
- End-to-end, `e2e/mcp.spec.ts`, in a group of its own for the tools of a Manager connection:
  - `delete_page` deletes a page: it is missing from `list_folder`, `read_page` answers that it does not exist, the
    result names the page, its tab and the full address `/deleted-pages/<folder>`, and in the browser the page is
    listed under "Deleted pages" of the folder with the user of the connection as the user who deleted it (R6, R13).
  - `delete_page` based on an older version, or on none, is refused with who changed the page last and when, and the
    page stays (R6); a page deleted already is answered like a page that does not exist (R11).
  - `create_tab` creates a tab that `list_folder` lists, into which `create_page` and `move_or_rename_page` put pages
    at once; the result names the tab and its address; a name that breaks the name rule and the name of an existing tab
    are tool errors and create nothing (R7).
  - `rename_tab` renames a tab: `list_folder` lists the tab and its pages under the new name and the pages under their
    new addresses; an unknown tab, a bad name and the name of another tab are tool errors and change nothing (R8).
  - A tab created and a tab renamed through MCP show the user of the connection as the last editor in the folder (R13).
  - A call of each of the three tools through a Writer and a Reader connection changes nothing (R5).

## The tool `delete_tab` and the instructions of a Manager connection

### Goal

A Manager connection deletes a tab with all its pages in one call, after a description that warns of it, and is told
in its instructions what the role Manager allows and what stays in the browser. Covers R9, the rest of R5, R10, R11
and R13, and R12.

### Build

- `delete_tab` in `src/features/mcp/tools.ts`, only for a Manager connection: takes the name of the tab, finds it
  with `getTab()` and calls `deleteTab()` of the folders service on the folder of the connection, without a further
  confirmation. A tab that does not exist, also one deleted meanwhile (`tab-not-found` of the service), is the tool
  error of a missing tab; `not-allowed` and `failed` are answered as by the other write tools.
- Its description says that every page in the tab is deleted with it, that the tab is deleted for good and cannot be
  restored, and that its pages can only be restored one by one by a Manager or Owner in the browser.
- Its result names the tab, the number of pages deleted with it and the name and title of each, without a limit, and
  says that a Manager or Owner can restore the pages one by one in the browser under "Deleted pages", with the full
  address `/deleted-pages/<folder>`. An empty tab gives the number 0 and no pages.
- Hints: writes, destructive, not idempotent, closed world.
- `ROLE_ABILITIES` for Manager, in `instructionsFor()`: the connection reads and writes the folder like a Writer, and
  deletes pages and creates, renames and deletes tabs; deleting a tab deletes all its pages with it; deleted pages can
  be neither seen nor restored through MCP, only by a Manager or Owner in the browser. The texts of Reader and Writer
  stay as they are.

### Test

- Unit, `src/features/mcp/tools.test.ts`: `delete_tab` is registered for a Manager connection with its input, output
  schema and the destructive hint; its description names the three points of R9; the tool list of a Manager connection
  has nine tools, that of a Writer five and that of a Reader two (R5, R10); every error code gives its tool error; the
  result of a tab with pages, of an empty tab and of a tab with more than a hundred pages, which lists every one (R9);
  the instructions of a Manager connection name the folder, the role Manager, what it allows, that deleting a tab
  deletes its pages and that deleted pages stay in the browser, and those of Reader and Writer connections are
  unchanged (R12).
- Integration, `integration/folder-service.test.ts`: `deleteTab()` with an actor of MCP of a Manager connection
  deletes the tab and all its pages with the user as the user who deleted them; with the same actor whose user was
  lowered to Writer it is `not-allowed` and changes nothing (R14).
- Unit, the service test that checks the log line of a tab deletion: it names the channel `mcp`, the grant and the
  number of pages (R13).
- End-to-end, `e2e/mcp.spec.ts`, in the group of the tools of a Manager connection:
  - `delete_tab` on a tab with five pages deletes the tab and the pages at once: the tab is missing from
    `list_folder`, `create_tab` with its name works at once, and every page is listed under "Deleted pages" of the
    folder with the user of the connection as the user who deleted it; the result names the tab, 5, the name and title
    of each page and the full address `/deleted-pages/<folder>` (R9, R13).
  - An empty tab is deleted as well, with the number 0 and no pages; a tab that does not exist, also one deleted in
    the browser meanwhile, is a tool error and changes nothing (R9).
  - The tool list of a Manager connection has the nine tools, with the destructive hint on `delete_page` and
    `delete_tab` and the write hints on the four tools of a Manager (R5, R10); there is no tool for deleted pages,
    roles, Owners or renaming the folder (R11).
  - A call of `delete_tab` through a Writer and a Reader connection changes nothing (R5).
  - `initialize` at the Manager address gives the instructions of a Manager connection (R12).

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs" in `step-plan-workflow.md`), or extend an
   existing feature spec, and move the rules and decisions of the requirements file that still hold into it; update
   `architecture.md`, `testing.md` or `tech.md` where conventions changed. For this feature, extend the existing specs,
   as "Effect on existing features" of the requirements file lists them:
   - `mcp.md`: the third address and role Manager, `owner` alone still 404, the four tools with their rules and
     results, the instructions of a Manager connection, the decisions of the requirements file (deleting a tab at once,
     the list of pages without a limit, the address of the deleted pages in the results, deleted pages and roles out
     of MCP, the accepted risk of a leaked Manager token), and "no Manager role for MCP" out of "Current limits".
   - `folder-roles.md`: through MCP the lower of the own role and the role of the connection, now Reader, Writer or
     Manager; the view "AI apps" shows the Manager address to a Manager and an Owner; the Owner role stays no role of
     MCP; the current limit about the Manager role.
   - `oauth.md`: an authorization request for the Manager address is valid; only `owner` and everything else stay
     `invalid_target`.
   - `connected-apps.md`: a connected app has the role Reader, Writer or Manager.
   - `content-structure.md`: tabs are created, renamed and deleted through MCP as well.
   - `page-deletion.md`: pages are deleted through MCP as well; deleted pages and restoring stay in the browser.
2. Remove the feature from `roadmap.md`.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and the requirements file of the feature, if there is one.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file and the requirements file.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
- `spec/` holds no rule that says Manager is no role of MCP, or that tabs are created, renamed and deleted only in the
  browser.
