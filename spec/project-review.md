# HippoWiki – Project Review

## Nits

### The CI workflows repeat their setup

- Location: `.github/workflows/*.yml`
- Severity: Nit
- Category: Performance, security
- Problem: Each of the six workflows runs `npm ci` on its own. The `lint` workflow and the production end-to-end
  workflow each create a production build. Actions are pinned by tag (`actions/checkout@v7`), not by commit SHA.
- Impact: Six installs and two builds per push, and a moved tag would change what runs in CI without a change in the repository.
- Suggestion (optional): Pin actions by commit SHA; Dependabot keeps the pins up to date. Whether to merge the
  workflows is a matter of taste: separate workflows show at a glance which check broke, which `testing.md` wants.

### Coverage has no thresholds for the code that the strategy covers with unit tests

- Location: `vitest.config.ts`, lines 11–14, `coverage`
- Severity: Nit
- Category: Tests
- Problem: Coverage is reported for all of `src/`, without thresholds. Routes and components, which only the
  end-to-end tests cover, pull the total down.
- Impact: The total (59 % of lines) does not say whether the modules that should be unit tested are, and a drop there
  goes unnoticed.
- Evidence: `spec/testing.md`: "has no thresholds: much of the code, such as the UI, is covered by the end-to-end tests
  instead."
- Suggestion (optional): Add per-glob thresholds for `src/lib/**` and for `schema.ts`, `derive.ts`, `actions.ts` and
  `queries.ts` of every feature, and keep the rest without one.

### The PostgreSQL image is set twice and not pinned

- Location: `scripts/db.sh`, line 21; `e2e/support/container.ts`, line 7
- Severity: Nit
- Category: Configuration
- Problem: Both files set `docker.io/library/postgres:18`. A comment asks to keep them in sync, and the tag follows
  every minor release.
- Impact: The development and test databases can drift apart, and a new minor version can change a run without a
  change in the repository.
- Suggestion (optional): Keep the image in one place, for example `.env.example` or a small file that both read, and
  pin an exact minor version (`postgres:18.<minor>`).

## Outside this review

There is no login yet, so every Server Action is a public endpoint, and `next.config.ts` sets no security headers or
Content Security Policy. That is fine while HippoWiki runs only on the development machine. Both belong to the
authentication work, before HippoWiki is reachable over a network.
