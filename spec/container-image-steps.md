# Container Image – Steps

## Goal

HippoWiki can be built as a container image and run outside the development machine, for a first pre-production
environment. The image applies the database migrations itself when it starts and then serves the wiki, so a first
installation needs nothing but the image and an empty database. Publishing a release on GitHub builds the image, checks
that it starts and answers, and stores it in the GitHub Container Registry under the tag of the release.

The requirements and the reasons for the decisions are in `container-image-requirements.md`. The wrap-up step folds
that file into the description of the feature as built and deletes it.

## Scope

- In:
  - a `Containerfile` for the application with one image: it runs `prisma migrate deploy` and then starts the server
  - a command in the same image that only applies the migrations, for the case that the migration becomes a step of
    its own later
  - the Next.js standalone output, switched on only for the image build
  - a script that builds the image locally with Podman and a smoke test that runs it against a throwaway database
  - a GitHub Actions workflow that builds and smoke-tests the image on every push to `main` and on pull requests,
    and pushes it to `ghcr.io` when a release is published
  - a Dependabot entry for the Node.js base image
- Not in:
  - a second image for the migrations
  - a switch to skip the migration at the start; `prisma migrate deploy` finds out by itself whether migrations are
    pending
  - waiting for the database at the start: when it is not reachable, the migration fails and the container exits
  - running more than one instance; instances that start together would all try to migrate
  - deploying the image: no compose file, no reverse proxy, no TLS, no backups (candidates in `roadmap.md`)
  - a `HEALTHCHECK` in the image; `/api/health` exists and the orchestrator calls it
  - a `latest` tag; the host names the tag of the release it runs
  - parameters in `DATABASE_URL`, such as `sslmode` or `schema`; only the form without parameters is tested
  - images for other platforms than `linux/amd64`
  - image signing, provenance attestations and vulnerability scans
  - running the seed script in a container
  - authentication; the image serves the wiki to everyone who reaches it

## Checklist

- [x] Image
- [ ] Smoke test
- [ ] Release workflow
- [ ] Wrap-up

## Image

### Goal

`npm run image:build` builds the image with Podman. A container of it finds its migration tools and its server; that
it migrates a database and then serves the wiki is proved by the smoke test of the next step. The normal build,
`npm run start` and the end-to-end tests stay as they are.

### Build

- `next.config.ts`: set `output: "standalone"` only when `HIPPOWIKI_OUTPUT=standalone`, in the style of
  `HIPPOWIKI_DIST_DIR`. Without the variable the option stays unset, because `next start` warns that it does not work
  with the standalone output, and `npm run start` and `npm run test:e2e:production` use `next start`. Follow
  `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`.
- `Containerfile` in the project root. `scripts/Containerfile` stays untouched: it only pins the PostgreSQL image and
  `scripts/db.sh` and `e2e/support/container.ts` read its first `FROM` line. The new file uses plain instructions
  only (no heredocs, no `RUN --mount`), because the Podman of the runner is older than the one of the development
  machine. It has these stages:
  - `base`: the Node.js image and nothing else. It is the only stage that names the image, so its version stands in
    one place; all other stages start from `base`.
  - `deps`: `npm ci`. The `postinstall` script runs `prisma generate`, so `prisma/` and `prisma.config.ts` are copied
    before `npm ci`, next to `package.json`, `package-lock.json` and `.npmrc`.
  - `build`: starts from `deps`, so that it has `node_modules` and the generated Prisma client in `src/generated`,
    which `.containerignore` keeps out of the build context. It copies the sources and runs `npm run build` with
    `HIPPOWIKI_OUTPUT=standalone` and `NEXT_TELEMETRY_DISABLED=1`. It needs no database and no `DATABASE_URL`. After
    the build the stage fails when `.next/standalone/.env` exists: `next build` copies a `.env` file of the project
    into the standalone output, and the `app` stage copies that folder as a whole.
  - `migrate-tools`: installs what `prisma migrate deploy` needs into a directory of its own, apart from the
    `node_modules` of the standalone output: the Prisma CLI (`prisma`) and `dotenv`, which `prisma.config.ts` imports.
    Both are development dependencies and therefore not part of the standalone output. Their versions are read from
    `package-lock.json` during the build, so the image uses the versions of the project for these two packages and
    no second pin has to be kept up to date. Their own dependencies are resolved anew at every build; that is
    accepted (see "Decisions" in `container-image-requirements.md`). The schema engine that `prisma migrate deploy`
    needs is downloaded by the `postinstall` script of `@prisma/engines`, so the stage fails when no
    `schema-engine-*` file exists in `node_modules/@prisma/engines` afterwards.
  - `app`, the last and therefore the default stage:
    - `.next/standalone` and `.next/static` from the `build` stage; there is no `public/` folder to copy
    - the directory of the `migrate-tools` stage. `prisma.config.ts`, `prisma/schema.prisma` and `prisma/migrations`
      lie in that directory, next to its `node_modules`: the configuration file imports `dotenv` and `prisma/config`,
      which are found only from there, and its paths to the schema and the migrations are relative to it.
      `prisma/seed.ts` is left out.
    - the two scripts described below
    - no further system packages: the slim image already has the OpenSSL library the schema engine needs. Install a
      package only when the smoke test shows that it is missing.
    - `NODE_ENV=production`, `PORT=3000`, the user `node`, port 3000 exposed and the start script as its command.
      `HOSTNAME` is not set in the image; the start script sets it.
- Two scripts in `scripts/`, copied into the image:
  - `image-migrate.sh`: runs `prisma migrate deploy` with the tools and files above and exits with its exit code. It
    is also the command for applying the migrations as a step of its own, by starting a container of the image with
    `./image-migrate.sh` as its command instead of the start script.
  - `image-start.sh`, the command of the image: runs `image-migrate.sh` on every start. `prisma migrate deploy` finds
    out by itself whether migrations are pending and changes nothing when there are none, so there is no switch to
    skip it. When the migration fails, the script exits with a non-zero code and does not start the server. Otherwise
    it sets `HOSTNAME=0.0.0.0` and starts the server with `exec node server.js`, so that the server receives the stop
    signal of the container. The script sets the address itself, right before the server starts, because the
    standalone server binds to `HOSTNAME` and Podman overwrites that variable with the name of the pod for every
    container in a pod, also when the image or `--env` sets another value.
- Base image: the slim Debian variant of the official Node.js image, with the major version of `.nvmrc` and pinned to
  the current minor version, like the PostgreSQL image.
- Labels: `org.opencontainers.image.source` with the URL of the GitHub repository, which links the package to the
  repository, is set in the `Containerfile`. `org.opencontainers.image.version` and
  `org.opencontainers.image.revision` come from the environment variables `IMAGE_VERSION` and `IMAGE_REVISION`:
  `scripts/image.sh build` passes each one on with `podman build --label` when it is set and leaves the label out
  otherwise.
- `.containerignore`: keeps at least `.env` and every other `.env*` file except `.env.example`, `.git`,
  `node_modules`, `.next`, `.next-e2e`, `src/generated`, `coverage`, `playwright-report`, `test-results` and
  `*.tsbuildinfo` out of the build context. The `.env` entries are what keeps the credentials of the development
  machine out of the image; say so in a comment in the file. Only Podman reads `.containerignore`, Docker ignores
  it, so the check in the `build` stage is the second guard.
- `scripts/image.sh` in the style of `scripts/db.sh`, with the command `build`: builds the image as
  `hippowiki:local`. It sets no platform, so the image is built for the machine that runs it. Before the build it
  compares the major version of `.nvmrc` with the one of the Node.js image in the `Containerfile` and fails with a
  clear message when they differ.
- `package.json`: the script `image:build`.
- `.github/dependabot.yml`: a second `docker` entry for the directory `/`. It ignores major updates of the Node.js
  image, because the major version changes together with `.nvmrc`.
- `README.md`: a section "Container image" with `npm run image:build`, the variables the image reads (`DATABASE_URL`
  in the form without parameters, `PORT`), what happens at the start (the migrations are applied to the database of
  `DATABASE_URL`, an empty database gets its tables, then the server starts) and the command that only applies the
  migrations. Add `npm run image:build` to the table under "Commands". Say that the Podman machine needs at least
  4 GiB of memory: `next build` runs inside it and was killed for lack of memory in a machine with 2 GiB.

### Test

- No unit, integration or end-to-end tests: the step adds no application code. The smoke test of the next step covers
  the start against a database.
- `npm run image:build` succeeds and leaves the image in `podman images`.
- A container of the image started with `./image-migrate.sh` as its command and without `DATABASE_URL` exits with a
  non-zero code and with the error of Prisma about the missing database URL, not with a command or a module that is
  not found. It needs no database and proves that the Prisma CLI, `prisma.config.ts` and `dotenv` are found and that
  the script is executable.
- `npm run build` without `HIPPOWIKI_OUTPUT` creates no `.next/standalone`, and `npm run test:e2e:production` passes
  without the standalone warning of `next start` in its output. This step changes the build configuration, so run it
  as described in "When a step is done" in `workflow.md`.
- The image contains no `.env` file although the project has one, its Prisma CLI has the version of
  `package-lock.json`, and its configured user is `node` (`podman image inspect`, `podman run --rm`).
- An image built with `IMAGE_VERSION` and `IMAGE_REVISION` set carries both labels; one built without them carries
  only the source label (`podman image inspect`).
- `scripts/image.sh build` fails before the build when `.nvmrc` names another major version than the `Containerfile`:
  check it once with a changed `.nvmrc`, then undo that change.
- The commands in "When a step is done" in `workflow.md` pass.

## Smoke test

### Goal

`npm run image:smoke` proves that the image installs itself: started against an empty database, it creates the tables
and serves the wiki. It runs the same way locally and in CI.

### Build

- `scripts/image.sh` gets the command `smoke`. It expects the image of `build` and does this:
  1. Remove a pod left behind by an earlier run, then create the pod `hippowiki-smoke`, which publishes port 3000 of
     the application as `127.0.0.1:3200`. The database port is not published.
  2. Start PostgreSQL in the pod from the image pinned in `scripts/Containerfile`, with its data in memory only, and
     wait until it accepts connections over TCP, as `scripts/db.sh` does. The database is empty.
  3. Start `hippowiki:local` with `DATABASE_URL`.
  4. Poll `http://127.0.0.1:3200/api/health` until it answers 200 with `{"status":"ok"}`, for at most 60 seconds.
  5. Request `/folders` and require status 200, which proves that the start created the tables. Request one
     `/_next/static/` file that the page references and require status 200, which proves that the static files were
     copied into the image.
  6. Request `/api/health` on `127.0.0.1:3000` from inside the application container (`podman exec` with `node`; the
     slim image has no `curl`) and require status 200. It proves that the server listens on all interfaces although
     Podman sets `HOSTNAME` to the name of the pod. The published port does not show that, because it reaches the
     address of the pod.
  7. Require that the application process does not run as root and that the container has no `.env` file, neither
     next to `server.js` nor in the directory of the migration tools.
  8. Read the rows of `_prisma_migrations` with `psql` in the database container. Remove the application container
     and start a second one against the same, now migrated database. Require that `/folders` answers 200 again and
     that the rows of `_prisma_migrations` are the same as before. The check does not read the log of the container:
     the sentence the Prisma CLI prints when no migrations are pending is no stable interface.
  9. Run a further container of the image with `./image-migrate.sh` as its command against the migrated database.
     Require exit code 0 and unchanged rows in `_prisma_migrations`.
  10. Remove the pod, also when a check fails. On a failure, print the last log lines of the containers first and
      exit with a non-zero code.
- The names and the port do not collide with the development database (`hippowiki-db`, 5432), the test database
  (`hippowiki-test-db`, 5433), `npm run dev` (3000) and the end-to-end server (3100), so the smoke test can run next
  to them.
- `package.json`: the script `image:smoke`.
- `README.md`: add `npm run image:smoke` to the section "Container image" and to the table under "Commands".

### Test

- `npm run image:build && npm run image:smoke` passes and leaves no pod and no container behind (`podman pod ls`,
  `podman ps --all`).
- The smoke test fails with a non-zero exit code and prints the container logs when the migration cannot run: check
  it once by running the script with a `DATABASE_URL` for the application container that names a port on which
  nothing listens, then undo that change. The application container must have exited instead of serving. A wrong
  database password is no such check: in the pod the application reaches PostgreSQL over `127.0.0.1`, and the
  PostgreSQL image accepts connections from the loopback address without a password, so the migration succeeds.
- A second run right after a first one passes as well.
- The commands in "When a step is done" in `workflow.md` pass.

## Release workflow

### Goal

Every push to `main` and every pull request shows whether the image still builds and starts. Publishing a release on
GitHub pushes the image to the GitHub Container Registry.

### Build

- `scripts/image.sh` gets two commands that the workflow calls, so that they can be tried locally:
  - `check-tag <tag>`: succeeds when the tag is a valid image tag (letters, digits, `_`, `.` and `-`, at most 128
    characters, not starting with `.` or `-`) and not `latest`; fails with a clear message otherwise.
  - `reference <owner> <tag>`: runs the same check and prints `ghcr.io/<owner>/hippowiki:<tag>`, with the owner in
    lower case and the tag unchanged.
- `.github/workflows/container_image.yml` with the workflow and job name `container_image`, like the other workflows.
- Triggers: `push` to `main`, `pull_request`, `workflow_dispatch` and `release` with the type `published`. A
  pre-release counts as published; a draft does not.
- Runner `ubuntu-24.04` with its preinstalled Podman, as in the test workflows. The runner is `linux/amd64`, so the
  published image is too. No Node.js setup and no `npm ci` on the runner: the steps call `bash scripts/image.sh`
  directly.
- Steps, in this order:
  1. Check out with `persist-credentials: false`. For a release, the checkout is the commit of the release tag.
  2. Print `podman version`, so that the log of a run shows which Podman built the image.
  3. Only for the `release` event: `scripts/image.sh check-tag` with the tag name of the release. It runs before the
     build, so that an invalid tag fails at once and no unchecked string reaches the build command.
  4. `scripts/image.sh build` with `IMAGE_REVISION` set to the commit and, for a release, `IMAGE_VERSION` set to the
     tag name of the release.
  5. `scripts/image.sh smoke`.
  6. Only for the `release` event, after the smoke test, so that only a checked image is published: log in to
     `ghcr.io` with `podman login` as `github.actor` with `GITHUB_TOKEN`, passed on standard input.
  7. Only for the `release` event: tag and push the image under the reference that `scripts/image.sh reference`
     prints for the owner of the repository and the tag name of the release. No `latest` tag is pushed.
  8. Only for the `release` event: write the pushed image reference with its digest to the job summary.
- The release tag reaches the shell through an `env` entry, never through `${{ }}` inside a `run` script.
- Permissions: `contents: read` for the workflow, and `packages: write` in addition for the job, which the push of a
  release needs. The job has that permission for every trigger and builds and starts code of the commit for pushes
  and pull requests too, so the token is kept away from that code: the checkout does not store it
  (`persist-credentials: false`), and only the login step gets it, after the build and the smoke test.
- Concurrency as in the other workflows, but a run for a release is never cancelled.
- `README.md`: add to the section "Container image" how a release publishes the image, how to pull it by the tag of
  the release, and that there is no `latest` tag.

### Test

- No unit, integration or end-to-end tests: the step adds no application code.
- `bash scripts/image.sh check-tag` accepts `v1.0.0` and `1.0.0-rc.1`. It fails with a message for `latest`, for an
  empty tag, for a tag that starts with `.` or `-`, for a tag with `/` or `:` and for a tag of 129 characters.
- `bash scripts/image.sh reference Some-Owner v1.0.0` prints `ghcr.io/some-owner/hippowiki:v1.0.0`, and fails for an
  invalid tag.
- `npm run format:check` accepts the workflow file.
- Manual checks for the user, on GitHub after the push of the finished plan. The login and the push cannot be tried
  before; they run for the first time with the first release.
  - the `container_image` workflow is green for the push to `main`. This is the first run with the Podman of the
    runner (the 4.9 series, without root rights, `linux/amd64`); a `Containerfile` instruction or a pod command that
    only the newer Podman of the development machine accepts shows here.
  - publishing a pre-release creates the package with the tag of the release
  - publishing a release adds its tag; the package has no `latest` tag
  - `podman pull ghcr.io/<owner>/hippowiki:<tag>` works on the pre-production host; a new package is private until
    its visibility is changed, so the host may need a token with the `read:packages` scope
  - a container of the pulled image, started on the pre-production host with `DATABASE_URL` for an empty database,
    creates the tables and serves the wiki
- The commands in "When a step is done" in `workflow.md` pass.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/container-image.md` (in the style of `pages.md`): the image and its build
   stages, the start with the migration, the command that only migrates, the environment variables, the smoke test,
   the release workflow with its tags, and the limits. Fold `container-image-requirements.md` into this file: take over
   what still holds and is not covered yet, in particular its sections "What the environment has to provide" and
   "Decisions", worded as built instead of as required. Where the image as built differs from a requirement, describe
   the image as built and name the difference in the report of the step. Say there which manual checks of the
   release workflow have not run yet. Update the section "Continuous integration" in `testing.md`:
   - the number of workflows and the new workflow
   - the sentence "Every workflow installs Node.js from `.nvmrc` and runs `npm ci`", which does not hold for the new
     workflow
   - the sentence about Dependabot, which names only the `npm` and `github-actions` dependencies: add the two
     `docker` entries

   Add the GitHub Container Registry to `tech.md`.

2. Remove "Container Image", "Database Migrations Command", "Configuration via Environment Variables" and "Container
   Health Check" from `roadmap.md`. The image covers all four: its variables are decided, and its health check is
   `/api/health`, called by the environment.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and `spec/container-image-requirements.md`.
5. Update the spec catalog in `CLAUDE.md`: add `spec/container-image.md`, remove this step file and
   `spec/container-image-requirements.md`.

### Test

- No file in the repository refers to `container-image-requirements.md` or to this step file any more.
- The commands in "When a step is done" in `spec/workflow.md` pass.
