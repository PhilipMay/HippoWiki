# Deployment

- Container image built with uv via `podman build` from a `Containerfile` (multi-stage, slim runtime). The container runs
  as a non-root user.
- `compose.yaml` with `app`, `postgres` and a one-shot `migrate` service, run via `podman compose`, for development and
  simple self-hosting. The `migrate` service runs `hippowiki migrate` and then `hippowiki init`, and the app waits for it
  to succeed. The `postgres` service sets `timezone=UTC` on the server, see [Time](time.md), and uses the same
  `postgres:16-alpine` image as the tests, because Alpine and Debian images can sort text differently.
- Secrets, such as the database password, never go into `compose.yaml`. They come from an uncommitted `.env` file or from
  Podman secrets.
- Alembic migrations run only through `hippowiki migrate`, never on app startup. They ship inside the package, and the
  command builds the Alembic configuration in code without an `alembic.ini`, so the slim runtime image needs nothing
  copied separately.
- `hippowiki init` runs after the migrations and creates the root admin. It is idempotent, so it is safe to run on every
  deployment.
- Reverse proxy with TLS (e.g. Caddy or Traefik) in front, required for remote MCP connectors. MCP tool calls can answer
  as a stream, so its idle timeout has to be longer than the slowest tool call, and it needs a body limit that matches the
  [Request Body Limit](auth-middleware.md#request-body-limit).
- Container and reverse proxy health checks use the public health route, so they need no credentials. It reports
  liveness only, see [Auth Middleware](auth-middleware.md#public-routes). The slim image has no `curl`, so the container
  health check calls the route with Python's standard library.
- Backups via standard PostgreSQL tooling (`pg_dump`).
