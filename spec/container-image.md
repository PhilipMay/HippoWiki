# HippoWiki – Container Image

The container image of HippoWiki as built: one image that applies the database migrations when it starts and then
serves the wiki, for a first pre-production environment outside the development machine. A first installation needs
only the image, an empty PostgreSQL database and its address. Code: `Containerfile`, `.containerignore`,
`scripts/image.sh`, `scripts/image-migrate.sh`, `scripts/image-start.sh` and `.github/workflows/container_image.yml`.

## Image

- There is one image. It contains the application and everything it needs to set up its database; there is no second
  image for the migrations.
- It is built from the `Containerfile` in the project root. `scripts/Containerfile` is a different file: it only pins
  the PostgreSQL image of the development, test and smoke test databases.
- The `Containerfile` uses plain instructions only (no heredocs, no `RUN --mount`), because the Podman of the CI runner
  is older than the one of the development machine.
- The base image is the slim Debian variant of the official Node.js image, with the major version of `.nvmrc`, pinned
  to a minor version (`node:26.13-slim`). Dependabot keeps the minor version up to date and ignores major updates,
  because the major version changes together with `.nvmrc`.
- The stages:
  - `base`: the Node.js image and nothing else. It is the only stage that names the image; all others start from it.
  - `deps`: `npm ci`, with `package.json`, `package-lock.json`, `.npmrc`, `prisma.config.ts` and `prisma/` copied
    first, because the `postinstall` script runs `prisma generate`.
  - `build`: starts from `deps` for `node_modules` and the generated Prisma client, copies the sources and runs
    `npm run build` with `HIPPOWIKI_OUTPUT=standalone` and `NEXT_TELEMETRY_DISABLED=1`. It needs no database and no
    `DATABASE_URL`. It fails when `.next/standalone/.env` exists, because `next build` copies a `.env` file of the
    project into the standalone output.
  - `migrate-tools`: installs the Prisma CLI (`prisma`) and `dotenv`, which `prisma.config.ts` imports, into a
    directory of their own. Both are development dependencies and not part of the standalone output. Their versions
    are read from `package-lock.json` during the build; their own dependencies are resolved anew at every build. The
    stage fails when the schema engine (`node_modules/@prisma/engines/schema-engine-*`) was not downloaded.
  - `app`, the last and default stage. Its content:
    - the standalone output with `.next/static` in `/app`, owned by `node` so that the server can write its cache
    - the migration tools in `/app/migrate`, next to `prisma.config.ts`, `prisma/schema.prisma` and
      `prisma/migrations`; the seed script is left out
    - `image-migrate.sh` and `image-start.sh` in `/app`
    - no further system packages: the slim image already has the OpenSSL library the schema engine needs
    - `NODE_ENV=production`, `PORT=3000`, `NEXT_TELEMETRY_DISABLED=1` and `CHECKPOINT_DISABLE=1`, which stops the
      Prisma CLI from checking for updates
    - user `node`, port 3000 exposed, and `./image-start.sh` as its command
- The Next.js standalone output is switched on only for the image build: `next.config.ts` sets `output: "standalone"`
  only when `HIPPOWIKI_OUTPUT=standalone`. `npm run start` and `npm run test:e2e:production` keep using `next start`,
  which warns that it does not work with the standalone output.
- `.containerignore` keeps `.env` and every other `.env*` file except `.env.example` out of the build context, as well
  as `.git`, `node_modules`, `.next`, `.next-e2e`, `src/generated`, `coverage`, `playwright-report`, `test-results`
  and `*.tsbuildinfo`. Only Podman reads this file, so the check in the `build` stage is the second guard. The image
  contains no credentials, no `.env` file and no database address.
- Labels:
  - `org.opencontainers.image.source` names the GitHub repository and links the package to it. It is set in the
    `Containerfile`.
  - `org.opencontainers.image.version` and `org.opencontainers.image.revision` come from the variables
    `IMAGE_VERSION` and `IMAGE_REVISION` of `scripts/image.sh build`. Each label is left out when its variable is
    not set.
- The image of the development machine (`linux/arm64`) is about 570 MB. The migration tools take the larger part of
  it.

## Building

- `npm run image:build` (`scripts/image.sh build`) builds the image as `hippowiki:local` with Podman, for the platform
  of the machine that runs it.
- Before the build, it compares the major version of `.nvmrc` with that of the Node.js image in the first `FROM` line
  of the `Containerfile`. It fails with a message when they differ. A plain `podman build` does not check this.
- `next build` runs inside the Podman machine. It needs at least 4 GiB of memory there; with 2 GiB the build is killed
  for lack of memory.

## Start and database setup

- `image-start.sh` runs `image-migrate.sh` (`prisma migrate deploy`) on every start of a container, then starts the
  server.
- An empty database gets its tables this way. Every later start applies only the migrations that are not applied yet,
  and none when there are none. A new version of the image therefore updates the database when it starts.
- When the migration fails, the script exits with a non-zero code and the server does not start.
- There is no switch to skip the migration. The container does not wait for the database: when it is not reachable,
  the migration fails and the container exits.
- Before the server starts, the script sets `HOSTNAME=0.0.0.0`. The standalone server binds to `HOSTNAME`, and Podman
  sets that variable to the name of the pod for every container in a pod, also when the image or `--env` sets another
  value. The server is started with `exec node server.js`, so it receives the stop signal of the container.
- `image-migrate.sh` alone only applies the migrations and exits with the exit code of Prisma. A container started
  with `./image-migrate.sh` as its command makes the migration a step of its own without a second image.
- No sample data is inserted; the seed script is not part of the image.

## Configuration

- `DATABASE_URL` is the only variable a container needs: `postgresql://<user>:<password>@<host>:<port>/<database>`.
  The migration and the server both read it. Special characters in the password are percent-encoded.
- Only this form, without parameters, is supported and tested. The migration reads the URL with the schema engine of
  Prisma and the server with node-postgres, and the two may read parameters such as `sslmode` or `schema` differently.
- The URL is read when the container runs, never when the image is built.
- `PORT` is optional (default 3000). `HOSTNAME` has no effect (see above). `NODE_ENV` is `production`.
- The database is PostgreSQL in the version pinned in `scripts/Containerfile`. The database and its user are created
  outside HippoWiki. The user must be allowed to create tables, because the migrations run with it. The migrations
  need no database extensions.

## Health

- `/api/health` answers 200 with `{"status":"ok"}` while the database is reachable and 503 otherwise. The environment
  uses it as its health check; the image declares no `HEALTHCHECK`.
- The route only checks that the database answers. That is enough: a container that serves has applied all migrations
  at its start.

## Smoke test

`npm run image:smoke` (`scripts/image.sh smoke`) checks the image of `npm run image:build` against a throwaway
database. It runs the same way locally and in CI:

1. It removes a pod left behind by an earlier run and creates the pod `hippowiki-smoke`. The pod publishes port 3000
   of the application as `127.0.0.1:3200`; the database port is not published.
2. It starts PostgreSQL `hippowiki-smoke-db` in the pod from the image of `scripts/Containerfile`, with its data in
   memory only, and waits until it accepts connections over TCP.
3. It starts `hippowiki-smoke-app` with `DATABASE_URL` and polls `/api/health` for at most 60 seconds until it reports
   ok. It fails at once when the container exits.
4. `/folders` must answer 200, which proves that the start created the tables. The first `/_next/static/` file that
   the page references must answer 200.
5. `/api/health` must answer 200 on `127.0.0.1:3000` from inside the container, requested with `node`, because the
   slim image has no `curl`.
6. The server process (PID 1) must not run as root. The container must have no `.env` file in `/app` or in
   `/app/migrate`.
7. It reads the rows of `_prisma_migrations` with `psql`. Then it replaces the application container with a second one
   against the same database. `/folders` must answer 200 again, and the rows must stay the same.
8. `./image-migrate.sh` in a further container must exit with 0, and the rows must stay the same.
9. It removes the pod, also when a check fails. On a failure it prints the last log lines of the containers first and
   exits with a non-zero code.

The names and the port differ from the development database (`hippowiki-db`, 5432), the test database
(`hippowiki-test-db`, 5433), `npm run dev` (3000) and the end-to-end server (3100), so the smoke test can run next to
them. A wrong database password does not make it fail: in the pod the application reaches PostgreSQL over
`127.0.0.1`, and the PostgreSQL image accepts loopback connections without a password.

## Publishing

- The workflow `container_image` builds the image and runs the smoke test on these triggers:
  - every push to `main`
  - pull requests
  - a start by hand (`workflow_dispatch`)
  - a published release
- Only a published release pushes the image, to `ghcr.io/<owner>/hippowiki:<tag>`. A pre-release counts as published;
  a draft does not.
- The workflow runs on `ubuntu-24.04` with the Podman preinstalled on the runner, so the published image is
  `linux/amd64`. It sets up no Node.js and runs no `npm ci`; its steps call `bash scripts/image.sh` directly.
- The steps, in this order:
  1. checkout without storing the token (`persist-credentials: false`); for a release, this is the commit of the
     release tag
  2. `podman version`
  3. for a release only: `scripts/image.sh check-tag` with the tag name of the release
  4. `scripts/image.sh build` with `IMAGE_REVISION` set to the commit and, for a release, `IMAGE_VERSION` set to the
     tag name
  5. `scripts/image.sh smoke`
  6. for a release only: `podman login ghcr.io` as `github.actor`, with `GITHUB_TOKEN` passed on standard input
  7. for a release only: tagging and pushing the image under the reference that `scripts/image.sh reference` prints
  8. for a release only: the pushed reference and its digest in the job summary
- Tags:
  - The image tag is the tag name of the release, unchanged.
  - `scripts/image.sh check-tag` accepts letters, digits, `_`, `.` and `-`, at most 128 characters, not starting with
    `.` or `-`. It refuses `latest`.
  - `scripts/image.sh reference <owner> <tag>` runs the same check and prints the reference, with the owner in lower
    case.
  - An invalid tag fails the run before the build.
  - No `latest` tag is pushed: the host names the tag of the release it runs.
- Token and permissions:
  - The release tag, the actor, the owner and the token reach the shell through `env` entries, never through `${{ }}`
    inside a `run` script.
  - The workflow has `contents: read`; the job also has `packages: write`.
  - The job builds and starts the code of the commit for every trigger, so the token is kept away from that code:
    only the login step gets it, after the build and the smoke test. Only an image that passed the smoke test is
    pushed.
- A run for a release is never cancelled; other runs are cancelled by a newer push to the same ref, as in the other
  workflows.

## What the environment has to provide

These are not built into the image; whoever runs it takes care of them.

- A PostgreSQL database and `DATABASE_URL`, kept out of the image and out of the repository, for example in an
  environment file that only the host can read.
- Protection from the public: the wiki has no login yet, so everyone who reaches the container can read and change
  everything. It runs behind a VPN or a reverse proxy that authenticates.
- TLS: the container speaks plain HTTP.
- One instance only. Instances that start together would all try to migrate, and each instance has its own page
  cache.
- Access to the package: a new package in the GitHub Container Registry is private until its visibility is changed, so
  the host may need a token with the `read:packages` scope.
- A backup of the database before a container of a new version starts: the start changes the database without a
  question.
- No way back to an older image without that backup: an older image started against the database of a newer one does
  not notice the difference and serves against tables it does not know.
- A way out of a failed migration: a migration that fails halfway stays marked as failed in the database. Every
  further start then exits, with a restart policy in a loop, until someone resolves it by hand with
  `prisma migrate resolve` (Prisma documentation, "Failed migrations" in the production troubleshooting).

## Decisions

- One image that migrates at the start, instead of a separate migration image:
  - Comparable open source applications do it this way (Umami, Cal.com, Documenso, Linkwarden, Outline), and a first
    installation stays simple.
  - The price is a larger image, because it carries the Prisma CLI. In a trial on `linux/arm64` the migration tools
    took 256 MB, next to 51 MB for the standalone application. Every pull therefore moves about 300 MB on top of the
    base image instead of about 50 MB, which is acceptable for a pre-production environment.
- No switch to skip the migration, although Umami, Outline and Formbricks have one:
  - `prisma migrate deploy` finds out by itself whether migrations are pending and changes nothing when there are
    none.
  - Without a switch the application can never serve from a database without its tables.
  - If the migration becomes a step of its own later, the switch can be added then; the command that only migrates is
    already there.
- `DATABASE_URL` only: it is what Prisma and the Prisma-based applications among them use, and what the application
  and its tests already read. Applications in other ecosystems often take separate variables; that would only add a
  second way to configure the same thing.
- The standalone output only for the image build, so that `npm run start` and the end-to-end tests against a
  production build keep using `next start`.
- Podman in CI, as on the development machine, so that both use the same command:
  - The program is not the same: the runner has an older Podman (the 4.9 series of Ubuntu 24.04, against 6 on the
    development machine), works without root rights and is `linux/amd64`.
  - The `Containerfile` and the scripts therefore keep to what the older version knows.
- The migration tools are `prisma` and `dotenv` in the versions of `package-lock.json`:
  - Their own dependencies are not pinned and are resolved anew at every build, so two builds of the same commit can
    contain different packages. That is accepted for a pre-production image.
  - A lock file of their own would be a second pin to keep up to date with every Prisma update.
- No `latest` tag:
  - It would follow only the publishing of a release. A pre-release that is later changed to a release would not move
    it, and a release for an older version line would move it back.
  - With the tag named by the host, the version that runs is always the one that was chosen.

## Current limits

- no deployment: no compose file, no reverse proxy, no TLS, no backups (candidates in `roadmap.md`)
- images for `linux/amd64` only
- one running instance only
- no switch to skip the migration, no waiting for the database at the start
- no `HEALTHCHECK` in the image
- no `latest` tag
- no parameters in `DATABASE_URL`, such as `sslmode` or `schema`
- no image signing, provenance attestations or vulnerability scans
- no seed script in the image
- no authentication: the image serves the wiki to everyone who reaches it
- the first runs on GitHub are still to come:
  - the workflow on the runner's Podman
  - the login and the push to `ghcr.io`, which run for the first time with the first release
