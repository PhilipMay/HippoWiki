# Roadmap

This documents what still needs to be done and is missing, most urgent first. What is out of scope is in
[Non-Goals](goals.md#non-goals-for-now).

## Next Steps

1. **Connector setup**: everything the [Connector Test](#connector-test) needs and no server provides yet: Keycloak with
   the realm import, the reverse proxy with TLS on a public URL, for which the product has to be chosen, and the auth
   middleware and MCP routes over in-memory data, with enough tools to run the test.
2. **Connector Test**: see [below](#connector-test).
3. **Foundation**: replace `demo.py`, its test and its script entry with `cli.py`, and add the settings, logging,
   problem helper, `domain.py` and `schemas/`, with the import contracts that wait for the first code.
4. **Database**: models, migrations, repositories, their fakes, the contract tests and `hippowiki migrate`.
5. **Services**: users, rights, folders, tabs and md_documents with revisions and revert, and `hippowiki init` and
   `hippowiki link-admin`.
6. **Adapters**: the REST routes and all MCP tools.
7. **Deployment**: the `Containerfile` and the complete `compose.yaml`, see [Deployment](deployment.md).

### Connector Test

The login method is defined in [Authentication](authentication.md), but the local transport tests can not show whether
it works with the real clients, so this test comes before the other implementation work. It checks:

- ChatGPT logs in with the fixed client while Keycloak ignores the `resource` parameter.
- Whether ChatGPT needs `securitySchemes` on the tools, which [Connectors](connectors.md#why-oauth) names and
  [MCP](mcp.md#tools) does not define.
- The option "Use your own OAuth client" of Claude works for a connector added by a user, without approval by Anthropic.
  The documentation offers it on Pro and Max, and on Team plans only owners can add one.
- Claude Code works with a fixed client through `--client-id` and `--callback-port`, with the redirect URI
  `http://localhost:PORT/callback`, and whether that client needs a secret.
- All clients keep working after a token refresh, and the session lifetimes are long enough that nobody has to log in
  again every day.
- All clients accept 405 on `GET /mcp`, see [Serving the MCP App](mcp.md#serving-the-mcp-app), and a server that sends
  no session ID, see [Sessions and Principal](mcp.md#sessions-and-principal).
- How each client reacts to the 401 for a valid login with no linked user or a deactivated user, in case it keeps
  retrying the login.
- How each client reacts to the 403 for the admin account, see [Admin Account](mcp.md#admin-account), and whether the
  person sees why.
- What each client does with a `get_md_document` result at the [maximum document size](limits.md#document-size), which
  is more than some clients put into the context at once.

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
