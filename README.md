# HippoWiki

HippoWiki is a knowledge management system, built with Next.js (App Router) and Material UI.

## Prerequisites

- [nvm](https://github.com/nvm-sh/nvm) with the current Node.js LTS release: `nvm install --lts`. The project's major
  version is pinned in `.nvmrc`.
- [Podman](https://podman.io/) for the development database: `podman machine start`.

## Getting started

```bash
nvm use
npm install
cp .env.example .env   # once; .env stays on your machine
npm run db:up
npm run dev
```

The app runs at http://localhost:3000.

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
