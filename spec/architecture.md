# HippoWiki – Architecture and Conventions

How the code is organised and which patterns new code follows. The technology stack is defined in `tech.md`.

## Layout

- Source code lives under `src/`, with the import alias `@/` pointing to `src/`.
- `src/app/`: routes (App Router), including the global `not-found`, `error` and `global-error` pages
- `src/components/`: shared UI components (app bar, `Link`)
- `src/lib/`: cross-cutting modules (`env.ts`, `db.ts`, `db-errors.ts`, `logger.ts`, `theme.ts`, `site.ts`,
  `format.ts`, `hydration.ts`, `focus.ts`, `names.ts`, `addresses.ts`, `revalidate.ts`, `result.ts`)
  - `names.ts`: the name rule shared by folders, tabs and pages (`nameSchema`, `parseName`) and the form state of
    forms that ask for a name
  - `addresses.ts`: the addresses under `/folders` (`folderPath`, `tabPath`, `pagePath`, `parsePageSegment`) and
    `/deleted-pages` (`deletedPagesPath`, `deletedPagePath`), and the actions and views in their query string
    (`parseAction`, `parseView`)
  - `names.ts` and `addresses.ts` have no server-only imports, so Client Components can use them.
  - `revalidate.ts`: `revalidateContent()`, the revalidation after every write to folders, tabs and pages
  - `result.ts`: the type `Result`, which the writes of a service return; no server-only imports
- `src/features/<feature>/`: everything about one feature – `schema.ts`, `service.ts`, `forms.ts`, `queries.ts`,
  `actions.ts`, `components/` and pure helpers such as `derive.ts` and `limits.ts` for pages (no server-only imports,
  so Client Components can use them). `limits.ts` holds the field length limits, so that `schema.ts` can import
  `derive.ts` without a cycle.
  - `schema.ts`: the ids, the Zod schemas and the types of validated input
  - `service.ts`: every read and write of the feature (see "Reads and writes")
  - `forms.ts`: what only a form needs: the `parse*FormData` functions, the form states, the types of the form
    actions and the names of form fields. It has no server-only imports, so Client Components can use it.
  - `queries.ts` and `actions.ts`: the adapters between the web and the service
  - `folders`: folders and their tabs, and the name dialog used for folders, tabs and pages
  - `pages`: pages
- `src/generated/prisma/`: the generated Prisma client (`npm run db:generate`), not checked in
- `prisma/`: schema, migrations, seed
- `scripts/`: development scripts (`db.sh`)
- `e2e/`: Playwright tests
- `integration/`: Vitest integration tests against the test database

## Reads and writes

- The layers: a route or component calls `queries.ts` or `actions.ts`, these call `service.ts`, and only `service.ts`
  calls `getDb()`. Routes and components import a service only for its types. The health route
  (`src/app/api/health/route.ts`) is the one exception: it checks the database connection itself.
- `service.ts` of a feature holds every read and write of the feature. It knows nothing about Next.js, forms or
  addresses, so that a caller other than the GUI, such as an MCP server, can use the same service.
  - It imports nothing from `next`, `react`, `@/lib/revalidate` or a `forms.ts`, has no `"use server"` and works
    outside a request.
  - It takes plain typed arguments (ids, names, objects of strings), never `FormData`.
  - It trusts no caller: it parses ids and names and validates input with the Zod schemas of `schema.ts`, which also
    derive the title of a page (see "Validation and errors").
  - Reads return rows, a list or `null`. A malformed id or name counts as a missing row and never reaches the
    database: a list is empty, a single item is `null`. Database errors are thrown.
  - Writes return a `Result` from `src/lib/result.ts`: `{ ok: true, value }` with the item as stored, or
    `{ ok: false, error }` with a code. The codes are `invalid-input` (with `fieldErrors`), `name-taken`,
    `folder-not-found`, `tab-not-found`, `page-not-found` and `failed`. Each write declares the ones it can return in
    a type of its own, such as `CreatePageError`.
  - A write checks its ids first, then its input, then writes.
  - Rows that may no longer exist are changed with `updateMany` and the returned count is checked, instead of catching
    "not found" errors.
  - It logs the events of its writes: the stored item, a taken name, an item that was not found in the database and
    an unexpected error. A malformed id and invalid input are not logged.
  - It returns no addresses and no messages, except the field errors of the schemas in `invalid-input`. The stored
    item carries what an address is built from: its name and the names of its folder and tab.
  - It declares the types of its results itself (`FolderSummary`, `PageWithPlace`, `StoredPage` and the like) instead
    of deriving them from a Prisma query, states the return type of every function, and names the columns of every
    query with `select`, never `include`, so that a new column does not reach a caller by accident. Components import
    these types from the service with `import type`.
  - It is the place for checks of who may read or change something, once users and rights exist. Such checks never go
    into the adapters, which an MCP server does not pass through.
  - Its functions have the names of the queries and actions, so the adapters import it as a namespace:
    `import * as folderService from "@/features/folders/service"`.
- Reads happen in Server Components through the feature's `queries.ts`.
  - Every query first awaits `connection()`, so that Next.js does not prerender the route at build time, and then
    calls the service read of the same name.
  - Queries that are used by both `generateMetadata` and the page are wrapped in React `cache()`.
- Writes happen through Server Actions in the feature's `actions.ts`.
  - An action checks the id, parses the form with a `parse*FormData` function of `forms.ts`, calls the service and
    maps the result.
  - It maps every error code to a form state `{ fieldErrors?, message? }` in a `switch`; the form shows the state and
    keeps the entered values. The messages live in `actions.ts`, and each action has its own message for `failed`.
  - On success it calls `revalidateContent()` from `src/lib/revalidate.ts` and redirects. `revalidateContent()` calls
    `revalidatePath` with `"layout"` for `/folders` and `/deleted-pages` and so covers every address under both:
    renaming a folder changes the addresses of its deleted pages, and creating or renaming a tab changes the places
    offered when a page is restored.
  - It redirects to the address of the item as stored, built from the result of the service with the helpers in
    `addresses.ts`, never to one built from submitted values.
  - `redirect` is called last and outside `try` blocks, because it throws.
  - Values such as the id are bound with `action.bind(null, id)`.

## Validation and errors

- All input (forms, service arguments, environment variables) is validated with Zod. Schemas live in the feature's
  `schema.ts` and have unit tests.
- A form is parsed by a `parse*FormData` function in the feature's `forms.ts`. It reports all errors of a form
  together, including the ones only a form has, such as no place chosen or a file instead of text.
- The service validates the same input again with the same schemas. This is deliberate: a caller other than a form
  does not pass through `forms.ts`.
- Ids and names from URLs, forms or callers of a service are parsed (`parsePageId`, `parseFolderId`, `parseTabId`,
  `parseName`, `parsePageSegment`) before they reach the database; malformed ones are treated like missing rows: a
  route shows the not-found page, a write returns its not-found code.
- Unique and foreign key violations that a user can cause, such as a taken name or a folder that no longer exists,
  are recognised in the service with `isUniqueViolation` and `isForeignKeyViolation` from `src/lib/db-errors.ts` and
  returned as `name-taken` or a not-found code, which the action shows in the form. Any other database error in a
  write is logged with `{ err }` and the ids and returned as `failed`, which the action shows as a failed save.
- The server environment is read through `getServerEnv()` from `src/lib/env.ts`, never directly from `process.env`.
- Server-side logging goes through the pino `logger` from `src/lib/logger.ts`, not `console`. Errors are logged with
  `{ err }` and the relevant ids.

## Addresses and actions

- All content lives under `/folders`, deleted pages under `/deleted-pages`; the addresses are described in
  `content-structure.md`. Routes, Server Actions and links build them with the helpers in `src/lib/addresses.ts`
  instead of writing paths by hand.
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
  (`npm run db:up`, `db:down`, `db:reset`, `db:psql`, `db:logs`). The image is pinned to an exact minor
  version in `scripts/Containerfile`, which `scripts/db.sh`, the test database container and the smoke test of the
  container image (`scripts/image.sh`, see `container-image.md`) read; Dependabot keeps the minor version up to date.

## UI

- Every page is rendered inside the root layout: Material UI with its App Router cache provider, the theme from
  `src/lib/theme.ts`, `CssBaseline`, the app bar and a centered content container.
- Components are Server Components unless they need interaction; then they are small Client Components.
- Material UI components and icons are imported per path (`@mui/material/Button`, `@mui/icons-material/Folder`).
  Links use `@/components/Link` as `component={Link}`.
- `sx` props in Server Components are plain objects, because functions cannot cross to Client Components.
- Forms focus the field the user most likely edits first. When the server rejects a save with field errors, the first
  field with an error is focused; errors that only show a message above the form leave the focus where it is.
- A dialog focuses itself on opening, so `autoFocus` does not hold in it; its first field is focused once the dialog
  has entered, with `focusOnEntered` from `src/lib/focus.ts` in the transition's `onEntered`. It leaves the focus where
  it is when it has already moved into the dialog: to a control the user clicked while the dialog faded in, or to a
  field with an error when the server rejected a save before the dialog had entered.
- Controls of Client Components that need JavaScript stay read-only (text fields) or disabled (buttons) until the
  component has hydrated, using `useHydrated()` from `src/lib/hydration.ts`. Input during hydration could otherwise be
  lost: React sets the value of a hydrating text field again, which resets its selection, and a click before the
  handler is attached does nothing. The end-to-end tests rely on this, because Playwright waits until a field is
  editable and a button is enabled; `e2e/hydration.spec.ts` checks the lock with JavaScript disabled.
- The root layout renders `HydrationMarker` (`src/components/`), which sets `data-hydrated="true"` on `<html>` in the
  same commit in which `useHydrated()` turns true. The end-to-end tests wait for it after every page load.
- Dialogs that a route renders for an action use `disablePortal`, so that they are part of the server-rendered HTML
  like the rest of the page, and lock their controls until hydration as described above. The name dialog
  (`NameDialog` in `src/features/folders/components/`) is shared by folders, tabs and pages. The name field and the
  place choice of a page (`PageNameAndPlaceFields` in `src/features/pages/components/`) are shared by the "Save page",
  the "Move or rename page" and the "Restore page" dialog; its `locked` prop locks them in a dialog that renders before
  hydration, and a place of `null` checks no place.
- A form with controlled radio buttons or checkboxes calls its Server Action in `onSubmit` inside `startTransition`
  instead of passing it as the form's `action`: React resets a form after its action, which puts these controls back
  to their initial state, out of sync with the controlled one.
- Browser titles are built with `pageTitle()` from `src/lib/site.ts`.
- Markdown is rendered with `react-markdown` and GitHub Flavored Markdown; raw HTML is never rendered.
- Markdown that is analysed instead of rendered, such as the title heading of a page, is parsed with the same parser
  that `react-markdown` uses (`mdast-util-from-markdown` with `micromark-extension-gfm` and `mdast-util-gfm`, and
  `mdast-util-to-string` for plain text), so the result matches the rendered page.

## Linting

- TypeScript runs with `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` and `noFallthroughCasesInSwitch`
  (`tsconfig.json`). An element read by index, from an array or a record, may be `undefined` and has to be checked.
- ESLint uses the rules of `eslint-config-next` (`core-web-vitals`, `typescript`) and Prettier's config, which turns off
  the rules that conflict with formatting.
- TypeScript files are linted with type information (`parserOptions.projectService`). These rules report a promise that
  is neither awaited nor handled (`no-floating-promises`), a promise passed where no promise is expected
  (`no-misused-promises`), `await` on a value that is not a promise (`await-thenable`) and a `switch` over a union that
  misses a case (`switch-exhaustiveness-check`). A promise that is deliberately not awaited is marked with `void` and a
  comment saying why.
- Lint rules enforce the conventions above:
  - `import/order`: imports come in groups separated by a blank line: Node.js modules, packages, `@/` modules, relative
    paths. Imports within a group are not sorted by the rule.
  - `no-restricted-properties`: `process.env` is not read in `src/`, except in `src/lib/env.ts` and
    `src/lib/logger.ts`. Configuration files, `e2e/` and `scripts/` read it directly.
  - `no-restricted-imports`: the barrel imports `@mui/material` and `@mui/icons-material` are not allowed in `src/`.
  - `no-console`: server code (`src/features/**/actions.ts`, `src/features/**/queries.ts`,
    `src/features/**/service.ts`, `src/app/api/`, `src/lib/`) does not use `console`. The client error boundaries
    `src/app/error.tsx` and `global-error.tsx` log with `console.error`, because the pino logger runs only on the
    server.
  - `@typescript-eslint/no-restricted-imports` keeps the layers apart (see "Reads and writes"). It is a rule of its
    own, so that the Material UI paths in `no-restricted-imports` stay as they are.
    - `@/lib/db` may only be imported in `src/features/**/service.ts`, `src/lib/**` and `src/app/api/health/**`;
      everywhere else in `src/` the rule points to the service of the feature.
    - In `src/app/**` and `src/features/**/components/**`, `@/features/*/service` may only be imported as a type; the
      rule points to `queries.ts` and `actions.ts`.
    - `src/features/**/service.ts` imports neither `next`, `next/*`, `react`, `@/lib/revalidate` nor
      `@/features/*/forms`.
    - A later config object replaces the options of a rule instead of adding to them. The config objects of this rule
      therefore match disjoint sets of files, and each one lists all restrictions of its files.
- The rules for the end-to-end tests are described in `testing.md`.
