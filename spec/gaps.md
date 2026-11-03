# Gaps

These are open gaps in the specification that block the [Connector Test](roadmap.md#connector-test), or that have to be
settled before it can run. None of them is closed yet. Each suggested fix is only a proposal, and no other document has
been changed for it.

## Step Order

- **Middleware before Foundation**: the [auth middleware](authentication.md#request-handling) in the first step of the
  [roadmap](roadmap.md#next-steps) uses `problem.py` and needs the settings for the issuer, the audience and the signing
  keys. Both only arrive in the third step, Foundation. Suggested fix: move the settings and `problem.py` into the first
  step, limited to what the middleware needs. The rest of Foundation stays where it is.
- **Running the test app**: the test app has to run on the public host, but the `Containerfile` and the complete
  `compose.yaml` only arrive in the last step. Nothing defines how it runs until then. Suggested fix: move the
  `Containerfile` into the first step and run the image on the NixOS host with `virtualisation.oci-containers`, on the
  `hippowiki` network. The complete `compose.yaml` stays in the last step.
- **Test users**: the test needs a linked user, an unlinked user, a deactivated user and an admin. Nothing defines how
  they get into the in-memory data, because `hippowiki link-root-admin` only arrives with the services. Suggested fix:
  give the test app its own composition, outside `create_production_app()`, which passes in-memory data to
  `create_app()`. It reads the four users from a JSON file named by an environment variable, each with its Keycloak
  subject, name, `is_admin` and deactivated state.
- **Test code afterwards**: nothing says whether the code written for the test stays or gets thrown away. Suggested fix:
  keep the middleware, the token check and the MCP routes, and throw away the in-memory data, the JSON file and the test
  composition. State this in the first step of the roadmap.

## Reverse Proxy

- **Product not chosen**: the [roadmap](roadmap.md#next-steps) lists the choice as open and [Deployment](deployment.md)
  says "e.g. Caddy or Traefik", while the [Keycloak guide](../doc/nixos-keycloak-setup.md) already uses Traefik.
  Suggested fix: choose Traefik, because the guide has already tested it, and name it in the roadmap and in Deployment.
- **No route for HippoWiki**: the guide only has a Traefik route for the Keycloak hostname, not for the wiki hostname.
  Suggested fix: add a router and service for the wiki hostname to the guide, covering the whole host, so the MCP path
  and the public routes reach the app and its middleware rejects the rest. Add the 2 MiB body limit and the idle timeout
  from [Deployment](deployment.md). Before using the Traefik `buffering` middleware for the limit, check that it does
  not hold back streamed MCP responses.
- **Login paths differ**: [Deployment](deployment.md) names `/realms/` and `/resources/` as the paths to expose, but the
  guide also exposes `/.well-known/`, which its check of the RFC 8414 metadata uses. Suggested fix: add `/.well-known/`
  to the exposed paths in Deployment.

## Keycloak

- **Claude Code client**: the realm setup in the guide only covers the clients of Claude and ChatGPT and script clients.
  It has no client for Claude Code with the redirect URI `http://localhost:PORT/callback`, and the port is not chosen.
  Suggested fix: add a third connector client to the guide, with a fixed port chosen for `--callback-port` and that
  redirect URI. Start it as confidential like the other clients, and record in
  [Client Registration](authentication.md#client-registration) whether the test shows it needs a secret.
- **`offline_access`**: [Token Lifecycle](authentication.md#token-lifecycle) relies on this scope to keep connectors
  logged in, but the realm setup in the guide does not mention it. Suggested fix: add a step to the realm setup that
  checks the scope is available on each connector client, and add whether each client requests it to the
  [Connector Test](roadmap.md#connector-test).
- **Realm import**: the [roadmap](roadmap.md#next-steps) expects Keycloak with the realm import, but the guide says the
  export and import has not been tested. Suggested fix: configure the realm in the console first, and move the export
  and a tested import on a fresh installation to after the Connector Test in the roadmap.

## Client Accounts

- **ChatGPT plan**: [Connector Test](roadmap.md#connector-test) names the plans for Claude, but nothing says which
  ChatGPT plan can add a connector with its own OAuth client. Suggested fix: look up the required plan in the OpenAI
  documentation when the test is prepared, and add it to the Connector Test next to the Claude plans. It is left unnamed
  here because plans change.

## Keycloak Guide

- **Broken links**: the links in the [guide](../doc/nixos-keycloak-setup.md) start with `spec/`, so from `doc/` they
  point to `doc/spec/`, which does not exist. Suggested fix: change the links to start with `../spec/`.
