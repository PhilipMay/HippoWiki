# Deployment

This document defines how HippoWiki runs in production and for simple self-hosting.

## Where It Runs

- HippoWiki is independent of the Linux distribution. Everything runs in containers, with Podman or Docker, and nothing
  in the project depends on the host.
- Production is a NixOS host, set up in the [guide](../doc/nixos-setup.md). It runs the same image as every other setup.
  What is specific to NixOS stays in the guide.
- The app is one process, because the [login protection](oauth-server.md#login-protection) counts failures per address
  and limits hashes in memory. Uvicorn runs with its default of one worker.
- `compose.yaml` is for development and simple self-hosting, on any distribution.

## Containers and Compose

- Container image built with uv from a `Containerfile` (multi-stage, slim runtime), with `podman build` or
  `docker build`. The container runs as a non-root user.
- `compose.yaml` with `app`, `postgres` and a one-shot `migrate` service, run via `podman compose` or `docker compose`.
  The `migrate` service runs `hippowiki migrate` and then `hippowiki init`, and the app waits for it to succeed. The
  `postgres` service sets `timezone=UTC` on the server, see [Time](time.md), and uses the same `postgres:16-alpine`
  image as the tests, because Alpine and Debian images can sort text differently.
- Secrets, such as the database password, never go into `compose.yaml`. They come from an uncommitted `.env` file or
  from Podman secrets.

## Migrations and Initialization

- Alembic migrations run only through `hippowiki migrate`, never on app startup. They ship inside the package, and the
  command builds the Alembic configuration in code without an `alembic.ini`, so the slim runtime image needs nothing
  copied separately.
- `hippowiki init` runs after the migrations and creates the admin. It is idempotent, so it is safe to run on every
  deployment. The first deployment then needs manual steps on the server: `hippowiki set-admin-password`, and
  `hippowiki client add --name admin-script --user admin` for a script client, because REST is the only way to
  administer the system. Run these with `podman exec` in the running container, because the output of `podman run` can
  end up in the journal, and it holds a secret, see [Admin](users.md#admin).

## OAuth Server Settings

- HippoWiki gets `HIPPOWIKI_PUBLIC_URL`, see [Settings](oauth-server.md#settings). It is the one value that names the
  issuer, the MCP URL and the metadata, so these can not disagree.
- `HIPPOWIKI_OAUTH_TRUSTED_CLIENT_URLS` keeps its default unless a [Trusted Client](oauth-server.md#trusted-clients)
  changes its URL.
- The app needs outgoing `https` access to the hosts of these URLs, and only those, to fetch their documents.
- The container memory has to leave room for the [running hashes](limits.md#oauth-values), about 256 MiB.

## Reverse Proxy Setup

- Traefik with TLS in front, required for remote MCP connectors. It routes the whole hostname to the app, whose
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
- It passes the real client address in `X-Forwarded-For`, for the [login protection](oauth-server.md#login-protection).
  Uvicorn runs with `--proxy-headers` and `--forwarded-allow-ips` set to the address the proxy connects from, so the app
  trusts this header only from the proxy. [Uvicorn](https://uvicorn.dev/settings/) accepts a subnet there. To check:
  what address Podman shows for the proxy.
- HippoWiki gets `HIPPOWIKI_MCP_ALLOWED_HOSTS`, the hostname, and `HIPPOWIKI_MCP_ALLOWED_ORIGINS`, `https://` plus the
  hostname, because an origin includes the scheme. Without them the SDK allows only localhost, so every request behind
  the proxy gets 421, see [Serving the MCP App](mcp.md#serving-the-mcp-app). The
  [Connector Test](roadmap.md#connector-test) shows whether a client sends an `Origin` at all.
- HippoWiki must be reachable from the public internet, including Anthropic's range `160.79.104.0/21`, because Claude
  connects from there. A firewall in front of it can break the login.

## Health Checks and Backups

- Container and reverse proxy health checks use the [public health route](authentication.md#public-routes), so they need
  no credentials. The slim image has no `curl`, so the container health check calls the route with Python's standard
  library.
- Backups via standard PostgreSQL tooling (`pg_dump`), of the one database. It holds password hashes and token hashes,
  so a backup needs the same protection as the live database.
