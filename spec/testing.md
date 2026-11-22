# HippoWiki – Testing

How the code is tested. Commands are listed in `README.md`.

## Checks and coverage

- What `npm run check` and `npm run check:all` hold, when a change runs them and what never runs next to the
  end-to-end tests is stated in "When a step is done" in `step-plan-workflow.md`. `npm run check` stays fast and needs
  no Podman. `scripts/check.ts` runs the checks side by side and prints the output of each one as a block when it is
  done. Only what would clash waits: `next typegen` runs first, because lint and the type check read the route types
  it writes, the build of `npm run check:all` waits for lint and the type check, because it writes the route types
  again, and the cost tests run last and alone; in `npm run check:all` the integration tests with a time budget
  follow them, after the integration tests and the build, alone as well. `npm run check` alone writes nothing but the
  route types;
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
  - `src/test/slow-markdown.ts`: `SLOW_INPUTS`, the content at the content limit that is slow for other Markdown
    parsers, for the cost tests of the parse, of the search text and of live preview.
  - `src/test/editor-content.ts`: `EDITOR_PAGE`, a page at the content limit with headings, wiki links, lists, task
    lists, quotes, code blocks and tables, for the cost test of live preview and the manual check of the editor's speed.
  - `src/test/language-samples.ts`: a page of the same content in each language that search tells apart, for the
    tests of the language of a page and of search.
  - `src/test/pages-service.ts`: the mocked database and logger of the unit tests of the pages service, which are
    split by concern into `src/features/pages/service-reads.test.ts`, `service-writes.test.ts` and
    `service-access.test.ts` (the actor, an admin and the roles), and of the history service
    (`src/features/pages/history-service.test.ts`). Each file mocks
    `@/lib/db` and `@/lib/logger` with a factory that imports this module.
- Services (`service.test.ts`, and `<part>-service.test.ts` for a service module next to it) get unit tests for what needs a mock: the branches that the database cannot be made to
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
  (project `cost`) parses and renders the inputs that are slow for other parsers, each at the content limit, from
  `src/test/slow-markdown.ts`; they guard the cost of the parse and the page view: each must be parsed and rendered
  within 2 s, so that an update of markdown-it or a change of the renderer cannot bring a slow parse back unnoticed. A
  new input that turns out to be slow is added there.
- The modules of the Markdown editor get unit tests next to them in `src/features/pages/editor/`, in the `node`
  environment without a DOM: they build an `EditorState` with the extensions of the editor, run its commands and read
  its decorations, with the syntax tree parsed to the end with `ensureSyntaxTree()`. What needs the DOM of the editor,
  such as clicks, the toolbar and the focus, is tested end to end. `src/features/pages/editor/live-preview.cost.test.ts`
  (project `cost`) builds the state, the parse, the decorations of live preview and the tables of the page of
  `src/test/editor-content.ts` within 2 s; for every input of `src/test/slow-markdown.ts` it builds the decorations and
  the tables on the parsed tree within 2 s, since the parser of the editor itself is slow on some of them (see "Current
  limits" in `markdown-editor.md`), and a typed character in the middle of each, with the parse and the decorations of
  one screen, within 50 ms on average. Lists nested 50,000 deep have a budget of 150 ms for a typed character: they
  are one line, which every typed character changes, so the parser parses all of it again, which takes about 60 ms
  on a runner of GitHub Actions.
- The comparison of revisions gets unit tests in `src/features/pages/diff.test.ts`. `src/features/pages/diff.cost.test.ts`
  (project `cost`) compares completely different revisions at the content limit, with many short lines and with few
  long ones: each comparison must answer with a diff or "too different" within 2 s, which guards the cap of the diff.
- The replacements of `edit_page_content` get unit tests in `src/features/mcp/edits.test.ts`.
  `src/features/mcp/edits.cost.test.ts` (project `cost`) applies the largest calls that fit into the body of an MCP
  request to a content at the content limit: as many small replacements as fit, and a replacement of every place of a
  text on every other character. Each must be applied, or refused as too long, within 2 s, because the number of
  replacements of a call has no limit of its own.
- `src/features/services.test.ts` checks that the services load without Next.js and React: it mocks `next/cache`,
  `next/headers`, `next/navigation`, `next/server` and `react` with factories that throw, then imports the services.
  An import of one of them, also an indirect one through `schema.ts` or `src/lib/`, fails the test. A new service is
  added to this test. The auth service is part of it, so the test also shows that Better Auth with its `nextCookies()`
  plugin loads without Next.js.
- The auth service (`src/features/auth/service.test.ts`) mocks `@/lib/auth`, `@/lib/db` and `@/lib/logger` and sets
  the clock with fake timers for `Date`. Its tests and those of the users service assert that no password and no hash
  is logged, for every outcome.
- The limiter of `src/lib/limiter.ts`, which the password hashing and the processing of images share, is tested with
  a work function that the test controls and with fake timers (`src/lib/limiter.test.ts`); the hashing itself with
  real hashes.
- Route handlers get unit tests for their failure branches; they mock `@/lib/db` and `@/lib/logger`.
- The adapters of callers other than the browser get unit tests like actions and queries, with the service mocked: the
  adapter of the MCP addresses (`src/features/mcp/http.test.ts`) for the 404 of every address that is no folder
  address, the status and the headers of every outcome of the token check, the 403 of a role that is too low, the
  `Origin` check and 405, and the adapters of the OAuth endpoints (`src/features/oauth/http.test.ts`) for
  404 without the public URL, the metadata fields, the status codes, the error shape, `no-store` and the answer of
  the registration limit. The tests of the MCP adapter and of its tools (`src/features/mcp/tools.test.ts`, which
  builds the server for a Reader, a Writer and a Manager connection and compares the tools of each role with
  `FUNCTION_ROLES`) run the real MCP SDK against mocked services, so a
  change of the SDK shows there.
- The fetch of the metadata documents of OAuth clients (`src/features/oauth/metadata-fetch.ts`) never reaches the
  network in a test. Its own unit test mocks `node:dns/promises` and `node:https` and stands in for the server; the
  tests of the service modules of OAuth replace the whole module with `vi.mock`.
- A page whose decisions are worth a test of their own puts them into a function of its `queries.ts`, such as
  `loadConsent()` of the consent page of OAuth, because pages and components have no unit tests.
- `getDb()`, `getAuth()` and `getServerEnv()` are tested for creating the client, the Better Auth instance and
  validating the environment on first use only, not on import. These tests load the module anew for every case
  (`vi.resetModules()` and a dynamic import), because the modules keep their result.

## Doc references

- `npm run docs:check` (`scripts/check-doc-references.ts`) checks that the files named in `spec/*.md`, `README.md`,
  `CLAUDE.md`, the skills in `.claude/skills/` and the agents in `.claude/agents/` exist. It is part of `npm run check` and of the `lint` workflow.

## Unused code

- `npm run knip` reports unused files, exports and dependencies, with the plugins of knip for Next.js, Vitest,
  Playwright, Prisma and ESLint. A test that imports a name counts as a use. It is part of `npm run check` and of the
  `lint` workflow.
- What it reports is deleted, loses its `export`, or is named in `knip.jsonc` with the reason why knip cannot see its
  use; that file holds the setup project of Playwright, the script that makes the list of common passwords, and
  Podman.
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
  `createRevisions()`, `createFile()`, `createFolderRole()`, `createUser()`, `createGrant()`). `integration/setup.ts`
  creates a temporary directory of files for the test file, which `createFile()` and the store of the files service
  use, and removes it after the file. A state that no helper sets up, such as
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
  - The service modules of OAuth (`integration/oauth-service.test.ts`): the registration and its limit per client address group and
    hour, the checks of an authorization request, codes that work once, also for exchanges at the same time (sent with
    `Promise.all`), the expiry of codes, access tokens and grants with the clock set, the refresh, a refresh token that
    is used again, two refreshes at the same time, the grants that a new grant replaces, the limit of connected apps,
    what is deleted with a client and a user, and the clean-up. `integration/oauth-metadata.test.ts` does the same for
    clients with a metadata document, with the fetch replaced: the first fetch, the kept row, the fetch after the cache
    time, a document that is not valid and a fetch that fails.
  - The services of the content on real data, one file per service in `integration/`
    (`integration/folder-service.test.ts`, `integration/page-service.test.ts`,
    `integration/page-history-service.test.ts` and `integration/folder-role-service.test.ts`):
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
- Search is tested against the database in three files:
  - `integration/search-database.test.ts`: the check of the migrations, against throwaway databases of the test
    container with the character type `C` and with a user who may not create extensions;
  - `integration/search-index.test.ts`: the vector and the words of the folders after every kind of write, writes at
    the same time in one folder, and the derivation of the pages stored before search;
  - `integration/search-service.test.ts`: the matches, the order, the pieces of text and the limits of a search. A
    search that runs into the time limit, and searches beyond the 3 at the same time, are made by a transaction of the
    test that holds the table of the words of the folders (`LOCK TABLE "SearchWord"`).
- Vitest project `integration-cost`: integration tests with a wall-clock budget, `integration/*.cost.test.ts`, left
  out of the project `integration` and run with `npm run test:integration:cost`, on their own, like the cost tests.
  `integration/search-size.cost.test.ts` fills one folder with 3,000 pages of about 20,000 characters, in several
  languages and with the vocabulary of real text, and keeps the times of search and of a save into the full folder
  within their budgets (see "Limits" in `search.md`). `integration/wiki-link-update.cost.test.ts` keeps a rename that
  updates the links of 1,000 pages within its budget (see `wiki-links.md`).
- A new unique constraint gets a constant in `db-errors.ts` and a case in `integration/db-errors.test.ts`; a new
  read with a condition the database must get right and every new write get a case in the integration test of their
  service.

## End-to-end tests

- Playwright with Chromium only; tests live in `e2e/` (`npm run test:e2e`, `npm run test:e2e:ui`).
- Each run uses a throwaway PostgreSQL container `hippowiki-test-db` (port 5433, database `hippowiki_test`, data in
  memory only). The global setup starts it and applies the migrations; the global teardown removes it, so nothing is
  left running.
- The tests run with several workers at the same time, each with its own test database and its own server (see
  "Workers" below). The development database is never touched and does not need to run.
- By default the servers are development servers (`next dev`), which start fast. With
  `HIPPOWIKI_E2E_SERVER=production` (`npm run test:e2e:production`) the app is built once with `next build`, and each
  worker gets a `next start` on that build. This run covers what only exists in a production build: prerendering and
  the route cache, the minified client bundles and rendering without the double rendering of StrictMode.
- The error pages `error.tsx` and `global-error.tsx` are covered by no test, in neither run: to render them, a test
  would have to make a read of the test database of its worker fail, and every later spec of that worker would fail
  with it if the test could not restore the database. The build needs no running database, because no route is
  prerendered; the global setup starts the test database only after the servers.
- Each test server has a public URL (`HIPPOWIKI_PUBLIC_URL`, the address of the server, in `playwright.config.ts`), so
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
- The tests log in once per run and reuse the session in every worker:
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
  - `resetTestDatabase()` puts the known users and the saved session rows back into the database of its worker, so the
    saved cookies are valid on the server of every worker and stay valid after every reset. It never empties
    `AuthSecret`: the running server keeps the secret that signed them, and every worker database has the same one.
  - The Playwright UI does not run the setup project by itself (see `README.md`).
  - A test that needs a user with a first password creates one with `createUser()` and logs in through the login
    page, in a spec or a browser context without a saved state.
  - A test in which a second user works at the same time logs that user in with `logInElsewhere(browser, name)` of
    `e2e/support/auth.ts`, in a browser context of its own; the user is created with `createUser()` and
    `mustChangePassword: false`, and the test closes the context.
  - A test that changes a password or ends the sessions of an account uses an account of its own, created with
    `createUser()` and `mustChangePassword: false`, and logs in through the login page in a spec without a saved
    state, so that the saved sessions of the known users stay valid for the other specs.
  - Every approval on the consent page enters the password of its user first, with `approve(page, password)` or
    `connect(..., password)` of `e2e/support/oauth.ts`; the password is the one of the known user unless another is
    given.
- Helpers in `e2e/support/`:
  - `test.ts` exports the `test` and `expect` that all specs use; a lint rule forbids importing them from
    `@playwright/test`. After `page.goto()` and `page.reload()` its `page` waits until the page has hydrated, i.e. until
    `HydrationMarker` has set `data-hydrated="true"` on `<html>` (see "UI" in `architecture.md`); not with JavaScript
    disabled. Every other page a test opens, in a second tab or a browser context of its own, gets the same wait from
    `hydrating()`, e.g. `hydrating(await context.newPage())`. So no test acts on the locked, server-rendered page, where
    React could undo a change to the DOM or report a hydration mismatch. This matters most in CI, whose runner hydrates
    much later than a fast local machine. `hydrating()` also routes the page through the filter of `hmr.ts`, and its
    `goto()` and `reload()` wait for that route before they load the page, so that the first load is covered.
  - The hot module replacement of the development server (`next dev` with Turbopack) can drive a page into a reload
    loop: now and then the compile pass that a page render schedules lands just after the page has subscribed to its
    chunk lists, and the server answers the subscription of the shared entry chunk list with an update of the type
    `restart`, or sends `reloadPage` because the version of the page no longer matches. The page reloads, its next
    render schedules the next pass, and the loop never ends until the test times out. The filter of `hmr.ts` keeps the
    messages `reloadPage` and `restart` from every page that `hydrating()` wraps. That loses nothing: the tests change
    no source file, so these messages never carry a real update. The production run has no hot module replacement.
  - The wait still fails at once when the page loads itself again more than 5 times meanwhile
    (`MAX_RELOADS_WHILE_HYDRATING` in `test.ts`), as a guard: no page of the app reloads itself and the filter keeps
    the development server from doing so, so its error points to a new cause of reloads, which is told apart from a
    failure of the app, instead of a test that fails after 30 seconds while waiting for `data-hydrated`.
  - `hmr.ts` holds that filter. `withoutReloads()` drops a message `reloadPage`, drops the updates of the type
    `restart` from a `turbopack-message` and the message when none is left, and returns every other message unchanged,
    binary ones included; its unit tests are in `hmr.test.ts`. `keepFromReloading()` routes the websocket of
    `/_next/hmr` of a page with `page.routeWebSocket()`, connected to the server, and passes the messages of the server
    through `withoutReloads()`. The websocket is routed, not stubbed, because a page of Next.js 16 does not hydrate
    without the connection of the hot module replacement.
  - `editor.ts` holds the helpers for the Markdown editor, which every spec that writes or reads the content of a page
    uses: `contentEditor()` and `editorReady()` find the editor by its role and its name "Content", `fillContent()`
    replaces the whole content as input that CodeMirror reads, `expectContent()` asserts the exact content,
    `pasteContent()` dispatches a paste, `startInSourceMode()` starts the editor in source mode, and `shownLines()`
    reads the text that each line shows.
  - `resetTestDatabase()` empties all tables of the database of its worker except the migration history and
    `AuthSecret`, then creates the known users with their fixed ids and restores their saved sessions; tests call it in
    `beforeEach`. `emptyTestDatabase()` only empties the tables, and only of `hippowiki_test` or a worker database; the
    integration tests use it.
  - The `TRUNCATE` of `emptyTestDatabase()` waits for its locks only a short time and is tried again a few times
    (`TRUNCATE_LOCK_TIMEOUT` and `TRUNCATE_ATTEMPTS` in `e2e/support/database.ts`). A login of the server that is
    still running writes `LoginAttempt` and `LoginWindow` in one transaction, while the `TRUNCATE` locks the tables one
    after another, so the two can deadlock or the `TRUNCATE` can wait too long for a lock. Both are over in
    milliseconds, so the next try succeeds; without the retry such a reset fails its test, and in CI a test that only
    passes on a retry fails the run. A fixed order of the tables would not help, because the order of the login is its
    own.
  - The helpers that insert rows directly into the test database: `createUser()`, `createGrant()` (an OAuth client
    and the grant of a user to it at an MCP address, with its access token), `createFolder()`, `createFolderRole()`,
    `createTab()`, `createPage()`, `createRevisions()` and `createFile()`. Each gives every row a unique name and lets a test set any
    field; what each one creates when a field is left out is in its doc comment in `e2e/support/database.ts`. What a
    test relies on:
    - Without `roles`, a folder that `createFolder()`, `createTab()` or `createPage()` creates has the known user
      `alice` as its Owner when that user exists, as after `resetTestDatabase()`, so that the end-to-end tests, which
      run as `alice`, see every folder they create; the integration tests start from empty tables and give roles where
      a test needs them, or create their actor with the id of `alice` (`KNOWN_USER.id`) to get the same default.
    - Without `editor`, these three create a user as the last editor, so that the integration tests need no user of
      their own. A test that checks the editor shown after a change through the browser sets up the item with another
      editor, e.g. `createPage({ folder, editor: bob })`.
    - `createPage()` derives the title from the content, like the forms, stores its search columns and its wiki links
      in the index of links, like every write of a page, and inserts revision 1 of the page, like a page after the
      migration of the page history; a title given together with content is stored as is, to set up a
      page whose stored title differs from its content. A deleted page has no tab.
    - `createRevisions()` gives the page the content and title of its last revision, like the saves that recorded
      them, and leaves its version, last editor and `updatedAt` as they are.
    - `createUser()` creates a user whose first password is still to change, unless `mustChangePassword` is false.
    - `createFile()` writes the blob of every version into the files directory of its process, as an upload stores
      it, and inserts the file and its versions; without versions it gets one with a small image or PDF of the type
      of its extension. A deleted file has no tab.
  - Every server of the end-to-end tests has a files directory of its own, `.next-e2e/files-<worker>`
    (`workerFilesDir()` in `e2e/support/workers.ts`, set as `HIPPOWIKI_FILES_DIR` in `playwright.config.ts`), so the
    files are on in every run; that the views offer no upload while the files are off is covered by the unit tests of
    the files service and the smoke test of the container image.
  - `files.ts` has the helpers of files: the test images and PDFs made with sharp (`pngBytes()` and the others,
    `phonePhoto()` with a GPS position and a camera), `uploadFile()`, which posts a file to the upload address with the
    cookies of the page, and `expectFileNotFound()`, which checks the plain 404 of a file address.
  - Tests that open an address give the folder, tab and page fixed names, e.g.
    `createPage({ folder, name: "overview" })` for `/folders/<folder>/overview.md`.
  - `getTestDb()` returns a Prisma client for the test database of the worker, e.g. to check what an action stored.
  - `oauth.ts` has the helpers of the OAuth tests, in which a test stands in for the client: `registerClient()`,
    `authorizeUrl()`, `exchange()`, `refresh()`, and `connect()`, which approves a client on its consent page and
    returns the tokens of the new grant. `awaitCallback()` answers everything at the redirect address of the client,
    a loopback address where nothing listens, with `page.route()`, and returns the parameters of the answer that
    arrives there.
  - `mcp.ts` has the helpers of the MCP tests, in which a test stands in for an MCP client: `sendMcp()` sends a
    JSON-RPC message to an MCP address with a bearer token, `callTool()` calls a tool there and returns its result, and
    `mcpPath()` gives the path of the address of a folder and role. `setUpProjects()` resets the test database and
    creates a user of its own for the test, the Owner and last editor of the folder "projects", with a Reader grant of
    that user there, instead of one of `alice`, and returns that user as `owner`; until the next reset, `send()` and
    `call()` use that connection unless a test gives another token or address.
  - `search.ts` has `holdSearchWords()`, which holds the table of the words of the folders in a transaction of the
    test until it is released, so that every search of the worker waits for it until its time limit, and
    `waitForHeldSearches()`, which waits until a number of searches wait for it.
  - `setOwnRole()` sets the role of the known user `alice` on a folder, as another Owner would while a form of the test
    is open.
  - `auth.ts` also has `submitLogin()`, which fills and submits the login form of the open page, and `logIn()`, which
    opens the login page first; the test asserts where the login leads.
  - `browser.ts` has `collectErrors()`, which records console errors and uncaught exceptions of the browser page (tests
    assert it stays empty); `expectNotFound()`, which opens an address and expects the not-found page with the status
    404, named with the address; `by()`, the end of a line of a list or view that names the last editor and the
    channel, "by <user> via <channel>"; and `holdServerAction()`, which holds the next request of a Server Action of
    the page with `page.route()` until the test releases it.
  - The public URL of the server of the worker, the base of every full address, is `ISSUER` of `oauth.ts`.
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
    address;
  - the hidden field `content` of the Markdown editor, whose value is the exact content: CodeMirror draws only the lines
    in view, so the content is read there, by `expectContent()` of `e2e/support/editor.ts`.
  - A required field has an asterisk after its label, so a label is matched by its text or its start, not exactly.
  - Next.js has an element with the role `alert` of its own, its route announcer; the error message of a form is
    located inside `main` or its dialog.
  - What lies behind an open dialog is hidden from assistive technology and is found with `includeHidden: true`.
- A test that simulates a crafted request adds hidden fields to the form, or changes the submitted data in the form's
  `formdata` event. It does not change the value of a control that React renders: React writes that value back
  whenever it renders the control again, e.g. when it gets the focus.
- `e2e/pending-states.spec.ts` checks the guard against a double submission once per pattern of a form: while a
  Server Action is held with `holdServerAction()`, the buttons are disabled with their pending label, and Escape,
  pressed with the focus in the dialog, leaves the dialog open. A new pattern of a form adds a case there.
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
  `e2e/image-optimizer-spec-tests.spec.ts` holds the tests of the switched-off image optimizer written from the spec
  alone.
- The specs of MCP call the MCP addresses of folders with `request`, the helpers of `e2e/support/mcp.ts` and the
  access token of a grant from `createGrant()`, for Reader, Writer and Manager connections, each from a test database
  reset by `setUpProjects()`: `e2e/mcp-access.spec.ts` the tokens, the binding of a connection to its address and the
  current role behind it, `e2e/mcp-read.spec.ts` the protocol and the read tools, `e2e/mcp-write.spec.ts` the write
  tools of a Writer with their locking, `e2e/mcp-edit.spec.ts` the replacements of `edit_page_content`, `e2e/mcp-manager.spec.ts` the tools of a Manager, and `e2e/mcp-search.spec.ts` the search tool. Every
  test of these specs connects as the user of its own that `setUpProjects()` creates, never as `alice`: the budget of
  the rate limit of MCP is kept per user in the memory of the server of a worker and outlives `resetTestDatabase()`, so
  one known user would share one budget across all MCP specs of a worker. Their tests "in the browser" log in as that
  user with `logIn()`, in a spec without a saved state. A change of a tool runs
  the spec of its group, a change of the access `e2e/mcp-access.spec.ts`; `e2e/oauth.spec.ts` covers the discovery, the registration, the
  token endpoint and the whole flow from the login over the consent page to a tool call, a refresh and a refresh token
  that is used again. The helpers of `e2e/support/oauth.ts` send a folder address as `resource` (`mcpAddress()`).
- `e2e/mcp-limits.spec.ts` covers the limits of the MCP addresses: the refusal of batches, the body limit and the rate
  limit per user. The servers of the end-to-end tests keep the default limits, so that the spec checks them. The budget
  of the rate limit is kept per user in the memory of a server and outlives `resetTestDatabase()`, so every MCP test
  uses a user of its own: the tests of this spec create theirs with `createUser()`, the other MCP specs get theirs
  from `setUpProjects()`. `e2e/oauth.spec.ts` approves its grants as `alice` and sends few MCP requests, so it keeps
  the known user. A spec that meets the limit gets a user of its own, and the limits of the servers are not raised. The unit tests written from the
  spec alone for these limits are `src/features/mcp/limits.spec-tests.test.ts` and `src/lib/env.spec-tests.test.ts`.
- The Markdown editor has specs of its own: `e2e/editor.spec.ts` the editor in source mode, its loading, its safety
  and its keyboard; `e2e/editor-preview.spec.ts` live preview and the mode switch; `e2e/editor-toolbar.spec.ts` the
  toolbar and its shortcuts; `e2e/editor-limit.spec.ts` the content limit and the counter, in a file of its own
  because it fills pages near the limit; `e2e/editor-leave.spec.ts` the question before leaving with unsaved changes;
  `e2e/editor-phone.spec.ts` the editor at phone size with touch, which removes the badge of the development server of
  Next.js that covers "Save" there; `e2e/editor-wiki-links.spec.ts` the wiki links of live preview and the picker on
  `[[`; and `e2e/editor-spec-tests.spec.ts` the tests written from the spec alone.
- Wiki links have specs of their own: `e2e/wiki-links.spec.ts` the page view, missing links, backlinks and the limit;
  `e2e/wiki-link-updates.spec.ts` the update of links on a move, a rename and a tab rename; and
  `e2e/wiki-links-spec-tests.spec.ts` the tests written from the spec alone.
- Files have specs of their own: `e2e/files.spec.ts` the upload address and the file address with its headers;
  `e2e/upload-file.spec.ts` the upload dialog and the section "Files"; `e2e/file-details.spec.ts` the details page,
  new versions and reverts; `e2e/file-links.spec.ts` links and embeds of files in pages; `e2e/move-or-rename-file.spec.ts`
  and `e2e/delete-file.spec.ts` the moves, renames, deletes and restores; and `e2e/attachments-spec-tests.spec.ts` and
  `e2e/mcp-attachments-spec-tests.spec.ts` the tests written from the spec alone (see `attachments.md`).
- `e2e/ai-apps.spec.ts` covers the folder view "AI apps" with its addresses per role and the copy button.
- `e2e/search.spec.ts` covers the results view and its address, the search field on every view of a folder and where
  it is left out, and the messages of the limits. Chromium waits with a request for an address until a request for
  the same address that is still running has ended, so the searches that a test runs at the same time each have words
  of their own.
- `e2e/security-headers.spec.ts` checks the security headers of `next.config.ts` (see "Security headers" in
  `architecture.md`) with their exact values, and that no `X-Powered-By` is sent: on the login page, the redirect to
  it, `/api/health`, a page with a login and a `/_next/static/` file. It also checks that an image of another host in
  a page is not requested and is reported as a violation of `img-src`, and that a `data:` image is not shown in the
  page at all. A change to the headers changes this spec and the smoke test of the container image.
- Every feature step adds end-to-end tests for its behaviour, including error and empty states.

### Workers

The end-to-end tests run with several workers in one Playwright run, so that the complete suite takes much less time
than one after another. Code: `e2e/support/workers.ts` (the number of workers and what belongs to each, with the unit
tests in `e2e/support/workers.test.ts`), `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/support/database.ts`,
`e2e/support/container.ts` and `e2e/support/test.ts`.

- Each worker has its own database and its own server, so no worker sees or resets the data of another. The global
  setup prepares `hippowiki_test` (migrations, one new `AuthSecret`, a reset) and copies it into one database per
  worker, `hippowiki_test_<n>`, so every worker database starts reset, with the same schema and the same secret. The
  integration tests keep using `hippowiki_test`.
- Worker 1 has its server on port 3100 and each further worker the next port, up to 3107. Each development server has
  its own build directory below `.next-e2e/`; the production run builds once into `.next-e2e/production`, and all its
  servers start on that build.
- The spec files are spread over the workers as they become free; the tests of one file run one after another in one
  worker (`fullyParallel` is off). A run ends with one result and one HTML report, whatever the number of workers.
- `HIPPOWIKI_E2E_WORKERS` sets the number of workers for one run: a whole number from 1 to 8, 4 without the variable.
  Any other value stops the run before any server or database starts, with a message that names the variable, the
  value and the range. CI sets 1 for both end-to-end workflows (see "Continuous integration").
- The number of workers is set with the variable, not with Playwright's `--workers`: it also decides how many servers
  and databases start. `--workers` may ask for fewer workers; more stop the run before any test with a message that
  names the variable.
- Every run starts the servers of all workers, also a run of one spec or of `--last-failed`, so the rules of a step plan
  for which specs run do not depend on the number of workers.
- With one worker a run behaves as before the workers: one database copy, one server on port 3100, all tests one after
  another. This is the way to debug a test, e.g. `HIPPOWIKI_E2E_WORKERS=1 npm run test:e2e:ui`.
- The `baseURL` of every test, and `ISSUER` of `e2e/support/oauth.ts`, is the address of the server of its worker; a
  worker without a server fails.
- A port of a server that is already taken fails the run before any test, with the message of Playwright, which names
  the port. A server that someone else started is never used (`reuseExistingServer: false`).
- A run leaves every file that Git tracks as it was. `next dev` adds the types directories of its build directory to
  `tsconfig.json` unless they are listed there, so `tsconfig.json` lists those of the eight worker directories and of
  `.next-e2e/production`.
- Nothing of a run is left running after it ends, also when it fails: no server and no container.

Times of the complete suite, before (one worker) and after (4 workers locally). Locally on a Mac16,7 (14 CPU cores,
48 GB memory, Podman machine with 7 CPUs and 4 GB), 777 tests, the median of three runs; in CI on `ubuntu-24.04` (4 CPU
cores, 16 GB), one run with 3 workers against the median of five runs before:

- `npm run test:e2e`, locally: 6.4 min before, 2.3 min after, as reported by Playwright (6 min 25 s and 2 min 20 s
  wall time).
- `npm run test:e2e:production`, locally: 3.8 min before, 1.4 min after, the build included (3 min 50 s and 1 min 27 s
  wall time).
- `end_to_end_tests`, CI: the step of the tests took 11 min 29 s with one worker and 14 min 1 s with 3, which also had
  two flaky tests.
- `end_to_end_tests_production`, CI: the step of the tests took 5 min 1 s with one worker and 3 min 30 s with 3.

Decisions:

- Several workers in one run, not shards: the workers take the next spec file when they are free, which balances the
  load better than shards split by file, and there is one command and one report. Shards in CI were rejected: they
  cost more runner minutes and a job to merge the reports.
- Both runs are parallel, so the local default run and the complete suite of a step plan get faster too, at the cost
  of one development server per worker, each compiling the routes itself.
- The speedup is measured and written down, with no fixed target.
- The default of 4 workers was fixed, not measured first. A run of a few specs uses the same number as the complete
  suite, so the rules of a step plan stay as they are; the cost is a few seconds and some memory for the servers.
- CI runs both end-to-end workflows with 1 worker. With 3 workers on the 4 CPU cores of the runner, the development
  servers each compiled every route themselves, and the run took longer than with one and had flaky tests: a click
  that did not lead to the next page within 5 seconds on the first visit of a route. The production run, which was
  faster with 3, runs with 1 as well, so both CI runs stay as they were before the workers.
- The variable is called `HIPPOWIKI_E2E_WORKERS`, like `HIPPOWIKI_E2E_SERVER`, which chooses the run; `E2E_WORKERS`,
  without the prefix of the project, was rejected.
- An invalid number stops the run instead of falling back to the default, so a typo is not hidden; the limit of 8
  keeps a typo such as `40` from starting 40 servers.
- A taken port fails the run instead of a search for free ports, so the ports of a run stay fixed.
- The build directories are listed in `tsconfig.json`, so a run changes no tracked file and the working tree stays
  clean after the tests.

Current limits:

- The parallel run pays off only locally: CI runs with one worker (see "Decisions").
- Every run starts the servers of all workers, also for one spec.

## Continuous integration

- GitHub Actions runs the checks in seven workflows in `.github/workflows/`, each named like its file, so a failure
  shows at a glance which kind of check broke. The steps of each are in its file:
  - `format_check`: the format check
  - `lint`: the build, the type check, lint, the doc references and knip
  - `unit_tests`: the unit tests with coverage and the cost tests
  - `integration_tests`: the integration tests, then the integration tests with a time budget
  - `end_to_end_tests`: the end-to-end tests against the development server
  - `end_to_end_tests_production`: the end-to-end tests against a production build
  - `container_image`: the build and the smoke test of the container image, and for a published release its push to
    the GitHub Container Registry (see `container-image.md`)
- They run on every push to `main`, on pull requests and when started by hand (`workflow_dispatch`). Pushes to other
  branches run them only through their pull request, so a pull request's commits are not tested twice. A newer push to
  the same ref cancels a run still in progress. `container_image` also runs when a release is published, and a run for a
  release is never cancelled.
- All workflows but `container_image` install Node.js from `.nvmrc` and run `npm ci`; `container_image` builds
  Node.js into the image instead. The workflows that need a container use the Podman preinstalled on the runner.
- The end-to-end workflows install Chromium with `npx playwright install chromium`, without `--with-deps`. The runner
  already has every library Chromium needs; `--with-deps` only added fonts and upgrades through apt, which no test
  relies on (the tests take no screenshots), and that download from the Ubuntu mirror took between seconds and 8
  minutes. If a new runner image lacks a library, Chromium fails at its start with a message that names it, and the
  option comes back.
- No workflow sets `DATABASE_URL`. `prisma generate` during `npm ci` does not need it, and the build needs no
  database, because every query calls `connection()` and no route is prerendered. No workflow sets
  `HIPPOWIKI_ADMIN_PASSWORD` either: the tests create their users themselves, and the smoke test of the container
  image passes its own value.
- The end-to-end tests start and remove their throwaway container `hippowiki-test-db` as they do locally. Both
  end-to-end workflows set `HIPPOWIKI_E2E_WORKERS` to 1 for the step of the tests, so they run with one worker and one
  server (see "Workers" in "End-to-end tests"). With `CI` set, Playwright retries a failed test, fails the run if a test passed only on a retry, and rejects `test.only`
  (`playwright.config.ts`). Every run keeps the trace of the first run of a test that failed, the failed run itself and
  not its retry, in the HTML report.
- The end-to-end workflows upload the Playwright HTML report, and the unit test workflow the coverage report with its
  tables of `scripts/coverage-summary.ts` in the job summary, also when the tests fail.
- Dependabot (`.github/dependabot.yml`) checks the `npm` and `github-actions` dependencies and the two images of
  `scripts/Containerfile` and the `Containerfile` of the project root every week. Its pull requests run the same
  workflows; merging one is an upgrade, a task of its own (see `step-plan-workflow.md`).
