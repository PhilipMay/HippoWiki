# HippoWiki – Testing

How the code is tested. Commands are listed in `README.md`.

## Unit tests

- Vitest project `unit` (`vitest.config.ts`); unit tests sit next to the code as `*.test.ts`. `npm run test` and
  `npm run test:coverage` run only this project.
- Schemas, environment parsing and other pure helpers get unit tests.
- Mocks are set up with `vi.mock` and shared mock functions from `vi.hoisted`, reset in `beforeEach`.
- Services (`service.test.ts`) get unit tests for the branches the end-to-end tests cannot reach without breaking the
  shared test database, and for what they cannot tell apart. They mock `@/lib/db` and `@/lib/logger`.
  - Malformed ids and names never reach the database; invalid input returns `invalid-input` with the field errors and
    writes nothing.
  - The stored data of every write, such as the derived title of a page.
  - Every database error gives its code: a unique violation `name-taken`, a foreign key violation or a count of 0 a
    not-found code, any other error `failed`.
  - What is logged for each outcome.
  - The conditions of the reads, such as the ones that pick the place of a page and leave out deleted pages.
    Assertions that only repeat the `select` and `orderBy` of a query are left out.
- Server Actions (`actions.test.ts`) get unit tests as adapters. They mock the service of the feature, `next/cache`
  and `next/navigation`; the mocked `redirect` throws like the real one, so code after it never runs and tests assert
  the rejection and its path.
  - Every error code of every action gives its form state.
  - Success revalidates and redirects to the address of the stored item; a failure does neither.
  - A malformed id or an invalid form never reaches the service.
- Queries (`queries.test.ts`) get one unit test per query: that it awaits `connection()` before it calls the service
  read of the same name (the default end-to-end run uses the development server, which never prerenders). They mock
  the service of the feature and `next/server`.
- The form parsers get unit tests in `forms.test.ts`, the ids in `schema.test.ts`.
- `src/features/services.test.ts` checks that the services load without Next.js and React: it mocks `next/cache`,
  `next/headers`, `next/navigation`, `next/server` and `react` with factories that throw, then imports the services.
  An import of one of them, also an indirect one through `schema.ts` or `src/lib/`, fails the test. A new service is
  added to this test.
- Route handlers get unit tests for their failure branches; they mock `@/lib/db` and `@/lib/logger`.
- `getDb()` and `getServerEnv()` are tested for creating the client and validating the environment on first use only,
  not on import. These tests load the module anew for every case (`vi.resetModules()` and a dynamic import), because
  the modules keep their result.
- `npm run check` (format, lint, typecheck, unit tests) stays fast and does not include the end-to-end tests.
- `npm run test:coverage` measures the coverage of the unit tests with `@vitest/coverage-v8` (configured in
  `vitest.config.ts`). It covers all `.ts` and `.tsx` files in `src/` except the tests and `src/generated/`, so files
  that no unit test loads show up with 0%. It prints a table, writes an HTML report to `coverage/index.html` and a
  summary to `coverage/coverage-summary.json` (all in `coverage/`, ignored by Git and ESLint), also when a test fails
  (`reportOnFailure`). It is not part of `npm run check` and has no thresholds: much of the code, such as the UI, is
  covered by the end-to-end tests instead.
- `scripts/coverage-summary.ts` (`npx tsx scripts/coverage-summary.ts`) turns `coverage/coverage-summary.json` into
  Markdown tables, the totals and a collapsed table per file: appended to the GitHub job summary when
  `GITHUB_STEP_SUMMARY` is set, printed otherwise.

## Integration tests

- Vitest project `integration` (`vitest.config.ts`); tests live in `integration/` (`npm run test:integration`). They
  are not part of `npm run check`, which stays fast and needs no Podman.
- They run against the throwaway test database container of the end-to-end tests (`e2e/support/container.ts`):
  `integration/global-setup.ts` starts it and applies the migrations, and its teardown removes it. Both runs use the
  same container name and port, so integration and end-to-end tests must not run at the same time.
- `integration/setup.ts` runs before every test file: it mocks `@/lib/db` so that `getDb()` returns the client of
  `getTestDb()`, and empties all tables before every test with `resetTestDatabase()`. Nothing of Next.js is mocked:
  the tests call the services, which work outside a request. The test files run one after another
  (`fileParallelism: false`).
- Rows are created with the helpers of `e2e/support/database.ts` (`createFolder()`, `createTab()`, `createPage()`).
- They cover what the unit tests can only mock:
  - `db-errors.ts` against the errors that Prisma and its `pg` adapter really report: every unique constraint of the
    schema is recognised by its constant (`FOLDER_NAME`, `TAB_NAME`, `PAGE_NAME`) and by no other, every foreign key
    violation by `isForeignKeyViolation()`. The services use the same constants, so a Prisma upgrade that changes the
    error shape or the index names fails here.
  - The services of the features on real data, one file per service (`integration/folder-service.test.ts`,
    `integration/page-service.test.ts`):
    - the reads: their conditions (e.g. pages placed directly in a folder versus pages in a tab) and their order, and
      that a read of a single item returns exactly the declared fields (`toStrictEqual`)
    - the writes: what is stored and returned, and the codes the database decides, such as `name-taken` for a taken
      name and `tab-not-found` for a tab of another folder
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
  cache, the minified client bundles, `error.tsx` and `global-error.tsx` (hidden by the development error overlay)
  and rendering without the double rendering of StrictMode. The build needs no running database, because no route is
  prerendered; the global setup starts the test database only after the server.
- All tests share the test database and run one after another.
- Helpers in `e2e/support/`:
  - `test.ts` exports the `test` and `expect` that all specs use; a lint rule forbids importing them from
    `@playwright/test`. After `page.goto()` and `page.reload()` its `page` waits until the page has hydrated, i.e. until
    `HydrationMarker` has set `data-hydrated="true"` on `<html>` (see "UI" in `architecture.md`); not with JavaScript
    disabled. So no test acts on the locked, server-rendered page, where React could undo a change to the DOM or report
    a hydration mismatch. This matters most in CI, whose runner hydrates much later than a fast local machine.
  - `resetTestDatabase()` empties all tables; tests call it in `beforeEach`.
  - `createFolder()` inserts a folder directly into the test database with a unique name; any field, e.g. `name` or
    `updatedAt`, can be set.
  - `createTab()` inserts a tab with a unique name into the folder given as `folder`; without one, it creates a folder
    for the tab.
  - `createPage()` inserts a page with a unique name: into the tab given as `tab`, or directly into the folder given
    as `folder`; without either, it creates a folder for the page. Any field, e.g. `name` or `updatedAt`, can be set.
    Like the forms, it derives the title from the content; the content defaults to `# <title>`, so
    `createPage({ title: "Older page" })` works. A title given together with content is stored as is, to set up a page
    that was stored before titles were derived. With `deletedAt` it creates a deleted page, which has no tab, so it
    cannot be combined with `tab`.
  - Tests that open an address give the folder, tab and page fixed names, e.g.
    `createPage({ folder, name: "overview" })` for `/folders/<folder>/overview.md`.
  - `getTestDb()` returns a Prisma client for the test database, e.g. to check what an action stored.
  - `collectErrors()` records console errors and uncaught exceptions of the browser page; tests assert it stays empty.
- `eslint-plugin-playwright` checks all files in `e2e/`: a Playwright call or `expect` that is not awaited
  (`missing-playwright-await`), `page.waitForTimeout()` (`no-wait-for-timeout`) and checks such as
  `expect(await locator.isVisible())` instead of the retrying `await expect(locator).toBeVisible()`
  (`prefer-web-first-assertions`) are errors.
- Elements are located by role, label and accessible name, not by CSS selectors.
- A test that simulates a crafted request adds hidden fields to the form, or changes the submitted data in the form's
  `formdata` event. It does not change the value of a control that React renders: React writes that value back
  whenever it renders the control again, e.g. when it gets the focus.
- `e2e/hydration.spec.ts` checks with JavaScript disabled that the controls of Client Components stay read-only or
  disabled until hydration (see "UI" in `architecture.md`). A new Client Component with such controls adds a case there.
- Every feature step adds end-to-end tests for its behaviour, including error and empty states.

## Continuous integration

- GitHub Actions runs the checks in seven workflows in `.github/workflows/`, each named like its file, so a failure
  shows at a glance which kind of check broke:
  - `format_check`: `npm run format:check`
  - `lint`: `npm run build`, `npm run typecheck`, `npm run lint`, as separate steps in this order
  - `unit_tests`: `npm run test:coverage`
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
  database, because every query calls `connection()` and no route is prerendered.
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
  in a pull request of its own, all action updates in one. Its pull requests run the same workflows; merging one is an upgrade, a task of its own (see `workflow.md`).
