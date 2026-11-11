# Test Coverage – Steps

## Goal

Close the gaps between the layers that the current tests leave open: the failure branches of the Server Actions and
the health route, which no end-to-end test can reach without breaking the shared test database, and the hydration lock
of the forms, which the end-to-end tests rely on but never check. The behaviour of the application does not change.

## Scope

- In:
  - unit tests for `src/features/pages/actions.ts` with mocked database, logger, `revalidatePath` and `redirect`
  - unit tests for `src/app/api/health/route.ts` with a mocked database
  - end-to-end tests with JavaScript disabled for the locked state of the forms and the delete button before hydration
  - `testing.md` describes the new conventions
- Not in:
  - changes to application code, except where a test reveals a bug (then the step file is updated first)
  - component tests with jsdom or Testing Library; client behaviour stays covered by the end-to-end tests
  - end-to-end tests that make the shared test database fail (failure messages in the UI, `error.tsx`)
  - unit tests of `queries.ts`, the seed or the end-to-end support code
  - coverage reports or thresholds

## Checklist

- [x] Action unit tests
- [x] Health route unit tests
- [ ] Hydration lock end-to-end tests
- [ ] Wrap-up

## Action unit tests

### Goal

Every branch of `createPage`, `updatePage` and `deletePage` is covered, including those the end-to-end tests cannot
reach: database failures, malformed ids and the detection of a taken slug.

### Build

- Add `src/features/pages/actions.test.ts` (Vitest, `node` environment, picked up by the existing `include`).
- Mock with `vi.mock` (shared mock functions created with `vi.hoisted`, reset in `beforeEach`):
  - `@/lib/db`: `getDb()` returns an object with `page.create`, `page.updateMany`, `page.deleteMany` as `vi.fn()`
  - `@/lib/logger`: `logger.info`, `logger.warn`, `logger.error` as `vi.fn()`
  - `next/cache`: `revalidatePath`
  - `next/navigation`: `redirect` throws an error carrying the target path, like the real one throws, so that code after
    it never runs; tests assert the rejection and the path
- Build form data with a small local helper `formData({ slug, content, title? })`.
- Build Prisma errors with `new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion, meta })` from
  `@/generated/prisma/client`. The `meta.driverAdapterError.cause.constraint` shape mirrors what Prisma reports with
  the `pg` adapter; the end-to-end "slug taken" tests stay the check against the real shape.
- Cases for `createPage`:
  - invalid input returns the field errors; nothing is written, revalidated or redirected
  - success stores the derived title, the trimmed slug and the content (a submitted `title` is ignored), logs
    "page created" with the id, revalidates `/pages` as layout and redirects to `/pages/<stored slug>`
  - a unique violation on the index `Page_slug_key` returns "Slug is already in use" at the slug field and logs a warning
  - a unique violation reported by fields (`["slug"]`) instead of the index name counts as a taken slug as well
  - a unique violation on another constraint and any other error return the "could not be saved" message and log an
    error with `{ err }`; nothing is revalidated or redirected
- Cases for `updatePage`:
  - a malformed id returns the "no longer exists" message without touching the database, even with invalid input
  - invalid input returns the field errors without touching the database
  - success calls `updateMany` with the id and the validated data, revalidates and redirects to the new slug
  - a count of 0 returns the "no longer exists" message and logs a warning; nothing is revalidated or redirected
  - a taken slug and other errors behave as in `createPage`
- Cases for `deletePage`:
  - success deletes by id, logs "page deleted", revalidates and redirects to `/pages`
  - a count of 0 logs a warning and still revalidates and redirects to `/pages`
  - a malformed id does not touch the database, logs a warning and redirects to `/pages` without revalidating
  - a database error returns the "could not be deleted" message and does not redirect

### Test

- `npm run test` runs the new tests; each branch listed above has a test.
- Manual check: temporarily breaking a branch in `actions.ts` (e.g. dropping the `fields` fallback in `isSlugTaken`)
  makes a test fail.

## Health route unit tests

### Goal

Both answers of `GET /api/health` are covered: ok while the database answers, 503 with a logged error otherwise.

### Build

- Add `src/app/api/health/route.test.ts`.
- Mock `@/lib/db` (`getDb().$queryRaw` as `vi.fn()`; it is called as a tagged template) and `@/lib/logger`, in the
  same way as the action tests.
- Cases:
  - the query resolves: status 200 and `{ "status": "ok" }`
  - the query rejects: status 503, `{ "status": "error" }` and `logger.error` called with `{ err }`

### Test

- `npm run test` runs the new tests.

## Hydration lock end-to-end tests

### Goal

The server-rendered forms keep their controls locked until hydration, as `architecture.md` requires, so that the
end-to-end tests that rely on this fail instead of becoming flaky when the lock is lost.

### Build

- Add `e2e/hydration.spec.ts` with `test.use({ javaScriptEnabled: false })`; the page shows the server-rendered HTML
  only. Use `resetTestDatabase()` in `beforeEach` and `createPage()` for the edit and view cases.
- Cases:
  - `/pages/new`: the content field is not editable and "Save" is disabled; "Cancel" links to `/pages`
  - `/pages/<slug>/edit`: slug and content are prefilled and not editable, "Save" is disabled
  - `/pages/<slug>`: "Delete" is disabled; "Edit" links to the edit form
- Locate elements by role and label as in the other specs (`toBeEditable`, `toBeDisabled`, `toHaveAttribute("href")`).

### Test

- `npm run test:e2e` runs the new tests.
- Manual check: removing `readOnly: !hydrated` from `PageForm` makes the edit case fail.

## Wrap-up

### Goal

The new test conventions are part of the spec and the step file is gone.

### Build

1. Update `testing.md`:
   - "Unit tests": Server Actions and route handlers get unit tests for the branches the end-to-end tests cannot reach
     (database failures, malformed ids); they mock `@/lib/db`, `@/lib/logger`, `next/cache` and `next/navigation`, and
     the mocked `redirect` throws like the real one.
   - "End-to-end tests": `e2e/hydration.spec.ts` checks with JavaScript disabled that controls stay locked until
     hydration; new Client Components with such controls add a case there.
   - In `architecture.md`, point the hydration bullet under "UI" to that test.
2. `roadmap.md`: nothing to remove, this plan does not come from the roadmap.
3. `README.md`: no new commands; check that nothing is out of date.
4. Delete `spec/test-coverage-steps.md`.
5. Remove the step file from the spec catalog in `CLAUDE.md`.

### Test

- `npm run check`, `npm run test:e2e` and `npm run build` pass.
- `CLAUDE.md` lists exactly the files in `spec/`.
