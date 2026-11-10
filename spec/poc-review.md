# HippoWiki – Prototype Review

Comparison of the implemented prototype with `poc-steps.md` and `tech.md`, as of 2026-11-10.

## Verdict

All eight steps of `poc-steps.md` are implemented as described, and the prototype uses the stack from `tech.md`. The
differences are:

- features from `tech.md` that `poc-steps.md` postpones on purpose,
- two packages held below their latest major version for compatibility reasons,
- small additions that the specification does not describe.

None of them needs to be fixed for the prototype to count as complete. The small fixes made after the review are listed
under "Fixed after the review".

## Check results

Run on 2026-11-10 with Node.js 26.13.0, after the fixes:

| Check              | Result                                                        |
| ------------------ | ------------------------------------------------------------- |
| `npm run check`    | Passed: formatting, lint, typecheck, 24 unit tests in 5 files |
| `npm run build`    | Passed                                                        |
| `npm run test:e2e` | Passed: 22 tests; no test container left in `podman ps -a`    |

Not run again during this review, because they change or delete the data of the development database: the manual
database checks (table survives `db:down`/`db:up`, gone after `db:reset`), the run from an empty database, and the
check that an edit survives a restart.

## Steps of poc-steps.md

| Step                       | Status | Notes                                                                                  |
| -------------------------- | ------ | -------------------------------------------------------------------------------------- |
| Project scaffold           | Done   | The home page that showed "HippoWiki" is now a redirect to `/pages` (step 6 asks so)   |
| App shell with Material UI | Done   | `AppRouterCacheProvider` from `@mui/material-nextjs/v16-appRouter`, theme in `src/lib` |
| Postgres in Podman         | Done   | PostgreSQL 18, the current major version                                               |
| Prisma and the Page model  | Done   | Prisma 7 with `prisma.config.ts`, `prisma-client` generator and `PrismaPg` adapter     |
| End-to-end test harness    | Done   | Also handles a container left behind by a killed run                                   |
| List and view pages        | Done   | Raw HTML is shown as text, unsafe links are removed                                    |
| Create pages               | Done   | Content limit is 100,000 characters                                                    |
| Edit and delete pages      | Done   | Both actions handle a page that no longer exists                                       |

## Comparison with tech.md

Used as specified: TypeScript, Next.js with the App Router, Material UI, PostgreSQL, Prisma for CRUD (without the
`fullTextSearchPostgres` preview feature), pino, nvm, npm, ESLint without the Airbnb style guide, Prettier, Vitest,
Playwright, Podman, and Zod for forms, actions and environment variables.

Not implemented, because `poc-steps.md` lists them under "Not in the prototype":

- authentication with Better Auth
- PostgreSQL full-text search (English, German and more)

The items under "Later aspects" in `tech.md` are not implemented either, as expected.

## Package versions

`poc-steps.md` asks for the latest stable versions. These packages are not on the latest version:

- ESLint 9.39.5 instead of 10.14.0: `eslint-config-next` pulls in `eslint-plugin-react` 7.37.5, `eslint-plugin-import`
  2.32.0 and `eslint-plugin-jsx-a11y` 6.10.2, which support ESLint only up to version 9.
- TypeScript 6.0.3 instead of 7.0.2: `typescript-eslint` requires TypeScript below 6.1.

These are on the latest stable version, even if a tool may suggest otherwise:

- React and React DOM 19.3.1, pinned exactly.
- Prisma 7.10.1: the npm `latest` tag points to `8.0.0-rc.33`, a release candidate.
- Node.js 26 (`.nvmrc`, `engines`) is the current LTS release.

## Additions not described in the specification

- npm scripts `db:generate` and `postinstall`, which generate the Prisma client. Because of this, `.env` must exist
  before `npm install` (documented in `README.md`).
- `HIPPOWIKI_DIST_DIR` in `next.config.ts`: the end-to-end test server builds into `.next-e2e`, so it can run next to
  `npm run dev`.
- More end-to-end tests than required: redirect from `/`, malformed id, unsafe links, cancelling the create form,
  editing an unknown page, and saving or deleting a page that was deleted in the meantime.

## Details where the specification is silent

- The end-to-end tests run against `next dev`, not against a production build.
- `db:down` stops and removes the container; the volume and its data are kept, as required.
- `src/app/error.tsx` logs with `console.error`. It runs in the browser, so the rule to log through pino (server side)
  does not apply.

## Fixed after the review

- React and React DOM updated from 19.3.0 to 19.3.1.
- `src/app/global-error.tsx` added: an error in the root layout itself now shows a themed error page with "Try again"
  instead of the bare default page of Next.js. Checked in the browser with a temporary error in the app bar.
- `e2e/smoke.spec.ts` uses `collectErrors()` from `e2e/support/browser.ts`, like the other end-to-end tests.
- The layout under "Conventions" in `poc-steps.md` now lists `src/components/` and names `src/lib/` modules as
  examples, so it matches the code.
