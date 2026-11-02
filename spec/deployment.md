# Deployment

- Container image built with uv via `podman build` from a `Containerfile` (multi-stage, slim runtime). The container
  runs as a non-root user.
- `compose.yaml` with `app`, `postgres`, `keycloak` and a one-shot `migrate` service, run via `podman compose`, for
  development and simple self-hosting. The `migrate` service runs `hippowiki migrate` and then `hippowiki init`, and the
  app waits for it to succeed. The `postgres` service sets `timezone=UTC` on the server, see [Time](time.md), and uses
  the same `postgres:16-alpine` image as the tests, because Alpine and Debian images can sort text differently.
- Secrets, such as the database password, never go into `compose.yaml`. They come from an uncommitted `.env` file or
  from Podman secrets.
- Alembic migrations run only through `hippowiki migrate`, never on app startup. They ship inside the package, and the
  command builds the Alembic configuration in code without an `alembic.ini`, so the slim runtime image needs nothing
  copied separately.
- `hippowiki init` runs after the migrations and creates the root admin. It is idempotent, so it is safe to run on every
  deployment. The first deployment then needs one manual step: create the account in Keycloak and run
  `hippowiki link-root-admin <subject>`, see [Root Admin](users-and-rights.md#root-admin).
- Keycloak, see [Authentication](authentication.md):
  - It has its own database and its own role on the existing PostgreSQL server, so it can not read HippoWiki's tables.
  - Its memory limit is 2 GB, as the [Keycloak container guide](https://www.keycloak.org/server/containers) recommends
    for smaller production deployments.
  - The realm configuration is a versioned import file without secrets. Client secrets and the bootstrap admin password
    follow the same rule as the other secrets.
  - HippoWiki gets `HIPPOWIKI_OAUTH_ISSUER`, the public URL of the realm, `HIPPOWIKI_OAUTH_AUDIENCE`, the MCP URL, and
    `HIPPOWIKI_OAUTH_JWKS_URL`, so signing keys can be fetched inside the container network.
- Reverse proxy with TLS (e.g. Caddy or Traefik) in front, required for remote MCP connectors. MCP tool calls can answer
  as a stream, so its idle timeout has to be longer than the slowest tool call, and it needs a body limit that matches
  the [Request Body Limit](authentication.md#request-body-limit). It exposes Keycloak's login paths (`/realms/` and
  `/resources/`), but not its admin console.
- HippoWiki and Keycloak must both be reachable from the public internet, including Anthropic's range `160.79.104.0/21`,
  because Claude connects from there. A firewall in front of Keycloak can break the login.
- Container and reverse proxy health checks use the [public health route](authentication.md#public-routes), so they need
  no credentials. The slim image has no `curl`, so the container health check calls the route with Python's standard
  library.
- Backups via standard PostgreSQL tooling (`pg_dump`), for both the HippoWiki and the Keycloak database, because the
  links in `users.auth_subject` only make sense together with the Keycloak accounts.
