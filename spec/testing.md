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

## End-to-end tests

- Playwright with Chromium only; tests live in `e2e/` (`npm run test:e2e`, `npm run test:e2e:ui`).
- Each run uses a throwaway PostgreSQL container `hippowiki-test-db` (port 5433, database `hippowiki_test`, data in
  memory only). The global setup starts it and applies the migrations; the global teardown removes it, so nothing is
  left running.
- Playwright starts the application itself on port 3100 with the build directory `.next-e2e` and `DATABASE_URL`
  pointing to the test database. The development database is never touched and does not need to run.
- All tests share the test database and run one after another.
- Helpers in `e2e/support/`:
  - `resetTestDatabase()` empties all tables; tests call it in `beforeEach`.
  - `createPage()` inserts a page directly into the test database with a unique slug; any field, e.g. `updatedAt`,
    can be set. Like the forms, it derives the title from the content; the content defaults to `# <title>`, so
    `createPage({ title: "Older page" })` works. A title given together with content is stored as is, to set up a page
    that was stored before titles were derived.
  - `getTestDb()` returns a Prisma client for the test database, e.g. to check what an action stored.
  - `collectErrors()` records console errors and uncaught exceptions of the browser page; tests assert it stays empty.
- Elements are located by role, label and accessible name, not by CSS selectors.
- `e2e/hydration.spec.ts` checks with JavaScript disabled that the controls of Client Components stay read-only or
  disabled until hydration (see "UI" in `architecture.md`). A new Client Component with such controls adds a case there.
- Every feature step adds end-to-end tests for its behaviour, including error and empty states.

## Continuous integration

- GitHub Actions runs the checks in four workflows in `.github/workflows/`, each named like its file, so a failure
  shows at a glance which kind of check broke:
  - `format_check`: `npm run format:check`
  - `lint`: `npm run build`, `npm run typecheck`, `npm run lint`, as separate steps in this order
  - `unit_tests`: `npm run test`
  - `end_to_end_tests`: `npm run test:e2e`
- They run on every push to any branch, on pull requests and when started by hand (`workflow_dispatch`). A newer push
  to the same ref cancels a run still in progress.
- Every workflow installs Node.js from `.nvmrc` and runs `npm ci` on `ubuntu-24.04`.
- `DATABASE_URL` is set to a placeholder URL on port 5432, never the test database: only `prisma generate` during
  `npm ci` reads it, nothing connects to it. The build needs no database, because every query calls `connection()` and
  no route is prerendered.
- The end-to-end workflow installs Chromium with `npx playwright install --with-deps chromium` and uses the Podman
  preinstalled on the runner; the tests start and remove their throwaway container `hippowiki-test-db` as they do
  locally. With `CI` set, Playwright retries a failed test twice and rejects `test.only`.
- The Playwright HTML report (`playwright-report/`) is uploaded as the artifact `playwright-report`, also when the tests
  fail (not when the run was cancelled), and kept for 7 days.
