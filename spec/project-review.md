# HippoWiki – Project Review

## Minor

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
- Problem: Each of the five workflows runs `npm ci` on its own. The `lint` workflow and the production end-to-end
  workflow each create a production build. Actions are pinned by tag (`actions/checkout@v7`), not by commit SHA.
- Impact: Five installs and two builds per push, and a moved tag would change what runs in CI without a change in the repository.
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
