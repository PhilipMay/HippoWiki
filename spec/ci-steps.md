# Continuous Integration – Steps

## Goal

Every push and pull request on GitHub runs the same checks as a developer does locally: formatting, static analysis,
unit tests and end-to-end tests. Each check is its own GitHub Actions workflow, so a failure shows at a glance which
kind of check broke.

## Scope

- In:
  - Four workflows in `.github/workflows/`, each named like its file:
    - `format_check.yml`: `npm run format:check`
    - `lint.yml`: `npm run build`, `npm run typecheck`, `npm run lint`, in this order
    - `unit_tests.yml`: `npm run test`
    - `end_to_end_tests.yml`: `npm run test:e2e`
  - Triggers: `push` (all branches), `pull_request`, `workflow_dispatch`.
  - The Playwright HTML report as a build artifact of the end-to-end workflow.
  - Documentation of the workflows in `README.md` and `testing.md`.
- Not in:
  - Deployment, container images or releases.
  - Branch protection rules and other repository settings on GitHub.
  - Dependabot, CodeQL or other scanning.
  - A test matrix over several Node.js versions or operating systems.
  - Changes to the npm scripts or the test setup, except where a step shows that CI cannot run without one (then the
    step file is updated first, see `workflow.md`).

## Checklist

- [x] Format, lint and unit test workflows
- [x] End-to-end test workflow
- [ ] Wrap-up

## Format, lint and unit test workflows

### Goal

The three checks that need no database run on GitHub for every push, pull request and manual start.

### Build

- Add `.github/workflows/format_check.yml`, `lint.yml` and `unit_tests.yml`. Each has `name:` equal to its file name
  and one job of the same name.
- Shared setup in every workflow (repeated per file, no composite action):
  - `on: push`, `pull_request`, `workflow_dispatch`.
  - `permissions: contents: read`.
  - `concurrency` per workflow and ref, cancelling a run that a newer push supersedes.
  - `runs-on: ubuntu-24.04` and a `timeout-minutes` limit.
  - `env: DATABASE_URL` set to a placeholder PostgreSQL URL (port 5432, never the test database), with a comment: only
    `prisma generate` during `npm ci` reads it (`prisma.config.ts` requires it), nothing connects to it. The build
    needs no database, because every query calls `connection()` and no route is prerendered.
  - Steps: `actions/checkout`, `actions/setup-node` with `node-version-file: .nvmrc` and `cache: npm`, then `npm ci`.
  - Use the latest major version of each action.
- `lint.yml` runs `npm run build`, `npm run typecheck` and `npm run lint` as three separate steps, so the failing one is
  visible in the run.
- The YAML files are Prettier-formatted (`npm run format`); `format:check` covers them.

### Test

- No unit or end-to-end tests are added; the step only adds CI configuration.
- `npm run check`, `npm run build` and `npm run test:e2e` pass locally, including `format:check` over the new YAML files.
- Manual: after the next push, the three workflows run on GitHub and are green.

## End-to-end test workflow

### Goal

The end-to-end tests run on GitHub with their own throwaway database container, the same way as on a developer
machine.

### Build

- Add `.github/workflows/end_to_end_tests.yml` with the same shared setup as the other workflows.
- Use Podman as it is installed on the `ubuntu-24.04` runner; `e2e/support/container.ts` starts and removes the
  `hippowiki-test-db` container as it does locally.
- Install the browser with `npx playwright install --with-deps chromium`.
- Run `npm run test:e2e`. `playwright.config.ts` already reacts to `CI` (two retries, `forbidOnly`).
- Upload `playwright-report/` with `actions/upload-artifact` also when the tests fail (not when the run was cancelled),
  with a short retention time.

### Test

- No unit or end-to-end tests are added.
- `npm run check`, `npm run build` and `npm run test:e2e` pass locally.
- Manual: after the next push, the workflow is green on GitHub and the run offers the Playwright report as an
  artifact.

## Wrap-up

### Goal

The CI setup is documented where developers look for it, and the step file is gone.

### Build

1. Add a "Continuous integration" section to `testing.md` (the four workflows, what each runs, when they run, the
   placeholder `DATABASE_URL`, Podman on the runner, the report artifact); add GitHub Actions to the tooling in
   `tech.md`. No separate feature spec is needed.
2. `roadmap.md` has no CI entry; nothing to remove.
3. Add a "Continuous integration" section to `README.md` that names the workflows and what they run.
4. Delete `spec/ci-steps.md`.
5. Remove `spec/ci-steps.md` from the spec catalog in `CLAUDE.md`.

### Test

- `npm run check`, `npm run build` and `npm run test:e2e` pass locally.
- The spec catalog in `CLAUDE.md` matches the files in `spec/`.
