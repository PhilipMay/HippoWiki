# HippoWiki – Technology Stack

## Core

- Language: TypeScript
- Framework: Next.js (React, Node.js) with the App Router
- UI library: Material UI, with the icons of `@mui/icons-material`
- Markdown: markdown-it (`markdown-it`) with its footnote plugin (`markdown-it-footnote`), the Markdown parser of the
  wiki for the title, the limits, the page view and search (see `pages.md`)
- Markdown editor: CodeMirror 6 with `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`,
  `@codemirror/language`, `@codemirror/lang-markdown`, `@codemirror/search` and `@lezer/highlight`, without the
  `codemirror` package and its `basicSetup` (see `markdown-editor.md`). Its Markdown parser, Lezer (`@lezer/markdown`,
  CommonMark with the GitHub Flavored Markdown extensions), is a second parser used only to show the content in the
  editor; `entities` decodes the entities of link addresses there as markdown-it does
- Comparing revisions of a page: jsdiff (`diff`), line by line, with a cap on the size of the difference (see
  `page-history.md`)

## Data & Backend

- Database: PostgreSQL
- ORM: Prisma
  - use Prisma for CRUD - "fullTextSearchPostgres" preview feature is not used.
  - the "partialIndexes" preview feature is used for partial unique indexes
- Search: the full-text search of PostgreSQL with its text search configurations, and the trusted contrib extension
  `pg_trgm` for parts of words and typos; no other extension and no external search engine (see `search.md`)
- Language of a page for search: the language detector eld (`eld`, Apache-2.0) with its smallest database,
  `eld/extrasmall`, loaded on the server only (see `search.md`)
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
- Linting: ESLint (without the Airbnb style guide), and knip for unused files, exports and dependencies (see "Unused
  code" in `testing.md`)
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
