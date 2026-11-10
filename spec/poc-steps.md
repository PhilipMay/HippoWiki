# HippoWiki – Prototype Steps

Step-by-step plan for the first prototype. The technology stack is defined in `tech.md`.

## Goal

At the end, the prototype

- runs a PostgreSQL database in Podman,
- lets you create Markdown pages that are stored in PostgreSQL,
- lets you list, view, edit and delete these pages.

## Scope

In the prototype:

- a single `Page` entity with title and Markdown content
- raw Markdown editing in a textarea, rendered view of a page
- one user, no login

Not in the prototype (see "After the prototype"):

- authentication (Better Auth)
- full-text search
- `[[wiki links]]`, rich editor, attachments, page history

## How to use this plan

- Each step is implemented with one Claude Code call, for example: `Implement the step "Postgres in Podman" from
spec/poc-steps.md`.
- The steps build on each other and are worked through in this order. A step is ticked off here when its checks pass:

1. [x] Project scaffold
2. [x] App shell with Material UI
3. [x] Postgres in Podman
4. [x] Prisma and the Page model
5. [x] End-to-end test harness
6. [x] List and view pages
7. [x] Create pages
8. [x] Edit and delete pages

Rules for every step:

- Use the latest stable versions of all packages and check their current documentation for setup details instead of
  relying on older conventions (notably Next.js, Prisma, Material UI, Zod).
- A step is done only when `npm run check` passes and the "Test" items of the step have been verified.
- Keep `README.md` up to date with the commands a developer needs.
- Do not add anything from the "Not in the prototype" list.

## Prerequisites

One-time setup on the development machine, done by hand before the first step:

- Install the current Node.js LTS release: `nvm install --lts`
- Start the Podman machine: `podman machine start`

## Conventions

- Source code lives under `src/`, with the import alias `@/` pointing to `src/`.
- Layout:
  - `src/app/`: routes (App Router)
  - `src/lib/`: cross-cutting modules (`env.ts`, `db.ts`, `logger.ts`)
  - `src/features/pages/`: everything about pages (`schema.ts`, `queries.ts`, `actions.ts`, `components/`)
  - `prisma/`: schema, migrations, seed
  - `scripts/`: development scripts
  - `e2e/`: Playwright tests
- Unit tests sit next to the code as `*.test.ts`.
- Reads happen in Server Components through `queries.ts`; writes happen through Server Actions in `actions.ts`.
- All input (forms, actions, environment variables) is validated with Zod.
- Server-side logging goes through the pino logger, not `console`.

## Project scaffold

Goal: an empty Next.js application with the complete tooling in place.

Build:

- Next.js with App Router, TypeScript (strict), `src/` directory and `@/` alias; no Tailwind. The directory already
  contains `CLAUDE.md`, `README.md` and `spec/`, which must be kept – scaffold in a temporary directory and move the
  files over if the generator refuses a non-empty directory.
- `.nvmrc` with the installed Node.js LTS major version, and a matching `engines` entry in `package.json`.
- ESLint (flat config with the Next.js rules, no Airbnb style guide) and Prettier (with `eslint-config-prettier`,
  print width 120).
- Vitest with one sample unit test.
- npm scripts: `dev`, `build`, `start`, `lint`, `format`, `format:check`, `typecheck`, `test`, and `check` (runs
  `format:check`, `lint`, `typecheck` and `test`).
- A minimal home page that shows "HippoWiki".
- `README.md`: prerequisites and the commands above. `CLAUDE.md`: a short section on how to run the checks (including
  `nvm use`).

Test:

- `npm run check` passes.
- `npm run build` succeeds.
- `npm run dev` serves the home page at `http://localhost:3000`.

## App shell with Material UI

Goal: every page is rendered inside a common Material UI layout.

Build:

- Material UI with its official Next.js App Router integration (Emotion cache provider), a theme module and
  `CssBaseline`.
- Root layout with an app bar ("HippoWiki", linking to the home page) and a centered content container.
- Home page content rendered with Material UI components.
- Global `not-found` and `error` pages in the same layout.

Test:

- `npm run check` and `npm run build` pass.
- The home page shows the app bar and themed content, without hydration or console errors in the browser.
- An unknown URL shows the not-found page inside the layout.

## Postgres in Podman

Goal: a local PostgreSQL database that is started and stopped with npm scripts.

Build:

- `scripts/db.sh` with the subcommands `up`, `down`, `reset`, `psql` and `logs`, using plain `podman` commands:
  - container `hippowiki-db` from the official PostgreSQL image, pinned to the current major version
  - named volume `hippowiki-db-data`, so that data survives `down` (check the image documentation for the data
    directory of the pinned version)
  - port 5432 published on localhost only
  - `up` is idempotent and waits until the database accepts connections (`pg_isready`)
  - `reset` removes container and volume and starts fresh
- npm scripts `db:up`, `db:down`, `db:reset`, `db:psql`, `db:logs`.
- `.env.example` with `DATABASE_URL` and the database name, user and password used by the script; `.env` is the local
  copy and stays on the development machine.
- `src/lib/env.ts`: Zod validation of the server environment (`DATABASE_URL`, `NODE_ENV`), with a unit test for valid
  and invalid input.
- `README.md`: database commands.

Test:

- `npm run db:up` starts the container; `podman ps` lists `hippowiki-db`.
- `npm run db:psql -- -c "select version()"` prints the PostgreSQL version.
- A table created by hand is still there after `npm run db:down` and `npm run db:up`, and gone after
  `npm run db:reset`.
- `npm run check` passes.

## Prisma and the Page model

Goal: the application talks to the database and the `Page` table exists.

Build:

- Prisma set up for PostgreSQL according to the current Prisma documentation (configuration file, generated client,
  driver adapter). The `fullTextSearchPostgres` preview feature is not enabled.
- Model `Page`:
  - `id`: UUID, primary key
  - `title`: text
  - `content`: text (Markdown source)
  - `createdAt`, `updatedAt`: timestamps
- First migration, stored under `prisma/migrations/`.
- `src/lib/db.ts`: a single Prisma client instance that survives hot reloads in development and uses the validated
  environment.
- `src/lib/logger.ts`: pino logger (pretty output in development, JSON otherwise).
- `prisma/seed.ts` with two sample pages whose Markdown covers headings, lists, links, code and a table.
- npm scripts `db:migrate` (development migration), `db:deploy` (apply migrations), `db:seed`, `db:studio`.
- Route `GET /api/health` that runs a trivial query and returns `{ "status": "ok" }`, or status 503 with a logged
  error when the database is unreachable.

Test:

- `npm run db:migrate` creates the table; `npm run db:seed` inserts the sample pages
  (`npm run db:psql -- -c 'select title from "Page"'`).
- `curl http://localhost:3000/api/health` returns `ok` while the database is up and 503 after `npm run db:down`.
- `npm run check` and `npm run build` pass.

## End-to-end test harness

Goal: Playwright tests run against a separate test database, so that the following steps can each add their own
end-to-end tests.

Build:

- Playwright (Chromium only) with tests in `e2e/`.
- A separate database `hippowiki_test` in the same container. A global setup creates it if missing, applies the
  migrations and empties all tables.
- Playwright starts the application itself on a separate port (3100) with `DATABASE_URL` pointing to the test
  database; the development database is never touched by tests.
- A small helper to create pages directly in the test database from a test.
- Smoke tests: the home page shows the app bar, and `/api/health` returns `ok`.
- npm scripts `test:e2e` and `test:e2e:ui`. `npm run check` stays fast and does not include the end-to-end tests.
- `README.md`: how to run the end-to-end tests.

Test:

- `npm run test:e2e` passes with the database running.
- The development database has the same content before and after the test run.
- `npm run check` passes.

## List and view pages

Goal: existing pages can be browsed and read.

Build:

- `src/features/pages/queries.ts`: `listPages()` (ordered by last update, newest first) and `getPage(id)`.
- `/pages`: list of all pages with title and last update, each linking to its page; an empty state when there are no
  pages.
- `/pages/[id]`: title, last update and the Markdown content rendered as HTML with `react-markdown` and GitHub
  Flavored Markdown, styled with Material UI typography. Raw HTML inside the Markdown is not rendered.
- Unknown or malformed ids show the not-found page.
- `/` redirects to `/pages`; the app bar links to `/pages`.
- End-to-end tests: list shows created pages in the right order, page view renders Markdown (heading, list, link,
  table), unknown id shows not-found, empty state.

Test:

- With seeded data, `http://localhost:3000/pages` lists both sample pages and each one opens rendered.
- A page whose content contains `<script>alert(1)</script>` does not execute it.
- `npm run check`, `npm run test:e2e` and `npm run build` pass.

## Create pages

Goal: a new Markdown page can be created in the browser and is stored in PostgreSQL.

Build:

- `src/features/pages/schema.ts`: Zod schema for page input – `title` trimmed, required, at most 200 characters;
  `content` may be empty, with an upper length limit. Unit tests for the schema.
- `src/features/pages/actions.ts`: Server Action `createPage` that validates the input with the schema, stores the
  page, logs the event, revalidates the list and redirects to the new page.
- `src/features/pages/components/PageForm.tsx`: form with a title field, a multi-line monospace textarea for the
  Markdown content, and "Save" and "Cancel". Validation errors are shown at the fields, the entered values are kept,
  and the save button is disabled while the action runs. The component is built so that the edit step can reuse it.
- `/pages/new` with the form, and a "New page" button on the list.
- End-to-end tests: creating a page leads to its rendered view and it appears in the list; an empty title shows a
  validation error and creates nothing.

Test:

- Create a page in the browser; it is shown rendered, appears at the top of the list and exists in the database
  (`npm run db:studio`).
- Saving with an empty title shows an error at the title field and keeps the content.
- `npm run check`, `npm run test:e2e` and `npm run build` pass.

## Edit and delete pages

Goal: existing pages can be changed and removed. With this step the prototype is complete.

Build:

- Server Actions `updatePage` and `deletePage` in `actions.ts`, with the same validation, logging and revalidation as
  `createPage`. Both handle a page that no longer exists.
- `/pages/[id]/edit`: the form from the create step, prefilled; saving returns to the page view, which shows the new
  content and update time.
- "Edit" and "Delete" buttons on the page view. Delete asks for confirmation in a dialog that names the page, then
  removes it and returns to the list.
- End-to-end tests: editing title and content, cancelling an edit, deleting with confirmation, cancelling the delete
  dialog, and one full run through create, edit and delete.
- `README.md`: short description of what the prototype can do and how to start it from scratch.
- Tick off all steps in this document.

Test:

- Starting from an empty database (`npm run db:reset`, `npm run db:deploy`, `npm run dev`): create a page, edit it,
  delete it, and see the list reflect every change.
- An edit survives a restart of the application and of the database container.
- `npm run check`, `npm run test:e2e` and `npm run build` pass.

## After the prototype

Candidates for the next steps, not ordered:

- authentication with Better Auth, pages with an author
- PostgreSQL full-text search (English, German and more)
- unique titles or slugs and `[[wiki links]]`
- rich editor (TipTap or Milkdown)
- page history
- attachments and images
- metrics, semantic search with pgvector
