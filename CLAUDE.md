# CLAUDE.md

HippoWiki is a knowledge management system.

## Specification

The specification lives in the `spec/` directory. This catalog should always be kept in sync with the files.

- `spec/tech.md`: technology stack
- `spec/poc-steps.md`: step-by-step plan for the first prototype
- `spec/poc-review.md`: review of the implemented prototype against `poc-steps.md` and `tech.md`

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

## No Git

Git must not be used in this project. Treat the documents as if they were not managed under Git:

- Do not run any Git commands. In particular, do not view the history, diffs, or status.
- Do not create commits, branches, pull requests, or pushes.
- Never ask if something should be committed or pushed, and do not offer to do so.
- Do not mention Git in your responses.
