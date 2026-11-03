# Configuration and Failure Modes

This document collects what has to be configured for each component and how it can fail. It adds no new rules: the rules
stay in the documents it links to, and open items of the specification stay in the [Roadmap](roadmap.md).

## Values That Must Match

Some failures come from values that have to match across components. Each component can look healthy on its own while
requests still fail.

| Value      | Must match between                                                                                         | If it does not match                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Body limit | Any limit on the reverse proxy and the app's 2 MiB, see [Request Body Limit](limits.md#request-body-limit) | A lower proxy limit rejects documents the app allows |

## Components

### Login

Configure the admin password on the server, see [Admin](users.md#admin).

What can go wrong:

- `hippowiki set-admin-password` is a manual step on the first deployment and is easy to miss, so nobody can administer
  the system yet.
- Hashing needs memory, so a tight container limit can kill the app during logins, see
  [Migrations and Initialization](deployment.md#migrations-and-initialization).
- One wrong password per wait keeps a known account from logging in, see
  [Login Protection](authentication.md#login-protection).
- The clock of the app host does not matter for sessions, because the database compares all times, see [Time](time.md).

### Reverse Proxy

Configure:

- TLS and the route of the hostname
- no body limit, because the app enforces it

### PostgreSQL and Alembic

Configure:

- a separate role for HippoWiki
- `timezone=UTC`
- the same image as the tests

What can go wrong:

- Alpine and Debian images can sort text differently, which affects anything sorted by name.
- A naive datetime silently stores the wrong instant, see [asyncpg Notes](implementation-notes.md#asyncpg-notes).
- A restored backup brings back old sessions that were ended since, until they expire.

### SQLAlchemy

Configure `expire_on_commit=False`, `eager_defaults=True` and `DateTime(timezone=True)`.

What can go wrong: without these settings the code gets `MissingGreenlet` errors or naive datetimes, see
[SQLAlchemy Notes](implementation-notes.md#sqlalchemy-notes).

### Auth Middleware

Configure the credential check, the public routes and the body limit, which are passed in as parameters.

What can go wrong:

- Answering 401 instead of 503 during an outage makes clients discard valid credentials, see
  [Failed Credential Lookup](authentication.md#failed-credential-lookup).

### Container, Podman and Secrets

Configure:

- a non-root user
- an uncommitted `.env` file or Podman secrets
- the `migrate` service running before the app

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
