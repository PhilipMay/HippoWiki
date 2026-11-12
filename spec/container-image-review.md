# Container Image – Review of the Requirements and the Step Plan

Review of `spec/container-image-requirements.md` and `spec/container-image-steps.md`, reported as described in
`issue-report.md`. Delete this file once its findings are worked into the two files: the wrap-up of the plan requires
that no file refers to them any more, and this file does.

## How this was checked

- Both files were read against the repository: `package.json`, `next.config.ts`, `prisma.config.ts`, `scripts/`,
  `.github/`, `src/lib/db.ts`, `src/lib/logger.ts`, the health route, `testing.md`, `tech.md`, `workflow.md`,
  `roadmap.md` and the Next.js documentation of the installed version.
- The risky assumptions were tried out in a copy of the project outside the repository and in a throwaway pod, with
  Next.js 16.4.6, Prisma 7.10.1, PostgreSQL 18.6, `docker.io/library/node:26-slim` (Node.js 26.13.1, Debian 13) and
  Podman 6.2.0 (server 6.1.4) on `linux/arm64`:
  - `next build` with `output: "standalone"` creates `.next/standalone` (51 MB) with a `server.js` that reads `PORT`
    and `HOSTNAME`
  - `prisma` and `dotenv`, installed into a directory of their own together with `prisma.config.ts` and `prisma/`,
    apply the six migrations to an empty database as the user `node` on a read-only file system
  - the standalone server, started as the user `node` on a read-only file system, answers `/api/health` with 200 and
    `{"status":"ok"}`, `/folders` with 200 and a referenced `/_next/static/` file with 200
- Not tried: the `Containerfile` itself, the workflow on GitHub, Podman on the `ubuntu-24.04` runner and `linux/amd64`.
- The pod and its containers were removed afterwards. The image `docker.io/library/node:26-slim` is still in the
  local Podman storage.

## Major

### issue: The wrong-password check of the smoke test cannot fail

- Location: `container-image-steps.md`, "Smoke test" → "Test"
- Severity: Major
- Category: tests
- Problem: the step checks the failing migration "by running the script with a wrong database password for the
  application container". In the pod the application reaches PostgreSQL over `127.0.0.1`, and the PostgreSQL image
  accepts every connection from the loopback address without a password. The migration therefore succeeds with a
  wrong password.
- Impact: the "Test" item cannot be verified, so the step is not done and the whole plan stops there (`workflow.md`,
  "When a step cannot be finished"). The smoke test also never proves that the password of `DATABASE_URL` is used
  at all.
- Evidence:
  - "check it once by running the script with a wrong database password for the application container"
  - in a pod, `psql -h 127.0.0.1` with `PGPASSWORD=wrong-password` connected, and `prisma migrate deploy` with a wrong
    password in `DATABASE_URL` ended with "No pending migrations to apply." and exit code 0
  - `pg_hba_file_rules` of the image: `host all all 127.0.0.1 trust`, and only `host all all all scram-sha-256` for
    other addresses
- Suggestion (required): provoke the failure with something that fails on the loopback address as well, for example a
  port on which nothing listens. That was tried: `prisma migrate deploy` ends with `P1001` and exit code 1.
- Reference: the description of the official PostgreSQL image on Docker Hub, note on trust authentication for local
  connections.

### issue: Inside a pod Podman overwrites `HOSTNAME`, and the server no longer listens on all interfaces

- Location: `container-image-requirements.md`, "Image" and "Configuration"; `container-image-steps.md`, "Image" →
  "Build" (the `app` stage) and "Smoke test" → "Build"
- Severity: Major
- Category: correctness
- Problem: the standalone `server.js` binds to `process.env.HOSTNAME`. The plan sets `HOSTNAME=0.0.0.0` in the image
  and documents `HOSTNAME` as a variable of the container. Podman sets `HOSTNAME` to the name of the pod for every
  container in a pod, also when the image or `--env` sets another value. The server then binds to the address of the
  pod only, not to `0.0.0.0` and not to `127.0.0.1`.
- Impact: a reverse proxy in the same pod (the environment the requirements ask for) or a health check run inside the
  container gets "connection refused" on `localhost:3000`. The smoke test does not notice it, because the published
  port still reaches the address of the pod; so it passes while a requirement is not met. Other environments that set
  `HOSTNAME` themselves can behave the same way.
- Evidence:
  - "The server listens on all interfaces, port 3000." and "Optional variables: `PORT` (default 3000) and `HOSTNAME`
    (default `0.0.0.0`)."
  - `podman run --pod … --env HOSTNAME=0.0.0.0 … printenv HOSTNAME` prints the name of the pod; without the pod it
    prints `0.0.0.0`
  - the server started that way logs `Local: http://hw-spec-review:3000`, and its only listening socket on port 3000
    is `10.88.0.155:3000`
- Suggestion (required): let `image-start.sh` set the address itself, right before `exec node server.js`, and take
  `HOSTNAME` out of the configuration variables. Add a check to the smoke test that requests `/api/health` on
  `127.0.0.1:3000` from inside the application container.

## Minor

### issue: The "Image" step starts no container of the image

- Location: `container-image-steps.md`, "Image" → "Goal" and "Test"
- Severity: Minor
- Category: tests
- Problem: the goal of the step says that a container "migrates its database and then serves the wiki", but its
  "Test" items only build and inspect the image. The first container starts in the next step.
- Impact: the step is ticked off and committed with a `Containerfile` that may not start. A mistake in the layout
  (the location of `prisma.config.ts`, the path of the Prisma CLI, a script that is not executable) shows only in the
  smoke test step, which then has to repair the step before it.
- Evidence: "No unit, integration or end-to-end tests: the step adds no application code. The smoke test of the next
  step covers the image."
- Suggestion (optional): add a check that needs no database: a container started with `./image-migrate.sh` and
  without `DATABASE_URL` must exit with a non-zero code and with the message of Prisma about the missing URL. In the
  trial that was "The datasource.url property is required in your Prisma config file when using prisma migrate
  deploy." with exit code 1. It proves that the CLI, the configuration file and `dotenv` are found.

### issue: The command that only migrates is never run

- Location: `container-image-requirements.md`, "Start and database setup" and "Smoke test";
  `container-image-steps.md`, "Smoke test" → "Build"
- Severity: Minor
- Category: tests
- Problem: the requirements ask for "a command that only applies the migrations and exits", and the README documents
  it. Neither the smoke test of the requirements nor the one of the plan starts a container with that command.
- Impact: the command can break without anyone noticing, for example when the working directory or the path of the
  script changes. It is found when the migration is to become a step of its own.
- Evidence: the smoke test starts the image twice with its default command; `./image-migrate.sh` appears only in
  "Image" → "Build".
- Suggestion (optional): run `./image-migrate.sh` once in the smoke test against the migrated database and require
  exit code 0, and add the line to "Smoke test" in the requirements.

### issue: The standalone output contains `.env`; only `.containerignore` keeps it out of the image

- Location: `container-image-steps.md`, "Image" → "Build" (`.containerignore`, the `build` and `app` stages);
  `container-image-requirements.md`, "Image"
- Severity: Minor
- Category: security
- Problem: `next build` copies a `.env` file of the project into `.next/standalone`, and the `app` stage copies that
  folder as a whole. The plan lists `.env` among many entries of `.containerignore` and does not say that this entry
  is what keeps the credentials out of the image. `.containerignore` is read by Podman only; Docker ignores it.
- Impact: when the entry is lost or the image is built with Docker, the `.env` of the development machine ends up
  in the image, against "The image contains no credentials, no `.env` file and no database address". Locally that is
  the development password; the risk grows once a `.env` with real values lies next to the sources.
- Evidence: after `HIPPOWIKI_OUTPUT=standalone next build` in a copy with a `.env` file, `.next/standalone/.env`
  existed (374 bytes, the size of the original).
- Suggestion (required): say in the plan why the entry matters. Keep the "Test" item that the image contains no
  `.env`, and let the `build` stage fail when `.next/standalone/.env` exists.
- Alternatives: also add the check to the smoke test, so that CI repeats it for every image.

### issue: The dependencies of the migration tools are not pinned

- Location: `container-image-steps.md`, "Image" → "Build" (the `migrate-tools` stage)
- Severity: Minor
- Category: security
- Problem: the plan installs `prisma` and `dotenv` in the versions of `package-lock.json` and concludes that "the
  image always uses the versions of the project". That holds for these two packages only. Their dependencies are
  resolved anew at every build, without a lock file.
- Impact: two builds of the same commit can contain different packages. A broken or malicious release of one of
  these dependencies reaches the image without any change in the repository, and the migration runs with the full
  rights of the database user.
- Evidence: "Their versions are read from `package-lock.json` during the build, so the image always uses the versions
  of the project"; the trial installation of `prisma@7.10.1` and `dotenv@18.0.10` added 137 packages.
- Suggestion (optional): decide it knowingly. Either accept it and say so in "Decisions", or keep a small
  `package.json` with its lock file for the migration tools in the repository, installed with `npm ci`, and let the
  build fail when its versions differ from the ones of the project.
- Alternatives: copy the complete `node_modules` of the `deps` stage. That is pinned by the lock file, but far
  larger.

### issue: The schema engine depends on an install script

- Location: `container-image-steps.md`, "Image" → "Build" (the `migrate-tools` and `deps` stages)
- Severity: Minor
- Category: correctness
- Problem: the binary that `prisma migrate deploy` needs is downloaded by the `postinstall` script of
  `@prisma/engines`. npm 11.20.0, which the Node.js image and the development machine have, already warns about
  such scripts. What a later npm version does with them was not checked.
- Impact: if the script does not run, the image is built without the engine, and nothing in the "Image" step notices
  it. Prisma then tries to download the engine when the container starts, as the user `node` and from the
  environment of the host, which fails on a host without access to the internet.
- Evidence: "npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
  prisma@7.10.1 (preinstall …), @prisma/engines@7.10.1 (postinstall …)". With npm 11.20.0 the scripts still ran and
  the engine was there.
- Suggestion (optional): let the `migrate-tools` stage fail when no `schema-engine-*` file exists in
  `node_modules/@prisma/engines`.

### issue: The migration tools are five times the size of the application

- Location: `container-image-requirements.md`, "Decisions"; `container-image-steps.md`, "Image" → "Build"
- Severity: Minor
- Category: performance
- Problem: "Decisions" names "a larger image" as the price of the single image, without a number. In the trial the
  directory with `prisma` and `dotenv` had 256 MB, next to 51 MB for the standalone application. Most of it is not
  needed for `migrate deploy` (Prisma Studio, the local development database, `effect`).
- Impact: every pull on the pre-production host and every CI run moves about 300 MB on top of the base image instead
  of about 50 MB. The decision for one image was taken without this number.
- Evidence: "The price is a larger image, because it carries the Prisma CLI."; `du`: `@prisma/studio-core` 43 MB,
  `prisma` 40 MB, `effect` 33 MB, `@electric-sql` 27 MB, `@prisma/engines` 23 MB, `@prisma/dev` 19 MB.
- Suggestion (optional): write the measured size into "Decisions", so that the price is known. Keep the decision if
  the size is acceptable for a pre-production environment.

### issue: The `build` stage can lose the generated Prisma client

- Location: `container-image-steps.md`, "Image" → "Build" (the `deps` and `build` stages)
- Severity: Minor
- Category: docs
- Problem: `prisma generate` runs in the `deps` stage and writes the client to `src/generated`. The plan keeps
  `src/generated` out of the build context and does not say how the client reaches the `build` stage. When that stage
  takes only `node_modules` from `deps`, which is the usual pattern, the client is missing.
- Impact: `npm run build` fails in the image build with an import that cannot be resolved. It is found at once, but
  the plan gives no direction.
- Evidence: "`build`: copies the sources and runs `npm run build`"; `.containerignore` lists `src/generated`.
- Suggestion (optional): say that the `build` stage starts from the `deps` stage, or that it takes `src/generated`
  from it.

### issue: `latest` follows the publishing of a release only

- Location: `container-image-requirements.md`, "Publishing"; `container-image-steps.md`, "Release workflow" →
  "Build" and "Test"
- Severity: Minor
- Category: correctness
- Problem: the workflow runs for the `release` type `published` and moves `latest` when the release is not a
  pre-release at that moment. Three cases are not covered:
  - a pre-release that is later changed to a release sends `released` and `edited`, not `published`, so `latest` does
    not move (taken from the GitHub documentation, not tried)
  - a release for an older version line, published after a newer one, moves `latest` back
  - a release whose tag name is `latest` passes the tag check; as a pre-release it moves `latest` all the same
- Impact: the usual way of testing a pre-release on the pre-production host and then promoting it leaves `latest` on
  the release before. A host that pulls `latest` gets the wrong version in the first two cases.
- Evidence: "`release` with the type `published`"; "For a release that is not a pre-release, also push the image as
  `latest`."
- Suggestion (required): decide the first case and write it down: either a pre-release is never promoted (a new
  release is published instead), or the workflow also handles the promotion. Reject `latest` as a tag name in the tag
  check.
- Alternatives: do not publish `latest` at all and let the host name the tag. That is the simplest rule and fits a
  single pre-production host.
- Reference: GitHub documentation, "Events that trigger workflows", `release`.

### issue: The tag of the release is checked after it has been used

- Location: `container-image-steps.md`, "Release workflow" → "Build"
- Severity: Minor
- Category: error handling
- Problem: the check of the tag name is the first of the steps "after the smoke test", but "the version label of the
  image is the release tag", and labels are set when the image is built. An invalid tag is therefore used for the
  build first and rejected minutes later. The plan also does not say how the version and the commit reach
  `scripts/image.sh build`.
- Impact: a release with an invalid tag fails late instead of with "a clear message" at once, and an unchecked string
  reaches the build command.
- Evidence: "Steps only for the `release` event, after the smoke test"; "`org.opencontainers.image.revision` and
  `org.opencontainers.image.version` when the build knows them".
- Suggestion (required): check the tag before the build. Name the interface, for example two environment variables
  that `scripts/image.sh build` passes on with `podman build --label`.

### issue: The publishing path runs for the first time with a real release

- Location: `container-image-steps.md`, "Release workflow" → "Build" and "Test", "Wrap-up"
- Severity: Minor
- Category: tests
- Problem: the tag check, the login, the names of the image and the push exist only as steps of the workflow. Nothing
  of it can run before the plan is finished, pushed and wrapped up; the manual checks come after the step file and
  the requirements are deleted.
- Impact: a mistake in these steps shows when the first release is published. `container-image.md` then describes as
  built what never ran.
- Evidence: "Manual checks for the user, on GitHub after the push of the finished plan".
- Suggestion (optional): put the tag check and the building of the image reference into `scripts/image.sh` as
  commands of their own, which the workflow calls. They can then be tried locally with valid and invalid tags as a
  "Test" item, and only the login and the push stay untested.

### issue: Every run of the workflow can write packages

- Location: `container-image-steps.md`, "Release workflow" → "Build"
- Severity: Minor
- Category: security
- Problem: the job gets `packages: write` for every trigger, although only a release pushes. Runs for pushes and for
  pull requests from branches of the repository build and start code of that commit with a token that may write
  packages.
- Impact: a compromised dependency that runs during such a job could overwrite a published image, `latest` included.
  Pull requests from forks and from Dependabot are not affected; their token is read-only.
- Evidence: "Permissions: `contents: read` for the workflow, and `packages: write` in addition for the job."
- Suggestion (optional): check out with `persist-credentials: false` and pass the token only to the login step, so
  that the build and the smoke test never see it. Say in the plan that this is the reason.
- Alternatives: a second job for publishing, which alone has `packages: write`. It needs the image handed over as an
  artifact or built again, and it gives up the one job named like the workflow.

### issue: The smoke test depends on the wording of Prisma

- Location: `container-image-steps.md`, "Smoke test" → "Build"
- Severity: Minor
- Category: tests
- Problem: the second container must "say that no migrations were pending" in its log. That is the text "No pending
  migrations to apply." of the Prisma CLI, which is not a stable interface.
- Impact: a Prisma update that changes the sentence makes the smoke test fail, also in the weekly pull request of
  Dependabot, although the image is fine.
- Evidence: "Require that its log says that no migrations were pending".
- Suggestion (optional): compare the rows of `_prisma_migrations` before and after the second start, read with `psql`
  in the database container.

### issue: Nothing is said about a failed migration, a backup before an upgrade and a downgrade

- Location: `container-image-requirements.md`, "Start and database setup" and "What the environment has to provide"
- Severity: Minor
- Category: docs
- Problem: a new version of the image changes the database when it starts, without a question. The requirements say
  what happens when the migration fails (the container exits), but not what the operator does then, and not that a
  backup belongs before the start of a new version.
- Impact: a migration that fails halfway leaves the database marked as failed. Every further start exits, with a
  restart policy in a loop, until someone runs `prisma migrate resolve` by hand. An older image started against the
  newer database does not notice the difference and serves against tables it does not know.
- Evidence: "A new version of the image therefore updates the database when it starts."; backups appear only under
  "Not required".
- Suggestion (optional): add to "What the environment has to provide": a backup before a new version starts, no way
  back to an older image without that backup, and where to find the way out of a failed migration.
- Reference: Prisma documentation, "Failed migrations" in production troubleshooting.

### issue: Podman on the runner is two major versions older than on the development machine

- Location: `container-image-requirements.md`, "Decisions"; `container-image-steps.md`, "Release workflow" → "Build"
- Severity: Minor
- Category: correctness
- Problem: the image is built with Podman in CI "so that both use the same command". The command is the same, the
  program is not: the development machine has Podman 6.2, Ubuntu 24.04 ships the 4.9 series (not checked on a
  runner). The runner also works without root rights and on `linux/amd64`.
- Impact: a `Containerfile` or a pod command that works locally can fail on the runner or behave differently there,
  for example newer build instructions or the network of a pod. It is found only after the push of the finished plan.
- Evidence: "The image is built with Podman in CI as on the development machine, so that both use the same command."
- Suggestion (optional): keep the `Containerfile` to plain instructions, let the workflow print `podman version`, and
  name the first run on `main` as the place where the difference shows.

### question: Do parameters of `DATABASE_URL` mean the same for the migration and for the server?

- Location: `container-image-requirements.md`, "Configuration"
- Severity: Minor
- Category: correctness
- Problem: "The migration at the start and the server both read it", but with two different programs: the schema
  engine of Prisma and node-postgres behind `@prisma/adapter-pg`. Parameters such as `sslmode` or `schema` may be
  read differently by the two. This was not tried.
- Impact: with a database that requires TLS, the migration could succeed while the server cannot connect, or the
  other way round. The container then serves, and `/api/health` answers 503.
- Evidence: the form in the requirements, `postgresql://<user>:<password>@<host>:<port>/<database>`, has no
  parameters; `src/lib/db.ts` passes the URL to `PrismaPg` unchanged.
- Suggestion (optional): say whether parameters are supported. If the pre-production database needs TLS, try it
  before the plan starts.

## Nit

### nit: Small differences between the two files

- Location: `container-image-requirements.md`, "Publishing" and "Not required"; `container-image-steps.md`, "Scope"
  and "Release workflow" → "Build"
- Severity: Nit
- Category: docs
- Problem:
  - the plan has the trigger `workflow_dispatch`; "Publishing" names only pushes, pull requests and releases
  - "Not in" lists the `HEALTHCHECK` and the waiting for the database; "Not required" does not, the requirements say
    both in "Health" and in "Start and database setup"
- Impact: none for the implementation; a reader who compares the two lists looks for a difference in meaning.
- Evidence: "Triggers: `push` to `main`, `pull_request`, `workflow_dispatch` and `release`".
- Suggestion (optional): add the two entries to "Not required" and the manual start to "Publishing".

### nit: The wrap-up leaves sentences behind that are no longer true

- Location: `container-image-steps.md`, "Wrap-up" → "Build"
- Severity: Nit
- Category: docs
- Problem: the wrap-up names what to update in `testing.md` (the number of workflows, the new workflow, the second
  `docker` entry). Two sentences there become wrong and are not named: "Every workflow installs Node.js from `.nvmrc`
  and runs `npm ci`", and the Dependabot sentence, which already now names only `npm` and `github-actions`. In
  `roadmap.md` the entries "Container Health Check" and "Configuration via Environment Variables" stay, although the
  plan decides both for the image.
- Impact: small contradictions in the specification after the feature is finished.
- Evidence: "Update the section "Continuous integration" in `testing.md` (the number of workflows, the new workflow,
  the second `docker` entry of Dependabot)".
- Suggestion (optional): name the two sentences in the wrap-up, and say for the two roadmap entries whether they stay.

### nit: The OpenSSL package is probably not needed

- Location: `container-image-steps.md`, "Image" → "Build" (the `app` stage)
- Severity: Nit
- Category: performance
- Problem: the `app` stage installs "the system packages the Prisma schema engine needs and the slim image lacks,
  such as OpenSSL". `node:26-slim` already has `libssl.so.3`, and the migration ran in it without any further package.
- Impact: an `apt-get` layer that is not needed makes the build slower and the image larger.
- Evidence: `prisma migrate deploy` applied all migrations in `docker.io/library/node:26-slim` with the engine
  `schema-engine-linux-arm64-openssl-3.0.x`. Not tried on `linux/amd64`.
- Suggestion (optional): install a package only when the smoke test shows that it is missing.

### nit: Nothing keeps the base image and `.nvmrc` on the same major version

- Location: `container-image-requirements.md`, "Image"; `container-image-steps.md`, "Image" → "Build" (base image,
  Dependabot)
- Severity: Nit
- Category: docs
- Problem: "The Node.js major version is the one of `.nvmrc`", and Dependabot ignores major updates of the image for
  that reason. When `.nvmrc` changes, nothing reminds of the `Containerfile`. The file also names the Node.js image in
  several stages.
- Impact: the image keeps running an older Node.js than the tests after an upgrade.
- Evidence: "It ignores major updates of the Node.js image, because the major version changes together with
  `.nvmrc`."
- Suggestion (optional): let `scripts/image.sh build` compare the two major versions and fail when they differ. Name
  the Node.js image in one stage only, from which the others start.

### nit: The place of `prisma.config.ts` in the image is left open

- Location: `container-image-steps.md`, "Image" → "Build" (the `app` stage)
- Severity: Nit
- Category: docs
- Problem: the `app` stage gets "the directory of the `migrate-tools` stage together with `prisma.config.ts`,
  `prisma/schema.prisma` and `prisma/migrations`". `prisma.config.ts` imports `dotenv` and `prisma/config`, which are
  found only when the file lies in that directory or below it, and its paths to the schema and the migrations are
  relative to it.
- Impact: next to `server.js` the file cannot be loaded, and every start fails. The smoke test finds it.
- Evidence: in the trial the three lay in the directory of the tools, next to its `node_modules`, and the migration
  ran.
- Suggestion (optional): say that the configuration file and `prisma/` lie in the directory of the migration tools.
