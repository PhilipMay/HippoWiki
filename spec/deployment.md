# Deployment

- Container image built with uv via `podman build` from a `Containerfile` (multi-stage, slim runtime).
- `compose.yaml` with `app` and `postgres` services, run via `podman compose`, for development and simple
  self-hosting.
- Alembic migrations run on startup or via `hippowiki migrate`.
- Reverse proxy with TLS (e.g. Caddy or Traefik) in front, required for remote MCP connectors.
- Container and reverse proxy health checks use the public health route, so they need no credentials. It reports
  liveness only, see [Architecture](architecture.md).
- Backups via standard PostgreSQL tooling (`pg_dump`).
