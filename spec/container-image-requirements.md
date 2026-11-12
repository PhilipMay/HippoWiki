# HippoWiki – Container Image Requirements

What the container image of HippoWiki has to do, and why. The image is the way to run HippoWiki on a first
pre-production environment, outside the development machine. How it is built is planned in `container-image-steps.md`;
this file only says what is required. Nothing of it is built yet.

## Image

- There is one image. It contains the application and everything it needs to set up its database; there is no second
  image for the migrations.
- The image is built from a `Containerfile` in the project root. `scripts/Containerfile` keeps its role: it only pins
  the PostgreSQL image of the development and test databases.
- One command builds the image locally with Podman.
- The image contains no credentials, no `.env` file and no database address.
- The application runs as a user without root rights.
- The server listens on all interfaces, port 3000.
- The Node.js major version is the one of `.nvmrc`.
- The published image is built for `linux/amd64`.

## Start and database setup

- When a container starts, it first applies the pending database migrations (`prisma migrate deploy`) and then starts
  the server.
- An empty database gets its tables this way. A first installation needs only the image, an empty PostgreSQL database
  and its address.
- Every later start applies only the migrations that are not applied yet, and none if there are none. A new version
  of the image therefore updates the database when it starts.
- When the migration fails, the container exits with an error and does not serve the wiki.
- `HIPPOWIKI_SKIP_MIGRATION=true` skips the migration at the start.
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
- The URL is read when the container runs, never when the image is built. The build needs no database.
- Optional variables: `PORT` (default 3000), `HOSTNAME` (default `0.0.0.0`) and `HIPPOWIKI_SKIP_MIGRATION`.
- `NODE_ENV` is `production` in the image.
- The database is PostgreSQL in the version pinned in `scripts/Containerfile`. The database and its user are created
  outside HippoWiki. The user must be allowed to create tables, because the migrations run with it. The migrations
  need no database extensions.

## Health

- `/api/health` answers 200 with `{"status":"ok"}` while the database is reachable and 503 otherwise. The environment
  uses it as its health check; the image itself declares none.
- The route only checks that the database answers. A container started with `HIPPOWIKI_SKIP_MIGRATION=true` against a
  database without the tables reports ok.

## Smoke test

- One command checks a built image against a throwaway database, locally and in CI alike:
  - started against an empty database, the container creates the tables and serves `/folders`
  - `/api/health` reports ok
  - the static files of the application are served
  - the application does not run as root
  - a start with `HIPPOWIKI_SKIP_MIGRATION=true` against the migrated database serves the wiki as well
- The smoke test leaves no container behind and can run next to the development database, the test database and the
  development server.

## Publishing

- Every push to `main` and every pull request builds the image and runs the smoke test, without publishing anything.
- Publishing a release on GitHub, a pre-release included, builds the image, runs the smoke test and pushes the image
  to the GitHub Container Registry as `ghcr.io/<owner>/hippowiki:<tag>`. A draft does not.
- The tag of the image is the tag name of the release, unchanged. A release whose tag name is not a valid image tag
  fails with a clear message.
- `latest` moves only to a release that is not a pre-release.
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

## Decisions

- One image that migrates at the start, instead of a separate migration image: comparable open source applications
  do it this way (Umami, Cal.com, Documenso, Linkwarden, Outline), and a first installation stays simple. The switch
  to skip the migration follows Umami, Outline and Formbricks. The price is a larger image, because it carries the
  Prisma CLI.
- `DATABASE_URL` only: it is what Prisma and the Prisma-based applications among them use, and what the application
  and its tests already read. Applications in other ecosystems often take separate variables; that would only add a
  second way to configure the same thing.
- The Next.js standalone output is used for the image build only, so that `npm run start` and the end-to-end tests
  against a production build keep using `next start`.
- The image is built with Podman in CI as on the development machine, so that both use the same command.

## Not required

- deploying the image: a compose file, a reverse proxy, TLS, backups (candidates in `roadmap.md`)
- images for other platforms than `linux/amd64`
- more than one running instance
- image signing, provenance attestations and vulnerability scans
- running the seed script in a container
- authentication
