# Keycloak on NixOS with Podman and Traefik

This guide runs Keycloak in Podman on a NixOS host, behind a Traefik that runs as the native `services.traefik` and
handles TLS. It follows the requirements in [Deployment](spec/deployment.md) and
[Authentication](spec/authentication.md).

## What You Get

- `quay.io/keycloak/keycloak:26.8.1`, the version pinned in [Architecture](spec/architecture.md), limited to 2 GB of
  memory.
- `postgres:16-alpine` with `timezone=UTC`, and a separate `keycloak` database and role. HippoWiki's database goes on
  the same server later.
- Traefik exposes only the login paths. The admin console, `/realms/master`, health and metrics answer 404 from the
  internet.
- You reach the admin console through an SSH tunnel.

Replace these placeholders everywhere:

| Placeholder                    | Meaning                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| `auth.example.org`             | public hostname of Keycloak, with DNS pointing at the host |
| `https://wiki.example.org/mcp` | the MCP URL of HippoWiki, used as the token audience       |
| `websecure`                    | the name of your HTTPS entry point in Traefik              |
| `letsencrypt`                  | the name of your certificate resolver in Traefik           |

## How It Was Tested

The container settings, the Traefik rule and the admin console login were tested on 2 November 2026 with Keycloak
26.8.1, Traefik 3.7.17 and `postgres:16-alpine`, in a rootless Podman machine on macOS. The memory limit was 1200 MB
there, because that machine has only 2 GB.

The `keycloak.nix` module was evaluated against `nixos-26.05`, and the `podman run` commands it generates match the
tested settings. Evaluating it does not start anything, so these parts have not run on a real NixOS host. Check them
with [Checks](#checks):

- the systemd units and the network unit
- the firewall rule for container DNS
- the health check that makes Keycloak wait for PostgreSQL
- the native Traefik route and real TLS
- the realm checklist, whose console labels were written from memory

## Secrets

Secrets live in root-only files and never in the Nix store. In `keycloak.nix` the paths are quoted strings on purpose:
an unquoted Nix path would copy the file into the world-readable store.

Create the files on the host. The hex passwords also avoid the `$` character, which `KC_DB_PASSWORD` can not contain:

```bash
sudo bash -c '
set -e
umask 077
mkdir -p /etc/secrets/keycloak
cd /etc/secrets/keycloak
secret() { tr -dc a-f0-9 < /dev/urandom | head -c 64; }
db_password="$(secret)"
printf "POSTGRES_PASSWORD=%s\nKEYCLOAK_DB_PASSWORD=%s\n" "$(secret)" "$db_password" > postgres.env
printf "KC_DB_PASSWORD=%s\n" "$db_password" > keycloak.env
printf "KC_BOOTSTRAP_ADMIN_USERNAME=temp-admin\nKC_BOOTSTRAP_ADMIN_PASSWORD=%s\n" "$(secret)" > bootstrap.env
'
```

If you use sops-nix or agenix, point `environmentFiles` at the decrypted paths instead.

## NixOS Module

Save this as `keycloak.nix` next to `configuration.nix`, and add `./keycloak.nix` to `imports`:

```nix
{ pkgs, ... }:

let
  # Runs only when the PostgreSQL data volume is first created.
  postgresInit = pkgs.writeText "10-keycloak.sh" ''
    set -e
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -v pw="$KEYCLOAK_DB_PASSWORD" <<'SQL'
    CREATE ROLE keycloak LOGIN PASSWORD :'pw';
    CREATE DATABASE keycloak OWNER keycloak;
    REVOKE CONNECT ON DATABASE keycloak FROM PUBLIC;
    SQL
  '';
in
{
  virtualisation.podman.enable = true;
  virtualisation.oci-containers.backend = "podman";

  # The firewall otherwise blocks container DNS on networks other than podman0,
  # and the container "keycloak" could not resolve the name "postgres".
  networking.firewall.interfaces."podman+".allowedUDPPorts = [ 53 ];

  # A fixed subnet gives KC_PROXY_TRUSTED_ADDRESSES a stable value.
  systemd.services.podman-network-hippowiki = {
    description = "Create the hippowiki Podman network";
    requiredBy = [ "podman-postgres.service" "podman-keycloak.service" ];
    before = [ "podman-postgres.service" "podman-keycloak.service" ];
    path = [ pkgs.podman ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      podman network exists hippowiki || podman network create --subnet 10.89.10.0/24 hippowiki
    '';
  };

  virtualisation.oci-containers.containers = {
    postgres = {
      image = "docker.io/library/postgres:16-alpine";
      cmd = [ "-c" "timezone=UTC" ];
      environmentFiles = [ "/etc/secrets/keycloak/postgres.env" ];
      volumes = [
        "hippowiki-postgres:/var/lib/postgresql/data"
        "${postgresInit}:/docker-entrypoint-initdb.d/10-keycloak.sh:ro"
      ];
      networks = [ "hippowiki" ];
      # The unit counts as started only when the health check passes, so Keycloak waits.
      # TCP matters here: the temporary server during initialization listens only on a socket.
      podman.sdnotify = "healthy";
      extraOptions = [
        "--health-cmd=pg_isready -U postgres -h 127.0.0.1"
        "--health-interval=5s"
        "--health-retries=30"
      ];
    };

    keycloak = {
      image = "quay.io/keycloak/keycloak:26.8.1";
      cmd = [ "start" ];
      dependsOn = [ "postgres" ];
      networks = [ "hippowiki" ];
      # Published ports bypass the NixOS firewall, so bind them to localhost.
      # 8180 and 9180 avoid port 8080, which Traefik's own API commonly uses.
      ports = [
        "127.0.0.1:8180:8080"
        "127.0.0.1:9180:9000"
      ];
      environment = {
        KC_DB = "postgres";
        KC_DB_URL_HOST = "postgres";
        KC_DB_URL_DATABASE = "keycloak";
        KC_DB_USERNAME = "keycloak";

        KC_HOSTNAME = "https://auth.example.org";
        KC_HOSTNAME_ADMIN = "http://localhost:8180";

        # Traefik terminates TLS and sets the X-Forwarded-* headers.
        KC_HTTP_ENABLED = "true";
        KC_PROXY_HEADERS = "xforwarded";
        KC_PROXY_TRUSTED_ADDRESSES = "10.89.10.0/24";

        KC_HEALTH_ENABLED = "true";
      };
      environmentFiles = [
        "/etc/secrets/keycloak/keycloak.env"
        # Remove this line after creating a permanent admin.
        "/etc/secrets/keycloak/bootstrap.env"
      ];
      extraOptions = [ "--memory=2g" ];
    };
  };

  services.traefik.dynamicConfigOptions.http = {
    routers.keycloak = {
      rule = "Host(`auth.example.org`) && (PathPrefix(`/realms/`) || PathPrefix(`/resources/`) || PathPrefix(`/.well-known/`)) && !PathPrefix(`/realms/master`)";
      entryPoints = [ "websecure" ];
      tls.certResolver = "letsencrypt";
      service = "keycloak";
    };
    services.keycloak.loadBalancer.servers = [
      { url = "http://127.0.0.1:8180"; }
    ];
  };
}
```

Some choices worth knowing:

- **Plain `start`:** the Keycloak guide recommends a custom image built with `kc.sh build` and `start --optimized`.
  Plain `start` is simpler on one node, because it needs no image build, but Keycloak rebuilds itself on each container
  start, so startup is slower. Move to a custom image if the startup time bothers you.
- **`hostname-backchannel-dynamic` stays off:** HippoWiki only fetches the signing keys over the internal network, and
  that response contains no URLs.
- **Existing Traefik configuration:** `services.traefik.dynamicConfigFile` and `staticConfigFile` take precedence over
  `dynamicConfigOptions`. If you use one of them, put the router and service there instead. Do not set
  `forwardedHeaders.insecure`, and if another proxy sits in front of Traefik, set `forwardedHeaders.trustedIPs` for it.

## First Start

1. Apply the configuration. The first start pulls the images and creates the database, which takes a few minutes:

   ```bash
   sudo nixos-rebuild switch
   ```

2. Wait until Keycloak reports that it is ready:

   ```bash
   curl -fsS http://127.0.0.1:9180/health/ready
   ```

3. Log in with the command-line tool inside the container. It asks for `KC_BOOTSTRAP_ADMIN_PASSWORD` from
   `/etc/secrets/keycloak/bootstrap.env`:

   ```bash
   sudo podman exec -it keycloak /opt/keycloak/bin/kcadm.sh config credentials --config /tmp/kcadm.config --server http://localhost:8080 --realm master --user temp-admin
   ```

4. Point the `master` realm at the tunnel address. Without this step the console can not log you in:

   ```bash
   sudo podman exec keycloak /opt/keycloak/bin/kcadm.sh update realms/master --config /tmp/kcadm.config -s attributes.frontendUrl=http://localhost:8180
   ```

5. On your own computer, open the tunnel. The local port has to be 8180, because the `master` realm now uses that exact
   address:

   ```bash
   ssh -L 8180:127.0.0.1:8180 you@your-nixos-host
   ```

6. Open `http://localhost:8180/admin/master/console/` and log in as `temp-admin`.

7. In the `master` realm, create your permanent admin: add a user, set a password, and assign the realm role `admin`.

8. Log in as the new admin, then delete `temp-admin`.

9. Remove the `bootstrap.env` line from `keycloak.nix`, then apply the configuration and delete the file:

   ```bash
   sudo nixos-rebuild switch
   ```

   ```bash
   sudo rm /etc/secrets/keycloak/bootstrap.env
   ```

### Why the Master Realm Needs a Frontend URL

`KC_HOSTNAME_ADMIN` alone is not enough here. In the test, the console page loaded from `http://localhost:8180`, but its
login still went to the public hostname under `/realms/master`, which Traefik blocks. The console stopped with "Timeout
when waiting for 3rd party check iframe message".

The realm's Frontend URL fixes this for `master` only. The `hippowiki` realm keeps its public issuer, and the login
works with `/realms/master` closed to the internet.

## Realm Setup

Create the realm `hippowiki` in the console (the realm menu, then "Create realm"), and then set the following. The rules
come from [Authentication](spec/authentication.md). The labels may differ slightly between Keycloak versions.

- **Realm settings, Login:** turn off "User registration" and "Edit username".
- **Realm settings, Security defenses:** turn on "Brute force detection".
- **Realm settings, Events:** turn on saving of user events.
- **Realm settings, Tokens:** set "Access token lifespan" to 5 minutes, turn on "Revoke refresh token", and set "Refresh
  token max reuse" to 0. The session lifetimes are decided in the [Connector Test](spec/roadmap.md#connector-test).
- **Client scopes:** create a scope `hippowiki-audience` of type "Default". Add a mapper "By configuration", type
  "Audience", with "Included Custom Audience" set to `https://wiki.example.org/mcp` and "Add to access token" on. Create
  this before the clients, so that they pick it up.
- **Clients:** create one client per product, with "Client authentication" on and "Standard flow" on. Under "Advanced",
  set "Proof Key for Code Exchange Code Challenge Method" to `S256`. The redirect URI of Claude is
  `https://claude.ai/api/mcp/auth_callback`. Copy the one for ChatGPT from its management page.
- **Script clients:** create one client per script, with "Service accounts roles" on and "Standard flow" off.
- **Features:** do not enable `cimd`, `resource-indicators` or anonymous client registration, see
  [Client Registration](spec/authentication.md#client-registration).

The HippoWiki admin account also goes in this realm, not in `master`. Create the user, copy its ID, and run
`hippowiki link-admin <subject>` with that ID, see [Admin](spec/users-and-rights.md#admin).

[Deployment](spec/deployment.md) wants the realm as a versioned import file without secrets:

1. In "Realm settings", use "Action" and then "Partial export", including clients and groups.
2. Replace each client secret with an environment placeholder such as `${CLAUDE_CLIENT_SECRET}`, and save the file as
   `hippowiki-realm.json`.
3. For a new installation, mount the file into `/opt/keycloak/data/import` and use `cmd = [ "start" "--import-realm" ]`.
   Keycloak skips the import when the realm already exists, so it can not overwrite a running setup.

This export and import has not been tested yet.

## What HippoWiki Needs

If the HippoWiki container joins the `hippowiki` network:

```text
HIPPOWIKI_OAUTH_ISSUER=https://auth.example.org/realms/hippowiki
HIPPOWIKI_OAUTH_AUDIENCE=https://wiki.example.org/mcp
HIPPOWIKI_OAUTH_JWKS_URL=http://keycloak:8080/realms/hippowiki/protocol/openid-connect/certs
```

Keycloak's public hostname must also stay reachable from Anthropic's range `160.79.104.0/21`, see
[Deployment](spec/deployment.md).

## Checks

Run these on the host:

1. Both containers run, and Keycloak is healthy. Expect `"status": "UP"` from the second command:

   ```bash
   systemctl status podman-postgres podman-keycloak podman-network-hippowiki
   ```

   ```bash
   curl -fsS http://127.0.0.1:9180/health/ready
   ```

2. The database runs in UTC. Expect `UTC`:

   ```bash
   sudo podman exec postgres psql -U postgres -Atc 'show timezone'
   ```

3. The Keycloak ports listen on localhost only. Expect `127.0.0.1` in every line:

   ```bash
   sudo ss -tlnp | grep -E ':(8180|9180)'
   ```

Run these from outside the host, once the realm exists:

1. The issuer is the public URL. Expect `https://auth.example.org/realms/hippowiki`:

   ```bash
   curl -fsS https://auth.example.org/realms/hippowiki/.well-known/openid-configuration | jq -r .issuer
   ```

2. The signing keys and the RFC 8414 metadata answer. Expect 200 from both:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://auth.example.org/realms/hippowiki/protocol/openid-connect/certs
   ```

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://auth.example.org/.well-known/oauth-authorization-server/realms/hippowiki
   ```

3. The protected paths are closed. Expect 404 from each line:

   ```bash
   for path in /admin/ /admin/realms /realms/master /realms/master/.well-known/openid-configuration /health /metrics; do curl -s -o /dev/null -w "%{http_code} $path\n" "https://auth.example.org$path"; done
   ```

4. Keycloak sees the real client address. Log in once with a wrong password at
   `https://auth.example.org/realms/hippowiki/account`, and look at the event under "Events" in the console. Expect your
   own public IP address. This depends on how Podman forwards the port on your host, see
   [Troubleshooting](#troubleshooting).

## Backups and Upgrades

Back up the Keycloak database together with HippoWiki's database, because `users.auth_subject` only makes sense together
with the Keycloak accounts:

```bash
sudo podman exec postgres pg_dump -U postgres -Fc keycloak > "keycloak-$(date +%F).dump"
```

To upgrade, read the Keycloak upgrading guide, make a backup, change the image tag in `keycloak.nix`, and run
`sudo nixos-rebuild switch`. Update the pinned version in [Architecture](spec/architecture.md) as well.

## Troubleshooting

Look at the logs first:

```bash
journalctl -u podman-keycloak -n 100 --no-pager
```

| Symptom                                                       | Likely cause and fix                                                                                                                                                             |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UnknownHostException: postgres`, or a similar DNS error      | The firewall blocks container DNS. Check `networking.firewall.interfaces."podman+"`, and that both containers are on the `hippowiki` network.                                    |
| Password authentication failed for user `keycloak`            | The init script runs only on an empty volume, so a later change in the env files has no effect. Change it with `ALTER ROLE` in `psql`, or delete the volume if it holds no data. |
| Console stuck with "Timeout when waiting for 3rd party check" | The `master` Frontend URL is not set, or your tunnel uses a port other than 8180. See [First Start](#first-start).                                                               |
| "HTTPS required" on the console                               | The request does not come from a private address. Use the SSH tunnel, and check the tunnel target is `127.0.0.1:8180`.                                                           |
| Wrong issuer in tokens or in discovery                        | `KC_HOSTNAME` is not the full public URL. The issuer has to match `HIPPOWIKI_OAUTH_ISSUER` exactly.                                                                              |
| 403 on login pages through Traefik                            | `KC_PROXY_HEADERS` is missing, or Traefik does not reach Keycloak directly.                                                                                                      |
| Events show `10.89.10.1` instead of the client address        | Traefik's forwarded headers are not reaching Keycloak. Check `forwardedHeaders` in Traefik, and `KC_PROXY_TRUSTED_ADDRESSES`.                                                    |
| Events show another private address as the client             | The address Traefik connects from is outside the trusted subnet. Add it to `KC_PROXY_TRUSTED_ADDRESSES`.                                                                         |
| Keycloak stops with an out-of-memory error                    | The container limit is too low. The Keycloak guide requires at least 750 MB and recommends 2 GB.                                                                                 |
| 404 from Traefik on every path                                | The entry point or resolver name differs, or `dynamicConfigFile` overrides `dynamicConfigOptions`. Check the Traefik logs.                                                       |

## Sources

- [Keycloak: containers](https://www.keycloak.org/server/containers)
- [Keycloak: reverse proxy](https://www.keycloak.org/server/reverseproxy)
- [Keycloak: hostname](https://www.keycloak.org/server/hostname)
- [Keycloak: database](https://www.keycloak.org/server/db)
- [Keycloak: health checks](https://www.keycloak.org/observability/health)
- [Keycloak: import and export](https://www.keycloak.org/server/importExport)
- [Keycloak: temporary admin accounts](https://www.keycloak.org/server/bootstrap-admin-recovery)
- [Keycloak: MCP authorization server](https://www.keycloak.org/securing-apps/mcp-authz-server)
- [nixpkgs: oci-containers module](https://github.com/NixOS/nixpkgs/blob/nixos-26.05/nixos/modules/virtualisation/oci-containers.nix)
- [nixpkgs: Traefik module](https://github.com/NixOS/nixpkgs/blob/nixos-26.05/nixos/modules/services/web-servers/traefik.nix)
