# HippoWiki – Testing

How the code is tested. Commands are listed in `README.md`.

## Unit tests

- Vitest; unit tests sit next to the code as `*.test.ts`.
- Schemas, environment parsing and other pure helpers get unit tests.
- Server Actions and route handlers get unit tests for the branches the end-to-end tests cannot reach without breaking
  the shared test database, such as database failures and malformed ids. They mock `@/lib/db`, `@/lib/logger`,
  `next/cache` and `next/navigation` with `vi.mock` (shared mock functions from `vi.hoisted`, reset in `beforeEach`);
  the mocked `redirect` throws like the real one, so code after it never runs and tests assert the rejection and its
  path.
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

## End-to-end tests

- Playwright with Chromium only; tests live in `e2e/` (`npm run test:e2e`, `npm run test:e2e:ui`).
- Each run uses a throwaway PostgreSQL container `hippowiki-test-db` (port 5433, database `hippowiki_test`, data in
  memory only). The global setup starts it and applies the migrations; the global teardown removes it, so nothing is
  left running.
- Playwright starts the application itself on port 3100 with the build directory `.next-e2e` and `DATABASE_URL`
  pointing to the test database. The development database is never touched and does not need to run.
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
    that was stored before titles were derived.
  - Tests that open an address give the folder, tab and page fixed names, e.g.
    `createPage({ folder, name: "overview" })` for `/folders/<folder>/overview.md`.
  - `getTestDb()` returns a Prisma client for the test database, e.g. to check what an action stored.
  - `collectErrors()` records console errors and uncaught exceptions of the browser page; tests assert it stays empty.
- Elements are located by role, label and accessible name, not by CSS selectors.
- A test that simulates a crafted request adds hidden fields to the form, or changes the submitted data in the form's
  `formdata` event. It does not change the value of a control that React renders: React writes that value back
  whenever it renders the control again, e.g. when it gets the focus.
- `e2e/hydration.spec.ts` checks with JavaScript disabled that the controls of Client Components stay read-only or
  disabled until hydration (see "UI" in `architecture.md`). A new Client Component with such controls adds a case there.
- Every feature step adds end-to-end tests for its behaviour, including error and empty states.

## Continuous integration

- GitHub Actions runs the checks in four workflows in `.github/workflows/`, each named like its file, so a failure
  shows at a glance which kind of check broke:
  - `format_check`: `npm run format:check`
  - `lint`: `npm run build`, `npm run typecheck`, `npm run lint`, as separate steps in this order
  - `unit_tests`: `npm run test:coverage`
  - `end_to_end_tests`: `npm run test:e2e`
- They run on every push to any branch, on pull requests and when started by hand (`workflow_dispatch`). A newer push
  to the same ref cancels a run still in progress.
- Every workflow installs Node.js from `.nvmrc` and runs `npm ci` on `ubuntu-24.04`.
- `DATABASE_URL` is set to a placeholder URL on port 5432, never the test database: only `prisma generate` during
  `npm ci` reads it, nothing connects to it. The build needs no database, because every query calls `connection()` and
  no route is prerendered.
- The end-to-end workflow installs Chromium with `npx playwright install --with-deps chromium` and uses the Podman
  preinstalled on the runner; the tests start and remove their throwaway container `hippowiki-test-db` as they do
  locally. With `CI` set, Playwright retries a failed test twice, fails the run if a test passed only on a
  retry, and rejects `test.only`.
- The Playwright HTML report (`playwright-report/`) is uploaded as the artifact `playwright-report`, also when the tests
  fail (not when the run was cancelled), and kept for 7 days.
- The unit test workflow writes the coverage tables of `scripts/coverage-summary.ts` to the job summary and uploads
  `coverage/` as the artifact `coverage-report`, also when the tests fail (not when the run was cancelled or no report
  was written), kept for 7 days.
