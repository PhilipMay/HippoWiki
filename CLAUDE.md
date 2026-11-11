# CLAUDE.md

HippoWiki is a knowledge management system.

## Specification

The specification lives in the `spec/` directory. This catalog should always be kept in sync with the files.

- `spec/tech.md`: technology stack
- `spec/workflow.md`: how features are planned in step files and when a step is done
- `spec/architecture.md`: code layout and conventions (reads, writes, validation, database, UI)
- `spec/testing.md`: unit and end-to-end test conventions
- `spec/pages.md`: the page feature as built (model, input rules, routes, limits)
- `spec/roadmap.md`: backlog of candidate features
- `spec/issue-report.md`: how to report issues found in code and document reviews

## Running the Checks

Node.js is managed with nvm; every shell session needs `nvm use` first (it reads `.nvmrc`):

```bash
source ~/.nvm/nvm.sh && nvm use
npm install
npm run check   # format:check, lint, typecheck, test
npm run build
npm run test:e2e  # end-to-end tests in a throwaway database container, needs only Podman
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

## No Git

Git must not be used in this project. Treat the documents as if they were not managed under Git:

- Do not run any Git commands. In particular, do not view the history, diffs, or status.
- Do not create commits, branches, pull requests, or pushes.
- Never ask if something should be committed or pushed, and do not offer to do so.
- Do not mention Git in your responses.
