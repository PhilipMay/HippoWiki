# HippoWiki – Architecture and Conventions

How the code is organised and which patterns new code follows. The technology stack is defined in `tech.md`.

## Layout

- Source code lives under `src/`, with the import alias `@/` pointing to `src/`.
- `src/app/`: routes (App Router), including the global `not-found`, `error` and `global-error` pages
- `src/components/`: shared UI components (app bar, `Link`)
- `src/lib/`: cross-cutting modules (`env.ts`, `db.ts`, `logger.ts`, `theme.ts`, `site.ts`, `format.ts`,
  `hydration.ts`)
- `src/features/<feature>/`: everything about one feature – `schema.ts`, `queries.ts`, `actions.ts`, `components/`
  and pure helpers such as `derive.ts` and `limits.ts` for pages (no server-only imports, so Client Components can use
  them). `limits.ts` holds the field length limits, so that `schema.ts` can import `derive.ts` without a cycle.
- `src/generated/prisma/`: the generated Prisma client (`npm run db:generate`), not checked in
- `prisma/`: schema, migrations, seed
- `scripts/`: development scripts (`db.sh`)
- `e2e/`: Playwright tests

## Reads and writes

- Reads happen in Server Components through the feature's `queries.ts`.
  - Every query first awaits `connection()`, so that Next.js does not prerender the route at build time.
  - Queries that are used by both `generateMetadata` and the page are wrapped in React `cache()`.
- Writes happen through Server Actions in the feature's `actions.ts`.
  - An action validates its input, writes, logs the event, calls `revalidatePath` for every affected route and
    redirects.
  - On failure it returns a form state `{ fieldErrors?, message? }` that the form shows; the entered values are kept.
  - `redirect` is called outside `try` blocks, because it throws.
  - Rows that may no longer exist are changed with `updateMany`/`deleteMany` and the returned count is checked,
    instead of catching "not found" errors.
  - Values such as the id are bound with `action.bind(null, id)`.

## Validation and errors

- All input (forms, actions, environment variables) is validated with Zod. Schemas live in the feature's `schema.ts`
  and have unit tests.
- Ids and slugs from URLs or forms are parsed (`parsePageId`, `parsePageSlug`) before they reach the database;
  malformed ones are treated like missing rows and show the not-found page.
- The server environment is read through `getServerEnv()` from `src/lib/env.ts`, never directly from `process.env`.
- Server-side logging goes through the pino `logger` from `src/lib/logger.ts`, not `console`. Errors are logged with
  `{ err }` and the relevant ids.

## Database

- The application uses the single Prisma client from `getDb()` in `src/lib/db.ts`. It is created on first use, uses the
  `pg` driver adapter and survives hot reloads in development.
- Schema changes are made in `prisma/schema.prisma` and always come with a migration
  (`npm run db:migrate -- --name <change>`). Migrations are stored under `prisma/migrations/`.
- Prisma is used for CRUD. The `fullTextSearchPostgres` preview feature is not enabled; search uses PostgreSQL
  full-text search directly.
- The development database is PostgreSQL 18 in the Podman container `hippowiki-db`, managed with `scripts/db.sh`
  (`npm run db:up`, `db:down`, `db:reset`, `db:psql`, `db:logs`). The test database uses the same image version.

## UI

- Every page is rendered inside the root layout: Material UI with its App Router cache provider, the theme from
  `src/lib/theme.ts`, `CssBaseline`, the app bar and a centered content container.
- Components are Server Components unless they need interaction; then they are small Client Components.
- Material UI components are imported per path (`@mui/material/Button`). Links use `@/components/Link` as
  `component={Link}`.
- `sx` props in Server Components are plain objects, because functions cannot cross to Client Components.
- Forms focus the field the user most likely edits first. When the server rejects a save with field errors, the first
  field with an error is focused; errors that only show a message above the form leave the focus where it is.
- Controls of Client Components that need JavaScript stay read-only (text fields) or disabled (buttons) until the
  component has hydrated, using `useHydrated()` from `src/lib/hydration.ts`. Input during hydration could otherwise be
  lost: React sets the value of a hydrating text field again, which resets its selection, and a click before the
  handler is attached does nothing. The end-to-end tests rely on this, because Playwright waits until a field is
  editable and a button is enabled; `e2e/hydration.spec.ts` checks the lock with JavaScript disabled.
- Browser titles are built with `pageTitle()` from `src/lib/site.ts`.
- Markdown is rendered with `react-markdown` and GitHub Flavored Markdown; raw HTML is never rendered.
- Markdown that is analysed instead of rendered, such as the title heading of a page, is parsed with the same parser
  that `react-markdown` uses (`mdast-util-from-markdown` with `micromark-extension-gfm` and `mdast-util-gfm`, and
  `mdast-util-to-string` for plain text), so the result matches the rendered page.
