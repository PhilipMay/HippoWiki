# HippoWiki – Architecture and Conventions

How the code is organised and which patterns new code follows. The technology stack is defined in `tech.md`.

## Terms

The documents use one name for each of these things:

- The browser: the pages, forms and Server Actions that a person uses. A caller other than the browser calls the
  services without them; today that is the MCP server.
- An item: a folder, a tab or a page. The route segment `[item]` is narrower: a tab or a page placed directly in the
  folder.
- The actor: the user a read or write is done for, with the channel of the call, `web` for the browser and `mcp` for
  MCP (see "Actors, channels and roles").
- An AI app: a program that works with the wiki through MCP, as the folder view "AI apps" calls it. To OAuth it is a
  client, an OAuth client once it is registered. "Connector" names only the feature of a product, such as the custom
  connectors of claude.ai.
- A connected app: the grant of a user to an AI app at one MCP address, a folder and a role, as the account page lists
  it. The code and the database call it a grant; at the MCP address it is a connection.
- The version and the revision of a page: the version counts the stored changes of a page, for optimistic locking
  (`optimistic-locking.md`); a revision is a stored state of its content, in its history (`page-history.md`).

## Layout

- Source code lives under `src/`, with the import alias `@/` pointing to `src/`.
- `src/app/`: routes (App Router), including the global `not-found`, `error` and `global-error` pages
- `src/proxy.ts`: the proxy of Next.js, which sends requests without a session cookie to the login page (see "Login
  and sessions")
- `src/components/`: shared UI components (app bar, `Link`, and the pieces of the lists and heads: `Time` for a point
  in time, `EmptyState` for a list without items, `HeadingWithActions` for a heading with its row of buttons, and
  `ActionDialog.tsx`, the frame of the dialogs, see "UI")
- `src/lib/`: cross-cutting modules, such as the environment, the database client, the logger, the name rule, the
  addresses, the revalidation after a write, the type `Result`, the Better Auth instance and the password hashing.
  What each module holds is in the module itself. A module that a Client Component imports, such as `names.ts` or
  `addresses.ts`, has no server-only imports.
- `src/features/<feature>/`: everything about one feature:
  - `schema.ts`: the ids, the Zod schemas and the types of validated input
  - `service.ts`: every read and write of the feature (see "Services"). A part of a feature that stands on its own may
    have a service module of its own next to it, named `<part>-service.ts`, such as `history-service.ts` of the pages
    with the reads of the history of a page. Every rule of a service holds for it as well.
  - `forms.ts`: what only a form needs: the `parse*FormData` functions, the form states, the types of the form
    actions and the names of form fields. It has no server-only imports, so Client Components can use it.
  - `queries.ts` and `actions.ts`: the adapters between the browser and the service; `http.ts` is the adapter of a
    caller other than the browser (see "Callers other than the browser")
  - `components/`, and pure helpers such as `derive.ts` and `limits.ts`, without server-only imports, so that Client
    Components can use them. `limits.ts` holds the limits of the fields, so that the schemas, the helpers and the
    components share them without importing each other; for users, so that Client Components show the limits without
    importing `schema.ts`, which would put the list of common passwords into the bundle for the browser. For the same
    reason the type of an account and `isAdmin()` live in `src/features/users/user-type.ts`.
- The features, whose specs are listed in `CLAUDE.md`:

  | Feature        | What it holds                                       | Modules of its own                                                                                                                                                                                               |
  | -------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `folders`      | folders and their tabs                              | `folder-query.ts`: what a folder or tab address shows                                                                                                                                                            |
  | `pages`        | pages, their deletion and their history             | `history-service.ts`, `writes.ts` (the data of a soft delete), `page-query.ts`, `markdown.ts`, `diff.ts`, `changed-page.ts`, `fields.ts`                                                                         |
  | `folder-roles` | the roles of users on folders                       | `roles.ts` (the roles and the lowest role of each function), `actors.ts` (the actors of the content and the guards of a content write)                                                                           |
  | `users`        | the accounts                                        | `user-type.ts`, `records.ts`, `password.ts`                                                                                                                                                                      |
  | `auth`         | login, logout, the session and the login wait       | `session.ts`: who is calling (see "Login and sessions")                                                                                                                                                          |
  | `grants`       | the connected apps and the check of an access token | `limits.ts`: the limit of connected apps per user                                                                                                                                                                |
  | `mcp`          | the MCP server and the folder view "AI apps"        | `server.ts` (the tools a connection gets), `tools.ts` (their handlers), `tool-schemas.ts` (their inputs and outputs), `edits.ts` (the replacements of `edit_page_content`), `http.ts`                            |
  | `search`       | search in a folder, in the browser and through MCP  | `text.ts` and `language.ts` (what search derives of a page), `index-data.ts` (what a write stores), `words.ts` (the parser of the search words), `query-text.ts`, `excerpt.ts`, `slots.ts`, `limits.ts`          |
  | `oauth`        | the OAuth authorization server for AI apps          | `clients-service.ts`, `authorization-service.ts`, `token-service.ts`, `cleanup-service.ts`, `rows.ts` (what they share), `issuer.ts` (the issuer and `isOAuthOn()`), `secret.ts`, `metadata-fetch.ts`, `http.ts` |

- `src/test/`: the helpers of the unit tests, no code of the app (see "Unit tests" in `testing.md`)
- `src/generated/prisma/`: the generated Prisma client (`npm run db:generate`), not checked in
- `prisma/`: schema, migrations, seed, and `known-users.ts`, the known users of the seed and the tests
- `scripts/`: development scripts (`db.sh`), the admin setup (`admin.ts`) and the scripts of the container image
  (see `container-image.md`)
- `e2e/`: Playwright tests
- `integration/`: Vitest integration tests against the test database

## Reads and writes

How a request reaches the database, in six parts: the layers, the services, the actors, the queries, the actions and
the callers other than the browser.

### Layers

- A route or component calls `queries.ts` or `actions.ts`, these call a service module (`service.ts` or a
  `<part>-service.ts` next to it), and only a service module calls `getDb()`. Routes and components import a service
  only for its types. Two modules outside a feature call `getDb()` as well: the health route
  (`src/app/api/health/route.ts`), which checks the database connection itself, and `src/lib/auth.ts`, which hands the
  client to Better Auth.
- A caller other than the browser has an adapter of its own in place of `queries.ts` and `actions.ts` (see "Callers
  other than the browser"). It calls the same services.
- ESLint holds these layers (see "Linting").

### Services

- A service holds every read and write of its feature, apart from a part that has a service module of its own: the
  reads of the history of a page are in `src/features/pages/history-service.ts`, while reverting, a content save,
  stays in the pages service.
- It knows nothing about Next.js, forms or addresses, so that a caller other than the browser can use the same
  service: it imports nothing from `next`, `react`, `@/lib/revalidate` or a `forms.ts`, has no `"use server"`, works
  outside a request and takes plain typed arguments (ids, names, objects of strings), never `FormData`.
- It trusts no caller: it parses ids and names and validates its input again (see "Validation and errors").
- It is the place for checks of who may read or change something. Such checks never go into the adapters, which a
  caller other than the browser does not pass through. A function that not every account may call takes the actor as
  its first argument and decides itself (see "Actors, channels and roles").
- Reads return rows, a list or `null`. A malformed id or name counts as a missing row (see "Validation and errors"):
  a list is empty, a single item is `null`. A read that the actor may not do returns `null`, a list included. Database
  errors are thrown.
- The one read with outcomes of its own is `searchPages()` of the search service. It returns a `Result`, with a code
  for words that are no search (`no-words`, `too-long`), a search that the database stopped after its time limit
  (`too-broad`) and one refused because enough searches were running (`busy`), because the browser and MCP tell the
  user why there are no results. Like every read, it returns `null` for what the actor may not read.
- Writes return a `Result` from `src/lib/result.ts`: `{ ok: true, value }` with the item as stored, or
  `{ ok: false, error }` with a code. The errors that several services share and `invalidInput()`, which builds
  `invalid-input` with the `fieldErrors` of a schema, are declared there as well. Each write declares the codes it can
  return in a union type next to it, such as `CreatePageError`, and the lint rule for exhaustive switches (see
  "Linting") makes every adapter handle each one.
- A write checks, in this order: the actor (an admin gets `not-allowed` for content), the id of the actor, the ids of
  its arguments, the role of the actor on the folder, its input, the version of the row, and then writes. The writes
  of roles check that the actor is an Owner before they look at the input, so that the answer to anyone else does not
  depend on it.
- A write that would store what is stored already stores nothing: the item keeps its last editor, its time and its
  version, the write answers as a stored change does, and it is logged in a line of its own. The feature specs
  describe each case (see "Saves without a change" in `pages.md` and the sections on changes to the own name in
  `content-structure.md`).
- Rows that may no longer exist are changed with `updateMany` and the returned count is checked, instead of catching
  "not found" errors.
- A write that is based on a version of its row, such as a content save, move, rename or delete of a page, checks the
  version in the condition of the write itself and counts it up in the same write (see `optimistic-locking.md`).
- A write that changes the content of a page also stores the revision of the change, in the same interactive
  transaction (`storeContentChange()` of the pages service). Every content save, reverts included, goes through it, so
  that the page and its history never disagree (see `page-history.md`).
- It logs the events of its writes: the stored item, a taken name, an item that was not found in the database and
  an unexpected error. A malformed id and invalid input are not logged.
- It returns no addresses and no messages, except the field errors of the schemas in `invalid-input`. The stored
  item carries what an address is built from: its name and the names of its folder and tab. The exceptions:
  - The services of grants and OAuth build the public MCP address of a folder with `src/features/oauth/issuer.ts`,
    because OAuth names a connection by it.
  - The service modules of OAuth return messages: an error that a client is told about carries its description
    (`error_description` of RFC 6749), because the protocol sends it to the client as it is; the adapters add only the
    texts of their own answers, such as a failed write. An error that no client is told about, such as
    `unknown-client` and `foreign-redirect-uri` of an authorization request, carries no description.
- A helper that two services need lives in a pure module of the feature that owns the rule, not in one of the two
  services: `src/features/folder-roles/actors.ts` for the actors and the guards of a content write,
  `src/features/pages/writes.ts` for the data of the soft delete of a page, which the delete of a tab stores for its
  pages inside its own transaction.
- It declares the types of its results itself (`FolderSummary`, `PageWithPlace`, `StoredPage` and the like) instead
  of deriving them from a Prisma query, states the return type of every function, and names the columns of every
  query with `select`, never `include`, so that a new column does not reach a caller by accident. Components import
  these types from the service with `import type`.
- The auth service is the only code that uses Better Auth (`getAuth()` from `src/lib/auth.ts`). It takes the
  `Headers` of the request, a web standard, because the session lives in a cookie, and returns the response headers
  that set or clear it. `logIn()` also takes the client address group of the request as a plain string, after the
  headers; the service never reads a forwarding header itself.
- Its functions have the names of the queries and actions, so the adapters import it as a namespace:
  `import * as folderService from "@/features/folders/service"`.

### Actors, channels and roles

- A function that not every account may call takes the acting user as its first argument (`Actor` in the users
  service: `id`, `name` and the type of the account) and decides with `isAdmin()` of
  `src/features/users/user-type.ts`, by the type and never by the name. Examples: `createUser(actor, input)` answers
  `not-allowed` for a user, `listUsers(actor)` leaves out the pending password changes for a user, and the grant
  service answers `null` and `not-allowed` for an admin. The adapters find the actor from the session (see "Login and
  sessions").
- Every read and write of content (folders, tabs, pages and deleted pages) takes the actor together with the channel
  of the call, `web` or `mcp` (`ContentActor`, `BrowserActor` and `McpActor` in
  `src/features/folder-roles/actors.ts`; `inBrowser()` and `inMcp()` build them), which no caller can leave out. The
  same two values are the channel the content stores with its last editor and the channel of every log line (see
  "Channel" in `content-structure.md`). The actor of MCP also carries its connection: the grant, the folder and the
  role of its address. The queries and actions pass the actor of the browser, the MCP tools the actor of MCP.
- The type of the first argument says which channel a function accepts: `ContentActor` for what MCP may do as well,
  `BrowserActor` for what only the browser does (creating and renaming folders, reverting, restoring, the reads of
  the history). Which tools exist is in `mcp.md`. The writes of roles take a plain `Actor` and are not offered through
  MCP.
- `actors.ts` is a pure module: it also holds the guards that the services of folders, pages and folder roles share,
  among them `openContentWrite()`, the opening of every content write (an admin gets `not-allowed`, a malformed actor
  id `failed`, otherwise the last editor and the channel to store).
- An admin sees no content: for an admin a read returns `null` and a write `not-allowed`, logged with the actor id,
  before anything else is checked and without asking the database (see "Only users see content" in
  `content-structure.md`).
- Then the role of the actor on the folder is checked with the functions of the folder-roles service and `mayDo()` of
  `roles.ts`, before any other database work that could tell whether an item exists: a read without the needed role
  returns `null`, a write `not-allowed`, logged with the folder, tab or page and the role (see `folder-roles.md`). For
  the actor of MCP these functions give the lower of the user's role and the role of the connection on the folder of
  the connection, and no role on every other folder, so the services need no rule of their own for MCP.
- A write stores the user as the last editor of the item (see "Last editor" in `content-structure.md`), and its log
  line names the channel and, for MCP, the grant. It parses the actor's id like every other id; a malformed id gives
  `failed` and is logged as an error, because only a broken caller can cause it. Pure helpers such as
  `directPageFirstPerName()` take no actor.
- A route decides which buttons, actions and views to offer with the role that the folder read returns and `mayDo()`
  of `roles.ts`, the same function the services use, so that a route and a service never disagree about a role. An
  action or view beyond the role shows the not-found page before the content is read.

### Queries

- Reads happen in Server Components through the feature's `queries.ts`.
- Every query first awaits `connection()`, so that Next.js does not prerender the route at build time, then
  `requireUser()` (see "Login and sessions"), and then calls the service read of the same name with that user as the
  actor. A route shows the not-found page when a read returns `null`.
- Queries that are used by both `generateMetadata` and the page are wrapped in React `cache()`.
- The rules of "Queries" and "Actions" hold for the queries and actions of a page behind the login. The exceptions,
  each for its reason:
  - `listMcpAddresses()` of the MCP feature is synchronous and calls no service: it builds the addresses of the view
    "AI apps" from the folder and the role that the folder query of the route has read after the login.
  - `loadConsent()` of the OAuth feature has no service read of its name: it puts the checks of the consent page
    together, so that they can be unit tested (see `testing.md`).
  - `logIn()` and `logOut()` call neither `requireUser()` nor `requireSession()`, because they are what makes and ends
    a session, and `changeFirstPassword()` calls `requireSession()`, because `requireUser()` would send the user back
    to the password change.
  - `changeOwnPassword()` and `logOutOtherBrowsers()` of the auth feature call `requireUser()` like every action, but
    read the client address group (the first) and redirect to `/account` with a notice of what they did instead of
    to an item; `approve()` of the OAuth feature checks the password through `verifyOwnPassword()` of the auth feature
    before it calls its service.
  - The actions of users, grants and auth revalidate their own paths instead of calling `revalidateContent()`,
    because they change no content.

### Actions

- Writes happen through Server Actions in the feature's `actions.ts`. Values such as the id are bound with
  `action.bind(null, id)`.
- An action first calls `requireUser()` (see "Login and sessions"), outside its `try` blocks. Then it checks the id,
  parses the form with a `parse*FormData` function of `forms.ts`, calls the service and maps the result.
- It maps every error code to a form state `{ fieldErrors?, message? }` in a `switch`; the form shows the state and
  keeps the entered values. `not-allowed` is mapped to `notFound()`: what an account may not change does not exist for
  it. The messages live in `actions.ts`, apart from the message of a taken name, which is `NAME_TAKEN_MESSAGE` of
  `src/lib/names.ts`. Actions that do the same thing share a message for `failed`, such as the content saves, moves
  and renames of a page.
- On success it calls `revalidateContent()` from `src/lib/revalidate.ts`, which covers every address under `/folders`
  and `/deleted-pages` (the module says why both), and redirects to the address of the item as stored, built from the
  result of the service with the helpers in `addresses.ts`, never to one built from submitted values.
- `redirect` and `notFound()` throw, so `redirect` is called last, and both outside `try` blocks.

### Callers other than the browser

- A caller other than the browser has an adapter named `http.ts` in its feature. The MCP server is the first: the
  route `src/app/mcp/[[...path]]/route.ts` only hands the request and the segments of its path to
  `handleMcpRequest()` in `src/features/mcp/http.ts`, which answers every path that is no folder address with 404,
  finds the actor and the connection from the bearer token instead of the session (see "Login and sessions"), reads
  the folder of the connection and passes the request to the MCP SDK with the actor of MCP and the folder. The server
  of `src/features/mcp/server.ts` registers a tool only when the role of the connection may do the function that its
  write checks (`mayDo()`), so the tools follow `FUNCTION_ROLES` like the services; the tools of
  `src/features/mcp/tools.ts` call the services of the folders and pages with that actor. The server, the tools and
  their schemas import nothing from `next` or `react`, like a service.
- The public endpoints of OAuth work the same way: the routes under `src/app/.well-known/` and
  `src/app/oauth/register` and `src/app/oauth/token` hand the request to a function of `src/features/oauth/http.ts`,
  which calls the service modules of OAuth and answers 404 while `HIPPOWIKI_PUBLIC_URL` is not set.
- The consent page `src/app/oauth/authorize/` is a page like every other, with `queries.ts` and `actions.ts` of the
  OAuth feature; its actions return the address of the client instead of redirecting, and its form opens it (see
  `src/features/oauth/actions.ts`).

## Login and sessions

The feature is described in `users-and-login.md`. What every new route, query and action has to do:

- Nothing is read or changed without a login. The login is checked in two layers:
  - `src/proxy.ts` sends every request without a session cookie to the login page. It only looks whether the cookie
    is there. Its matcher leaves out the public addresses, each with its reason in the comment of the matcher: the
    login page, `/api/health`, `/mcp` and every address below it, the public endpoints of OAuth and the static files
    of Next.js, but not the image optimizer (`_next/image`), which the app does not use. A new public address has to
    be added there. The consent page `/oauth/authorize` is not public.
  - `requireUser()` from `src/features/auth/session.ts` checks the session in the database. It is the layer that
    protects the data: it redirects to the login page without a session, and to the password change while the user
    still has the first password.
- Every page behind the login calls `requireUser()` first, before it reads the query string, so that an invalid address
  also leads to the login page. The login page and the consent page of OAuth read the query first: the login page
  needs no login, and the consent page passes its whole address to `requireUser()` as the way back. Queries and
  actions call it as "Queries" and "Actions" say. `not-found.tsx`, `error.tsx` and `global-error.tsx` show no data and
  have no check.
- `requireUser()` returns the user of the session (`SessionUser` of the auth service: `id`, `name`, `type`,
  `mustChangePassword`). Better Auth reads the type with the session (an additional field of `src/lib/auth.ts`); a
  user without a known type is treated like a missing session. An adapter passes the user to a service function that
  needs the actor.
- `src/proxy.ts` gives a read without a session cookie its own address as the way back (`next`). `requireUser()` and
  `requireSession()` redirect without one, unless the caller passes it: the consent page of OAuth does, so that a
  request with a cookie that is no longer valid still comes back to it after the login.
- `requireSession()` only asks for a session; only the password change page and its action use it. `getCurrentUser()`
  returns the user or `null` without redirecting, for the header and the login page; it is wrapped in React `cache()`.
- These three functions, the actions of the auth feature and `verifyOwnPassword()` of
  `src/features/auth/password-check.ts`, which the consent page of OAuth calls to check the password, are the only
  code that reads the headers of the request for the session.
- A caller other than the browser, such as the MCP server, finds its actor with
  `authenticateAccessToken(headers, address)` of the grant service, from the access token of a grant in the
  `Authorization` header (see `connected-apps.md`). It returns the same `Actor`, type included, as the session of the
  grant's user, with the connection of the grant, or a code for a missing or bad token, an access token of an admin or
  of another address included, and for a role on the folder that is too low for the address. The adapter of the MCP
  addresses calls it for every `POST` from an allowed origin while OAuth is on; `src/proxy.ts` does not look at the
  header.
- The actions of the login and of the password changes, and "Approve" on the consent page through
  `verifyOwnPassword()` of `src/features/auth/password-check.ts`, also read the client address of the request, with
  `requestClientAddressGroup()` of `src/features/auth/client-address.ts`, which uses `clientAddressGroup()` from
  `src/lib/client-address.ts` and `HIPPOWIKI_TRUSTED_PROXIES`, because `/login` does not pass `src/proxy.ts`; they
  pass the group to the auth service. The adapter of `/oauth/register` (`handleRegister()` in
  `src/features/oauth/http.ts`) is the second reader: it reads the group the same way, for the limit on registrations
  per client address group, and passes it to the OAuth service. No other code reads a forwarding header for anything
  but the diagnostic `client-address-probe.ts`. `src/lib/auth.ts` is imported only by the auth service and by `src/lib/`.

## Security headers

- `next.config.ts` sets the security headers for every address (`headers()` with the source `/:path*`), so every new
  route, the redirects of `src/proxy.ts` and the static files get them without doing anything:
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains`; browsers ignore it over plain HTTP, so
    `npm run dev` and the end-to-end server on `localhost` are not affected.
  - `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; img-src 'self' data:`.
    `img-src 'self' data:` keeps images of other hosts, such as a tracking image in Markdown, from loading. There is
    no `script-src` or `style-src`, because Material UI and Next.js insert inline styles and scripts.
  - `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`.
- `poweredByHeader: false`: no response names the framework in `X-Powered-By`.
- A change to the headers is checked by `e2e/security-headers.spec.ts` and the smoke test of the container image.

## Validation and errors

- All input (forms, service arguments, environment variables) is validated with Zod. Schemas live in the feature's
  `schema.ts` and have unit tests.
- A form is parsed by a `parse*FormData` function in the feature's `forms.ts`. It reports all errors of a form
  together, including the ones only a form has, such as no place chosen. A text field is read with `textField()` of
  `src/lib/forms.ts`, which counts a missing field and a file as empty, so that the schema reports the field as
  missing; the same module holds the generic types of a parse result (`ParseResult`) and of a form state
  (`FormState`).
- The service validates the same input again with the same schemas, and derives the title of a page with them. This
  is deliberate: a caller other than the browser does not pass through `forms.ts`.
- Ids and names from URLs, forms or callers of a service are parsed (`parsePageId`, `parseFolderId`, `parseTabId`,
  `parseName`, `parsePageSegment`) before they reach the database; a name that must match exactly is parsed with
  `parseExact()` of `src/lib/names.ts`, whose `nameSchemaWith()` builds the schema of a name with its limits for
  folders, tabs, pages and user names. A malformed one counts as a missing row and never reaches the database: a
  route shows the not-found page, a write returns its not-found code.
- A malformed id that is bound to an action is answered as the action answers a missing row of its feature: the
  actions of folders and pages show the message that the folder, tab or page no longer exists, those of roles and
  grants the not-found page.
- Unique and foreign key violations that a user can cause, such as a taken name or a folder that no longer exists,
  are recognised in the service with `isUniqueViolation` and `isForeignKeyViolation` from `src/lib/db-errors.ts` and
  returned as `name-taken` or a not-found code, which the action shows in the form. Both read the name of the violated
  index or constraint, as the `pg` driver adapter reports it: `isForeignKeyViolation(err, LAST_EDITOR)` tells a
  violation of the key of the last editor, which only a broken caller can cause and which gives `failed`, from one of
  a folder or tab key. A write checks the key of the last editor first. Any other database error in a
  write is logged with `{ err }` and the ids and returned as `failed`, which the action shows as a failed save. This
  holds also for the reads a write makes before it writes, such as the role of the actor or the user who gets a role:
  `lookUp()` of `src/features/folder-roles/actors.ts` logs such an error under the message of the failed write.
- The server environment is read through `getServerEnv()` from `src/lib/env.ts`, never directly from `process.env`.
  `HIPPOWIKI_ADMIN_PASSWORD` is not part of it: only the admin setup script reads it.
- A password and its hash are never logged. A password is checked for its length with a refinement on the length of
  the string, as Better Auth counts it; `.min()` and `.max()` of Zod count code points.
- Server-side logging goes through the pino `logger` from `src/lib/logger.ts`, not `console`. Errors are logged with
  `{ err }` and the relevant ids.

## Addresses and actions

- All content lives under `/folders`, deleted pages under `/deleted-pages`; the addresses are described in
  `content-structure.md`. The login is at `/login`, the forced password change at `/change-password` and the user list
  at `/users` (see `users-and-login.md`), the own account with the connected apps at `/account` (see
  `connected-apps.md`), the overview of the folder roles for admins at `/folder-roles` (see `folder-roles.md`), the MCP
  addresses of the folders at `/mcp/<folder-uuid>/<reader|writer|manager>` (see `mcp.md`) and the endpoints of OAuth
  under `/oauth/` and `/.well-known/` (see `oauth.md`).
- Routes, Server Actions and links build every address with the helpers in `src/lib/addresses.ts` instead of writing
  paths by hand, the roots included: `homePath()` for `/`, `foldersPath()` and `deletedPagesRootPath()` for the roots
  that `src/lib/revalidate.ts` revalidates.
- What an address opens is given in its query string: an action as `?action=<action>`, a view as `?view=<view>`.
  They are read with `parseAction` and `parseView`, passing only the actions and views the address has; an address
  without views calls `parseView` without allowed views.
- Each route of the content decides once what its address shows: a pure function of the feature turns the stored
  item and the query string into `null` or into the action or view with the browser title, the role of the user
  included (`folderAddressOf()` and `tabAddressOf()` of `src/features/folders/folder-query.ts`, `pageAddressOf()` and
  `deletedPageAddressOf()` of `src/features/pages/page-query.ts`). The route calls it once in a local `resolve()` for
  `generateMetadata` and for the page, and shows the not-found page, under the plain title, for `null`. The same
  modules hold the tables of the lowest role of each action, and the buttons that link to an action ask them too
  (`mayDoFolderAction()`, `mayDoTabAction()`, `mayDoPageAction()`), so that a button is offered exactly where its
  address exists.
- Other search parameters, such as `before` of the history, the revisions of a comparison or the app to revoke, are
  built by a helper of `src/lib/addresses.ts` and read with a parser of the route; an unknown or malformed value shows
  the not-found page. Among them:
  - A page address with an action may carry `?notice=changed` after it, which an action sets when it redirects after
    a change refused as `page-changed` (see `optimistic-locking.md`). The page routes read it with
    `pageAddressOf()` of `src/features/pages/page-query.ts`, and `pagePath()` builds it.
  - The login and the forced password change take `?next=<path>`, the address to go to afterwards. It is accepted
    only as a path on this site, checked with `safeNextPath()` wherever it is read, and `loginPath(next)` and
    `changePasswordPath(next)` build it. Where a login or a password change leads on, `landingPath(next, user)` turns
    a way back to `/` or into the content into `/users` for an admin, judged by the path alone.
  - The consent page `/oauth/authorize` takes the parameters of an OAuth authorization request (`client_id`,
    `redirect_uri`, `state` and the others), because OAuth defines them. It has no actions and no views and reads its
    parameters with `readAuthorizationParams()` of `src/features/oauth/forms.ts`; the OAuth service checks them.
- A dialog that belongs to an action is rendered by the route's Server Component, open from the start, on top of the
  content of the address. Buttons that open it are links to the address with the action; closing it navigates to the
  address without the query string.

## Database

- The application uses the single Prisma client from `getDb()` in `src/lib/db.ts`. It is created on first use, uses the
  `pg` driver adapter and survives hot reloads in development.
- Schema changes are made in `prisma/schema.prisma` and always come with a migration
  (`npm run db:migrate -- --name <change>`). Migrations are stored under `prisma/migrations/`.
- The history of migrations starts with the one migration `prisma/migrations/20261116103037_init/`, which creates the
  whole schema of an empty database and holds the hand-written parts of the schema at its end. Later schema changes
  get migrations of their own; they are not folded into `init`.
- A migration that Prisma cannot create by itself, such as one that moves data or one that `prisma migrate dev`
  refuses to create without a prompt, is written by hand: the SQL of the schema change comes from
  `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, and
  `npm run db:migrate` then applies it and checks that the database matches the schema.
- The name of a migration directory must sort after all existing ones, because migrations are applied in the order of
  their names.
- What Prisma cannot express in the schema, such as the check constraint that keeps `AuthSecret` to a single row, the
  trigger that refuses every update that changes the type of a `User`, or the trigger that refuses every role of an
  admin (all three at the end of `prisma/migrations/20261116103037_init/`), is added to the SQL of the migration by
  hand (`npm run db:migrate -- --name <change> --create-only`, edit the file, then `npm run db:migrate`).
- Every model has a UUID id generated by PostgreSQL (`gen_random_uuid()`), except the single row of `AuthSecret` and
  the counters `LoginAttempt`, `LoginWindow` and `OAuthRegistrationWindow`, whose keys are what they count, and every
  model stores its times as `timestamptz(3)`. The
  foreign keys between folders, tabs and pages, and those of a role to its folder and user, restrict deleting
  (`onDelete: Restrict`), so that no content and no role disappears by a cascade; the sessions, accounts, grants and
  OAuth codes of a user are deleted with the user, and the codes and grants of an OAuth client and of a folder with the
  client and the folder (`onDelete: Cascade`): a grant is no content.
- The tables `User`, `Session`, `Account` and `Verification` have the shape Better Auth expects; a change to them
  follows the schema of the installed Better Auth version.
- Writes that must succeed together run in one interactive transaction of the Prisma client
  (`getDb().$transaction(async (tx) => ...)`), such as the two counts of a login in `reserveAttempt()` of the auth
  service and a content save of a page with its revision. A check that must hold until the write, such as that a
  folder keeps an Owner, reads its rows with `SELECT ... FOR UPDATE` in the same transaction (`changeRole()` and
  `removeRole()` of the folder-roles service). A conditional write inside it that finds its row changed throws an
  error that only the caller knows, which rolls the transaction back, and the caller reads again.
- Prisma is used for CRUD. The `fullTextSearchPostgres` preview feature is not enabled. Search reads the database with
  tagged `$queryRaw` in its service, every value a bound parameter, because Prisma cannot express the queries of text
  search. The pages service stores what search derives of a page with the page itself. The database builds the
  vector of the page and keeps the words of the folders current in triggers, so that every write of a page, also one
  of a test helper or the seed, keeps search current. The triggers, their functions and the check constraints of
  search are hand-written in `prisma/migrations/20261119110000_search_index/`; Prisma expresses every index, the GIN
  index on the vector included (see `search.md`).
- The `partialIndexes` preview feature is enabled for partial unique indexes (`where` in `@@unique`), such as the one
  on the names of pages placed directly in a folder.
- The development database and its commands are described in `README.md`. Its image is pinned in
  `scripts/Containerfile`, which `scripts/db.sh`, the test database container and the smoke test of the container
  image (`scripts/image.sh`, see `container-image.md`) read, so that all three run the same PostgreSQL; Dependabot
  keeps the pin up to date.

## UI

- Every page is rendered inside the root layout: Material UI with its App Router cache provider, the theme from
  `src/lib/theme.ts`, `CssBaseline`, the app bar and a centered content container. The app bar reads the user of the
  session, so every route is rendered on demand.
- Components are Server Components unless they need interaction; then they are small Client Components.
- A route holds only `requireUser()`, its `resolve()` (see "Addresses and actions"), the gate and a switch over what
  the address shows; each view is a Server Component of its feature that reads its own data through `queries.ts`,
  such as `FolderView`, `TabView` and `FolderRolesView`, `AllPagesView`, `NewPageView` and `PageView`, `AiAppsView`
  of MCP and `SearchView` of search.
- A page is labelled as its address names it, with `pageLabel()` of `src/lib/addresses.ts`.
- A Client Component imports a value only from a module that pulls in nothing it does not use: the names of form
  fields of pages from `src/features/pages/fields.ts` and the limit of a name from `src/lib/name-limits.ts`, both
  without imports, and the limits of users and pages from their `limits.ts`. A constant read from a module of forms
  or schemas would bring Zod and the Markdown parser into the bundle of every page with such a dialog; a production
  build showed both in the chunks of a page until the field names moved. Types may come from any module.
- Material UI components and icons are imported per path (`@mui/material/Button`, `@mui/icons-material/Folder`).
  Links use `@/components/Link` as `component={Link}`.
- `sx` props in Server Components are plain objects, because functions cannot cross to Client Components.
- Forms focus the field the user most likely edits first. When the server rejects a save with field errors, the first
  field with an error is focused, with `useFocusOnFirstError()` of `src/lib/form-hooks.ts`; errors that only show a
  message above the form leave the focus where it is.
- A dialog focuses itself on opening, so `autoFocus` does not hold in it; its first field is focused once the dialog
  has entered, with `focusOnEntered` from `src/lib/focus.ts` in the transition's `onEntered` (the `focusRef` of
  `ActionDialog`). It leaves the focus where it is when it has already moved into the dialog: to a control the user
  clicked while the dialog faded in, or to a field with an error when the server rejected a save before the dialog had
  entered.
- Controls of Client Components that need JavaScript stay read-only (text fields) or disabled (buttons) until the
  component has hydrated, using `useHydrated()` from `src/lib/hydration.ts`. Input during hydration could otherwise be
  lost: React sets the value of a hydrating text field again, which resets its selection, and a click before the
  handler is attached does nothing. The end-to-end tests rely on this, because Playwright waits until a field is
  editable and a button is enabled; `e2e/hydration.spec.ts` checks the lock with JavaScript disabled.
- The root layout renders `HydrationMarker` (`src/components/`), which sets `data-hydrated="true"` on `<html>` in the
  same commit in which `useHydrated()` turns true. The end-to-end tests wait for it after every page load.
- Dialogs that a route renders for an action are built on the frame of `src/components/ActionDialog.tsx`, which holds
  their rules once: `ActionDialog` is open from the start, uses `disablePortal`, so that the dialog is part of the
  server-rendered HTML like the rest of the page, does not close while the submission runs and closes to the address
  without the action; `DialogForm` is the form with the error of its state; `DialogFormActions` is "Cancel" as a link
  and the submit button outside the form, locked while pending and until hydration as described above;
  `ConfirmDialog` is a dialog without fields that confirms a delete, a revoke or a revert. The dialogs keep their
  fields and texts. The name dialog (`NameDialog` in `src/features/folders/components/`) is shared by folders and
  tabs; pages are moved and renamed in `MoveOrRenamePageDialog` of `src/features/pages/components/`. The name field and
  the place choice of a page (`PageNameAndPlaceFields` in `src/features/pages/components/`) are shared by the "Save
  page", the "Move or rename page" and the "Restore page" dialog; its `locked` prop locks them in a dialog that renders
  before hydration, and a place of `null` checks no place.
- A form with controlled radio buttons, checkboxes or selects calls its Server Action in `onSubmit` inside
  `startTransition`, with `useSubmitInTransition()` of `src/lib/form-hooks.ts`, instead of passing it as the form's
  `action`: React resets a form after its action, which puts these controls back to their initial state, out of sync
  with the controlled one.
- A form that rests on the version of a page holds `PageVersionField` of `src/features/pages/components/`, the hidden
  version and the warning after a refused change, and its parent mounts it with the key of `changedPageForm()` of
  `src/features/pages/changed-page.ts`, which starts it anew with the page as stored (see `optimistic-locking.md`).
- Browser titles are built with `pageTitle()` from `src/lib/site.ts`.
- Markdown is parsed only with the markdown-it instance of `src/features/pages/markdown.ts`, which has no server-only
  imports, so the browser can use it too. Raw HTML is never rendered, and only links and images with a safe address
  are made (`isSafeAddress()`).
- The page view converts the tokens of that parse into React elements (`markdownToReact.tsx`), with text only as
  children and never `dangerouslySetInnerHTML`. Markdown that is analysed instead of rendered, such as the title
  heading of a page, uses the tokens of the same parse, so the result matches the rendered page.

## Linting

The configuration is in `tsconfig.json` and `eslint.config.mjs`; the comments of `eslint.config.mjs` say what each
group of rules is for, and how its config objects are combined. What new code has to know:

- TypeScript runs in its strict modes: among them, an element read by index, from an array or a record, may be
  `undefined` and has to be checked, and a `switch` case cannot fall through.
- ESLint uses the rules of `eslint-config-next` and Prettier's config, which turns off the rules that conflict with
  formatting.
- TypeScript files are linted with type information: a promise is awaited or handled, no promise is passed where none
  is expected, only a promise is awaited, and a `switch` over a union handles every case. A promise that is
  deliberately not awaited is marked with `void` and a comment saying why.
- Lint rules hold the conventions above:
  - Imports come in groups separated by a blank line: Node.js modules, packages, `@/` modules, relative paths.
  - `process.env` is read in `src/` only by `src/lib/env.ts` and `src/lib/logger.ts` (see "Validation and errors").
  - Material UI is imported per path (see "UI").
  - No file of `src/` uses `console` (see "Validation and errors"), apart from the client error pages, because the
    pino logger runs only on the server.
  - A read of a service module uses `select`, never `include` (see "Services").
  - The layers (see "Layers"): `@/lib/db` only in a service module and in the two modules that "Layers" names, a
    service only as a type in routes and components, `@/lib/auth` only in the auth service and `src/lib/`, and the
    imports that "Services" forbids a service, also for the modules that load wherever the services load: the MCP
    server, its tools and their schemas, and the pure modules of OAuth, which also import no `@/lib/db`. A service
    module is `service.ts` or a `<part>-service.ts`, and every rule that names a service holds for both.
- The rules for the end-to-end tests are described in `testing.md`.
- `npm run knip` reports unused files, exports and dependencies (see "Unused code" in `testing.md`): a name is
  exported only when another file, a test included, imports it.
- Addresses, the roots included, come from `src/lib/addresses.ts` (see "Addresses and actions").
