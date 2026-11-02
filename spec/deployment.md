# Deployment

- Container image built with uv via `podman build` from a `Containerfile` (multi-stage, slim runtime).
- `compose.yaml` with `app`, `postgres` and a one-shot `migrate` service, run via `podman compose`, for development and
  simple self-hosting. The `migrate` service runs `hippowiki migrate` and then `hippowiki init`, and the app waits for it
  to succeed. The `postgres` service sets `timezone=UTC` on the server, see [Time](time.md).
- Alembic migrations run only through `hippowiki migrate`, never on app startup. They ship inside the package, and the
  command builds the Alembic configuration in code without an `alembic.ini`, so the slim runtime image needs nothing
  copied separately.
- `hippowiki init` runs after the migrations and creates the root admin. It is idempotent, so it is safe to run on every
  deployment.
- Reverse proxy with TLS (e.g. Caddy or Traefik) in front, required for remote MCP connectors.
- Container and reverse proxy health checks use the public health route, so they need no credentials. It reports
  liveness only, see [Architecture](architecture.md).
- Backups via standard PostgreSQL tooling (`pg_dump`).
