# Configuration and Failure Modes

This document collects what has to be configured for each component and how it can fail. It adds no new rules: the rules
stay in the documents it links to, and open items of the specification stay in the [Roadmap](roadmap.md).

## Values That Must Match

Most failures come from values that have to match across components. Each component can look healthy on its own while
logins or requests still fail.

| Value                     | Must match between                                                                                                                          | If it does not match                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Issuer                    | Keycloak's public hostname and `HIPPOWIKI_OAUTH_ISSUER`                                                                                     | Every token gets 401                                      |
| Audience                  | Keycloak's Audience mapper, `HIPPOWIKI_OAUTH_AUDIENCE`, the `resource` of the protected resource metadata and the URL entered in the client | 401, possibly from something as small as a trailing slash |
| Signing keys URL          | `HIPPOWIKI_OAUTH_JWKS_URL` and Keycloak's address inside the container network                                                              | 503, not 401, so it looks like an outage                  |
| Allowed hosts and origins | `HIPPOWIKI_MCP_ALLOWED_HOSTS`, `HIPPOWIKI_MCP_ALLOWED_ORIGINS` and the public hostname                                                      | 421 or 403, because the SDK default allows only localhost |
| Redirect URIs             | The Keycloak client and each product, see [Client Registration](connectors.md#client-registration)                                          | The login fails at Keycloak                               |
| Body limit                | Any limit on the reverse proxy and the app's 2 MiB, see [Request Body Limit](limits.md#request-body-limit)                                  | A lower proxy limit rejects documents the app allows      |
| User link                 | `users.auth_subject` and Keycloak's `sub`, see [User Linking](users.md#user-linking)                                                        | A valid login, but 401                                    |

## Components

### Keycloak

Configure:

- the realm, and one client per product with S256 PKCE required
- the Audience mapper and `offline_access`
- brute-force detection and login events
- the 2 GB memory limit

Keep off self-registration, username editing, dynamic client registration and the experimental features, see
[Client Registration](connectors.md#client-registration).

What can go wrong:

- The realm import is still untested, and it comes after the Connector Test, see [Roadmap](roadmap.md#next-steps).
- A firewall can block Claude's IP range and break the login, see [Deployment](deployment.md).
- The admin console can be exposed by accident.
- When Keycloak is down, existing access tokens work for at most 5 more minutes, and then clients are locked out, see
  [Token Check](authentication.md#token-check).

### Reverse Proxy

Configure:

- TLS and routes for both hostnames
- no body limit, because the app enforces it
- no timeout that cuts a response before the slowest tool call ends

What can go wrong, see [Deployment](deployment.md#reverse-proxy-setup):

- The Traefik `buffering` middleware holds back streamed MCP responses, so it is not used for a body limit.

### PostgreSQL and Alembic

Configure:

- separate databases and roles for HippoWiki and Keycloak
- `timezone=UTC`
- the same image as the tests

What can go wrong:

- Alpine and Debian images can sort text differently, which affects anything sorted by name.
- A naive datetime silently stores the wrong instant, see [Time](implementation-notes.md#asyncpg-notes).
- Restoring only one of the two databases breaks the user links, see [Deployment](deployment.md).

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
in as parameters, with RS256 as the only allowed algorithm.

What can go wrong:

- Using `BaseHTTPMiddleware` would break MCP streaming, see [Request Handling](authentication.md#request-handling).
- Answering 401 instead of 503 during an outage makes clients discard valid credentials, see
  [Failed Credential Lookup](authentication.md#failed-credential-lookup).
- A clock difference over the [leeway](limits.md#token-check-values) rejects fresh tokens with 401.

### Container, Podman and Secrets

Configure:

- a non-root user
- an uncommitted `.env` file or Podman secrets
- the `migrate` service running before the app

What can go wrong:

- `hippowiki link-admin` is a manual step on the first deployment and is easy to miss, see [Admin](users.md#admin).
- Everyone re-enters the shared client secret when it is replaced, see
  [Client Registration](connectors.md#client-registration).

## Risks Not Settled Yet

The specification does not settle these yet. Points marked "to check" come from general knowledge of the tools and have
to be checked against the versions in use.

- **Login loop**: a valid token with no linked user, or of a deactivated user, gets 401, which tells MCP clients to log
  in again. [Admin Account on MCP](authentication.md#admin-account-on-mcp) avoids this for the admin with a 403, but not
  for these two cases. The user logs in successfully and is sent straight back to log in. The
  [Connector Test](roadmap.md#connector-test) will probably run into this, because it needs an unlinked and a
  deactivated user.
- **Health check hides outages**: `/health` is liveness only, so it stays green while every authenticated request gets
  503\. Database monitoring is an open point in the [Roadmap](roadmap.md), and Keycloak needs the same.
- **Recreating the realm**: new accounts get new `sub` values, so all user links break, including the admin's.
- **Refresh token rotation**: the [Keycloak guide](../doc/nixos-keycloak-setup.md) turns on "Revoke refresh token" with
  "Refresh token max reuse" set to 0, so a retry or two parallel refreshes can log a connector out. With access tokens
  of 5 minutes, refreshes happen often, and the [Connector Test](roadmap.md#connector-test) checks this with Claude.
- **Rollbacks**: migrations run separately from the app, so an older image may meet a newer schema. No rollback path is
  defined.
- **Connection pool**: the pool size and `max_connections` are not specified. Stale connections after a database restart
  can cause 500s unless the pool checks them first.
- **`podman compose` providers**: to check: it hands off to another compose tool, and these can differ in how they
  support waiting for the `migrate` service to finish.
- **Upgrades**: moving to a new PostgreSQL major version needs a data migration, and Keycloak is pinned to one exact
  version, so neither upgrade is a simple change of the image.
