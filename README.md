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
npm run dev
```

The app runs at http://localhost:3000.

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
