# HippoWiki

HippoWiki is a knowledge management system, built with Next.js (App Router) and Material UI.

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
npm run db:seed        # optional: insert two sample pages
npm run dev
```

`.env` must exist before `npm install`, because generating the Prisma client reads `DATABASE_URL`.

The app runs at http://localhost:3000. `GET /api/health` returns `{ "status": "ok" }` while the database is reachable
and status 503 otherwise.

## Database

The development database is PostgreSQL 18 in the Podman container `hippowiki-db`. Its data lives in the named volume
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
| `npm run db:seed`     | Insert the sample pages from `prisma/seed.ts`; running it again changes nothing             |
| `npm run db:studio`   | Open Prisma Studio to browse and edit the data                                              |

## Commands

| Command                | Description                                                 |
| ---------------------- | ----------------------------------------------------------- |
| `npm run dev`          | Start the development server                                |
| `npm run build`        | Create a production build                                   |
| `npm run start`        | Serve the production build                                  |
| `npm run lint`         | Lint with ESLint                                            |
| `npm run format`       | Format all files with Prettier                              |
| `npm run format:check` | Check formatting without changing files                     |
| `npm run typecheck`    | Generate the Next.js route types and run the type checker   |
| `npm run test`         | Run the unit tests with Vitest                              |
| `npm run check`        | Run `format:check`, `lint`, `typecheck` and `test` in a row |
