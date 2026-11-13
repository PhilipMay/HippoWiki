# HippoWiki – Container Image

The container image of HippoWiki as built: one image that applies the database migrations when it starts, creates
the admin account if there is none, and then serves the wiki, for a first pre-production environment outside the
development machine. A first installation needs only the image, an empty PostgreSQL database, its address and a first
password for the admin.

Code: `Containerfile`, `.containerignore`, `scripts/image.sh`, `scripts/image-migrate.sh`, `scripts/image-admin.sh`,
`scripts/image-start.sh`, `scripts/admin.ts` and `.github/workflows/container_image.yml`. Test: the smoke test of
`scripts/image.sh` (see "Smoke test").

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
- The stages, described in the comments of the `Containerfile`: `base` (the Node.js image, the only stage that names
  it), `deps` (`npm ci`), `build` (the standalone output of Next.js and the bundled admin setup `build/admin.mjs`; it
  needs no database), `migrate-tools` (the Prisma CLI and `dotenv` for the migration) and `app`, the last and default
  stage.
- The `app` stage holds the standalone server in `/app`, the migration tools in `/app/migrate`, the admin setup
  `admin.mjs` with the password hashing built for the platform of the image, and the three start scripts. The seed
  script is left out, and no further system packages are installed.
- Every file of the image belongs to root, and the server runs as the user `node`, so it cannot change its own code;
  only `/app/.next/cache` belongs to `node`, so that the server can write its cache.
- The image sets `NODE_ENV=production`, `PORT=3000`, `NEXT_TELEMETRY_DISABLED=1` and `CHECKPOINT_DISABLE=1` (no update
  check of the Prisma CLI), exposes port 3000 and has `./image-start.sh` as its command.
- The Next.js standalone output is switched on only for the image build: `next.config.ts` sets `output: "standalone"`
  only when `HIPPOWIKI_OUTPUT=standalone`. `npm run start` and `npm run test:e2e:production` keep using `next start`,
  which warns that it does not work with the standalone output.
- `.containerignore` keeps every `.env*` file except `.env.example` out of the build context, together with the local
  and generated files. Only Podman reads it, so the `build` stage also fails when the standalone output contains a
  `.env` file. The image contains no credentials, no `.env` file and no database address.
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

- `image-start.sh` runs `image-migrate.sh` (`prisma migrate deploy`) on every start of a container, then
  `image-admin.sh` (see "Admin setup"), then starts the server.
- An empty database gets its tables this way. Every later start applies only the migrations that are not applied yet,
  and none when there are none. A new version of the image therefore updates the database when it starts.
- When the migration fails, the script exits with a non-zero code and the server does not start.
- There is no switch to skip the migration. The container does not wait for the database: when it is not reachable,
  the migration fails and the container exits.
- The server always listens on all addresses of the container, also in a pod, whose name Podman puts into `HOSTNAME`,
  and it receives the stop signal of the container (see `scripts/image-start.sh`).
- `image-migrate.sh` alone only applies the migrations and exits with the exit code of Prisma. A container started
  with `./image-migrate.sh` as its command makes the migration a step of its own without a second image.
- No sample data is inserted; the seed script is not part of the image.

## Admin setup

- The admin setup makes sure that the admin account, the user named `admin`, exists (see "Admin account and setup" in
  `users-and-login.md`). In the image it is the bundle `admin.mjs` of `scripts/admin.ts`, started by `image-admin.sh`.
- `image-start.sh` runs it on every start of a container, after the migration and before the server.
- If the database has no admin, it creates the admin with the password from `HIPPOWIKI_ADMIN_PASSWORD`, as a first
  password with a pending password change. If the admin exists, it does nothing and does not read the variable;
  changing the variable later does not change the password. Two containers that start together create one admin.
- When the admin has to be created and `HIPPOWIKI_ADMIN_PASSWORD` is missing, empty or not a valid password, it
  creates nothing and fails, and the container exits without serving. The same holds when the database is not
  reachable or `DATABASE_URL` is missing.
- It prints one line that says what it did, or on the error output why it failed; a password is never printed or
  logged. The messages and exit codes are in `scripts/admin.ts`.
- To run it on its own, in a running container or in a one-off container after the migration, see the comment of
  `scripts/image-admin.sh`.

## Configuration

- A container needs two variables, `DATABASE_URL` and `HIPPOWIKI_ADMIN_PASSWORD`, and nothing else. The optional
  variables `HIPPOWIKI_TRUSTED_PROXIES` and `HIPPOWIKI_LOG_CLIENT_ADDRESS` are described below.
- `DATABASE_URL`: `postgresql://<user>:<password>@<host>:<port>/<database>`. The migration, the admin setup and the
  server read it. Special characters in the password are percent-encoded.
- Only this form, without parameters, is supported and tested. The migration reads the URL with the schema engine of
  Prisma and the server with node-postgres, and the two may read parameters such as `sslmode` or `schema` differently.
- The URL is read when the container runs, never when the image is built.
- `HIPPOWIKI_ADMIN_PASSWORD`: the first password of the admin account, 8 to 128 characters, any characters. Only the
  admin setup reads it, and only while the database has no admin; the server never reads it. A container that starts
  against a database with an admin does not need it.
- `PORT` is optional (default 3000). `HOSTNAME` has no effect (see above). `NODE_ENV` is `production`, which makes
  the session cookies `Secure`.
- `HIPPOWIKI_LOG_CLIENT_ADDRESS` is optional, `true` or `false`, default `false`; any other value stops the server with
  an error like a wrong `DATABASE_URL`. It is read when the server runs, not when the image is built. With `true` the
  server logs one `info` line `client address probe` for every request that passes the proxy of Next.js (with
  `"source":"proxy"`, the method and the path; not for `/login` and `/api/health`) and for every submitted login (with
  `"source":"login"`). The line holds only the headers `X-Forwarded-For`, `X-Real-Ip`, `Forwarded`,
  `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Port` and `Host`, each cut to 200 characters, never cookies,
  `Authorization` or the body (`src/lib/client-address-probe.ts`).
  - It is meant for checking a reverse proxy in front of the container: whether a request from a known address arrives
    with that address, whether a forged `X-Forwarded-For` sent by the client is removed, and whether the container
    network keeps the source address or every client arrives with the same private one.
  - Client addresses are personal data, and every proxied request writes a line: switch it on for such a check only,
    not permanently in production.
- `HIPPOWIKI_TRUSTED_PROXIES` is optional, one digit from `0` to `9`, default `0`; any other value, such as `10`,
  `1.5` or an empty string, stops the server with an error like a wrong `DATABASE_URL`. It is read when the server
  runs. It says how many reverse proxies are in front of the server, and so where the login finds the client address
  for the wait after failed logins (see "Failed logins" in `users-and-login.md`):
  - `0`: no forwarding header is read, every login is in the client address group `shared`, and the wait after failed
    logins counts per user name alone.
  - `1`: the rightmost entry of `X-Forwarded-For` is the client address, the one that a single reverse proxy such as
    Traefik wrote.
  - `n`: the n-th entry from the right, for n reverse proxies in a row. The entries to its left are never used,
    because a client can write them.
  - A login whose entry is missing or not an address counts in `shared`, and the server logs a warning with the
    reason.
  - Set it only when the environment provides what "What the environment has to provide" names for it; otherwise a
    client that reaches the server around the reverse proxy chooses its own address.
- There is no variable for the secret that signs the session cookies: the server generates it on first use and
  stores it in the database (table `AuthSecret`). It therefore survives a new container, and all sessions with it.
- The database is PostgreSQL in the version pinned in `scripts/Containerfile`. The database and its user are created
  outside HippoWiki. The user must be allowed to create tables, because the migrations run with it. The migrations
  need no database extensions.

## Health

- `/api/health` answers 200 with `{"status":"ok"}` while the database is reachable and 503 otherwise. The environment
  uses it as its health check; the image declares no `HEALTHCHECK`.
- The route only checks that the database answers. That is enough: a container that serves has applied all migrations
  at its start.

## Smoke test

- `npm run image:smoke` (`scripts/image.sh smoke`) checks the image of `npm run image:build` against a throwaway, empty
  database, the same way locally and in CI. The list of its checks is at the top of `cmd_smoke` in `scripts/image.sh`.
- It checks what this spec promises: that a container without a valid admin password does not serve, that a first
  start installs the database, creates the admin and serves the wiki behind its login with the security headers, that
  the server does not run as root and cannot change its own files, and that later starts and the commands
  `./image-migrate.sh` and `./image-admin.sh` change nothing.
- It runs in a pod of its own whose names and port differ from the development database, the test database,
  `npm run dev` and the end-to-end server, so it can run next to them. It removes everything it started, also when a
  check fails.
- A wrong database password does not make it fail, because the PostgreSQL image accepts connections over the loopback
  of the pod without a password.

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
- `HIPPOWIKI_ADMIN_PASSWORD` for the first start, kept out of the image and out of the repository in the same way. It
  can be removed once the admin exists.
- TLS in front of the container, for example in a reverse proxy: the container speaks plain HTTP, and the login
  needs HTTPS. The session cookie is `Secure`, so a browser that reaches the wiki over plain HTTP does not send it
  back and nobody can stay logged in. `localhost` is the one exception that browsers make.
- No security headers: the server sets them itself (see "Security headers" in `architecture.md`), so a reverse proxy
  does not have to.
- The login is the protection from the public: nothing can be read or changed without it, and only the login page and
  `/api/health` answer without one. The server limits the logins per user name and client address and per user name
  (see "Failed logins" in `users-and-login.md`), but not the logins per client address across all user names; a
  reverse proxy can add that limit.
- For `HIPPOWIKI_TRUSTED_PROXIES` above `0`, a setup in which `X-Forwarded-For` can be trusted. Next.js never shows the
  application the address of the connecting peer, so the server cannot check where the header came from:
  - The port of the server is reachable through the reverse proxy alone, for example published on `127.0.0.1` only.
    A process on the host itself can still reach it and choose its own address.
  - The reverse proxy replaces the `X-Forwarded-For` that the client sent with the address it sees, or appends that
    address as the rightmost entry. Traefik replaces it by default, unless the client is one of its trusted IPs.
  - The container network keeps the source address of a client, so that every client does not arrive with the same
    private address.
  - The setup is checked once with `HIPPOWIKI_LOG_CLIENT_ADDRESS=true`: a failed login from a known address outside the
    network of the server is logged with that address, and the same login with a forged `X-Forwarded-For` and
    `X-Real-Ip` is logged with the same address as before.
  - The checks of the deployment behind Traefik on 2026-11-13, with `HIPPOWIKI_LOG_CLIENT_ADDRESS=true`:
    - Traefik writes `X-Forwarded-For` and `X-Real-Ip` with a single entry each, the same in both. Requests from a
      client outside the network of the server arrived with that client's own public address, so the container
      network (rootless Podman with `pasta`) keeps the source address.
    - A request with a forged `X-Forwarded-For: 203.0.113.7` and `X-Real-Ip: 203.0.113.7` arrived with only the real
      address: Traefik replaces these headers of the client instead of appending to them.
    - `pasta` publishes port 3000 on `127.0.0.1` only (`ss -ltnp`), so no other machine can reach the server around
      Traefik. A process on the host itself can: a request to `http://127.0.0.1:3000/` on the host with a forged
      `X-Forwarded-For: 203.0.113.7` arrived with that value, without `X-Real-Ip` and with `X-Forwarded-Proto: http`.
      Every request through Traefik carried `X-Real-Ip`, which Next.js never sets itself.
    - The login action sees the same `X-Forwarded-For` and `X-Real-Ip` as the proxy of Next.js. `/login` does not pass
      the proxy, so the action is the only place that sees the login request.
    - After a Server Action redirects, Next.js requests the target page from itself (`Host: localhost:3000`) with the
      headers of the client, so the proxy of Next.js sees such requests too.
    - Not checked: a request over IPv6, and the login limit itself with `HIPPOWIKI_TRUSTED_PROXIES=1` (see "Things to
      Check" in `roadmap.md`).
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
- The admin setup is one file, bundled with esbuild (`npm run build:admin`), instead of TypeScript run with `tsx`:
  - The standalone output has neither `tsx` nor the sources, and the setup uses the users service with its `@/`
    imports, so it has to be compiled for the image.
  - Everything is bundled except `@prisma/client`, `pg`, `pino`, `pino-pretty` and `@node-rs/argon2`. These five stay
    imports, because the standalone output carries them in `/app/node_modules`: Next.js keeps them out of its bundles.
  - `--packages=external` is not used: `zod` and `@prisma/adapter-pg` are bundled into the server by Next.js and are
    missing in the `node_modules` of the standalone output.
  - The format is ESM, because the generated Prisma client uses `import.meta.url`.
  - `node_modules/@node-rs` is copied from the `deps` stage instead of relying on the trace of Next.js, which only
    contains what the server imports.
  - `scripts/admin.ts` imports nothing that exists only on the development machine, such as `dotenv`;
    `npm run admin:setup` loads `.env` with an option of Node.js instead.
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
- the first runs on GitHub are still to come:
  - the workflow on the runner's Podman
  - the login and the push to `ghcr.io`, which run for the first time with the first release
