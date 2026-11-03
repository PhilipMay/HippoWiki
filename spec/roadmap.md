# Roadmap

This documents what still needs to be done and is missing, most urgent first. What is out of scope is in
[Non-Goals](goals.md#non-goals-for-now).

## Next Steps

1. **Connector setup**: everything the [Connector Test](#connector-test) needs and no server provides yet.
   - Keycloak configured in the console and Traefik with TLS on a public URL, both as in the
     [guide](../doc/nixos-keycloak-setup.md).
   - The parts of the foundation this step uses, and only those: the settings for the issuer, the audience, the signing
     keys URL and the allowed hosts and origins, `problem.py`, `domain.py`, `services/errors.py`, `SafeText`,
     `UtcDatetime`, the paging types and the response models of the tools, with the import contracts that wait for the
     first code.
   - The auth middleware, the token check, the [public routes](authentication.md#public-routes) and the MCP routes.
   - The tools `get_own_user`, to show who is logged in, `list_folders` and `list_md_documents`, to find the IDs,
     `get_md_document`, for the maximum size case, and `create_md_document`, as one write tool and for a body of the
     maximum size through the proxy. They start without `securitySchemes`, which are added only if ChatGPT needs them.
   - The `Containerfile`, whose image runs on the NixOS host, see the
     [guide](../doc/nixos-keycloak-setup.md#connector-test-app).
   - The [Connector Test App](#connector-test-app).
2. **Connector Test**: see [below](#connector-test).
3. **Realm import**: export the realm from the console as the versioned import file, with the results of the Connector
   Test in it, and test the import on a fresh installation, see the
   [guide](../doc/nixos-keycloak-setup.md#realm-export-and-import).
4. **Foundation**: replace `demo.py`, its test and its script entry with `cli.py`, and add logging and the settings and
   `schemas/` that the first step left out.
5. **First feature end to end**: the admin creates a folder with `POST /folders`, a user with a right reads it with
   `GET /folders/{folder_id}` and the MCP tool `get_folder`, and a user with no right gets 404. It goes through all
   layers: the models and migration, repositories, fakes and contract tests, services, routes, tool, `create_app()` and
   `create_production_app()`. This shows early that the layers fit together, on both adapters.
6. **Database**: the remaining models, migrations, repositories, their fakes and contract tests, and
   `hippowiki migrate`.
7. **Services**: the remaining services for users, rights, folders, tabs and md_documents with revisions and revert, and
   `hippowiki init` and `hippowiki link-admin`. The real services replace the stand-ins, and the
   [Connector Test App](#connector-test-app) is removed.
8. **Adapters**: the remaining REST routes and MCP tools.
9. **Deployment**: the complete `compose.yaml`, see [Deployment](deployment.md).

### Connector Test App

The first step has MCP tools, but no services, repositories or unit of work yet. So the test runs in its own
composition, `connector_test_app.py`, outside `create_production_app()`. The middleware, the token check, the public
routes, the MCP routes and the tools stay, with their tests. Everything below is thrown away in the Services step, so it
does not become a design for the services. Until then, the test can be repeated.

- It passes stand-in services, with only the methods the tools call, to the MCP server factory.
- It passes the middleware a credential check that runs the real token check and then looks up the subject in the test
  data.
- It reads the test data from a JSON file named by the environment variable `HIPPOWIKI_CONNECTOR_TEST_DATA`:
  - Four users, each with its Keycloak subject, name, `is_admin` and deactivated state: a linked user, a deactivated
    user, the admin, and the service account of a script client. A fifth Keycloak account stays unlinked, so it has no
    entry.
  - A folder with its default tab, and a right on it for the linked user and the service account.
  - A md_document of exactly the [maximum document size](limits.md#document-size).
- It logs the method, path and status of each request, its `Origin` and `User-Agent`, and the `azp` and `scope` of the
  token, because the test has to read these values and nothing else shows them.

### Connector Test

The login method is defined in [Authentication](authentication.md), but the local transport tests can not show whether
it works with the real clients, so this test comes before the other implementation work. It checks:

- ChatGPT logs in with the fixed client while Keycloak ignores the `resource` parameter. It runs on a Business or
  Enterprise plan, where a workspace admin first turns on developer mode, see
  [OpenAI: developer mode](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt).
- Where ChatGPT takes the client ID and secret. Its [documentation](connectors.md#why-oauth) names a predefined OAuth
  client, but does not describe the dialog.
- Whether ChatGPT needs `securitySchemes` on the tools, which [Connectors](connectors.md#why-oauth) names and
  [MCP](mcp.md#tools) does not define. The documentation says its linking UI needs them together with a tool error that
  carries `_meta["mcp/www_authenticate"]`, which HippoWiki does not send, because the 401 comes before any tool runs.
- The option "Use your own OAuth client" of Claude works for a connector added by a user, without approval by Anthropic.
  The documentation offers it on Pro and Max, and on Team plans only owners can add one.
- Claude Code works with a fixed client through `--client-id` and `--callback-port`, with the redirect URI
  `http://localhost:38765/callback`, and whether that client needs a secret.
- All clients keep working after a token refresh, and the session lifetimes are long enough that nobody has to log in
  again every day.
- Whether each client requests `offline_access`, and how long it stays logged in if it does not. The
  [documentation of Claude](https://claude.com/docs/connectors/building/authentication.md) says it adds the scope when
  the metadata of Keycloak lists it. The `scope` in the log and the offline sessions of the client in the Keycloak
  console show the result.
- Whether each client sends an `Origin`, and which one, because a foreign `Origin` gets 403, see
  [Serving the MCP App](mcp.md#serving-the-mcp-app).
- All clients accept 405 on `GET /mcp`, see [Serving the MCP App](mcp.md#serving-the-mcp-app), and a server that sends
  no session ID, see [Sessions and Principal](mcp.md#sessions-and-principal).
- How each client reacts to the 401 for a valid login with no linked user or a deactivated user, in case it keeps
  retrying the login.
- How each client reacts to the 403 for the admin account, see [Admin Account](mcp.md#admin-account), and whether the
  person sees why.
- What each client does with a `get_md_document` result at the [maximum document size](limits.md#document-size), which
  is more than some clients put into the context at once.
- A body of the largest size gets through the proxy. An AI client can not realistically write this much, so the script
  client sends a `create_md_document` call with `curl`, using a token of its service account: a body of exactly the
  [request body limit](limits.md#request-body-limit) passes the middleware, and one byte more gets the 413 problem+json
  of the app. This also tries out the [script login](connectors.md#scripts-and-web-clients).

If a client does not work this way, turn on the Keycloak feature `resource-indicators`, and `cimd` for Claude and Claude
Code only, because Keycloak does not support the metadata document of ChatGPT. Both are set when Keycloak starts, so
they apply to the whole server. If that also fails, evaluate
[Logto](https://docs.logto.io/use-cases/ai/mcp-server-enable-third-party-ai-agent-access).

The results go into [Authentication](authentication.md), including Claude Code in
[Client Registration](connectors.md#client-registration) and the session lifetimes, and this section is removed.

## Later

- Backup and restore: [Deployment](deployment.md) names `pg_dump`, but the schedule, the retention and a tested restore
  are open.
- Database monitoring: health reports liveness only, so a database outage does not show up in it.
- Erasure: deleted content and the names of deactivated users are never physically erased, so storage only grows and
  personal data stays. A permanent purge, a retention period and the handling of personal data need a design, including
  what happens to the revisions.
- Rate limits and quotas: nothing limits the requests or the storage of a user, and an AI agent can write any number of
  revisions, each up to the [maximum document size](limits.md#document-size).
- Large folder reverts: a [folder revert](history-revisions.md#folder-revert) runs in one transaction, whose size grows
  with the folder and which holds the lock on the folder row until it ends.
- Partial reads: reading part of a large md_document, so a tool result does not have to hold all of it. The
  [Connector Test](#connector-test) shows how urgent this is.
- MCP resources: the first version has tools only. Adding resources needs their errors, the identical 404 and tests
  defined, because a failed resource read is a protocol error in the SDK.
- Browser clients: same origin only for now, and no Keycloak client is defined for them. A preflight `OPTIONS` carries
  no credentials, so the auth middleware would reject it with 401. If origins get allowed, CORS wraps outside the auth
  middleware and is configured by an allowlist that is empty by default, with a preflight test.
- add Prometheus for monitoring
- add exporter to Prometheus for Database and other components
- add Grafana for visualization

## Ideas

- Admin role: more than one admin account, so that several administrators and admin scripts need not
  [share one](users.md#admin).
- Conflicting edits: a merge strategy for conflicting AI and human edits, beyond optimistic locking.
- Record the client of the token (the `azp` claim) in revisions, to tell AI edits from human edits made with the same
  account. Left out for now, because a [separate account](connectors.md#ai-agents) already shows up separately in the
  history.
- API tokens: REST accepts [OAuth tokens only](connectors.md#scripts-and-web-clients), and no token has fewer rights
  than its user.
- `md_document_links`: rebuilt for a md_document on every save. It enables **backlinks** ("what links here") and
  detection of **broken links**. When a md_document is created, dangling links pointing to it get resolved. md_documents
  have no path, only a folder, tab and name, so the link format has to be defined first.
