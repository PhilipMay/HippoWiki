# CLAUDE.md

HippoWiki is a knowledge management system.

## Specification

The specification lives in the `spec/` directory. This catalog should always be kept in sync with the files.

- `spec/tech.md`: technology stack
- `spec/workflow.md`: how features are planned in step files, when a step is done, what to do when it cannot be
  finished and how a feature is wrapped up
- `spec/architecture.md`: code layout and conventions (layers and services, reads, writes, login and sessions,
  validation, database, UI)
- `spec/testing.md`: unit, integration and end-to-end test conventions
- `spec/pages.md`: the page feature as built (model, input rules, derived title and name, routes, limits)
- `spec/content-structure.md`: the content structure as built (folders, tabs and pages under `/folders`: models, names,
  addresses, actions, routes, lists, limits)
- `spec/page-deletion.md`: the soft delete of pages as built (deleting, the deleted pages of a folder under
  `/deleted-pages`, restoring, limits)
- `spec/container-image.md`: the container image as built (image and build stages, start with the migration, the
  command that only migrates, the admin setup, configuration, smoke test, publishing on a release, what the
  environment has to provide, decisions, limits)
- `spec/users-and-login.md`: the users and login feature as built (models, user names and email, passwords and
  hashing, admin account and setup, login and logout, sessions, failed logins, authenticated access only, forced
  password change, user list, creating users, routes, decisions, limits)
- `spec/roadmap.md`: backlog of candidate features, grouped by theme
- `spec/security-review.md`: open findings of the security review of the deployment and the code, to be fixed later
- `spec/issue-report.md`: how to report issues found in code and document reviews

## Running the Checks

Node.js is managed with nvm; every shell session needs `nvm use` first (it reads `.nvmrc`):

```bash
source ~/.nvm/nvm.sh && nvm use
npm install
npm run check   # format:check, lint, typecheck, test
npm run test:coverage  # unit test coverage, report in coverage/
npm run build
npm run test:integration  # integration tests against a throwaway database container, needs only Podman
npm run test:e2e  # end-to-end tests in a throwaway database container, needs only Podman
npm run test:e2e:production  # the same end-to-end tests against a production build (next build, next start)
```

Run `npm run format` to fix formatting issues reported by `format:check`.

## Next.js Agent Rules

`AGENTS.md` is managed by Next.js (`next dev` rewrites it) and points to the version-matched Next.js docs in
`node_modules/next/dist/docs/`.

@AGENTS.md

## Document Style

Do not number headings, sections or paragraphs in documents (no `## 3. Data Model`, no `§3`). Use bullet lists for rules
and other unordered items; numbered lists only where the order itself matters, such as the steps of a procedure.

## Reporting Review Issues

Report every issue found in a review using the structure, severity levels and checklist in `spec/issue-report.md`.
This applies to code reviews and to reviews of documents such as the files in `spec/`.

- For code, Location is the file, line range and function.
- For documents, Location is the file and the heading of the section; Evidence is a short quote of the passage.
- Start the review with a short summary: the overall verdict and how many issues there are at each severity level.

## Git Handling

- Do not look at the Git history, and do not mention how something used to be in an earlier commit.
- Do not create branches or pull requests.
- Do not ask whether something should be committed or pushed, and do not offer to do so.
- After each finished step of a step plan, commit as described in `spec/workflow.md`.
- After the last step of a step plan, push as described in `spec/workflow.md`.
