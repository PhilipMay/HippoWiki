# HippoWiki – Architecture and Conventions

How the code is organised and which patterns new code follows. The technology stack is defined in `tech.md`.

## Layout

- Source code lives under `src/`, with the import alias `@/` pointing to `src/`.
- `src/app/`: routes (App Router), including the global `not-found`, `error` and `global-error` pages
- `src/proxy.ts`: the proxy of Next.js, which sends requests without a session cookie to the login page (see "Login
  and sessions")
- `src/components/`: shared UI components (app bar, `Link`)
- `src/lib/`: cross-cutting modules, such as the environment, the database client, the logger, the name rule, the
  addresses, the revalidation after a write, the type `Result`, the Better Auth instance and the password hashing.
  What each module holds is in the module itself. A module that a Client Component imports, such as `names.ts` or
  `addresses.ts`, has no server-only imports.
- `src/features/<feature>/`: everything about one feature – `schema.ts`, `service.ts`, `forms.ts`, `queries.ts`,
  `actions.ts`, `components/` and pure helpers such as `derive.ts` and `limits.ts` (no server-only imports, so Client
  Components can use them). `limits.ts` holds the limits of the fields: for pages, the lengths, the limits of the
  content and the number of revisions the history shows at once, so that `schema.ts`, `derive.ts` and `markdown.ts`
  can all use them without importing each other; for users, so that Client Components show the limits without
  importing `schema.ts`, which would put the list of common passwords into the bundle for the browser. For the same reason the type of an
  account and `isAdmin()` live in `src/features/users/user-type.ts`, which Client Components and
  `src/lib/addresses.ts` import.
  - `schema.ts`: the ids, the Zod schemas and the types of validated input
  - `service.ts`: every read and write of the feature (see "Reads and writes")
  - `forms.ts`: what only a form needs: the `parse*FormData` functions, the form states, the types of the form
    actions and the names of form fields. It has no server-only imports, so Client Components can use it.
  - `queries.ts` and `actions.ts`: the adapters between the web and the service
  - The features are `folders` (folders and their tabs), `pages`, `folder-roles` (the roles of users on folders, with
    `roles.ts` for the roles and the lowest role of each function, which services and routes share), `users` (the
    accounts), `auth` (login, logout, the session and the login wait, with `session.ts` for who is calling, see "Login
    and sessions"), `grants` (the connected apps, the grants of users to OAuth clients, and the check of an access
    token), `mcp` (the MCP server: `tools.ts` with its tools, `http.ts`, the adapter of the route of the MCP addresses,
    see "Reads and writes", and `queries.ts` and `components/` for the folder view "AI apps") and `oauth` (the OAuth authorization server for MCP clients: `service.ts` with the rules of the code
    flow, `http.ts` with the adapters of its public endpoints, `secret.ts` for codes and tokens and their hashes,
    `metadata-fetch.ts` for the metadata documents of clients). Their specs are listed in `CLAUDE.md`.
- `src/generated/prisma/`: the generated Prisma client (`npm run db:generate`), not checked in
- `prisma/`: schema, migrations, seed, and `known-users.ts`, the known users of the seed and the tests
- `scripts/`: development scripts (`db.sh`), the admin setup (`admin.ts`) and the scripts of the container image
  (see `container-image.md`)
- `e2e/`: Playwright tests
- `integration/`: Vitest integration tests against the test database

## Reads and writes

- The layers: a route or component calls `queries.ts` or `actions.ts`, these call `service.ts`, and only `service.ts`
  calls `getDb()`. Routes and components import a service only for its types. Two modules outside a feature call it
  as well: the health route (`src/app/api/health/route.ts`), which checks the database connection itself, and
  `src/lib/auth.ts`, which hands the client to Better Auth.
- A caller other than the GUI has an adapter of its own in place of `queries.ts` and `actions.ts`, named `http.ts` in
  its feature. The MCP server is
  the first: the route `src/app/mcp/[[...path]]/route.ts` only hands the request and the segments of its path to
  `handleMcpRequest()` in `src/features/mcp/http.ts`, which answers every path that is no folder address
  (`/mcp/<folder-uuid>/<reader|writer|manager>`) with 404, finds the actor and the connection from the bearer token instead of
  the session, reads the folder of the connection and passes the request to the MCP SDK, with the actor of MCP and the
  folder as the authentication information that the SDK passes on to the factory of the server; the tools in
  `src/features/mcp/tools.ts` call the services of the folders and pages with that actor. The
  tools import nothing from `next` or `react`, like a service. The public endpoints of OAuth work the same way: the
  routes under `src/app/.well-known/` and `src/app/oauth/register` and `src/app/oauth/token` hand the request to a
  function of `src/features/oauth/http.ts`, which calls the OAuth service and answers 404 while
  `HIPPOWIKI_PUBLIC_URL` is not set. The consent page `src/app/oauth/authorize/` is a page like every other, with
  `queries.ts` and `actions.ts` of the OAuth feature; its actions return the address of the client instead of
  redirecting, and its form opens it (see `src/features/oauth/actions.ts`).
- `service.ts` of a feature holds every read and write of the feature. It knows nothing about Next.js, forms or
  addresses, so that a caller other than the GUI, such as an MCP server, can use the same service.
  - It imports nothing from `next`, `react`, `@/lib/revalidate` or a `forms.ts`, has no `"use server"` and works
    outside a request.
  - It takes plain typed arguments (ids, names, objects of strings), never `FormData`.
  - It trusts no caller: it parses ids and names and validates input with the Zod schemas of `schema.ts`, which also
    derive the title of a page (see "Validation and errors").
  - Reads return rows, a list or `null`. A malformed id or name counts as a missing row and never reaches the
    database: a list is empty, a single item is `null`. A read that the actor may not do returns `null`, a list
    included: for an admin without asking the database, for a user without the needed role after the lookup of the
    role and before anything else is read. Database errors are thrown.
  - Writes return a `Result` from `src/lib/result.ts`: `{ ok: true, value }` with the item as stored, or
    `{ ok: false, error }` with a code. Each write declares the codes it can return in a union type next to it, such
    as `CreatePageError`, and the lint rule for exhaustive switches (see "Linting") makes every adapter handle each
    one.
  - A write checks, in this order: the actor (an admin gets `not-allowed` for content), the id of the actor, the ids
    of its arguments, the role of the actor on the folder, its input, the version of the row, and then writes. The
    writes of roles check that the actor is an Owner before they look at the input, so that the answer to anyone else
    does not depend on it.
  - A write that would store what is stored already stores nothing: the item keeps its last editor, its time and its
    version, the write answers as a stored change does, and it is logged in a line of its own. The feature specs
    describe each case (see "Saves without a change" in `pages.md` and the sections on changes to the own name in
    `content-structure.md`).
  - Rows that may no longer exist are changed with `updateMany` and the returned count is checked, instead of catching
    "not found" errors.
  - A write that is based on a version of its row, such as a content save, move, rename or delete of a page (see
    `optimistic-locking.md`), puts the version into the condition of its `updateMany` and counts it up in the same
    write. A count of 0 is told apart by reading the row again: missing gives `page-not-found`, otherwise
    `page-changed`. A version that does not parse writes nothing and counts as an older one.
  - A write that changes the content of a page also stores the revision of the change, in the same interactive
    transaction as its conditional `updateMany` (`storeContentChange()` of the pages service): the update locks the row
    of the page, so the next number of the revision is read and taken by one write at a time. Every content save,
    reverts included, goes through it, so that the page and its history never disagree (see `page-history.md`).
  - It logs the events of its writes: the stored item, a taken name, an item that was not found in the database and
    an unexpected error. A malformed id and invalid input are not logged.
  - It returns no addresses and no messages, except the field errors of the schemas in `invalid-input`. The stored
    item carries what an address is built from: its name and the names of its folder and tab. The services of grants
    and OAuth are the exception for addresses: they build the public MCP address of a folder with
    `src/features/oauth/issuer.ts`, because OAuth names a connection by it.
  - A helper that two services need lives in a pure module of the feature that owns the rule, not in one of the two
    services.
  - It declares the types of its results itself (`FolderSummary`, `PageWithPlace`, `StoredPage` and the like) instead
    of deriving them from a Prisma query, states the return type of every function, and names the columns of every
    query with `select`, never `include`, so that a new column does not reach a caller by accident. Components import
    these types from the service with `import type`.
  - It is the place for checks of who may read or change something. Such checks never go into the adapters, which
    an MCP server does not pass through. A function that not every account may call takes the acting user as its
    first argument (`Actor` in the users service: `id`, `name` and the type of the account) and decides itself with
    `isAdmin()` from `src/features/users/user-type.ts`, by the type and never by the name. Examples:
    `createUser(actor, input)` answers `not-allowed` for a user, `listUsers(actor)` leaves out the pending password
    changes for a user, and the grant service answers `null` and `not-allowed` for an admin. Who the actor is, the
    adapters find out from the session (see "Login and sessions").
  - Every read and write of content (folders, tabs, pages and deleted pages) takes the acting user as its first
    argument as well, together with the channel of the call, `browser` or `mcp` (`ContentActor`, `BrowserActor` and
    `McpActor` in `src/features/folder-roles/service.ts`; `inBrowser()` and `inMcp()` build them), which no caller can
    leave out. The actor of MCP also carries its connection: the grant, the folder and the role of its address. The
    queries and actions pass the actor of the browser, the MCP tools the actor of MCP. The type of the first argument
    says which channel a function accepts: `ContentActor` for what MCP may do as well, `BrowserActor` for what only
    the browser does (creating and renaming folders, reverting, restoring, the reads of the history). Which tools
    exist is in `mcp.md`. The writes of roles take a plain `Actor` and are not offered through MCP. An admin sees no
    content: for an admin a read returns `null` and a write `not-allowed`, logged with the actor id, before anything
    else is checked (see "Only users see content" in `content-structure.md`). Then the role of the actor on the folder
    is checked with the functions of the folder-roles service and `mayDo()` of `roles.ts`, before any other database
    work that could tell whether an item exists: a read without the needed role returns `null`, a write `not-allowed`,
    logged with the folder, tab or page and the role (see `folder-roles.md`). For the actor of MCP these functions give
    the lower of the user's role and the role of the connection on the folder of the connection, and no role on every
    other folder, so the services need no rule of their own for MCP. A write stores the user as the last editor of the
    item (see "Last editor" there), and its log line names the channel and, for MCP, the grant. It parses the
    actor's id like every other id; a malformed id gives `failed` and is logged as an error, because only a broken
    caller can cause it. Pure helpers such as `directPagesFirst()` take no actor.
  - A route decides which buttons, actions and views to offer with the role that the folder read returns and
    `mayDo()` of `roles.ts`, the same function the services use, so that a route and a service never disagree about a
    role. An action or view beyond the role shows the not-found page before the content is read.
  - The auth service is the only code that uses Better Auth (`getAuth()` from `src/lib/auth.ts`). It takes the
    `Headers` of the request, a web standard, because the session lives in a cookie, and returns the response headers
    that set or clear it. `logIn()` also takes the client address group of the request as a plain string, after the
    headers; the service never reads a forwarding header itself.
  - Its functions have the names of the queries and actions, so the adapters import it as a namespace:
    `import * as folderService from "@/features/folders/service"`.
- The rules for queries and actions below hold for the queries and actions of a page behind the login. The
  exceptions, each for its reason:
  - `listMcpAddresses()` of the MCP feature is synchronous and calls no service: it builds the addresses of the view
    "AI apps" from the folder and the role that the folder query of the route has read after the login.
  - `loadConsent()` of the OAuth feature has no service read of its name: it puts the checks of the consent page
    together, so that they can be unit tested (see `testing.md`).
  - `logIn()` and `logOut()` call neither `requireUser()` nor `requireSession()`, because they are what makes and ends
    a session, and `changeFirstPassword()` calls `requireSession()`, because `requireUser()` would send the user back
    to the password change.
  - The actions of users, grants and auth revalidate their own paths instead of calling `revalidateContent()`,
    because they change no content.
- Reads happen in Server Components through the feature's `queries.ts`.
  - Every query first awaits `connection()`, so that Next.js does not prerender the route at build time, then
    `requireUser()` (see "Login and sessions"), and then calls the service read of the same name with that user as
    the actor. A route shows the not-found page when a read returns `null`.
  - Queries that are used by both `generateMetadata` and the page are wrapped in React `cache()`.
- Writes happen through Server Actions in the feature's `actions.ts`.
  - An action first calls `requireUser()` (see "Login and sessions"), outside its `try` blocks, because the redirect
    throws. Then it checks the id, parses the form with a `parse*FormData` function of `forms.ts`, calls the service
    and maps the result.
  - It maps every error code to a form state `{ fieldErrors?, message? }` in a `switch`; the form shows the state and
    keeps the entered values. The messages live in `actions.ts`, apart from the message of a taken name, which is
    `NAME_TAKEN_MESSAGE` of `src/lib/names.ts`. Actions that do the same thing share a message for `failed`, such as
    the content saves, moves and renames of a page.
    `not-allowed` is mapped to `notFound()`: what an account may not change does not exist for it.
  - On success it calls `revalidateContent()` from `src/lib/revalidate.ts` and redirects. `revalidateContent()` calls
    `revalidatePath` with `"layout"` for `/folders` and `/deleted-pages` and so covers every address under both:
    renaming a folder changes the addresses of its deleted pages, creating, renaming or deleting a tab changes the
    places offered when a page is restored, and deleting a tab adds deleted pages.
  - It redirects to the address of the item as stored, built from the result of the service with the helpers in
    `addresses.ts`, never to one built from submitted values.
  - `redirect` is called last and outside `try` blocks, because it throws.
  - Values such as the id are bound with `action.bind(null, id)`.

## Login and sessions

The feature is described in `users-and-login.md`. What every new route, query and action has to do:

- Nothing is read or changed without a login. The login is checked in two layers:
  - `src/proxy.ts` sends every request without a session cookie to the login page. It only looks whether the cookie
    is there. Its matcher leaves out the login page, `/api/health`, `/mcp` and every address below it, the public
    endpoints of OAuth and the static files of Next.js (`_next/static/`), but not the image optimizer (`_next/image`), which the
    app does not use; a new public address has to be added there.
    - `/mcp` and the addresses below it are public to the proxy only: the callers of the MCP addresses have no
      session cookie, and their adapter answers every address that is no folder address with 404 and refuses every
      request without a valid bearer token.
    - The public endpoints of OAuth are what a client calls before it has a token: the metadata of the authorization
      server (`/.well-known/oauth-authorization-server`) and of the protected resources
      (`/.well-known/oauth-protected-resource` and what follows it, of which only the folder addresses answer), the registration `/oauth/register` and the token
      endpoint `/oauth/token`. The consent page `/oauth/authorize` is not public.
  - `requireUser()` from `src/features/auth/session.ts` checks the session in the database. It is the layer that
    protects the data: it redirects to the login page without a session, and to the password change while the user
    still has the first password.
- Every page behind the login calls `requireUser()` first, before it reads the query string, so that an invalid address
  also leads to the login page. The login page and the consent page of OAuth read the query first: the login page
  needs no login, and the consent page passes its whole address to `requireUser()` as the way back. Every query calls
  it after `connection()`, every Server Action first, with the exceptions of "Reads and writes". `not-found.tsx`, `error.tsx`
  and `global-error.tsx` show no data and have no check.
- `requireUser()` returns the user of the session (`SessionUser` of the auth service: `id`, `name`, `type`,
  `mustChangePassword`). Better Auth reads the type with the session (an additional field of `src/lib/auth.ts`); a
  user without a known type is treated like a missing session. An adapter passes the user to a service function that
  needs the actor.
- `src/proxy.ts` gives a read without a session cookie its own address as the way back (`next`). `requireUser()` and
  `requireSession()` redirect without one, unless the caller passes it: the consent page of OAuth does, so that a
  request with a cookie that is no longer valid still comes back to it after the login.
- `requireSession()` only asks for a session; only the password change page and its action use it. `getCurrentUser()`
  returns the user or `null` without redirecting, for the header and the login page; it is wrapped in React `cache()`.
- These three functions and the actions of the auth feature are the only code that reads the headers of the request
  for the session.
- A caller other than the browser, such as the MCP server, finds its actor with
  `authenticateAccessToken(headers, address)` of the grant service, from the access token of a grant in the
  `Authorization` header (see `connected-apps.md`). It returns the same `Actor`, type included, as the session of the
  grant's user, with the connection of the grant, or a code for a missing or bad token, an access token of an admin or
  of another address included, and for a role on the folder that is too low for the address. The adapter of the MCP
  addresses calls it for every `POST` from an allowed origin while OAuth is on; `src/proxy.ts` does not look at the
  header.
- The login action also reads the client address of the request, with `clientAddressGroup()` from
  `src/lib/client-address.ts` and `HIPPOWIKI_TRUSTED_PROXIES`, because `/login` does not pass `src/proxy.ts`; it
  passes the group to the auth service. The adapter of `/oauth/register` (`handleRegister()` in
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
  together, including the ones only a form has, such as no place chosen or a file instead of text.
- The service validates the same input again with the same schemas. This is deliberate: a caller other than a form
  does not pass through `forms.ts`.
- Ids and names from URLs, forms or callers of a service are parsed (`parsePageId`, `parseFolderId`, `parseTabId`,
  `parseName`, `parsePageSegment`) before they reach the database; malformed ones are treated like missing rows: a
  route shows the not-found page, a write returns its not-found code.
- Unique and foreign key violations that a user can cause, such as a taken name or a folder that no longer exists,
  are recognised in the service with `isUniqueViolation` and `isForeignKeyViolation` from `src/lib/db-errors.ts` and
  returned as `name-taken` or a not-found code, which the action shows in the form. Both read the name of the violated
  index or constraint, as the `pg` driver adapter reports it: `isForeignKeyViolation(err, LAST_EDITOR)` tells a
  violation of the key of the last editor, which only a broken caller can cause and which gives `failed`, from one of
  a folder or tab key. A write checks the key of the last editor first. Any other database error in a
  write is logged with `{ err }` and the ids and returned as `failed`, which the action shows as a failed save.
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
  addresses of the folders at `/mcp/<folder-uuid>/<reader|writer|manager>` (see `mcp.md`) and the endpoints of OAuth under `/oauth/` and `/.well-known/` (see `oauth.md`).
  Routes, Server Actions and links build them with the helpers in `src/lib/addresses.ts` instead of writing paths by
  hand.
- What an address opens is given in its query string: an action as `?action=<action>`, a view as `?view=<view>`.
  A route reads them with `parseAction` and `parseView`, passing only the actions and views it has, and calls
  `notFound()` for `"invalid"`. A route without views calls `parseView` without allowed views.
- Other search parameters, such as `before` of the history, the revisions of a comparison or the app to revoke, are
  built by a helper of `src/lib/addresses.ts` and read with a parser of the route; an unknown or malformed value shows
  the not-found page. Among them:
  - A page address with an action may carry `?notice=changed` after it, which an action sets when it redirects after
    a change refused as `page-changed` (see `optimistic-locking.md`). The page routes read it with
    `parsePageQuery()` of `src/features/pages/components/PageView.tsx`, and `pagePath()` builds it.
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
  whole schema of an empty database and holds the hand-written parts of the schema at its end. It replaced the
  migrations that led there, with the steps that moved the data of older states forward, because there was no
  installation whose database had to be kept. A database with the older history is not brought forward but
  recreated. Later schema changes get migrations of their own; they are not folded into `init`.
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
  service and a content save of a page with its revision. A check that must hold until the write, such as that a folder keeps an Owner, reads its rows with
  `SELECT ... FOR UPDATE` in the same transaction (`changeRole()` and `removeRole()` of the folder-roles service). A conditional write inside it that finds its row changed throws an error that only the caller knows, which
  rolls the transaction back, and the caller reads again.
- Prisma is used for CRUD. The `fullTextSearchPostgres` preview feature is not enabled; search uses PostgreSQL
  full-text search directly.
- The `partialIndexes` preview feature is enabled for partial unique indexes (`where` in `@@unique`), such as the one
  on the names of pages placed directly in a folder.
- The development database is PostgreSQL 18 in the Podman container `hippowiki-db`, managed with `scripts/db.sh`
  (`npm run db:up`, `db:down`, `db:reset`, `db:psql`, `db:logs`). The image is pinned to an exact minor
  version in `scripts/Containerfile`, which `scripts/db.sh`, the test database container and the smoke test of the
  container image (`scripts/image.sh`, see `container-image.md`) read; Dependabot keeps the minor version up to date.

## UI

- Every page is rendered inside the root layout: Material UI with its App Router cache provider, the theme from
  `src/lib/theme.ts`, `CssBaseline`, the app bar and a centered content container. The app bar reads the user of the
  session, so every route is rendered on demand.
- Components are Server Components unless they need interaction; then they are small Client Components.
- Material UI components and icons are imported per path (`@mui/material/Button`, `@mui/icons-material/Folder`).
  Links use `@/components/Link` as `component={Link}`.
- `sx` props in Server Components are plain objects, because functions cannot cross to Client Components.
- Forms focus the field the user most likely edits first. When the server rejects a save with field errors, the first
  field with an error is focused; errors that only show a message above the form leave the focus where it is.
- A dialog focuses itself on opening, so `autoFocus` does not hold in it; its first field is focused once the dialog
  has entered, with `focusOnEntered` from `src/lib/focus.ts` in the transition's `onEntered`. It leaves the focus where
  it is when it has already moved into the dialog: to a control the user clicked while the dialog faded in, or to a
  field with an error when the server rejected a save before the dialog had entered.
- Controls of Client Components that need JavaScript stay read-only (text fields) or disabled (buttons) until the
  component has hydrated, using `useHydrated()` from `src/lib/hydration.ts`. Input during hydration could otherwise be
  lost: React sets the value of a hydrating text field again, which resets its selection, and a click before the
  handler is attached does nothing. The end-to-end tests rely on this, because Playwright waits until a field is
  editable and a button is enabled; `e2e/hydration.spec.ts` checks the lock with JavaScript disabled.
- The root layout renders `HydrationMarker` (`src/components/`), which sets `data-hydrated="true"` on `<html>` in the
  same commit in which `useHydrated()` turns true. The end-to-end tests wait for it after every page load.
- Dialogs that a route renders for an action use `disablePortal`, so that they are part of the server-rendered HTML
  like the rest of the page, and lock their controls until hydration as described above. The name dialog
  (`NameDialog` in `src/features/folders/components/`) is shared by folders and tabs; pages are moved and renamed in
  `MoveOrRenamePageDialog` of `src/features/pages/components/`. The name field and the
  place choice of a page (`PageNameAndPlaceFields` in `src/features/pages/components/`) are shared by the "Save page",
  the "Move or rename page" and the "Restore page" dialog; its `locked` prop locks them in a dialog that renders before
  hydration, and a place of `null` checks no place.
- A form with controlled radio buttons or checkboxes calls its Server Action in `onSubmit` inside `startTransition`
  instead of passing it as the form's `action`: React resets a form after its action, which puts these controls back
  to their initial state, out of sync with the controlled one.
- Browser titles are built with `pageTitle()` from `src/lib/site.ts`.
- Markdown is parsed only with the markdown-it instance of `src/features/pages/markdown.ts`, which has no server-only
  imports, so the browser can use it too. Raw HTML is never rendered, and only links and images with a safe address
  are made (`isSafeAddress()`).
- The page view converts the tokens of that parse into React elements (`markdownToReact.tsx`), with text only as
  children and never `dangerouslySetInnerHTML`. Markdown that is analysed instead of rendered, such as the title
  heading of a page, uses the tokens of the same parse, so the result matches the rendered page.

## Linting

- TypeScript runs with `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` and `noFallthroughCasesInSwitch`
  (`tsconfig.json`). An element read by index, from an array or a record, may be `undefined` and has to be checked.
- ESLint uses the rules of `eslint-config-next` (`core-web-vitals`, `typescript`) and Prettier's config, which turns off
  the rules that conflict with formatting.
- TypeScript files are linted with type information (`parserOptions.projectService`). These rules report a promise that
  is neither awaited nor handled (`no-floating-promises`), a promise passed where no promise is expected
  (`no-misused-promises`), `await` on a value that is not a promise (`await-thenable`) and a `switch` over a union that
  misses a case (`switch-exhaustiveness-check`). A promise that is deliberately not awaited is marked with `void` and a
  comment saying why.
- Lint rules enforce the conventions above:
  - `import/order`: imports come in groups separated by a blank line: Node.js modules, packages, `@/` modules, relative
    paths. Imports within a group are not sorted by the rule.
  - `no-restricted-properties`: `process.env` is not read in `src/`, except in `src/lib/env.ts` and
    `src/lib/logger.ts`. Configuration files, `e2e/` and `scripts/` read it directly.
  - `no-restricted-imports`: the barrel imports `@mui/material` and `@mui/icons-material` are not allowed in `src/`.
  - `no-console`: server code (`src/features/**/actions.ts`, `src/features/**/queries.ts`,
    `src/features/**/service.ts`, `src/features/mcp/`, `src/features/oauth/`, `src/app/api/`, `src/app/mcp/`,
    `src/app/oauth/`, `src/app/.well-known/`, `src/lib/`, `src/proxy.ts`) does not use `console`. The client
    error boundaries `src/app/error.tsx` and `global-error.tsx` log with `console.error`, because the pino logger
    runs only on the server.
  - `@typescript-eslint/no-restricted-imports` keeps the layers apart (see "Reads and writes"). It is a rule of its
    own, so that the Material UI paths in `no-restricted-imports` stay as they are.
    - `@/lib/db` may only be imported in `src/features/**/service.ts`, `src/lib/**` and `src/app/api/health/**`;
      everywhere else in `src/` the rule points to the service of the feature.
    - In `src/app/**` and `src/features/**/components/**`, `@/features/*/service` may only be imported as a type; the
      rule points to `queries.ts` and `actions.ts`.
    - `src/features/**/service.ts` imports neither `next`, `next/*`, `react`, `@/lib/revalidate` nor
      `@/features/*/forms`.
    - `@/lib/auth` may only be imported in `src/features/auth/service.ts` and `src/lib/**`; everywhere else in `src/`
      the rule points to the auth service and to `session.ts`.
    - A later config object replaces the options of a rule instead of adding to them. The config objects of this rule
      therefore match disjoint sets of files, and each one lists all restrictions of its files.
- The rules for the end-to-end tests are described in `testing.md`.
