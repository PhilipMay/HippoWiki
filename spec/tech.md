# HippoWiki – Technology Stack

## Core

- Language: TypeScript
- Framework: Next.js (React, Node.js) with the App Router
- UI library: Material UI

## Data & Backend

- Database: PostgreSQL
- ORM: Prisma
  - use Prisma for CRUD - "fullTextSearchPostgres" preview feature is not used.
  - the "partialIndexes" preview feature is used for partial unique indexes
  - for search use Postgres full-text search - language: english, german and more
- Authentication: Better Auth
- Logging: pino

## Tooling

- Node.js version management: nvm
- Package manager: npm
- Linting: ESLint (without the Airbnb style guide)
- Formatting: Prettier
- Testing: Vitest (unit tests), coverage with `@vitest/coverage-v8`
- end-to-end tests: Playwright
- Podman: instead of Docker for development
- Continuous integration: GitHub Actions
- Zod: for forms, actions and environment variable validation

## Later Aspects

These aspects will be added later or are not solved yet. The feature backlog is in `roadmap.md`.

- metrics / prometheus
- PostgreSQL pgvector for semantic search
- Editor: writing pages with `[[wiki links]]` and slash commands; e.g. TipTap, or Milkdown if pages are stored as Markdown
- E-Mail provider for verification and password reset
- Attachments and images: local storage or S3-compatible
