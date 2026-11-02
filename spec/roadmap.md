# Roadmap

This documents what still needs to be done and is missing, most urgent first. What is out of scope is in
[Non-Goals](goals.md#non-goals-for-now).

## Next Steps

In this order, because the later steps depend on the decisions of the earlier ones:

1. **Connector test**: try the login method of [Authentication](authentication.md) with the real clients, see
   [Connector Test](#connector-test).
2. **Size limits**: set the maximum document size, then the request body limit.
   - The middleware answers 413 for a [body over the limit](authentication.md#request-body-limit), but its value is
     still open.
   - It has to leave room for the largest allowed document.
   - The reverse proxy needs a matching limit.
   - The SDK limits MCP bodies to 4 MiB by itself and answers with its own 413 body (`transport_security.py:15`). So the
     limit stays at or below that, or `max_request_body_size` is set as well.
   - On MCP the maximum document size also bounds what one `get_md_document` puts into the context of an AI client.

## Connector Test

The login method is defined in [Authentication](authentication.md), but the local transport tests can not show whether
it works with the real clients, so this test comes before the other implementation work. It checks:

- ChatGPT logs in with the fixed client while Keycloak ignores the `resource` parameter.
- The option "Use your own OAuth client" of Claude works for a connector added by a user, without approval by Anthropic.
  The documentation does not say.
- The changing loopback port of Claude Code works with a fixed client, and which kind of client it needs.
- Both clients keep working after a token refresh, and the session lifetimes are long enough that nobody has to log in
  again every day.
- Both clients accept 405 on `GET /mcp`, see [Serving the MCP App](mcp.md#serving-the-mcp-app).
- How each client reacts to the 401 for a valid login with no linked user or a deactivated user, in case it keeps
  retrying the login.
- How each client reacts to the 403 for an admin account, see [Admin Accounts](mcp.md#admin-accounts), and whether the
  person sees why.

If a client does not work this way, turn on the Keycloak features `cimd` and `resource-indicators` for it. If that also
fails, evaluate [Logto](https://docs.logto.io/use-cases/ai/mcp-server-enable-third-party-ai-agent-access).

## Later

- MCP resources: the first version has tools only. Adding resources needs their errors, the identical 404 and tests
  defined, because a failed resource read is a protocol error in the SDK.
- Partial reads: reading part of a large md_document, so a tool result does not have to hold all of it.
- Conflicting edits: a merge strategy for conflicting AI and human edits, beyond optimistic locking.
- Browser clients: same origin only for now. A preflight `OPTIONS` carries no credentials, so the auth middleware would
  reject it with 401. If origins get allowed, CORS wraps outside the auth middleware and is configured by an allowlist
  that is empty by default, with a preflight test.
- Reverse proxy: [Deployment](deployment.md) requires one with TLS for remote MCP access, but the product is not chosen
  and `compose.yaml` has no service for it.
- Backup and restore: [Deployment](deployment.md) names `pg_dump`, but the schedule, the retention and a tested restore
  are open.
- Database monitoring: health reports liveness only, so a database outage does not show up in it.
- Erasure: deleted content and the names of deleted users are never physically erased, so storage only grows and
  personal data stays. A permanent purge, a retention period and the handling of personal data need a design, including
  what happens to the revisions.

## Ideas

- Record the client of the token (the `azp` claim) in revisions, to tell AI edits from human edits made with the same
  account. Left out for now, because a [separate account](authentication.md#ai-agents) already shows up separately in
  the history.
- Split the frontmatter and store it separately. [Time](time.md) keeps it verbatim in `content_md` for now.
- `md_document_links`: rebuilt for a md_document on every save. It enables **backlinks** ("what links here") and
  detection of **broken links**. When a md_document is created, dangling links pointing to it get resolved. md_documents
  have no path, only a folder, tab and name, so the link format has to be defined first.
