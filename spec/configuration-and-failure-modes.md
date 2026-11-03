# Configuration and Failure Modes

This document collects what has to be configured for each component and how it can fail. It adds no new rules: the rules
stay in the documents it links to, and open items of the specification stay in the [Roadmap](roadmap.md).

## Values That Must Match

Most failures come from values that have to match across components. Each component can look healthy on its own while
logins or requests still fail.

| Value                     | Must match between                                                                                                   | If it does not match                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Public URL                | `HIPPOWIKI_PUBLIC_URL`, the URL of the proxy and the MCP URL entered in the client                                   | The client rejects the metadata, or `invalid_target`                |
| Allowed hosts and origins | `HIPPOWIKI_MCP_ALLOWED_HOSTS`, `HIPPOWIKI_MCP_ALLOWED_ORIGINS` and the public hostname                               | 421 or 403, because the SDK default allows only localhost           |
| Trusted client URLs       | `HIPPOWIKI_OAUTH_TRUSTED_CLIENT_URLS` and the `client_id` a product sends                                            | The error page instead of the login page                            |
| Proxy address             | `--forwarded-allow-ips` and the address the proxy connects from, see [Deployment](deployment.md#reverse-proxy-setup) | All logins count as one address, so one attacker can block them all |
| Body limit                | Any limit on the reverse proxy and the app's 2 MiB, see [Request Body Limit](limits.md#request-body-limit)           | A lower proxy limit rejects documents the app allows                |

## Components

### OAuth Server

Configure:

- `HIPPOWIKI_PUBLIC_URL`, and the allowlist only when a vendor changes its URL
- the admin password and a script client, on the server, see [Admin](users.md#admin)
- outgoing `https` access to the hosts of the allowlist

What can go wrong:

- A vendor changes its document or URL, so its product stops logging in, see [Open Risks](oauth-server.md#open-risks).
- A vendor is down with no document in the cache after a restart. New logins of that product fail, and clients that are
  logged in keep working, see [Trusted Clients](oauth-server.md#trusted-clients).
- The app has no outgoing network access, which has the same result for every product.
- `--forwarded-allow-ips` is wrong, so the failures of all users count against one address, see
  [Login Protection](oauth-server.md#login-protection).
- A public client retries a refresh after the [grace window](limits.md#oauth-values), which logs it out.
- Hashing needs memory, so a tight container limit can kill the app during logins, see
  [OAuth Server Settings](deployment.md#oauth-server-settings).
- The clock does not matter for tokens, because the database compares all times, see [Tokens](oauth-server.md#tokens).

### Reverse Proxy

Configure:

- TLS and the route of the hostname
- the forwarded client address
- no body limit, because the app enforces it
- no timeout that cuts a response before the slowest tool call ends

What can go wrong, see [Deployment](deployment.md#reverse-proxy-setup):

- The Traefik `buffering` middleware holds back streamed MCP responses, so it is not used for a body limit.

### PostgreSQL and Alembic

Configure:

- a separate role for HippoWiki
- `timezone=UTC`
- the same image as the tests

What can go wrong:

- Alpine and Debian images can sort text differently, which affects anything sorted by name.
- A naive datetime silently stores the wrong instant, see [Time](implementation-notes.md#asyncpg-notes).
- A restored backup brings back old tokens that were ended since, until they expire.

### SQLAlchemy

Configure `expire_on_commit=False`, `eager_defaults=True` and `DateTime(timezone=True)`.

What can go wrong: without these settings the code gets `MissingGreenlet` errors or naive datetimes, see
[Time](implementation-notes.md#sqlalchemy-notes).

### MCP SDK

Configure:

- `stateless_http=True`
- the session manager in the FastAPI lifespan
- routes added directly rather than mounted

What can go wrong, see the [implementation notes](implementation-notes.md#mcp-sdk-notes):

- Mounting causes a 307 redirect on `POST /mcp`.
- A missing lifespan gives "Task group is not initialized".
- The tool wrapper depends on the SDK internal `fn_metadata.arg_model`, and the notes cite line numbers of `mcp` 2.3.0,
  so upgrades need care.
- Real clients may not accept the 405 on `GET`, which the [Connector Test](roadmap.md#connector-test) has to show.

### Auth Middleware

Configure the credential check, the MCP path, the public routes, the metadata URL and the body limit, which are passed
in as parameters.

What can go wrong:

- Using `BaseHTTPMiddleware` would break MCP streaming, see [Request Handling](authentication.md#request-handling).
- Answering 401 instead of 503 during an outage makes clients discard valid credentials, see
  [Failed Credential Lookup](authentication.md#failed-credential-lookup).

### Container, Podman and Secrets

Configure:

- a non-root user
- an uncommitted `.env` file or Podman secrets
- the `migrate` service running before the app

What can go wrong:

- `hippowiki set-admin-password` and the script client of the admin are manual steps on the first deployment and are
  easy to miss, see [Admin](users.md#admin).

## Risks Not Settled Yet

The specification does not settle these yet. Points marked "to check" come from general knowledge of the tools and have
to be checked against the versions in use.

- **Health check hides outages**: `/health` is liveness only, so it stays green while every authenticated request gets
  503\. Database monitoring is an open point in the [Roadmap](roadmap.md).
- **Rollbacks**: migrations run separately from the app, so an older image may meet a newer schema. No rollback path is
  defined.
- **Connection pool**: the pool size and `max_connections` are not specified. Stale connections after a database restart
  can cause 500s unless the pool checks them first.
- **`podman compose` providers**: to check: it hands off to another compose tool, and these can differ in how they
  support waiting for the `migrate` service to finish.
- **Upgrades**: moving to a new PostgreSQL major version needs a data migration, so it is not a simple change of the
  image.
