# HippoWiki – Development Workflow

How new features are planned, built and finished.

## Step plans

- Each feature from `roadmap.md` is planned in its own file `spec/<feature>-steps.md` before work starts.
- A step plan has a goal, a scope (what is in, what is explicitly not in), an ordered checklist of steps, and for
  every step a "Goal", "Build" and "Test" section.
- Each step is implemented with one Claude Code call, for example: `Implement the step "Search index" from
spec/search-steps.md`.
- The steps build on each other and are worked through in order. A step is ticked off in the checklist when its checks
  pass.
- As a last step the lasting content of the plan moves into the other spec files (at `spec/*`), and the step file is deleted.

## Rules for every step

- Use the latest stable versions of all packages and check their current documentation for setup details instead of
  relying on older conventions (notably Next.js, Prisma, Material UI, Zod). The version-matched Next.js docs are in
  `node_modules/next/dist/docs/`.
- Follow the conventions in `architecture.md` and `testing.md`.
- A step is done only when `npm run check`, `npm run test:e2e` and `npm run build` pass and the "Test" items of the
  step have been verified.
- Keep `README.md` up to date with the commands a developer needs.
- Do not add anything that the plan puts out of scope.

## Prerequisites

One-time setup of the development machine (details in `README.md`):

- the current Node.js LTS release via nvm (`nvm install --lts`; the major version is pinned in `.nvmrc`)
- a running Podman machine (`podman machine start`)
