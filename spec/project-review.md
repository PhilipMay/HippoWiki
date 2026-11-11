# HippoWiki – Project Review

A review of the project setup: configuration, linting, type checking, test strategy and continuous integration. The
issues follow the structure in `issue-report.md`. Nothing in this review has been changed in the code yet.

## Summary

The setup is very good. There are no blockers, 2 major issues, 6 minor issues and 3 nits.

- `npm run lint` passes without findings, and the 264 unit tests pass in under a second.
- `npm audit --omit=dev` finds no vulnerabilities in the production dependencies.
- The end-to-end tests and the production build were not run for this review.

The two major issues are about what the checks cannot see: the end-to-end tests never run a production build, and the
linter does not catch a forgotten `await`. The minor issues and nits are about making the tooling enforce what the
specs already say, and about keeping dependencies and documentation up to date.

## What is good

These parts are worth keeping as they are:

- The specs in `spec/` are precise and match the code closely. The conventions in `architecture.md` and `testing.md`
  are followed throughout.
- The end-to-end tests bring their own throwaway database: in memory (`--tmpfs`, `fsync=off`), started by the global
  setup and removed by the global teardown, also after a failed setup. Several guards keep the tests away from the
  development database: `testDatabaseUrl()` refuses a URL that points to the test database, `resetTestDatabase()`
  checks the name of the connected database before it empties it, and `reuseExistingServer: false` never attaches to a
  server someone else started.
- `HydrationMarker` and the shared `test` fixture in `e2e/support/test.ts`, enforced by a `no-restricted-imports` rule,
  remove the most common cause of flaky Next.js end-to-end tests. No test waits for a fixed time.
- `failOnFlakyTests` together with retries in CI makes flaky tests visible in the report without hiding failures.
- The unit tests focus on the branches the end-to-end tests cannot reach (database failures, malformed ids,
  `connection()`), instead of repeating them.
- The database enforces the content rules itself: the composite foreign key keeps a page's tab in the page's folder,
  and the partial unique index covers the names of pages placed directly in a folder.
- The workflows use minimal permissions, cancel outdated runs and upload their reports also when tests fail.

## Major

### End-to-end tests never exercise a production build

- Location: `playwright.config.ts`, lines 32–33, `webServer.command`
- Severity: Major
- Category: Tests
- Problem: All browser tests run against the development server (`npx next dev`). `testing.md` acknowledges the gap
  and works around one part of it with unit tests that mock `next/server`.
- Impact: Behaviour that only exists in a production build is never tested in a browser:
  - prerendering and the route cache, and whether `revalidatePath("/folders", "layout")` really refreshes every
    address under `/folders` after a save
  - the minified client bundles
  - `error.tsx` and `global-error.tsx`, which the development error overlay hides
  - the absence of the double rendering that StrictMode does in development only

  A caching bug would pass every check and only show up after deployment.

- Evidence: `spec/testing.md`, "Unit tests": "the end-to-end tests run the development server, which never
  prerenders".

  ```ts
  webServer: {
    command: `npx next dev --port ${port}`,
  ```

- Suggestion (required): In CI, run the end-to-end tests against `next build` followed by `next start`, both with
  `HIPPOWIKI_DIST_DIR=.next-e2e` and the test `DATABASE_URL`. The build needs no database, because no route is
  prerendered.
- Alternatives: Keep `next dev` as the default locally and switch to the production server with an environment
  variable, so that local runs stay fast. Or run both in CI, which doubles the runtime of the workflow.
- Reference: `node_modules/next/dist/docs/` on `next build`, `next start` and caching.

### No type-aware lint rules and no Playwright lint rules

- Location: `eslint.config.mjs`, lines 6–10
- Severity: Major
- Category: Tests, correctness
- Problem: Only `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript` are active. Neither runs
  rules that need type information, so nothing reports a promise that is not awaited. No rules for Playwright tests are
  configured either.
- Impact: Almost all code is asynchronous: Server Actions, Prisma calls and every Playwright step. In an end-to-end
  test, a missing `await` before `expect(locator)…` lets the test finish before the assertion runs: it passes when it
  should fail, or fails at random, which is exactly the kind of timing problem the hydration work prevents elsewhere.
  In a Server Action, a write that is not awaited can still be running when `redirect` throws.
- Evidence: `npx eslint --print-config` on any spec file shows no `@typescript-eslint/no-floating-promises` rule.
- Suggestion (required): Enable typed linting with `parserOptions.projectService: true` and add at least
  `@typescript-eslint/no-floating-promises`, `@typescript-eslint/no-misused-promises`,
  `@typescript-eslint/await-thenable` and `@typescript-eslint/switch-exhaustiveness-check`. Add
  `eslint-plugin-playwright` for `e2e/**` with `missing-playwright-await`, `no-wait-for-timeout` and
  `prefer-web-first-assertions`.
- Alternatives: Use the whole `recommendedTypeChecked` preset of typescript-eslint. It finds more, but needs more
  suppressions at first and makes `npm run lint` slower.
- Reference: typescript-eslint, "Linting with Type Information"; eslint-plugin-playwright rules.

## Minor

### Dependencies are neither updated nor audited automatically

- Location: `.github/`, no `dependabot.yml` or Renovate configuration
- Severity: Minor
- Category: Security
- Problem: Nothing reports outdated or vulnerable packages. Upgrades only happen when someone thinks of them.
- Impact: Security fixes reach the project late. Today the advisories concern only development tooling, but the same
  gap applies to Next.js, Prisma and `pg`.
- Evidence: `npm audit` reports 7 moderate advisories in the typescript-eslint → minimatch chain (dev only, fixable
  with `npm audit fix`). `npm outdated` lists new major versions of ESLint (10), TypeScript (7) and Prisma (8, release
  candidate).
- Suggestion (optional): Add Dependabot for the `npm` and `github-actions` ecosystems, weekly and grouped, so it opens
  few pull requests. Upgrading stays a task of its own, as `workflow.md` asks.
- Reference: GitHub Docs, "Configuring Dependabot version updates".

### Conventions from the specs are not enforced by the linter

- Location: `spec/architecture.md`, "Validation and errors" and "UI"; `eslint.config.mjs`
- Severity: Minor
- Category: Style, correctness
- Problem: Several rules in the specs are only checked by review, although the linter could check them.
- Impact: A rule that only review checks gets broken sooner or later, especially in code written by an agent.
  `issue-report.md` itself says to fix the tool configuration rather than report what tools can catch.
- Evidence: `spec/architecture.md`:
  - "never directly from `process.env`"
  - "Server-side logging goes through the pino `logger` … not `console`"
  - "Material UI components are imported per path"
  - The groups of imports are also ordered by hand in every file.
- Suggestion (optional):
  - `no-restricted-properties` for `process.env`, turned off for `src/lib/env.ts` and `src/lib/logger.ts`
  - `no-console` for server code (`src/features/**/actions.ts`, `queries.ts`, `src/app/api/**`, `src/lib/**`)
  - `no-restricted-imports` for the barrel import `@mui/material`
  - `import/order` with the groups already in use; the import plugin is loaded by `eslint-config-next`

### Database behaviour is only tested through mocks and end-to-end tests

- Location: `src/lib/db-errors.ts`, lines 14–25, `isUniqueViolation`; the unit tests that mock `@/lib/db`
- Severity: Minor
- Category: Tests
- Problem: `isUniqueViolation` depends on the error shape `meta.driverAdapterError.cause.constraint` of the Prisma
  `pg` adapter, and on index names such as `Page_folderId_name_key`. The unit tests build this shape by hand, so they
  pass whatever shape Prisma really reports.
- Impact: If a Prisma upgrade (version 8 is in release candidate) changes the shape or the names, the unit tests stay
  green. Only the slower end-to-end tests for a taken name notice it, and they show a failed save, not the cause.
- Evidence:

  ```ts
  const adapterError = err.meta?.driverAdapterError as
    { cause?: { constraint?: { index?: string; fields?: string[] } } } | undefined;
  ```

- Suggestion (optional): Add a small Vitest project for integration tests against the throwaway PostgreSQL container
  of `e2e/support/container.ts`. It checks `db-errors.ts`, the unique and foreign key constraints and the queries
  against a real database, and stays out of `npm run check` so that the check stays fast.
- Alternatives: Rely on the end-to-end tests and add one test per constraint that checks the exact message in the
  form. Cheaper, but slower to run and to debug.

### `npm install` fails without `DATABASE_URL`

- Location: `prisma.config.ts`, lines 13–14, `datasource.url`; `package.json`, line 22, `postinstall`
- Severity: Minor
- Category: Configuration
- Problem: `env("DATABASE_URL")` throws when the variable is missing, and `postinstall` runs `prisma generate`, which
  loads the config. Generating the client does not need a database.
- Impact: A fresh clone fails at `npm install` until `.env` exists. Each of the four workflows carries a placeholder
  URL with a long comment explaining why.
- Evidence: `README.md`, "Getting started": "`.env` must exist before `npm install`, because generating the Prisma
  client reads `DATABASE_URL`."
- Suggestion (optional): Check in the Prisma 7 documentation whether the URL can be optional for `generate`, for
  example by reading `process.env.DATABASE_URL` directly instead of through `env()`, so that only `migrate`, `seed` and
  `studio` require it. Then remove the placeholders from the workflows.

### `tech.md` lists features that are not built yet

- Location: `spec/tech.md`, "Data & Backend"
- Severity: Minor
- Category: Docs
- Problem: Authentication and full-text search are listed as part of the stack, next to the parts that exist.
- Impact: A reader, or an agent following the specs, assumes a login and a search exist and may build on them.
- Evidence: "Authentication: Better Auth" and "for search use Postgres full-text search", while `README.md` says
  "There is a single user and no login."
- Suggestion (optional): Mark both as planned, or move them to "Later Aspects".

### TypeScript could be stricter

- Location: `tsconfig.json`, line 7, `compilerOptions`
- Severity: Minor
- Category: Correctness
- Problem: Only `strict` is enabled. Access by index is typed as always present.
- Impact: Code that assumes an array has an element compiles without a warning and fails at runtime if it does not.
- Evidence: `e2e/support/database.ts`, line 54:

  ```ts
  const [{ current_database: current }] = await db.$queryRaw<{ current_database: string }[]>`
  ```

- Suggestion (optional): Enable `noUncheckedIndexedAccess`, `noImplicitOverride` and `noFallthroughCasesInSwitch`.
  `noUncheckedIndexedAccess` will need a few small fixes in existing code.

## Nits

### The CI workflows repeat their setup

- Location: `.github/workflows/*.yml`
- Severity: Nit
- Category: Performance, security
- Problem: Each of the four workflows runs `npm ci` on its own. The production build sits in the `lint` workflow, and
  the end-to-end workflow does not reuse it. Actions are pinned by tag (`actions/checkout@v7`), not by commit SHA.
- Impact: Four installs per push, and a moved tag would change what runs in CI without a change in the repository.
- Suggestion (optional): Pin actions by commit SHA; Dependabot keeps the pins up to date. Whether to merge the
  workflows is a matter of taste: separate workflows show at a glance which check broke, which `testing.md` wants.

### Coverage has no thresholds for the code that the strategy covers with unit tests

- Location: `vitest.config.ts`, lines 11–14, `coverage`
- Severity: Nit
- Category: Tests
- Problem: Coverage is reported for all of `src/`, without thresholds. Routes and components, which only the
  end-to-end tests cover, pull the total down.
- Impact: The total (59 % of lines) does not say whether the modules that should be unit tested are, and a drop there
  goes unnoticed.
- Evidence: `spec/testing.md`: "has no thresholds: much of the code, such as the UI, is covered by the end-to-end tests
  instead."
- Suggestion (optional): Add per-glob thresholds for `src/lib/**` and for `schema.ts`, `derive.ts`, `actions.ts` and
  `queries.ts` of every feature, and keep the rest without one.

### The PostgreSQL image is set twice and not pinned

- Location: `scripts/db.sh`, line 21; `e2e/support/container.ts`, line 7
- Severity: Nit
- Category: Configuration
- Problem: Both files set `docker.io/library/postgres:18`. A comment asks to keep them in sync, and the tag follows
  every minor release.
- Impact: The development and test databases can drift apart, and a new minor version can change a run without a
  change in the repository.
- Suggestion (optional): Keep the image in one place, for example `.env.example` or a small file that both read, and
  pin an exact minor version (`postgres:18.<minor>`).

## Outside this review

There is no login yet, so every Server Action is a public endpoint, and `next.config.ts` sets no security headers or
Content Security Policy. That is fine while HippoWiki runs only on the development machine. Both belong to the
authentication work, before HippoWiki is reachable over a network.
