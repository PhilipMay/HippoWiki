# HippoWiki – Container Image Requirements

What the container image of HippoWiki has to do, and why. The image is the way to run HippoWiki on a first
pre-production environment, outside the development machine. How it is built is planned in `container-image-steps.md`;
this file only says what is required. Nothing of it is built yet. The wrap-up step of that plan folds this file into
`container-image.md`, the description of the feature as built, and deletes it.

## Image

- There is one image. It contains the application and everything it needs to set up its database; there is no second
  image for the migrations.
- The image is built from a `Containerfile` in the project root. `scripts/Containerfile` keeps its role: it only pins
  the PostgreSQL image of the development and test databases.
- One command builds the image locally with Podman.
- The image contains no credentials, no `.env` file and no database address, also when a `.env` file lies next to the
  sources while the image is built.
- The application runs as a user without root rights.
- The server listens on all interfaces, port 3000, whatever the environment sets in `HOSTNAME`. Podman sets that
  variable to the name of the pod for every container in a pod.
- The Node.js major version is the one of `.nvmrc`. The build fails when the two differ.
- The published image is built for `linux/amd64`.

## Start and database setup

- When a container starts, it first applies the pending database migrations (`prisma migrate deploy`) and then starts
  the server.
- An empty database gets its tables this way. A first installation needs only the image, an empty PostgreSQL database
  and its address.
- Every later start applies only the migrations that are not applied yet, and none if there are none. A new version
  of the image therefore updates the database when it starts.
- When the migration fails, the container exits with an error and does not serve the wiki.
- The container finds out by itself whether its database needs a migration. There is no switch to skip the migration
  at the start.
- The same image has a command that only applies the migrations and exits, so that the migration can become a step
  of its own later without a second image.
- The container does not wait for the database. When the database is not reachable at the start, the container
  exits; the environment starts the database first or restarts the container.
- No sample data is inserted.

## Configuration

- `DATABASE_URL` is the only variable a container needs: `postgresql://<user>:<password>@<host>:<port>/<database>`.
  The migration at the start and the server both read it.
- The user and the password of the database are part of this URL. There are no separate variables for host, user,
  password and database name. Special characters in the password are percent-encoded.
- Only this form of the URL, without parameters, is supported and tested. The migration and the server read the URL
  with two different programs (the schema engine of Prisma and node-postgres), which may read parameters such as
  `sslmode` or `schema` differently.
- The URL is read when the container runs, never when the image is built. The build needs no database.
- Optional variable: `PORT` (default 3000).
- `HOSTNAME` is not a configuration variable. The server binds to the address in it, so the start script sets it to
  `0.0.0.0` itself, and a value from the environment has no effect.
- `NODE_ENV` is `production` in the image.
- The database is PostgreSQL in the version pinned in `scripts/Containerfile`. The database and its user are created
  outside HippoWiki. The user must be allowed to create tables, because the migrations run with it. The migrations
  need no database extensions.

## Health

- `/api/health` answers 200 with `{"status":"ok"}` while the database is reachable and 503 otherwise. The environment
  uses it as its health check; the image itself declares none.
- The route only checks that the database answers. That is enough: a container that serves has applied all migrations
  at its start, so it never runs against a database without its tables.

## Smoke test

- One command checks a built image against a throwaway database, locally and in CI alike:
  - started against an empty database, the container creates the tables and serves `/folders`
  - `/api/health` reports ok, through the published port and on `127.0.0.1:3000` inside the container
  - the static files of the application are served
  - the application does not run as root
  - the image contains no `.env` file
  - a second container, started against the migrated database, applies no migration and serves the wiki as well
  - the command that only applies the migrations, run against the migrated database, applies none and exits without
    an error
- The smoke test leaves no container behind and can run next to the development database, the test database and the
  development server.

## Publishing

- Every push to `main`, every pull request and a start by hand build the image and run the smoke test, without
  publishing anything.
- Publishing a release on GitHub, a pre-release included, builds the image, runs the smoke test and pushes the image
  to the GitHub Container Registry as `ghcr.io/<owner>/hippowiki:<tag>`. A draft does not.
- The tag of the image is the tag name of the release, unchanged. A release whose tag name is not a valid image tag,
  or is `latest`, fails with a clear message before the image is built.
- No `latest` tag is published. The host names the tag of the release it runs.
- Only an image that passed the smoke test is pushed.
- The image carries labels that link the package to the GitHub repository and name the release and its commit.

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
  the host may need a token that can read packages.
- A backup of the database before a container of a new version starts: the start changes the database without a
  question.
- No way back to an older image without that backup: an older image started against the database of a newer one does
  not notice the difference and serves against tables it does not know.
- A way out of a failed migration: a migration that fails halfway stays marked as failed in the database. Every
  further start then exits, with a restart policy in a loop, until someone resolves it by hand with
  `prisma migrate resolve` (Prisma documentation, "Failed migrations" in the production troubleshooting).

## Decisions

- One image that migrates at the start, instead of a separate migration image: comparable open source applications
  do it this way (Umami, Cal.com, Documenso, Linkwarden, Outline), and a first installation stays simple. The price is a
  larger image, because it carries the Prisma CLI: in a trial on `linux/arm64` the migration tools took 256 MB, next
  to 51 MB for the standalone application. Every pull therefore moves about 300 MB on top of the base image instead of
  about 50 MB, which is acceptable for a pre-production environment.
- No switch to skip the migration, although Umami, Outline and Formbricks have one: `prisma migrate deploy` finds out
  by itself whether migrations are pending and changes nothing when there are none. Without a switch the application
  can never serve from a database without its tables. If the migration becomes a step of its own later, the switch
  can be added then; the command that only migrates is already there.
- `DATABASE_URL` only: it is what Prisma and the Prisma-based applications among them use, and what the application
  and its tests already read. Applications in other ecosystems often take separate variables; that would only add a
  second way to configure the same thing.
- The Next.js standalone output is used for the image build only, so that `npm run start` and the end-to-end tests
  against a production build keep using `next start`.
- The image is built with Podman in CI as on the development machine, so that both use the same command. The command
  is the same, the program is not: the runner has an older Podman (the 4.9 series of Ubuntu 24.04, against 6 on the
  development machine), works without root rights and is `linux/amd64`. The `Containerfile` and the scripts
  therefore keep to what the older version knows.
- The migration tools in the image are `prisma` and `dotenv` in the versions of `package-lock.json`. Their own
  dependencies are not pinned and are resolved anew at every build, so two builds of the same commit can contain
  different packages. That is accepted for a pre-production image; a lock file of their own would be a second pin to
  keep up to date with every Prisma update.
- No `latest` tag: it would follow the publishing of a release only. A pre-release that is later changed to a release
  would not move it, and a release for an older version line would move it back. With the tag named by the host,
  the version that runs is always the one that was chosen.

## Not required

- deploying the image: a compose file, a reverse proxy, TLS, backups (candidates in `roadmap.md`)
- images for other platforms than `linux/amd64`
- more than one running instance
- a switch to skip the migration at the start
- waiting for the database at the start
- a `HEALTHCHECK` in the image
- a `latest` tag
- parameters in `DATABASE_URL`, such as `sslmode` or `schema`
- image signing, provenance attestations and vulnerability scans
- running the seed script in a container
- authentication
