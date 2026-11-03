# Deployment

This document defines how HippoWiki runs in production and for simple self-hosting.

## Where It Runs

- HippoWiki is independent of the Linux distribution. Everything runs in containers, with Podman or Docker, and nothing
  in the project depends on the host.
- Production is a NixOS host, set up in the [guide](../doc/nixos-keycloak-setup.md). It runs the same image as every
  other setup. What is specific to NixOS stays in the guide.
- `compose.yaml` is for development and simple self-hosting, on any distribution.

## Containers and Compose

- Container image built with uv from a `Containerfile` (multi-stage, slim runtime), with `podman build` or
  `docker build`. The container runs as a non-root user.
- `compose.yaml` with `app`, `postgres`, `keycloak` and a one-shot `migrate` service, run via `podman compose` or
  `docker compose`. The `migrate` service runs `hippowiki migrate` and then `hippowiki init`, and the app waits for it
  to succeed. The `postgres` service sets `timezone=UTC` on the server, see [Time](time.md), and uses the same
  `postgres:16-alpine` image as the tests, because Alpine and Debian images can sort text differently.
- Secrets, such as the database password, never go into `compose.yaml`. They come from an uncommitted `.env` file or
  from Podman secrets.

## Migrations and Initialization

- Alembic migrations run only through `hippowiki migrate`, never on app startup. They ship inside the package, and the
  command builds the Alembic configuration in code without an `alembic.ini`, so the slim runtime image needs nothing
  copied separately.
- `hippowiki init` runs after the migrations and creates the admin. It is idempotent, so it is safe to run on every
  deployment. The first deployment then needs one manual step: create the account in Keycloak and run
  `hippowiki link-admin <subject>`, see [Admin](users.md#admin).

## Keycloak Service

- It has its own database and its own role on the existing PostgreSQL server, so it can not read HippoWiki's tables.
- Its memory limit is 2 GB, as the [Keycloak container guide](https://www.keycloak.org/server/containers) recommends for
  smaller production deployments.
- The realm configuration is a versioned import file without secrets. Client secrets and the bootstrap admin password
  follow the same rule as the other secrets. The file only comes after the [Connector Test](roadmap.md#next-steps), and
  until then the realm is configured in the console.
- HippoWiki gets `HIPPOWIKI_OAUTH_ISSUER`, the public URL of the realm, `HIPPOWIKI_OAUTH_AUDIENCE`, the MCP URL, and
  `HIPPOWIKI_OAUTH_JWKS_URL`, so signing keys can be fetched inside the container network.

## Reverse Proxy Setup

- Traefik with TLS in front, required for remote MCP connectors. It routes the whole wiki hostname to the app, whose
  middleware rejects everything that is not allowed.
- MCP tool calls can answer as a stream, so the proxy must not cut a response before the slowest tool call ends. In
  Traefik the entry point setting `writeTimeout` covers the whole response. It has no limit by default, so leave it
  unset or above the slowest tool call. `readTimeout`, 60 seconds by default, bounds a slow upload.
- It sets no body limit. The auth middleware enforces the [Request Body Limit](limits.md#request-body-limit), rejects an
  unauthenticated request before it reads the body, and answers over the limit with problem+json.
  - The Traefik `buffering` middleware is not used. In Traefik 3.7 it holds back every response until it is complete,
    and the switch that turns this off can not be set from configuration files before Traefik 3.8.
  - A later proxy limit must not be below the request body limit, because a lower one would reject documents the app
    allows.
- It exposes Keycloak's login paths (`/realms/` and `/resources/`) and `/.well-known/`, which serves the RFC 8414
  metadata, but not its admin console.
- HippoWiki gets `HIPPOWIKI_MCP_ALLOWED_HOSTS`, the wiki hostname, and `HIPPOWIKI_MCP_ALLOWED_ORIGINS`, `https://` plus
  the wiki hostname, because an origin includes the scheme. Without them the SDK allows only localhost, so every request
  behind the proxy gets 421, see [Serving the MCP App](mcp.md#serving-the-mcp-app). The
  [Connector Test](roadmap.md#connector-test) shows whether a client sends an `Origin` at all.
- HippoWiki and Keycloak must both be reachable from the public internet, including Anthropic's range `160.79.104.0/21`,
  because Claude connects from there. A firewall in front of Keycloak can break the login.

## Health Checks and Backups

- Container and reverse proxy health checks use the [public health route](authentication.md#public-routes), so they need
  no credentials. The slim image has no `curl`, so the container health check calls the route with Python's standard
  library.
- Backups via standard PostgreSQL tooling (`pg_dump`), for both the HippoWiki and the Keycloak database, because the
  links in `users.auth_subject` only make sense together with the Keycloak accounts.
