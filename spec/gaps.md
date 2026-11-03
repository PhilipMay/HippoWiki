# Gaps

These are open gaps in the specification that block the [Connector Test](roadmap.md#connector-test), or that have to be
settled before it can run. None of them is closed yet. Each suggested fix is only a proposal, and no other document has
been changed for it.

## Step Order

- **Middleware before Foundation**: the [auth middleware](authentication.md#request-handling) in the first step of the
  [roadmap](roadmap.md#next-steps) uses `problem.py` and needs the settings for the issuer, the audience and the signing
  keys. Both only arrive in the third step, Foundation. The same holds for `domain.py`, which `auth/principal.py`
  imports, for the field types from `schemas/` that the tools share, and for the settings of the
  [host check](mcp.md#serving-the-mcp-app). The import contracts that wait for the first code also sit in Foundation,
  although the first code now arrives earlier. Suggested fix: move all of these into the first step, limited to what
  that step uses. The rest of Foundation stays where it is.
- **Layers under the tools**: the first step has MCP tools, but [each tool makes one service call](mcp.md#tools) and the
  services only arrive in the fifth step. [`create_app()`](architecture.md#composition) takes a unit-of-work factory and
  builds the services itself, and the repository fakes arrive in the fourth step and live in `tests/`, which a container
  image would not hold. So "over in-memory data" does not fit the composition. Suggested fix: the test composition
  passes stand-in services, with only the methods the tools call, to the MCP server factory, which already takes the
  services and the principal resolver, and passes a credential check to the middleware. The first step then needs no
  unit of work and no repository, and the real services replace the stand-ins in the fifth step.
- **Tools for the test**: the first step says "enough tools", and nothing names them. Suggested fix: `get_own_user`, to
  show who is logged in, `list_folders` and `list_md_documents`, to find the IDs, `get_md_document`, for the maximum
  size case, and `create_md_document`, as one write tool and for a body of the maximum size through the proxy. They
  start without `securitySchemes`, which are added only if ChatGPT needs them.
- **Public routes**: the first step names the middleware and the MCP routes, but no client can find the login without
  the [protected resource metadata](authentication.md#public-routes), which the 401 points at.
  [Package Layout](package-layout.md) names no module for these routes or for health. Suggested fix: name the public
  routes in the first step and give them a place in Package Layout.
- **Running the test app**: the test app has to run on the public host, but the `Containerfile` and the complete
  `compose.yaml` only arrive in the last step. Nothing defines how it runs until then. Suggested fix: move the
  `Containerfile` into the first step and run the image on the NixOS host with `virtualisation.oci-containers`, on the
  `hippowiki` network. It publishes its port on `127.0.0.1` only, because the Traefik of the guide runs natively and
  published ports bypass the NixOS firewall. The complete `compose.yaml` stays in the last step.
- **Test users**: the test needs a linked user, an unlinked user, a deactivated user and the admin. Nothing defines how
  they get into the in-memory data, because `hippowiki link-admin` only arrives with the services. Suggested fix: give
  the test app its own composition, outside `create_production_app()`, as in **Layers under the tools**. It reads its
  data from a JSON file named by an environment variable. All four accounts exist in Keycloak, but the unlinked one has
  no matching user, so the file holds three users, each with its Keycloak subject, name, `is_admin` and deactivated
  state. It also holds a folder, a right for the linked user and a md_document at the
  [maximum document size](limits.md#document-size), which the Connector Test needs.
- **Test code afterwards**: nothing says whether the code written for the test stays or gets thrown away. Suggested fix:
  keep the middleware, the token check, the MCP routes and the tools, with their token, middleware and MCP transport
  tests written in the first step. Throw away the stand-in services, the JSON file and the test composition. State this
  in the first step of the roadmap.

## Reverse Proxy Gaps

- **Product not chosen**: the [roadmap](roadmap.md#next-steps) lists the choice as open and [Deployment](deployment.md)
  says "e.g. Caddy or Traefik", while the [Keycloak guide](../doc/nixos-keycloak-setup.md) already uses Traefik.
  [Tech Stack](tech-stack.md) names no reverse proxy. Suggested fix: choose Traefik, because the guide already uses it
  and tested its rule, and name it in the roadmap, in Deployment and in Tech Stack.
- **No route for HippoWiki**: the guide only has a Traefik route for the Keycloak hostname, not for the wiki hostname.
  Suggested fix: add a router and service for the wiki hostname to the guide, covering the whole host, so the MCP path
  and the public routes reach the app and its middleware rejects the rest. Add the
  [body limit](limits.md#request-body-limit) and the idle timeout from [Deployment](deployment.md). Before using the
  Traefik `buffering` middleware for the limit, check that it does not hold back streamed MCP responses.
- **Login paths differ**: [Deployment](deployment.md) names `/realms/` and `/resources/` as the paths to expose, but the
  guide also exposes `/.well-known/`, which its check of the RFC 8414 metadata uses. Suggested fix: add `/.well-known/`
  to the exposed paths in Deployment.
- **Allowed hosts and origins**: "What HippoWiki Needs" in the guide and the settings in [Deployment](deployment.md)
  leave out `HIPPOWIKI_MCP_ALLOWED_HOSTS` and `HIPPOWIKI_MCP_ALLOWED_ORIGINS`. The SDK default allows only localhost, so
  every MCP request behind the proxy would get 421. Nothing says which origins to allow. Suggested fix: add both to the
  guide and to Deployment with the wiki hostname, and add whether a client sends an `Origin` at all to the
  [Connector Test](roadmap.md#connector-test).

## Keycloak Gaps

- **Claude Code client**: the realm setup in the guide only covers the clients of Claude and ChatGPT and script clients.
  It has no client for Claude Code with the redirect URI `http://localhost:PORT/callback`, and the port is not chosen.
  Suggested fix: add a third connector client to the guide, with a fixed port chosen for `--callback-port` and that
  redirect URI. Start it as confidential like the other clients, and record in
  [Client Registration](connectors.md#client-registration) whether the test shows it needs a secret.
- **`offline_access`**: [Token Lifecycle](authentication.md#token-lifecycle) relies on this scope to keep connectors
  logged in, but the realm setup in the guide does not mention it. HippoWiki can not make a client request it: in the
  [MCP draft specification](https://modelcontextprotocol.io/specification/draft/basic/authorization) a client may
  request it when the metadata of the authorization server lists it, and a server should not name it in its protected
  resource metadata or in `WWW-Authenticate`. Suggested fix: add a step to the realm setup that checks the scope is
  available on each connector client and listed in the metadata of Keycloak. Add to the
  [Connector Test](roadmap.md#connector-test) whether each client requests it, and how long a client stays logged in if
  it does not.
- **Realm import**: the [roadmap](roadmap.md#next-steps) expects Keycloak with the realm import, but the guide says the
  export and import has not been tested. Suggested fix: configure the realm in the console first, and move the export
  and a tested import on a fresh installation to after the Connector Test in the roadmap.

## Client Accounts

- **ChatGPT plan**: [Connector Test](roadmap.md#connector-test) names the plans for Claude, but nothing says which
  ChatGPT plan can add a connector with its own OAuth client. Suggested fix: look up the required plan in the OpenAI
  documentation when the test is prepared, and add it to the Connector Test next to the Claude plans. It is left unnamed
  here because plans change.
