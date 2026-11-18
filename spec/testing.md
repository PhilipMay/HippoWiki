# HippoWiki – Testing

How the code is tested. Commands are listed in `README.md`.

## Checks and coverage

- What `npm run check` and `npm run check:all` hold, when a change runs them and what never runs next to the
  end-to-end tests is stated in "When a step is done" in `step-plan-workflow.md`. `npm run check` stays fast and needs
  no Podman. `scripts/check.ts` runs the checks side by side and prints the output of each one as a block when it is
  done. Only what would clash waits: `next typegen` runs first, because lint and the type check read the route types
  it writes, the build of `npm run check:all` waits for lint and the type check, because it writes the route types
  again, and the cost tests run last and alone. `npm run check` alone writes nothing but the route types;
  `npm run check:all` also writes `.next/` and starts the test database container.
- `npm run test:coverage` measures the coverage of the unit tests with `@vitest/coverage-v8` (configured in
  `vitest.config.ts`). It covers all `.ts` and `.tsx` files in `src/` except the tests and `src/generated/`, so files
  that no unit test loads show up with 0%. It prints a table, writes an HTML report to `coverage/index.html` and a
  summary to `coverage/coverage-summary.json` (all in `coverage/`, ignored by Git and ESLint), also when a test fails
  (`reportOnFailure`). It is not part of `npm run check` and has no thresholds: much of the code, such as the UI, is
  covered by the end-to-end tests instead.
- `scripts/coverage-summary.ts` (`npx tsx scripts/coverage-summary.ts`) turns `coverage/coverage-summary.json` into
  Markdown tables, the totals and a collapsed table per file: appended to the GitHub job summary when
  `GITHUB_STEP_SUMMARY` is set, printed otherwise.

## Unit tests

- Vitest project `unit` (`vitest.config.ts`); unit tests sit next to the code as `*.test.ts`. `npm run test:coverage`
  runs only this project.
- Vitest project `cost`: tests with a wall-clock budget, next to the code as `*.cost.test.ts` and left out of `unit`.
  `npm run test:cost` runs only this project, on its own and never with coverage: V8 coverage instruments every module,
  the dependencies included, and other test files running at the same time share the CPU, so a budget measured then
  says nothing about the code. `npm run test:unit` runs only `unit`; `npm run test` runs `unit`, then `cost`, as two
  runs.
- Schemas, environment parsing and other pure helpers get unit tests.
- Mocks are set up with `vi.mock` and shared mock functions from `vi.hoisted`, reset in `beforeEach`.
- The helpers of the unit tests live in `src/test/`, which `vitest.config.ts` leaves out of the coverage, and are
  imported, never copied:
  - `src/test/unit.ts`: `RedirectError` and `NotFoundError`, which the mocked `redirect()` and `notFound()` throw;
    the builders of Prisma errors (`knownError()`, `uniqueViolation()`, `foreignKeyViolation()`); `dataOf()`, the
    data of a write; the ids and the actors of the tests of the content services, among them `mcpActor()` for a
    connection of a given role. It imports no service.
  - `src/test/content-writes.ts`: `CONTENT_WRITES`, the one table of all content writes of the pages and the folders
    service, each with valid input, its lowest role, the ids and the start of its log lines and the key of its last
    editor. The tables of these tests that go over the writes (the actor, an admin, no role, the lowest role of each
    function) are built from it, so a new write is added there once.
  - `src/test/pages-service.ts`: the mocked database and logger of the unit tests of the pages service, which are
    split by concern into `src/features/pages/service-reads.test.ts`, `service-history.test.ts`,
    `service-writes.test.ts` and `service-access.test.ts` (the actor, an admin and the roles). Each file mocks
    `@/lib/db` and `@/lib/logger` with a factory that imports this module.
- Services (`service.test.ts`) get unit tests for what needs a mock: the branches that the database cannot be made to
  take on purpose, and what the integration tests cannot tell apart. They mock `@/lib/db` and `@/lib/logger`, and
  assert what the service does, not how it asks the database, so that a refactoring that keeps the behaviour keeps
  them green.
  - Malformed ids and names never reach the database; invalid input returns `invalid-input` with the field errors and
    writes nothing.
  - The stored data of every write (the `data` of its call), such as the derived title of a page.
  - Every database error gives its code: a unique violation `name-taken`, a foreign key violation or a count of 0 a
    not-found code, any other error `failed`.
  - What is logged for each outcome.
  - What a read returns from the rows it gets, such as the role of the actor and the last editor.
  - A race between two statements of one write that cannot be timed against the database, such as a rename between
    the update and the read of a folder.
- The integration test of the service proves the rest, and a unit test does not repeat it: the condition, the
  `select` and the order of a query (which rows a read finds, the fields it returns), the condition a write finds its
  row with (the version, a deleted page, a write without a change), the transaction, and the number and order of the
  calls. A unit test that asserted one of them is replaced by the integration test of the same rule.
- Server Actions (`actions.test.ts`) get unit tests as adapters. They mock the service of the feature, `next/cache`,
  `next/navigation` and `@/features/auth/session`; the mocked `redirect` throws like the real one, so code after it
  never runs and tests assert the rejection and its path.
  - Without a logged-in user (`requireUser()` rejects like its redirect) no action reaches the service; with one, the
    same call does.
  - Every error code of every action gives its form state.
  - Success revalidates and redirects to the address of the stored item; a failure does neither.
  - A malformed id or an invalid form never reaches the service.
- Queries (`queries.test.ts`) get unit tests per query: that it awaits `connection()` before it calls the service
  read of the same name (the default end-to-end run uses the development server, which never prerenders), that it
  awaits `requireUser()` after `connection()` and before the service, and that it does not reach the service when
  `requireUser()` redirects. They mock the service of the feature, `next/server` and `@/features/auth/session`.
- The form parsers get unit tests in `forms.test.ts`, the ids in `schema.test.ts`.
- The Markdown parser gets unit tests in `src/features/pages/markdown.test.ts`, which also renders the page view
  (`MarkdownContent`) with `renderToString()` of `react-dom/server`. `src/features/pages/markdown.cost.test.ts`
  (project `cost`) holds the inputs that are slow for other parsers, each at the content limit; they guard the cost of
  the parse and the page view: each must be parsed and rendered within 2 s, so
  that an update of markdown-it or a change of the renderer cannot bring a slow parse back unnoticed. A new input that
  turns out to be slow is added there.
- The comparison of revisions gets unit tests in `src/features/pages/diff.test.ts`. `src/features/pages/diff.cost.test.ts`
  (project `cost`) compares completely different revisions at the content limit, with many short lines and with few
  long ones: each comparison must answer with a diff or "too different" within 2 s, which guards the cap of the diff.
- `src/features/services.test.ts` checks that the services load without Next.js and React: it mocks `next/cache`,
  `next/headers`, `next/navigation`, `next/server` and `react` with factories that throw, then imports the services.
  An import of one of them, also an indirect one through `schema.ts` or `src/lib/`, fails the test. A new service is
  added to this test. The auth service is part of it, so the test also shows that Better Auth with its `nextCookies()`
  plugin loads without Next.js.
- The auth service (`src/features/auth/service.test.ts`) mocks `@/lib/auth`, `@/lib/db` and `@/lib/logger` and sets
  the clock with fake timers for `Date`. Its tests and those of the users service assert that no password and no hash
  is logged, for every outcome.
- The limiter of the password hashing is tested with a work function that the test controls and with fake timers;
  the hashing itself with real hashes.
- Route handlers get unit tests for their failure branches; they mock `@/lib/db` and `@/lib/logger`.
- The adapters of callers other than the GUI get unit tests like actions and queries, with the service mocked: the
  adapter of the MCP addresses (`src/features/mcp/http.test.ts`) for the 404 of every address that is no folder
  address, the status and the headers of every outcome of the token check, the 403 of a role that is too low, the
  `Origin` check and 405, and the adapters of the OAuth endpoints (`src/features/oauth/http.test.ts`) for
  404 without the public URL, the metadata fields, the status codes, the error shape, `no-store` and the answer of
  the registration limit. The tests of the MCP adapter and of its tools (`src/features/mcp/tools.test.ts`, which
  builds the server for a Reader, a Writer and a Manager connection) run the real MCP SDK against mocked services, so a
  change of the SDK shows there.
- The fetch of the metadata documents of OAuth clients (`src/features/oauth/metadata-fetch.ts`) never reaches the
  network in a test. Its own unit test mocks `node:dns/promises` and `node:https` and stands in for the server; the
  tests of the OAuth service replace the whole module with `vi.mock`.
- A page whose decisions are worth a test of their own puts them into a function of its `queries.ts`, such as
  `loadConsent()` of the consent page of OAuth, because pages and components have no unit tests.
- `getDb()`, `getAuth()` and `getServerEnv()` are tested for creating the client, the Better Auth instance and
  validating the environment on first use only, not on import. These tests load the module anew for every case
  (`vi.resetModules()` and a dynamic import), because the modules keep their result.

## Doc references

- `npm run docs:check` (`scripts/check-doc-references.ts`) checks that the files named in `spec/*.md`, `README.md` and
  `CLAUDE.md` exist. It is part of `npm run check` and of the `lint` workflow.
- A code span counts as a reference when it starts with a top-level file or directory of the repository (checked by its
  first word, so a command such as `scripts/image.sh smoke` passes) or ends in `.md` (a bare name such as `pages.md`
  is also looked up in `spec/`). Bare file names such as `wait.ts`, spans with a placeholder or a glob (`<`, `*`) and
  paths that Git ignores are not checked. A path also counts as ignored when Git ignores it as a directory (a pattern
  with a trailing slash such as `/e2e/.auth/`), so the result does not depend on whether that directory exists.
- Step plans (`spec/*-steps.md`) are not checked: they name files that do not exist yet.
- A broken reference is printed with its file and line, and the check fails.

## Integration tests

- Vitest project `integration` (`vitest.config.ts`); tests live in `integration/` (`npm run test:integration`). They
  are not part of `npm run check`, which stays fast and needs no Podman; `npm run check:all` runs them.
- They run against the throwaway test database container of the end-to-end tests (`e2e/support/container.ts`):
  `integration/global-setup.ts` starts it and applies the migrations, and its teardown removes it. Both runs use the
  same container name and port, so integration and end-to-end tests must not run at the same time.
- `integration/setup.ts` runs before every test file: it mocks `@/lib/db` so that `getDb()` returns the client of
  `getTestDb()`, and empties the tables before every test with `emptyTestDatabase()`, which leaves only the
  migration history and `AuthSecret`. The known users of the end-to-end tests are not created here. It also mocks
  `getServerEnv()`, because `getAuth()` reads `NODE_ENV` through it and CI has no `.env`; the mocked environment has
  a `HIPPOWIKI_PUBLIC_URL`, which the OAuth service needs for the MCP addresses of the folders. Nothing of Next.js is
  mocked: the tests call the services, which work outside a request. The test files run one after another
  (`fileParallelism: false`).
- Rows are created with the helpers of `e2e/support/database.ts` (`createFolder()`, `createTab()`, `createPage()`,
  `createRevisions()`, `createFolderRole()`, `createUser()`, `createGrant()`). A state that no helper sets up, such as
  another version, channel or revision of a stored row, is written directly with the client of `getTestDb()`.
- `integration/helpers.ts` holds what the tests of the content services share: the results `NOT_ALLOWED` and
  `FAILED`, `UNKNOWN_ACTOR`, `owners()` for the roles of a folder, `createBob()` for the second user, `mcpActorOf()`
  for an actor of MCP with a new grant, `storedPage()` for the stored row of a page, and `revisionsOf()` for the
  revisions of a page with the fields a test compares.
- They cover what the unit tests can only mock:
  - `src/lib/db-errors.ts` against the errors that Prisma and its `pg` adapter really report
    (`integration/db-errors.test.ts`): every unique constraint that the module names is recognised by its constant
    and by no other, every foreign key violation by `isForeignKeyViolation()`, and the refusal of the trigger against
    roles of admins is recognised as such. The services use the same constants, so a Prisma upgrade that changes the
    error shape or the index names fails here.
  - The users service (`integration/user-service.test.ts`) with real hashes: the admin setup, the user list and the
    creation of users, whose returned password must log in.
  - The auth service (`integration/auth-service.test.ts`) through the real Better Auth instance: that Better Auth
    accepts the users that HippoWiki writes, what a login and a logout do to the sessions, the 30 days of a session,
    the login wait, also for logins at the same time (sent with `Promise.all`), and the forced password change. The
    session cookie travels as headers: a test turns the response headers of a login into the request headers of the
    next call. `@/lib/password-hash` is mocked as spies, to count the hashes and to let one fail the way it does when
    no slot gets free.
  - The grant service (`integration/grant-service.test.ts`): listing and revoking only the own grants, and the check
    of an access token, with the clock set past the expiry and to the minute of the last use.
  - The OAuth service (`integration/oauth-service.test.ts`): the registration and its limit per client address group and
    hour, the checks of an authorization request, codes that work once, also for exchanges at the same time (sent with
    `Promise.all`), the expiry of codes, access tokens and grants with the clock set, the refresh, a refresh token that
    is used again, two refreshes at the same time, the grants that a new grant replaces, the limit of connected apps,
    what is deleted with a client and a user, and the clean-up. `integration/oauth-metadata.test.ts` does the same for
    clients with a metadata document, with the fetch replaced: the first fetch, the kept row, the fetch after the cache
    time, a document that is not valid and a fetch that fails.
  - The services of the content on real data, one file per service in `integration/`
    (`integration/folder-service.test.ts`, `integration/page-service.test.ts` and
    `integration/folder-role-service.test.ts`):
    - the reads: their conditions (e.g. pages placed directly in a folder versus pages in a tab) and their order, and
      that a read of a single item returns exactly the declared fields (`toStrictEqual`)
    - the writes: what is stored and returned, and the codes the database decides, such as `name-taken` for a taken
      name and `tab-not-found` for a tab of another folder
- Races and rollbacks are tested against the database, with real concurrency. Writes at the same time are sent with
  `Promise.all`, several of them or in rounds where a single pair could pass by chance. Where a race needs both writes
  to wait for the same row, a transaction of the test holds it with `SELECT ... FOR UPDATE` until both wait for the
  lock. A rollback is shown with a trigger that the test creates to raise an error inside the write and drops in
  `finally`, comparing the whole rows before and after. The tests:
  - `integration/page-service.test.ts`, "a content save and its revision": a save and a revert whose revision is
    refused store nothing; of every pair of save, revert, move and delete with the same version exactly one wins;
    of two restores at once exactly one wins.
  - `integration/folder-service.test.ts`, "deleting a tab": the rollback of the delete of a tab, and a page created,
    moved or restored into a tab while it is deleted never stays in the missing tab.
  - `integration/folder-role-service.test.ts`: two Owners who lower each other at once keep one Owner.
- A new unique constraint gets a constant in `db-errors.ts` and a case in `integration/db-errors.test.ts`; a new
  read with a condition the database must get right and every new write get a case in the integration test of their
  service.

## End-to-end tests

- Playwright with Chromium only; tests live in `e2e/` (`npm run test:e2e`, `npm run test:e2e:ui`).
- Each run uses a throwaway PostgreSQL container `hippowiki-test-db` (port 5433, database `hippowiki_test`, data in
  memory only). The global setup starts it and applies the migrations; the global teardown removes it, so nothing is
  left running.
- Playwright starts the application itself on port 3100 with the build directory `.next-e2e` and `DATABASE_URL`
  pointing to the test database. The development database is never touched and does not need to run.
- By default it starts the development server (`next dev`), which starts fast. With `HIPPOWIKI_E2E_SERVER=production`
  (`npm run test:e2e:production`) it runs `next build` followed by `next start` instead, both with the same build
  directory and `DATABASE_URL`. This run covers what only exists in a production build: prerendering and the route
  cache, the minified client bundles and rendering without the double rendering of StrictMode.
- The error pages `error.tsx` and `global-error.tsx` are covered by no test, in neither run: to render them, a test
  would have to make a read of the shared test database fail, and every later spec would fail with it if the test
  could not restore the database. The build needs no running database, because no route is
  prerendered; the global setup starts the test database only after the server.
- All tests share the test database and run one after another.
- The test server has a public URL (`HIPPOWIKI_PUBLIC_URL=http://localhost:3100` in `playwright.config.ts`), so
  OAuth is on and the MCP server gives out full addresses. That OAuth is off without the variable is covered by the
  unit tests of the adapters and by the smoke test of the container image.
- The test server trusts one reverse proxy (`HIPPOWIKI_TRUSTED_PROXIES=1` in `playwright.config.ts`), so a test
  chooses the client address of its logins with an `X-Forwarded-For` header: `extraHTTPHeaders` in `test.use()` for
  the page of the spec, or a browser context of its own for a second address. Next.js keeps a header that the browser
  sends and writes the address of the connection into it only when it is missing.
- A test waits for the answer of every login it submits, for example until the password field is emptied, also when
  the alert already shows the expected text from an earlier attempt. A login that is still being counted when the next
  test resets the database runs into the `TRUNCATE` of the reset, because its transaction writes two tables. The reset
  survives that on its own (see `emptyTestDatabase()` below), but the wait keeps a test from depending on it.
- The tests log in once and reuse the session:
  - The Playwright project `setup` (`e2e/auth.setup.ts`) logs in on the login page as the known admin and the known
    user of `prisma/known-users.ts`, each of its type, and saves one browser state each in `e2e/.auth/` (ignored by Git and by
    `.containerignore`), together with the rows of the two sessions. The global setup removes the files of an earlier
    run first.
  - The `chromium` project depends on `setup` and starts every test with the browser state of the known user. A spec
    that needs the admin or no user sets its own with `test.use({ storageState: ... })` and the constants of
    `e2e/support/auth.ts` (`ADMIN_STORAGE_STATE`, `USER_STORAGE_STATE`, `NO_STORAGE_STATE`).
  - A crafted request of the other type is tested with `becomeUser(context, storageState)` of `e2e/support/auth.ts`:
    the test opens a form with one saved login, replaces the cookies of the browser by the other saved login, and
    submits it, e.g. a content form with the login of the admin or the "New user" form with the login of a user.
  - `resetTestDatabase()` puts the known users and the saved session rows back, so the saved cookies stay valid
    after every reset. It never empties `AuthSecret`: the running server keeps the secret that signed them.
  - The Playwright UI does not run the setup project by itself (see `README.md`).
  - A test that needs a user with a first password creates one with `createUser()` and logs in through the login
    page, in a spec or a browser context without a saved state.
  - A test in which a second user works at the same time logs that user in with `logInElsewhere(browser, name)` of
    `e2e/support/auth.ts`, in a browser context of its own; the user is created with `createUser()` and
    `mustChangePassword: false`, and the test closes the context.
- Helpers in `e2e/support/`:
  - `test.ts` exports the `test` and `expect` that all specs use; a lint rule forbids importing them from
    `@playwright/test`. After `page.goto()` and `page.reload()` its `page` waits until the page has hydrated, i.e. until
    `HydrationMarker` has set `data-hydrated="true"` on `<html>` (see "UI" in `architecture.md`); not with JavaScript
    disabled. Every other page a test opens, in a second tab or a browser context of its own, gets the same wait from
    `hydrating()`, e.g. `hydrating(await context.newPage())`. So no test acts on the locked, server-rendered page, where
    React could undo a change to the DOM or report a hydration mismatch. This matters most in CI, whose runner hydrates
    much later than a fast local machine.
  - `resetTestDatabase()` empties all tables except the migration history and `AuthSecret`, then creates the known
    users with their fixed ids and restores their saved sessions; tests call it in `beforeEach`.
    `emptyTestDatabase()` only empties the tables; the integration tests use it.
  - The `TRUNCATE` of `emptyTestDatabase()` runs in a transaction with `lock_timeout` of 2 seconds and is tried up to
    five times, with a growing pause in between. A login of the server that is still running writes `LoginAttempt` and
    `LoginWindow` in one transaction, while the `TRUNCATE` locks the tables one after another, so the two can deadlock
    (PostgreSQL `40P01`) or the `TRUNCATE` can wait too long for a lock (`55P03`). Both are over in milliseconds, so
    the next try succeeds; without the retry such a reset fails its test, and in CI a test that only passes on a retry
    fails the run. A fixed order of the tables would not help, because the order of the login is its own.
  - `createUser()` inserts a user with its credential account, in the shape of `src/features/users/records.ts`, with
    a unique name, the type `user` and the password `TEST_PASSWORD` unless they are given, and with the first password
    still to change unless `mustChangePassword` is false. A test that needs another admin passes `type: "admin"`. The hash of a password is computed once per process.
  - `createGrant()` inserts an OAuth client and the grant of the user given as `owner` to it at an MCP address, a
    connected app, with a generated access token of which only the hash is stored, and returns the grant, its folder,
    the client and the access token. `folder` and `role` give the address; without a folder it creates one on which
    the owner is Owner (no role for an admin), and without a role the address is the one of Reader. The grant is named
    after the client, expires 90 days ahead and its access token works for an hour unless they are given; any field,
    e.g. `expiresAt`, `accessTokenExpiresAt` or `lastUsedAt`, can be set, and `client` gives an existing client.
  - `createFolder()` inserts a folder directly into the test database with a unique name; any field, e.g. `name` or
    `updatedAt`, can be set. `roles` gives users roles on it, e.g. `roles: [{ user: bob, role: "reader" }]`, and
    `roles: []` none. Without `roles` the known user `alice` is its Owner when that user exists, as after
    `resetTestDatabase()`, so that the end-to-end tests, which run as `alice`, see every folder they create; the
    integration tests start from empty tables and give roles where a test needs them, or create their actor with the
    id of `alice` (`KNOWN_USER.id`) to get the same default. `createTab()` and `createPage()` create their folder with
    the same default.
  - `createFolderRole()` gives the user given as `user` the role given as `role` on the folder given as `folder`.
  - `createTab()` inserts a tab with a unique name into the folder given as `folder`; without one, it creates a folder
    for the tab.
  - `createPage()` inserts a page with a unique name: into the tab given as `tab`, or directly into the folder given
    as `folder`; without either, it creates a folder for the page. Any field, e.g. `name`, `updatedAt` or `version`,
    can be set.
    Like the forms, it derives the title from the content; the content defaults to `# <title>`, so
    `createPage({ title: "Older page" })` works. A title given together with content is stored as is, to set up a page
    whose stored title differs from its content. With `deletedAt` it creates a deleted page, which has no tab, so it
    cannot be combined with `tab`. Like a page after the migration of the page history, it also inserts revision 1
    with the content, title, editor and channel of the page, made at its `updatedAt`.
  - `createRevisions()` adds revisions to a page given as `page`, numbered on from its newest revision: `count` of
    them, with `content`, `createdAt` and `revertedTo` as functions of the number, and `editor` and `via` for all. It
    gives the page the content and title of the last one, like the saves that recorded them, and leaves its version,
    last editor and `updatedAt` as they are.
  - `createFolder()`, `createTab()` and `createPage()` take the last editor as `editor`, a `User`; without one, they
    create a user with `createUser()`, so that the integration tests, which start from an empty database, need no
    user of their own. A folder they create for a tab or page gets the same editor. A test that checks the editor shown
    after a change through the GUI sets up the item with another editor, e.g. `createPage({ folder, editor: bob })`.
  - Tests that open an address give the folder, tab and page fixed names, e.g.
    `createPage({ folder, name: "overview" })` for `/folders/<folder>/overview.md`.
  - `getTestDb()` returns a Prisma client for the test database, e.g. to check what an action stored.
  - `oauth.ts` has the helpers of the OAuth tests, in which a test stands in for the client: `registerClient()`,
    `authorizeUrl()`, `exchange()`, `refresh()`, and `connect()`, which approves a client on its consent page and
    returns the tokens of the new grant. `awaitCallback()` answers everything at the redirect address of the client,
    a loopback address where nothing listens, with `page.route()`, and returns the parameters of the answer that
    arrives there.
  - `mcp.ts` has the helpers of the MCP tests, in which a test stands in for an MCP client: `sendMcp()` sends a
    JSON-RPC message to an MCP address with a bearer token, `callTool()` calls a tool there and returns its result, and
    `mcpPath()` gives the path of the address of a folder and role.
  - `setOwnRole()` sets the role of the known user `alice` on a folder, as another Owner would while a form of the test
    is open.
  - `auth.ts` also has `submitLogin()`, which fills and submits the login form of the open page, and `logIn()`, which
    opens the login page first; the test asserts where the login leads.
  - `browser.ts` has `collectErrors()`, which records console errors and uncaught exceptions of the browser page (tests
    assert it stays empty); `expectNotFound()`, which opens an address and expects the not-found page with the status
    404, named with the address; and `by()`, the end of a line of a list or view that names the last editor and the
    channel, "by <user> via <channel>".
  - The public URL of the test server, the base of every full address, is `ISSUER` of `oauth.ts`.
- `eslint-plugin-playwright` checks all files in `e2e/`: a Playwright call or `expect` that is not awaited
  (`missing-playwright-await`), `page.waitForTimeout()` (`no-wait-for-timeout`) and checks such as
  `expect(await locator.isVisible())` instead of the retrying `await expect(locator).toBeVisible()`
  (`prefer-web-first-assertions`) are errors.
- Elements are located by role, label and accessible name, not by CSS selectors. A CSS selector is used only for what
  has no role or name to find it by:
  - the `time` element of a line, the `data-change` attribute of the lines of a comparison and the current item of a
    breadcrumb (`aria-current`);
  - the `form` of a dialog that a test submits with `requestSubmit()`, and the `option` elements and labels that a
    test reads or changes as a whole;
  - elements that must be absent from rendered Markdown or a page, such as `script`, `img` or any element with an
    address.
  - A required field has an asterisk after its label, so a label is matched by its text or its start, not exactly.
  - Next.js has an element with the role `alert` of its own, its route announcer; the error message of a form is
    located inside `main` or its dialog.
  - What lies behind an open dialog is hidden from assistive technology and is found with `includeHidden: true`.
- A test that simulates a crafted request adds hidden fields to the form, or changes the submitted data in the form's
  `formdata` event. It does not change the value of a control that React renders: React writes that value back
  whenever it renders the control again, e.g. when it gets the focus.
- Playwright cannot read a page while it navigates away. A test of the state a page shows on its way out, such as
  "Returning to the app…" of the consent page, lets the target answer `204 No Content` with `page.route()`, so the
  browser stays on the page.
- The browser of the tests refuses the clipboard unless a test grants `clipboard-write` with
  `context.grantPermissions()`; a test of a copy that fails grants nothing.
- `e2e/hydration.spec.ts` checks with JavaScript disabled that the controls of Client Components stay read-only or
  disabled until hydration (see "UI" in `architecture.md`). A new Client Component with such controls adds a case there.
- The Chromium of the tests does not show the content of a `noscript` element, although its scripts are switched
  off with `javaScriptEnabled: false`. A note for browsers without JavaScript, such as the one of the consent page of
  OAuth, is therefore checked in the HTML of the page.
- `e2e/access.spec.ts` checks that every kind of address leads to the login page without a login, as a redirect that
  sends nothing of the page, and that the redirect carries the address as the way back. A new route adds its address
  there; a new public address is checked there as well, for not being sent to the login page.
- `e2e/mcp.spec.ts` calls the MCP addresses of folders with `request`, the helpers of `e2e/support/mcp.ts` and the
  access token of a grant from `createGrant()`, for Reader, Writer and Manager connections; `e2e/oauth.spec.ts` covers the discovery, the registration, the
  token endpoint and the whole flow from the login over the consent page to a tool call, a refresh and a refresh token
  that is used again. The helpers of `e2e/support/oauth.ts` send a folder address as `resource` (`mcpAddress()`).
- `e2e/ai-apps.spec.ts` covers the folder view "AI apps" with its addresses per role and the copy button.
- `e2e/security-headers.spec.ts` checks the security headers of `next.config.ts` (see "Security headers" in
  `architecture.md`) with their exact values, and that no `X-Powered-By` is sent: on the login page, the redirect to
  it, `/api/health`, a page with a login and a `/_next/static/` file. It also checks that an image of another host in
  a page is not requested and is reported as a violation of `img-src`, and that a `data:` image is not shown in the
  page at all. A change to the headers changes this spec and the smoke test of the container image.
- Every feature step adds end-to-end tests for its behaviour, including error and empty states.

## Continuous integration

- GitHub Actions runs the checks in seven workflows in `.github/workflows/`, each named like its file, so a failure
  shows at a glance which kind of check broke:
  - `format_check`: `npm run format:check`
  - `lint`: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run docs:check`, as separate steps in this order
  - `unit_tests`: `npm run test:coverage`, then `npm run test:cost`, also when the first step failed
  - `integration_tests`: `npm run test:integration`, using the Podman preinstalled on the runner
  - `end_to_end_tests`: `npm run test:e2e`, against the development server
  - `end_to_end_tests_production`: `npm run test:e2e:production`, against a production build
  - `container_image`: `scripts/image.sh build` and `scripts/image.sh smoke`, and for a published release the push of
    the image to the GitHub Container Registry (see `container-image.md`)
- They run on every push to `main`, on pull requests and when started by hand (`workflow_dispatch`). Pushes to other
  branches run them only through their pull request, so a pull request's commits are not tested twice. A newer push to
  the same ref cancels a run still in progress. `container_image` also runs when a release is published, and a run for a
  release is never cancelled.
- Every workflow runs on `ubuntu-24.04`. All but `container_image` install Node.js from `.nvmrc` and run `npm ci`;
  `container_image` calls `bash scripts/image.sh` directly, with the Podman preinstalled on the runner, and builds
  Node.js into the image instead.
- No workflow sets `DATABASE_URL`. `prisma generate` during `npm ci` does not need it, and the build needs no
  database, because every query calls `connection()` and no route is prerendered. No workflow sets
  `HIPPOWIKI_ADMIN_PASSWORD` either: the tests create their users themselves, and the smoke test of the container
  image passes its own value.
- Both end-to-end workflows install Chromium with `npx playwright install --with-deps chromium` and use the Podman
  preinstalled on the runner; the tests start and remove their throwaway container `hippowiki-test-db` as they do
  locally. With `CI` set, Playwright retries a failed test twice, fails the run if a test passed only on a
  retry, and rejects `test.only`.
- The Playwright HTML report (`playwright-report/`) is uploaded as the artifact `playwright-report`, or
  `playwright-report-production` for the production run, also when the tests fail (not when the run was cancelled),
  and kept for 7 days.
- The unit test workflow writes the coverage tables of `scripts/coverage-summary.ts` to the job summary and uploads
  `coverage/` as the artifact `coverage-report`, also when the tests fail (not when the run was cancelled or no report
  was written), kept for 7 days.
- Dependabot (`.github/dependabot.yml`) checks the `npm` and `github-actions` dependencies and the two `docker` images
  weekly: the PostgreSQL image in `scripts/Containerfile` and the Node.js image in the `Containerfile` of the project
  root, both for minor updates only. All minor and patch npm updates arrive in one pull request, each major npm update
  in a pull request of its own, all action updates in one. Its pull requests run the same workflows; merging one is an upgrade, a task of its own (see `step-plan-workflow.md`).
