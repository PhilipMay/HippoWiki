# HippoWiki – Testing

How the code is tested. Commands are listed in `README.md`.

## Unit tests

- Vitest; unit tests sit next to the code as `*.test.ts`.
- Schemas, environment parsing and other pure helpers get unit tests.
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
- Every feature step adds end-to-end tests for its behaviour, including error and empty states.
