# HippoWiki

HippoWiki is a knowledge management system, built with Next.js (App Router) and Material UI.

## What the prototype can do

The prototype manages wiki pages written in Markdown, organises them in folders and stores them in PostgreSQL:

- create, list and rename folders; every folder has its own address `/folders/<folder>`,
- divide a folder into tabs (`/folders/<folder>/<tab>`), listed like sub-folders in one list with the folder's pages,
  after them; create and rename tabs,
- list the pages placed directly in a folder, the pages of a tab, or all pages of a folder with their tabs, by name,
- view a page with its Markdown rendered at `/folders/<folder>/<page>.md` or `/folders/<folder>/<tab>/<page>.md`,
- create and edit pages; a new page goes directly into the folder or into one of its tabs,
- move or rename a page in one dialog: a new name, a new place within its folder (into a tab, to another tab or back
  to the folder), or both,
- delete a page; each folder lists its deleted pages at `/deleted-pages/<folder>`, where they can be read and restored
  into the folder under a chosen name and place.

Folders and tabs cannot be deleted yet. There is a single user and no login.

## Prerequisites

- [nvm](https://github.com/nvm-sh/nvm) with the current Node.js LTS release: `nvm install --lts`. The project's major
  version is pinned in `.nvmrc`.
- [Podman](https://podman.io/) for the development database: `podman machine start`.

## Getting started

```bash
nvm use
cp .env.example .env   # once; .env stays on your machine
npm install            # also generates the Prisma client
npm run db:up
npm run db:migrate     # apply the migrations to the development database
npm run db:seed        # optional: insert a sample folder with two sample pages
npm run dev
```

### Start and stop in one line

Once `.env` exists and the Podman machine runs (`podman machine start`), this line starts everything needed to try the
app: it installs the dependencies, starts the database, applies the migrations, inserts the sample folder with its
pages and starts the development server. It can be run again at any time; existing data is kept and the samples are not
duplicated.

```bash
source ~/.nvm/nvm.sh && nvm use && npm install && npm run db:up && npm run db:deploy && npm run db:seed && npm run dev
```

To spin it down, stop the development server with Ctrl+C and then stop and remove the database container (the data in
the volume is kept):

```bash
npm run db:down
```

`podman machine stop` also stops the Podman machine afterwards.

The app runs at http://localhost:3000.

To start from scratch with an empty database (this deletes all data of the development database):

```bash
npm run db:reset    # remove container and volume, start an empty database
npm run db:deploy   # create the tables
npm run dev
```

`npm run db:seed` adds the sample folder `getting-started` with two sample pages to try this out. `GET /api/health`
returns `{ "status": "ok" }` while the database is reachable and status 503 otherwise.

## Database

The development database is PostgreSQL 18 in the Podman container `hippowiki-db`, from the image pinned in
`scripts/Containerfile`. Its data lives in the named volume
`hippowiki-db-data`, and port 5432 is published on localhost only. Database name, user and password are read from
`.env`, and `DATABASE_URL` there must match them.

| Command            | Description                                                                     |
| ------------------ | ------------------------------------------------------------------------------- |
| `npm run db:up`    | Create or start the container and wait until the database accepts connections   |
| `npm run db:down`  | Stop and remove the container; the data in the volume is kept                   |
| `npm run db:reset` | Remove container and volume, then start with an empty database                  |
| `npm run db:psql`  | Open `psql`; pass arguments after `--`, e.g. `npm run db:psql -- -c "select 1"` |
| `npm run db:logs`  | Show the container logs; follow them with `npm run db:logs -- -f`               |

The application accesses the database with [Prisma](https://www.prisma.io/) 7. The schema is in
`prisma/schema.prisma`, the migrations are in `prisma/migrations/` and the connection is configured in
`prisma.config.ts`. The generated client is written to `src/generated/prisma/` and is not checked in.

| Command               | Description                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `npm run db:generate` | Regenerate the Prisma client; needed after every change to the schema                       |
| `npm run db:migrate`  | Create and apply a migration from schema changes, e.g. `npm run db:migrate -- --name add-x` |
| `npm run db:deploy`   | Apply all pending migrations without creating new ones                                      |
| `npm run db:seed`     | Insert the sample folder and pages from `prisma/seed.ts`; running it again changes nothing  |
| `npm run db:studio`   | Open Prisma Studio to browse and edit the data                                              |

## End-to-end tests

The end-to-end tests use [Playwright](https://playwright.dev/) with Chromium and live in `e2e/`. Install the browser
once:

```bash
npx playwright install chromium
```

The tests need only the Podman machine (`podman machine start`); they bring their own database:

```bash
npm run test:e2e              # run all end-to-end tests against the development server
npm run test:e2e:production   # run them against a production build (next build, next start)
npm run test:e2e:ui           # open the Playwright UI to run and debug tests
npx playwright show-report   # open the HTML report of the last run
```

- Each run starts its own throwaway PostgreSQL container `hippowiki-test-db` (port 5433, data in memory only, database
  `hippowiki_test`). The global setup (`e2e/global-setup.ts`) starts it and applies the migrations; the global
  teardown (`e2e/global-teardown.ts`) removes it again, also when tests fail or the run is stopped with Ctrl+C. If a
  run is killed hard and leaves the container behind, the next run removes it first. The development database and
  its container `hippowiki-db` are never touched, and do not need to run.
- Playwright starts its own development server on port 3100 with the build directory `.next-e2e`, so it can run next
  to `npm run dev`, and stops it after the run. `npm run test:e2e:production` builds the app and starts the
  production server instead, to test what only a production build does, such as prerendering and caching; it takes
  longer because of the build.
- `e2e/support/browser.ts` has `collectErrors()`, which records console errors of the browser page.
- `e2e/support/database.ts` has helpers for tests: `createFolder()`, `createTab()` and `createPage()` insert a folder,
  a tab or a page (in a given folder or tab, or in a new folder) directly into the test database,
  `resetTestDatabase()` empties it, and `getTestDb()` returns a Prisma client for it. All tests share this database
  and run one after another.

## Integration tests

The integration tests run with Vitest against the same throwaway PostgreSQL container `hippowiki-test-db` as the
end-to-end tests, and live in `integration/`. They check what the unit tests can only mock: the errors that Prisma
reports for the unique and foreign key constraints (`src/lib/db-errors.ts`) and the services of the features on real
data. Like the end-to-end tests, they need only the Podman machine:

```bash
npm run test:integration
```

They are not part of `npm run check`. Do not run them at the same time as the end-to-end tests: both use the same
container.

## Unit test coverage

`npm run test:coverage` runs the unit tests, prints a coverage table and writes an HTML report to
`coverage/index.html`. On GitHub, every run of the `unit_tests` workflow shows the coverage in its job summary and
offers the HTML report as the artifact `coverage-report`.

## Container image

The `Containerfile` in the project root builds one image that runs HippoWiki outside the development machine. It
needs only the Podman machine, with at least 4 GiB of memory, because `next build` runs inside it
(`podman machine set --memory 4096` while the machine is stopped):

```bash
npm run image:build   # build the image hippowiki:local for this machine
npm run image:smoke   # check the built image against a throwaway database
```

- The image reads `DATABASE_URL` in the form `postgresql://<user>:<password>@<host>:<port>/<database>`, without
  parameters such as `sslmode`; special characters in the password are percent-encoded. `PORT` is optional (default
  3000). The image contains no `.env` file and no database address.
- On every start the container applies the pending migrations to the database of `DATABASE_URL`
  (`prisma migrate deploy`): an empty database gets its tables, a migrated one stays as it is. Then the server starts
  on port 3000. When the migration fails, the container exits without serving.
- To only apply the migrations, start the image with `./image-migrate.sh` as its command:

  ```bash
  podman run --rm --env DATABASE_URL=postgresql://user:password@host:5432/hippowiki hippowiki:local ./image-migrate.sh
  ```

- `npm run image:smoke` checks the image of `npm run image:build`. In the pod `hippowiki-smoke` it starts PostgreSQL
  with an empty database in memory and a container of the image, whose port 3000 is published as `127.0.0.1:3200`.
  It checks that the start creates the tables and serves `/folders`, `/api/health` and the static files, that the
  server listens on all interfaces and not as root, and that the image has no `.env` file. A second container and
  `./image-migrate.sh` against the migrated database must apply no migration. The pod is removed at the end, also
  when a check fails; then the last log lines of the containers are printed. It can run next to the development
  database, the test database and the development server.

### Publishing

The workflow `container_image` builds the image and runs `npm run image:smoke` on every push to `main`, on pull
requests and when started by hand, without publishing anything. Publishing a release on GitHub, a pre-release
included, also pushes the image to the GitHub Container Registry under the tag name of the release, unchanged; a draft
does not. A tag name that is not a valid image tag, or is `latest`, fails the run before the build. There is no
`latest` tag: pull the image by the tag of the release:

```bash
podman pull ghcr.io/<owner>/hippowiki:<tag>
```

A new package is private until its visibility is changed on GitHub, so the host may need to log in to `ghcr.io`
first, with a token that has the `read:packages` scope.

## Commands

| Command                       | Description                                                           |
| ----------------------------- | --------------------------------------------------------------------- |
| `npm run dev`                 | Start the development server                                          |
| `npm run build`               | Create a production build                                             |
| `npm run start`               | Serve the production build                                            |
| `npm run lint`                | Lint with ESLint                                                      |
| `npm run format`              | Format all files with Prettier                                        |
| `npm run format:check`        | Check formatting without changing files                               |
| `npm run typecheck`           | Generate the Next.js route types and run the type checker             |
| `npm run test`                | Run the unit tests with Vitest                                        |
| `npm run test:coverage`       | Run the unit tests and measure their coverage (report in `coverage/`) |
| `npm run check`               | Run `format:check`, `lint`, `typecheck` and `test` in a row           |
| `npm run test:integration`    | Run the integration tests against a throwaway test database           |
| `npm run test:e2e`            | Run the end-to-end tests with Playwright                              |
| `npm run test:e2e:ui`         | Run the end-to-end tests in the Playwright UI                         |
| `npm run test:e2e:production` | Run the end-to-end tests against a production build                   |
| `npm run image:build`         | Build the container image `hippowiki:local` with Podman               |
| `npm run image:smoke`         | Check the built image against a throwaway database                    |

## Licensing

Copyright (c) 2026 [Philip May](https://philipmay.org)

Licensed under the **MIT License** (the "License"); you may not use this file except in compliance with the License.
You may obtain a copy of the License by reviewing the file
[LICENSE](https://github.com/PhilipMay/HippoWiki/blob/main/LICENSE) in the repository.
