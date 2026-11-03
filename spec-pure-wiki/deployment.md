# Deployment

This document defines how HippoWiki runs in production and for simple self-hosting.

## Where It Runs

- HippoWiki is independent of the Linux distribution. Everything runs in containers, with Podman or Docker, and nothing
  in the project depends on the host.
- Production is a NixOS host, and runs the same image as every other setup. The [existing guide](../doc/nixos-setup.md)
  still describes the earlier plan, and is adapted in the [Deployment step](roadmap.md#next-steps).
- The app is one process, because the [limit on running hashes](authentication.md#login-protection) holds per process.
  Uvicorn runs with its default of one worker.
- `compose.yaml` is for development and simple self-hosting, on any distribution.
- How the web client is served is open, see [Web Client](roadmap.md#web-client).

## Containers and Compose

- Container image built with uv from a `Containerfile` (multi-stage, slim runtime), with `podman build` or
  `docker build`. The container runs as a non-root user.
- `compose.yaml` with `app`, `postgres` and a one-shot `migrate` service, run via `podman compose` or `docker compose`.
  The `migrate` service runs `hippowiki migrate` and then `hippowiki init`, and the app waits for it to succeed. The
  `postgres` service sets `timezone=UTC` on the server, see [Time](time.md), and uses the same `postgres:16-alpine`
  image as the tests, because Alpine and Debian images can sort text differently.
- In `compose.yaml`, `postgres` publishes no port and `app` binds to `127.0.0.1`, so nothing reaches the app without the
  proxy and its TLS.
- Secrets, such as the database password, never go into `compose.yaml`. They come from an uncommitted `.env` file or
  from Podman secrets.

## Migrations and Initialization

- Alembic migrations run only through `hippowiki migrate`, never on app startup. They ship inside the package, and the
  command builds the Alembic configuration in code without an `alembic.ini`, so the slim runtime image needs nothing
  copied separately.
- `hippowiki init` runs after the migrations and creates the admin. It is idempotent, so it is safe to run on every
  deployment. The first deployment then needs one manual step on the server: `hippowiki set-admin-password`, because
  REST is the only way to administer the system. Run it with `podman exec -it` in the running container, because it asks
  for the password on the terminal, see [Admin](users.md#admin).
- The container memory has to leave room for the [running hashes](limits.md#login-values), about 256 MiB.

## Reverse Proxy Setup

- Traefik with TLS in front, because a password and a token must never cross the network in clear text. It routes the
  whole hostname to the app, whose middleware rejects everything that is not allowed.
- It routes no plain HTTP to the app, and sets `Strict-Transport-Security`, because the app does not check for TLS
  itself.
- `readTimeout`, 60 seconds by default, bounds a slow upload. The entry point setting `writeTimeout` covers the whole
  response, so leave it unset or above the slowest request, such as a large folder revert.
- Its access log is the source of the client address, because the app does not log it, see
  [Login Protection](authentication.md#login-protection).
- It sets no body limit. The auth middleware enforces the [Request Body Limit](limits.md#request-body-limit), rejects an
  unauthenticated request before it reads the body, and answers over the limit with problem+json.
  - A later proxy limit must not be below the request body limit, because a lower one would reject documents the app
    allows.

## Health Checks and Backups

- Container and reverse proxy health checks use the [public health route](authentication.md#public-routes), so they need
  no credentials. The slim image has no `curl`, so the container health check calls the route with Python's standard
  library.
- Backups via standard PostgreSQL tooling (`pg_dump`), of the one database. It holds password hashes and token hashes,
  so a backup needs the same protection as the live database.
