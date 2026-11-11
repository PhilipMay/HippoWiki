# HippoWiki – Architecture and Conventions

How the code is organised and which patterns new code follows. The technology stack is defined in `tech.md`.

## Layout

- Source code lives under `src/`, with the import alias `@/` pointing to `src/`.
- `src/app/`: routes (App Router), including the global `not-found`, `error` and `global-error` pages
- `src/components/`: shared UI components (app bar, `Link`)
- `src/lib/`: cross-cutting modules (`env.ts`, `db.ts`, `db-errors.ts`, `logger.ts`, `theme.ts`, `site.ts`,
  `format.ts`, `hydration.ts`, `names.ts`, `addresses.ts`)
  - `names.ts`: the name rule shared by folders, tabs and pages (`nameSchema`, `parseName`) and the form state of
    forms that ask for a name
  - `addresses.ts`: the addresses under `/folders` (`folderPath`, `tabPath`, `pagePath`, `parsePageSegment`) and the
    actions and views in their query string (`parseAction`, `parseView`)
  - Both have no server-only imports, so Client Components can use them.
- `src/features/<feature>/`: everything about one feature – `schema.ts`, `queries.ts`, `actions.ts`, `components/`
  and pure helpers such as `derive.ts` and `limits.ts` for pages (no server-only imports, so Client Components can use
  them). `limits.ts` holds the field length limits, so that `schema.ts` can import `derive.ts` without a cycle.
  - `folders`: folders and their tabs, and the name dialog used for folders, tabs and pages
  - `pages`: pages
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
    redirects. The actions for folders, tabs and pages call `revalidatePath("/folders", "layout")`, which covers every
    address under `/folders`.
  - An action redirects to the address of the item as stored, built with the helpers in `addresses.ts`, never to one
    built from submitted values.
  - On failure it returns a form state `{ fieldErrors?, message? }` that the form shows; the entered values are kept.
  - `redirect` is called outside `try` blocks, because it throws.
  - Rows that may no longer exist are changed with `updateMany`/`deleteMany` and the returned count is checked,
    instead of catching "not found" errors.
  - Values such as the id are bound with `action.bind(null, id)`.

## Validation and errors

- All input (forms, actions, environment variables) is validated with Zod. Schemas live in the feature's `schema.ts`
  and have unit tests.
- Ids and names from URLs or forms are parsed (`parsePageId`, `parseFolderId`, `parseTabId`, `parseName`,
  `parsePageSegment`) before they reach the database; malformed ones are treated like missing rows and show the
  not-found page.
- Unique and foreign key violations that a user can cause, such as a taken name or a folder that no longer exists,
  are recognised with `isUniqueViolation` and `isForeignKeyViolation` from `src/lib/db-errors.ts` and shown in the
  form. Any other database error is logged and shown as a failed save.
- The server environment is read through `getServerEnv()` from `src/lib/env.ts`, never directly from `process.env`.
- Server-side logging goes through the pino `logger` from `src/lib/logger.ts`, not `console`. Errors are logged with
  `{ err }` and the relevant ids.

## Addresses and actions

- All content lives under `/folders`; the addresses are described in `content-structure.md`. Routes, Server Actions
  and links build them with the helpers in `src/lib/addresses.ts` instead of writing paths by hand.
- What an address opens is given in its query string: an action as `?action=<action>`, a view as `?view=<view>`.
  A route reads them with `parseAction` and `parseView`, passing only the actions and views it has, and calls
  `notFound()` for `"invalid"`. A route without views calls `parseView` without allowed views.
- A dialog that belongs to an action is rendered by the route's Server Component, open from the start, on top of the
  content of the address. Buttons that open it are links to the address with the action; closing it navigates to the
  address without the query string.

## Database

- The application uses the single Prisma client from `getDb()` in `src/lib/db.ts`. It is created on first use, uses the
  `pg` driver adapter and survives hot reloads in development.
- Schema changes are made in `prisma/schema.prisma` and always come with a migration
  (`npm run db:migrate -- --name <change>`). Migrations are stored under `prisma/migrations/`.
- A migration that Prisma cannot create by itself, such as one that moves data or one that `prisma migrate dev`
  refuses to create without a prompt, is written by hand: the SQL of the schema change comes from
  `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, and
  `npm run db:migrate` then applies it and checks that the database matches the schema.
- The name of a migration directory must sort after all existing ones, because migrations are applied in the order of
  their names.
- Prisma is used for CRUD. The `fullTextSearchPostgres` preview feature is not enabled; search uses PostgreSQL
  full-text search directly.
- The `partialIndexes` preview feature is enabled for partial unique indexes (`where` in `@@unique`), such as the one
  on the names of pages placed directly in a folder.
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
- The root layout renders `HydrationMarker` (`src/components/`), which sets `data-hydrated="true"` on `<html>` in the
  same commit in which `useHydrated()` turns true. The end-to-end tests wait for it after every page load.
- Dialogs that a route renders for an action use `disablePortal`, so that they are part of the server-rendered HTML
  like the rest of the page, and lock their controls until hydration as described above. The name dialog
  (`NameDialog` in `src/features/folders/components/`) is shared by folders, tabs and pages.
- A form with controlled radio buttons or checkboxes calls its Server Action in `onSubmit` inside `startTransition`
  instead of passing it as the form's `action`: React resets a form after its action, which puts these controls back
  to their initial state, out of sync with the controlled one.
- Browser titles are built with `pageTitle()` from `src/lib/site.ts`.
- Markdown is rendered with `react-markdown` and GitHub Flavored Markdown; raw HTML is never rendered.
- Markdown that is analysed instead of rendered, such as the title heading of a page, is parsed with the same parser
  that `react-markdown` uses (`mdast-util-from-markdown` with `micromark-extension-gfm` and `mdast-util-gfm`, and
  `mdast-util-to-string` for plain text), so the result matches the rendered page.

## Linting

- ESLint uses the rules of `eslint-config-next` (`core-web-vitals`, `typescript`) and Prettier's config, which turns off
  the rules that conflict with formatting.
- TypeScript files are linted with type information (`parserOptions.projectService`). These rules report a promise that
  is neither awaited nor handled (`no-floating-promises`), a promise passed where no promise is expected
  (`no-misused-promises`), `await` on a value that is not a promise (`await-thenable`) and a `switch` over a union that
  misses a case (`switch-exhaustiveness-check`). A promise that is deliberately not awaited is marked with `void` and a
  comment saying why.
- The rules for the end-to-end tests are described in `testing.md`.
