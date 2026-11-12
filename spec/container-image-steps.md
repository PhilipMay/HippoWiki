# Container Image – Steps

## Goal

HippoWiki can be built as a container image and run outside the development machine, for a first pre-production
environment. Publishing a release on GitHub builds the image, checks that it starts and answers, and stores it in the
GitHub Container Registry under the tag of the release.

## Scope

- In:
  - a `Containerfile` for the application with two images from one build: the application and a one-shot image that
    applies the database migrations
  - the Next.js standalone output, switched on only for the image build
  - a script that builds both images locally with Podman and a smoke test that runs them against a throwaway
    database
  - a GitHub Actions workflow that builds and smoke-tests the images on every push to `main` and on pull requests,
    and pushes them to `ghcr.io` when a release is published
  - a Dependabot entry for the Node.js base image
- Not in:
  - deploying the image: no compose file, no reverse proxy, no TLS, no backups (candidates in `roadmap.md`)
  - a `HEALTHCHECK` in the image; `/api/health` exists and the orchestrator calls it
  - images for other platforms than `linux/amd64`
  - a slim migration image; it carries the development dependencies of the build
  - image signing, provenance attestations and vulnerability scans
  - running the seed script in a container
  - authentication; the image serves the wiki to everyone who reaches it

## Checklist

- [ ] Images
- [ ] Smoke test
- [ ] Release workflow
- [ ] Wrap-up

## Images

### Goal

`npm run image:build` builds the application image and the migration image with Podman. The normal build, `npm run
start` and the end-to-end tests stay as they are.

### Build

- `next.config.ts`: set `output: "standalone"` only when `HIPPOWIKI_OUTPUT=standalone`, in the style of
  `HIPPOWIKI_DIST_DIR`. Without the variable the option stays unset, because `next start` warns that it does not work
  with the standalone output, and `npm run start` and `npm run test:e2e:production` use `next start`. Follow
  `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`.
- `Containerfile` in the project root. `scripts/Containerfile` stays untouched: it only pins the PostgreSQL image and
  `scripts/db.sh` and `e2e/support/container.ts` read its first `FROM` line. The new file has these stages:
  - `deps`: the Node.js image, `npm ci`. The `postinstall` script runs `prisma generate`, so `prisma/` and
    `prisma.config.ts` are copied before `npm ci`, next to `package.json`, `package-lock.json` and `.npmrc`.
  - `build`: copies the sources and runs `npm run build` with `HIPPOWIKI_OUTPUT=standalone` and
    `NEXT_TELEMETRY_DISABLED=1`. It needs no database and no `DATABASE_URL`.
  - `migrate`: based on `deps`, runs `npx prisma migrate deploy` as its command, as the user `node`. It reads
    `DATABASE_URL` from the environment.
  - `app`, the last and therefore the default stage: the Node.js image with `.next/standalone` and `.next/static`
    from the `build` stage, `NODE_ENV=production`, `HOSTNAME=0.0.0.0`, `PORT=3000`, the user `node`, port 3000 exposed
    and `node server.js` as its command. There is no `public/` folder to copy.
- Base image: the slim Debian variant of the official Node.js image, with the major version of `.nvmrc` and pinned to
  the current minor version, like the PostgreSQL image.
- Labels on both images: `org.opencontainers.image.source` with the URL of the GitHub repository, which links the
  package to the repository, and `org.opencontainers.image.revision` and `org.opencontainers.image.version` when the
  build knows them.
- `.containerignore`: keeps at least `.env` and every other `.env*` file except `.env.example`, `.git`,
  `node_modules`, `.next`, `.next-e2e`, `src/generated`, `coverage`, `playwright-report`, `test-results` and
  `*.tsbuildinfo` out of the build context.
- `scripts/image.sh` in the style of `scripts/db.sh`, with the command `build`: builds the `app` stage as
  `hippowiki:local` and the `migrate` stage as `hippowiki-migrate:local`. It sets no platform, so the images are built
  for the machine that runs it.
- `package.json`: the script `image:build`.
- `.github/dependabot.yml`: a second `docker` entry for the directory `/`. It ignores major updates of the Node.js
  image, because the major version changes together with `.nvmrc`.
- `README.md`: a section "Container image" with `npm run image:build`, the two images, the variables the application
  image reads (`DATABASE_URL`, `PORT`, `HOSTNAME`) and the order on a host: apply the migrations with the migration
  image, then start the application image. Add the command to the table under "Commands".

### Test

- No unit, integration or end-to-end tests: the step adds no application code. The smoke test of the next step covers
  the images.
- `npm run image:build` succeeds and leaves both images in `podman images`.
- `npm run build` without `HIPPOWIKI_OUTPUT` creates no `.next/standalone`, and `npm run test:e2e:production` passes
  without the standalone warning of `next start` in its output. This step changes the build configuration, so run it
  as described in "When a step is done" in `workflow.md`.
- The application image contains no `.env` file and no `node_modules` beyond those of the standalone output, and its
  configured user is `node` (`podman image inspect`).
- The commands in "When a step is done" in `workflow.md` pass.

## Smoke test

### Goal

`npm run image:smoke` proves that the two images work together: the migration image creates the tables in an empty
database and the application image serves the wiki from it. It runs the same way locally and in CI.

### Build

- `scripts/image.sh` gets the command `smoke`. It expects the images of `build` and does this:
  1. Remove a pod left behind by an earlier run, then create the pod `hippowiki-smoke`, which publishes port 3000 of
     the application as `127.0.0.1:3200`. The database port is not published.
  2. Start PostgreSQL in the pod from the image pinned in `scripts/Containerfile`, with its data in memory only, and
     wait until it accepts connections over TCP, as `scripts/db.sh` does.
  3. Run `hippowiki-migrate:local` once with `DATABASE_URL` and require exit code 0.
  4. Start `hippowiki:local` with `DATABASE_URL`.
  5. Poll `http://127.0.0.1:3200/api/health` until it answers 200 with `{"status":"ok"}`, for at most 60 seconds.
  6. Request `/folders` and require status 200. Request one `/_next/static/` file that the page references and
     require status 200, which proves that the static files were copied into the image.
  7. Require that the application process does not run as root.
  8. Remove the pod, also when a check fails. On a failure, print the last log lines of the containers first and
     exit with a non-zero code.
- The names and the port do not collide with the development database (`hippowiki-db`, 5432), the test database
  (`hippowiki-test-db`, 5433), `npm run dev` (3000) and the end-to-end server (3100), so the smoke test can run next
  to them.
- `package.json`: the script `image:smoke`.
- `README.md`: add `npm run image:smoke` to the section "Container image" and to the table under "Commands".

### Test

- `npm run image:build && npm run image:smoke` passes and leaves no pod and no container behind (`podman pod ls`,
  `podman ps --all`).
- The smoke test fails with a non-zero exit code and prints the container logs when the application cannot start:
  check it once by running the script with a wrong database password for the application container, then undo that
  change.
- A second run right after a first one passes as well.
- The commands in "When a step is done" in `workflow.md` pass.

## Release workflow

### Goal

Every push to `main` and every pull request shows whether the images still build and start. Publishing a release on
GitHub pushes both images to the GitHub Container Registry.

### Build

- `.github/workflows/container_image.yml` with the workflow and job name `container_image`, like the other workflows.
- Triggers: `push` to `main`, `pull_request`, `workflow_dispatch` and `release` with the type `published`. A
  pre-release counts as published; a draft does not.
- Runner `ubuntu-24.04` with its preinstalled Podman, as in the test workflows. The runner is `linux/amd64`, so the
  published images are too. No Node.js setup and no `npm ci` on the runner: the steps call `bash scripts/image.sh`
  directly.
- Steps on every trigger: check out, `scripts/image.sh build`, `scripts/image.sh smoke`. For a release, the checkout
  is the commit of the release tag.
- Steps only for the `release` event, after the smoke test, so that only checked images are published:
  1. Check that the tag name of the release is a valid image tag (letters, digits, `_`, `.` and `-`, at most 128
     characters, not starting with `.` or `-`); fail with a clear message otherwise.
  2. Log in to `ghcr.io` with `podman login` as `github.actor` with `GITHUB_TOKEN`, passed on standard input.
  3. Tag and push `ghcr.io/<owner>/hippowiki:<tag>` and `ghcr.io/<owner>/hippowiki-migrate:<tag>`, with the owner in
     lower case. The tag is the tag name of the release, unchanged.
  4. For a release that is not a pre-release, also push both images as `latest`.
  5. Write the pushed image references with their digests to the job summary.
- The release tag reaches the shell through an `env` entry, never through `${{ }}` inside a `run` script.
- The version label of the images is the release tag; the revision label is the commit.
- Permissions: `contents: read` for the workflow, and `packages: write` in addition for the job.
- Concurrency as in the other workflows, but a run for a release is never cancelled.
- `README.md`: add to the section "Container image" how a release publishes the images and how to pull them.

### Test

- No unit, integration or end-to-end tests: the step adds no application code.
- `npm run format:check` accepts the workflow file.
- Manual checks for the user, on GitHub after the push of the finished plan:
  - the `container_image` workflow is green for the push to `main`
  - publishing a pre-release creates both packages with the tag of the release and without `latest`
  - publishing a release moves `latest` to it
  - `podman pull ghcr.io/<owner>/hippowiki:<tag>` works on the pre-production host; a new package is private until
    its visibility is changed, so the host may need a token with the `read:packages` scope
- The commands in "When a step is done" in `workflow.md` pass.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/container-image.md` (in the style of `pages.md`): the two images, the build
   stages, the environment variables, the smoke test, the release workflow with its tags, and the limits. Update the
   section "Continuous integration" in `testing.md` (the number of workflows, the new workflow, the second `docker`
   entry of Dependabot) and add the GitHub Container Registry to `tech.md`.
2. Remove "Container Image" and "Database Migrations Command" from `roadmap.md`.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file.
5. Update the spec catalog in `CLAUDE.md`: add `spec/container-image.md`, remove this step file.

### Test

- The commands in "When a step is done" in `spec/workflow.md` pass.
