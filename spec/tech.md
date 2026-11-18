# HippoWiki – Technology Stack

## Core

- Language: TypeScript
- Framework: Next.js (React, Node.js) with the App Router
- UI library: Material UI, with the icons of `@mui/icons-material`
- Markdown: markdown-it (`markdown-it`) with its footnote plugin (`markdown-it-footnote`), the only Markdown parser of
  the wiki (see `pages.md`)
- Comparing revisions of a page: jsdiff (`diff`), line by line, with a cap on the size of the difference (see
  `page-history.md`)

## Data & Backend

- Database: PostgreSQL
- ORM: Prisma
  - use Prisma for CRUD - "fullTextSearchPostgres" preview feature is not used.
  - the "partialIndexes" preview feature is used for partial unique indexes
- Authentication: Better Auth with its `username` plugin, called only on the server; its password hashing is
  replaced
- Password hashing: Argon2id with `@node-rs/argon2`, a native package with prebuilt builds
- Logging: pino
- MCP server: the official MCP TypeScript SDK (`@modelcontextprotocol/server`, v2), with its web-standard handler in
  a route handler of Next.js: stateless Streamable HTTP with JSON responses (see `mcp.md`)
- OAuth for AI apps: written in the project on top of Prisma, without a library; Better Auth is used for the
  login only (see `oauth.md`)

## Tooling

- Node.js version management: nvm
- Package manager: npm
  - `.npmrc` sets `strict-peer-deps=true`: a peer dependency conflict fails `npm install` and `npm ci` (also in CI)
    instead of only printing a warning
- Linting: ESLint (without the Airbnb style guide)
- Formatting: Prettier
- Testing: Vitest (unit and integration tests), coverage with `@vitest/coverage-v8`
- end-to-end tests: Playwright
- Podman: instead of Docker, for the development database, the test database container of the integration and
  end-to-end tests, building and checking the container image, and in CI
- Continuous integration: GitHub Actions
- Container registry: GitHub Container Registry (`ghcr.io`), which receives the container image of every published
  release (see `container-image.md`)
- Zod: for forms, actions and environment variable validation
- esbuild: bundles the admin setup script into one file for the container image (see `container-image.md`)

## Later Aspects

What may be added later, among it technology that is not chosen yet, is in `roadmap.md`.
