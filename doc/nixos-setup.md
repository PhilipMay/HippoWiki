# HippoWiki on NixOS with Podman and Traefik

This guide prepares a NixOS host for HippoWiki: PostgreSQL in Podman, behind a Traefik that runs as the native
`services.traefik` and handles TLS. It follows the requirements in [Deployment](../spec/deployment.md) and
[OAuth Server](../spec/oauth-server.md). It also runs the temporary [Connector Test App](#connector-test-app) on the
same host.

## What You Get

- `postgres:16-alpine` with `timezone=UTC`, and a separate `hippowiki` database and role.
- Traefik routes the whole hostname to the app, which also serves the login page.
- Nothing but Traefik is reachable from the internet.

Replace these placeholders everywhere:

| Placeholder                    | Meaning                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| `wiki.example.org`             | public hostname of HippoWiki, with DNS pointing at the host |
| `https://wiki.example.org/mcp` | the MCP URL of HippoWiki                                    |
| `websecure`                    | the name of your HTTPS entry point in Traefik               |
| `letsencrypt`                  | the name of your certificate resolver in Traefik            |

## How It Was Tested

This guide has not been run in this form. It comes from an earlier setup that also ran another login service:

- The settings of the PostgreSQL container and of Traefik 3.7.17 were tested on 2 November 2026, in a rootless Podman
  machine on macOS, and the NixOS module was evaluated against `nixos-26.05`. Evaluating it starts nothing, so it has
  not run on a real NixOS host.
- The modules below were changed after that, and have not been evaluated or run, and the app they start does not exist
  yet.

Check them with [Checks](#checks).

## Secrets

Secrets live in root-only files and never in the Nix store. In the modules the paths are quoted strings on purpose: an
unquoted Nix path would copy the file into the world-readable store.

Create the files on the host. The hex passwords avoid characters that would need escaping in a URL:

```bash
sudo bash -c '
set -e
umask 077
mkdir -p /etc/secrets/hippowiki
cd /etc/secrets/hippowiki
secret() { tr -dc a-f0-9 < /dev/urandom | head -c 64; }
db_password="$(secret)"
printf "POSTGRES_PASSWORD=%s\nHIPPOWIKI_DB_PASSWORD=%s\n" "$(secret)" "$db_password" > postgres.env
printf "HIPPOWIKI_DATABASE_URL=postgresql+asyncpg://hippowiki:%s@postgres:5432/hippowiki\n" "$db_password" > app.env
'
```

If you use sops-nix or agenix, point `environmentFiles` at the decrypted paths instead.

## NixOS Module

Save this as `hippowiki-base.nix` next to `configuration.nix`, and add `./hippowiki-base.nix` to `imports`:

```nix
{ pkgs, ... }:

let
  # Runs only when the PostgreSQL data volume is first created.
  postgresInit = pkgs.writeText "10-hippowiki.sh" ''
    set -e
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -v pw="$HIPPOWIKI_DB_PASSWORD" <<'SQL'
    CREATE ROLE hippowiki LOGIN PASSWORD :'pw';
    CREATE DATABASE hippowiki OWNER hippowiki;
    REVOKE CONNECT ON DATABASE hippowiki FROM PUBLIC;
    SQL
  '';
in
{
  virtualisation.podman.enable = true;
  virtualisation.oci-containers.backend = "podman";

  # The firewall otherwise blocks container DNS on networks other than podman0,
  # and the app could not resolve the name "postgres".
  networking.firewall.interfaces."podman+".allowedUDPPorts = [ 53 ];

  # A fixed subnet gives --forwarded-allow-ips a stable value.
  systemd.services.podman-network-hippowiki = {
    description = "Create the hippowiki Podman network";
    requiredBy = [ "podman-postgres.service" ];
    before = [ "podman-postgres.service" ];
    path = [ pkgs.podman ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      podman network exists hippowiki || podman network create --subnet 10.89.10.0/24 hippowiki
    '';
  };

  virtualisation.oci-containers.containers.postgres = {
    image = "docker.io/library/postgres:16-alpine";
    cmd = [ "-c" "timezone=UTC" ];
    environmentFiles = [ "/etc/secrets/hippowiki/postgres.env" ];
    volumes = [
      "hippowiki-postgres:/var/lib/postgresql/data"
      "${postgresInit}:/docker-entrypoint-initdb.d/10-hippowiki.sh:ro"
    ];
    networks = [ "hippowiki" ];
    # The unit counts as started only when the health check passes, so the app waits.
    # TCP matters here: the temporary server during initialization listens only on a socket.
    podman.sdnotify = "healthy";
    extraOptions = [
      "--health-cmd=pg_isready -U postgres -h 127.0.0.1"
      "--health-interval=5s"
      "--health-retries=30"
    ];
  };

  services.traefik.dynamicConfigOptions.http = {
    routers.hippowiki = {
      rule = "Host(`wiki.example.org`)";
      entryPoints = [ "websecure" ];
      tls.certResolver = "letsencrypt";
      service = "hippowiki";
    };
    services.hippowiki.loadBalancer.servers = [
      { url = "http://127.0.0.1:8280"; }
    ];
  };
}
```

The route covers the whole hostname, so the MCP path, the login page and the public routes reach the app and its
middleware rejects the rest. It uses no `buffering` middleware, see
[Reverse Proxy Setup](../spec/deployment.md#reverse-proxy-setup).

If you already use `services.traefik.dynamicConfigFile` or `staticConfigFile`, they take precedence over
`dynamicConfigOptions`, so put the router and service there instead. Do not set `forwardedHeaders.insecure`, and if
another proxy sits in front of Traefik, set `forwardedHeaders.trustedIPs` for it.

## What HippoWiki Needs

If the HippoWiki container joins the `hippowiki` network:

```text
HIPPOWIKI_PUBLIC_URL=https://wiki.example.org
HIPPOWIKI_MCP_ALLOWED_HOSTS=["wiki.example.org"]
HIPPOWIKI_MCP_ALLOWED_ORIGINS=["https://wiki.example.org"]
```

The last two are JSON lists, which is how pydantic-settings reads a list. The SDK otherwise allows only localhost, so
every MCP request behind Traefik would get 421.

`HIPPOWIKI_DATABASE_URL` holds a password, so it comes from `/etc/secrets/hippowiki/app.env`.

The hostname must stay reachable from Anthropic's range `160.79.104.0/21`, see [Deployment](../spec/deployment.md).

## Connector Test App

This runs the temporary [Connector Test App](../spec/roadmap.md#connector-test-app) for the
[Connector Test](../spec/roadmap.md#connector-test). The route stays afterwards, and the container is replaced by the
[complete deployment](#complete-deployment).

Save this as `connector-test.nix` next to `configuration.nix`:

```nix
{ ... }:

{
  # These lists merge with the ones in hippowiki-base.nix.
  systemd.services.podman-network-hippowiki = {
    requiredBy = [ "podman-hippowiki-connector-test.service" ];
    before = [ "podman-hippowiki-connector-test.service" ];
  };

  virtualisation.oci-containers.containers.hippowiki-connector-test = {
    image = "localhost/hippowiki:connector-test";
    # The subnet is where Traefik's connections appear to come from, see Checks.
    cmd = [ "uvicorn" "--factory" "hippowiki.connector_test_app:create_connector_test_app" "--host" "0.0.0.0" "--port" "8000" "--proxy-headers" "--forwarded-allow-ips" "10.89.10.0/24" ];
    dependsOn = [ "postgres" ];
    networks = [ "hippowiki" ];
    # Published ports bypass the NixOS firewall, so bind them to localhost.
    ports = [ "127.0.0.1:8280:8000" ];
    volumes = [ "/etc/hippowiki/connector-test.json:/data/connector-test.json:ro" ];
    environmentFiles = [ "/etc/secrets/hippowiki/app.env" ];
    environment = {
      HIPPOWIKI_PUBLIC_URL = "https://wiki.example.org";
      HIPPOWIKI_MCP_ALLOWED_HOSTS = ''["wiki.example.org"]'';
      HIPPOWIKI_MCP_ALLOWED_ORIGINS = ''["https://wiki.example.org"]'';
      HIPPOWIKI_CONNECTOR_TEST_DATA = "/data/connector-test.json";
    };
  };
}
```

Then set it up:

1. Build the image on the host from a copy of the project. This needs no registry and gives the image the architecture
   of the host:

   ```bash
   sudo podman build -t localhost/hippowiki:connector-test -f Containerfile .
   ```

2. Write the test data to `/etc/hippowiki/connector-test.json`, see
   [Connector Test App](../spec/roadmap.md#connector-test-app). It holds no secrets, and has to be readable by all,
   because the container runs as a non-root user.

3. Create the tables and the admin:

   ```bash
   sudo podman run --rm --network hippowiki --env-file /etc/secrets/hippowiki/app.env localhost/hippowiki:connector-test hippowiki migrate
   ```

   ```bash
   sudo podman run --rm --network hippowiki --env-file /etc/secrets/hippowiki/app.env localhost/hippowiki:connector-test hippowiki init
   ```

4. Set the password of the admin. It asks on the terminal:

   ```bash
   sudo podman run --rm -it --network hippowiki --env-file /etc/secrets/hippowiki/app.env localhost/hippowiki:connector-test hippowiki set-admin-password
   ```

5. Create the test users. This prints their one-time passwords once, so keep them for the test:

   ```bash
   sudo podman run --rm --network hippowiki --env-file /etc/secrets/hippowiki/app.env -v /etc/hippowiki/connector-test.json:/data/connector-test.json:ro -e HIPPOWIKI_CONNECTOR_TEST_DATA=/data/connector-test.json localhost/hippowiki:connector-test python -m hippowiki.connector_test_app create-users
   ```

6. Create a [script client](../spec/connectors.md#scripts) for the admin and one for the script user. Each prints its ID
   and secret once:

   ```bash
   sudo podman run --rm --network hippowiki --env-file /etc/secrets/hippowiki/app.env localhost/hippowiki:connector-test hippowiki client add --name admin-script --user admin
   ```

   ```bash
   sudo podman run --rm --network hippowiki --env-file /etc/secrets/hippowiki/app.env localhost/hippowiki:connector-test hippowiki client add --name test-script --user <name of the script user>
   ```

7. Add `./connector-test.nix` to `imports`, and apply the configuration:

   ```bash
   sudo nixos-rebuild switch
   ```

8. Add the connector in each product, with nothing but the MCP URL. For Claude Code:

   ```bash
   claude mcp add --transport http hippowiki https://wiki.example.org/mcp
   ```

### Getting a Token on the Command Line

A script client gets a token with its ID and secret. `curl` asks for the secret, so it stays out of the shell history:

```bash
curl -fsS -u <client_id> -d grant_type=client_credentials https://wiki.example.org/oauth/token | jq -r .access_token
```

## Complete Deployment

This host is the production system, see [Where It Runs](../spec/deployment.md#where-it-runs). The module for it, a
`hippowiki.nix`, is written in the [Deployment step](../spec/roadmap.md#next-steps), because the image and its commands
do not exist yet. It runs the same image as `compose.yaml`. Do not run `compose.yaml` on this host, because it would
start a second PostgreSQL.

The module and its setup have to cover:

- **Migrations:** a one-shot unit that runs `hippowiki migrate` and then `hippowiki init` from the image, and that the
  app waits for.
- **App container:** on the `hippowiki` network, with its port bound to localhost behind the existing route, and the
  Uvicorn flags of `connector-test.nix`.
- **First start:** `hippowiki set-admin-password` and the script client of the admin, see
  [Migrations and Initialization](../spec/deployment.md#migrations-and-initialization).
- **Removing the test app:** `connector-test.nix` and `/etc/hippowiki/connector-test.json`. The test data in the
  database has to go as well, by starting with an empty database.

## Checks

Run these on the host:

1. The containers run. For the app, add it to the list once it exists:

   ```bash
   systemctl status podman-postgres podman-network-hippowiki podman-hippowiki-connector-test
   ```

2. The database runs in UTC. Expect `UTC`:

   ```bash
   sudo podman exec postgres psql -U postgres -Atc 'show timezone'
   ```

3. The port of the app listens on localhost only. Expect `127.0.0.1` in the line:

   ```bash
   sudo ss -tlnp | grep ':8280'
   ```

4. PostgreSQL has no published port. Expect no output:

   ```bash
   sudo podman port postgres
   ```

Run these from outside the host, once the [Connector Test App](#connector-test-app) runs:

1. The health route answers through Traefik. Expect 200:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://wiki.example.org/health
   ```

2. The protected resource metadata names the MCP URL. Expect `https://wiki.example.org/mcp`:

   ```bash
   curl -fsS https://wiki.example.org/.well-known/oauth-protected-resource/mcp | jq -r .resource
   ```

3. The metadata of the OAuth server names the issuer. Expect `https://wiki.example.org`:

   ```bash
   curl -fsS https://wiki.example.org/.well-known/oauth-authorization-server | jq -r .issuer
   ```

4. The metadata has what the clients need. Expect `true` and `true`, then `["S256"]`, and a number for `none`:

   ```bash
   curl -fsS https://wiki.example.org/.well-known/oauth-authorization-server | jq -c '.client_id_metadata_document_supported, .authorization_response_iss_parameter_supported, .code_challenge_methods_supported, (.token_endpoint_auth_methods_supported | index("none"))'
   ```

5. MCP asks for a login and points at the metadata. Expect 401 and a `www-authenticate` line with `resource_metadata`:

   ```bash
   curl -si -X POST https://wiki.example.org/mcp | grep -iE '^(HTTP|www-authenticate)'
   ```

6. The app sees the real client address. Add a connector, enter a wrong password once on the login page, and read the
   log of the app. Expect your own public IP address. This depends on how Podman forwards the port on your host, see
   [Troubleshooting](#troubleshooting).

   ```bash
   journalctl -u podman-hippowiki-connector-test -n 100 --no-pager
   ```

## Backups and Upgrades

Back up the database. It holds password hashes and token hashes, so keep the dump as protected as the database:

```bash
sudo bash -c 'umask 077; podman exec postgres pg_dump -U postgres -Fc hippowiki > "hippowiki-$(date +%F).dump"'
```

To upgrade the app, build a new image and restart it. A new PostgreSQL major version needs a data migration, see
[Risks Not Settled Yet](../spec/configuration-and-failure-modes.md#risks-not-settled-yet).

## Troubleshooting

Look at the logs first:

```bash
journalctl -u podman-hippowiki-connector-test -n 100 --no-pager
```

| Symptom                                                   | Likely cause and fix                                                                                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Name or service not known: postgres`, or a similar error | The firewall blocks container DNS. Check `networking.firewall.interfaces."podman+"`, and that both containers are on the `hippowiki` network.                                    |
| Password authentication failed for user `hippowiki`       | The init script runs only on an empty volume, so a later change in the env files has no effect. Change it with `ALTER ROLE` in `psql`, or delete the volume if it holds no data. |
| The client rejects the metadata                           | `HIPPOWIKI_PUBLIC_URL` is not the exact public URL, for example with a trailing slash.                                                                                           |
| The error page instead of the login page                  | The product sends a `client_id` that is not on the allowlist, or its document could not be fetched. The log of the app shows which, and the app needs outgoing `https` access.   |
| The log shows `10.89.10.1` instead of the client address  | Traefik's forwarded headers are not reaching the app. Check `forwardedHeaders` in Traefik, and `--forwarded-allow-ips`.                                                          |
| The log shows another private address as the client       | The address Traefik connects from is outside the trusted subnet. Change `--forwarded-allow-ips`.                                                                                 |
| The app stops with an out-of-memory error during logins   | The container limit is too low for the [running hashes](../spec/limits.md#oauth-values).                                                                                         |
| 404 from Traefik on every path                            | The entry point or resolver name differs, or `dynamicConfigFile` overrides `dynamicConfigOptions`. Check the Traefik logs.                                                       |
| 421 on MCP requests                                       | `HIPPOWIKI_MCP_ALLOWED_HOSTS` does not hold the hostname. See [What HippoWiki Needs](#what-hippowiki-needs).                                                                     |
| 403 on MCP requests of a user who is not the admin        | The client sends an `Origin` that `HIPPOWIKI_MCP_ALLOWED_ORIGINS` does not hold. The log of the app shows it.                                                                    |

## Sources

- [nixpkgs: oci-containers module](https://github.com/NixOS/nixpkgs/blob/nixos-26.05/nixos/modules/virtualisation/oci-containers.nix)
- [nixpkgs: Traefik module](https://github.com/NixOS/nixpkgs/blob/nixos-26.05/nixos/modules/services/web-servers/traefik.nix)
