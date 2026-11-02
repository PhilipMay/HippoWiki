# Known Limitations

This documents what still needs to be done and is missing, most urgent first. The [Implementation Plan](implementation-plan.md) says which code waits for which of these decisions.

## Next Steps

In this order, because the later steps depend on the decisions of the earlier ones:

1. **Authentication**: finish the open points of the login method, see [Authentication](#authentication).
2. **Revisions and optimistic locking**: [Goals](goals.md) asks for a full revision history of md_documents, tabs and folders, but [Tables and Entities](entities.md) has no revision table and no `version` column yet.
   - Define the revision tables and the `version` column that `VersionConflictError` relies on.
   - `updated_at`: [Time](time.md) describes how it is set, but no table has the column. Decide whether tables get it or revisions replace it.
   - Number of revisions to keep: any limit has to be reconciled with the goal of a full history.
3. **Delete and deactivate**: define how md_documents, tabs, folders and users can be deleted, how users can be deactivated, which right allows it and what happens to the revision history.
   - No column supports deactivation yet, and the credential check must reject deactivated users.
   - The root admin can never be deleted or deactivated, see [Entity Rules](entity-rules.md#root-admin).
   - `created_by` and `assigned_by`: decide their nullability together with user deletion, because `ON DELETE SET NULL` needs the column to be nullable.
4. **Size limits**: set the maximum document size, then the request body limit.
   - The [Auth Middleware](auth-middleware.md#request-body-limit) answers 413 for a body over the limit, but its value is still open.
   - It has to leave room for the largest allowed document.
   - The reverse proxy needs a matching limit.
   - The SDK limits MCP bodies to 4 MiB by itself and answers with its own 413 body (`transport_security.py:15`). So the limit stays at or below that, or `max_request_body_size` is set as well.
5. **REST and MCP planning**: define the REST endpoints and the MCP tools.
   - Lists: a list can be arbitrarily large, and on MCP a large tool result goes straight into the context of an AI client. Define the page size, a maximum, cursor or offset, and whether lists return `content_md`. [Time](time.md) already has the tie-breaker rule that a stable order needs.
   - Own account: users can not read their own user record, and non-admins can not list users, so a `created_by` ID can not be turned into a name. Define how they find both.

## Authentication

Decided: hosted MCP connectors log in with OAuth 2.1 and PKCE, because the clients named in [Goals](goals.md) need it, and HippoWiki is the protected resource.

- ChatGPT needs OAuth for an authenticated server: protected resource metadata, an authorization server with discovery metadata, and the authorization code flow with PKCE and S256. It can not present API keys or customer mTLS certificates, and does not support machine-to-machine grants ([OpenAI: Authentication](https://developers.openai.com/plugins/build/auth)). The tools declare `securitySchemes`, and the `resource` parameter sets the audience of the tokens ([OpenAI: full documentation](https://developers.openai.com/plugins/llms-full.txt)).
- Claude documents OAuth with discovery from a 401 carrying `WWW-Authenticate: Bearer resource_metadata=...` ([Claude: connector authentication](https://claude.com/docs/connectors/building/authentication.md), [Claude: custom connectors](https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers)). It also lists authless servers, which [Goals](goals.md) rules out, and a request-header option whose details could not be confirmed.
- The local transport tests can not show whether this works, so the [real connector test](implementation-plan.md#steps) comes early.

Still open:

- Authorization server: run one or use an external identity provider. This decides the login routes among the public routes, and how clients register: ChatGPT can use Client ID Metadata Documents, dynamic client registration or a predefined client ([OpenAI: custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server)). OpenAI's pages disagree on the redirect URI, so copy it from the management page when setting this up.
- Scripts and web clients: decide whether REST also accepts API tokens, or OAuth only.
- User mapping: decide how a token maps to a row in `users`, which still has no column for this. The credential check in `auth/credentials.py` depends on it, and it must check the audience of the token.
- Root admin credential: `hippowiki init` creates the user without a credential until this is decided. Define how the root admin gets a credential, how a lost one is recovered, and that credential changes can not lock it out, since revoking its credentials would effectively deactivate it.
- Token lifecycle: define expiry and revocation, and hashed storage for anything HippoWiki stores itself. A revoked right has to take effect on the next request, so a token must not carry rights that are not checked again.
- AI agents: decide whether an agent acts as its user or has its own account, and whether a token can have fewer rights than its user, such as read-only.
- Login protection and audit: specify password hashing and rate limiting if HippoWiki handles passwords itself, and log logins and rights changes.

## Later

- MCP resources: the first version has tools only. Adding resources needs their errors, the identical 404 and tests defined, because a failed resource read is a protocol error in the SDK.
- Conflicting edits: a merge strategy for conflicting AI and human edits, beyond optimistic locking.
- Browser clients: same origin only for now. A preflight `OPTIONS` carries no credentials, so the auth middleware would reject it with 401. If origins get allowed, CORS wraps outside the auth middleware and is configured by an allowlist that is empty by default, with a preflight test.
- Reverse proxy: [Deployment](deployment.md) requires one with TLS for remote MCP access, but the product is not chosen and `compose.yaml` has no service for it.
- Backup and restore: [Deployment](deployment.md) names `pg_dump`, but the schedule, the retention and a tested restore are open.
- Database monitoring: health reports liveness only, so a database outage does not show up in it.

## Out of Scope for Now

These need a design once they come into scope, see [Goals](goals.md).

- Search: including `SearchService`, its filters and multi-language search.
- Multi-language content.
- Attachments and other documents like pdf and images: storage (DB, filesystem, S3) and how Markdown references them.
- Import/export (Markdown folder, Obsidian vault, frontmatter mapping).
  - It adds a `markdown/` package used by the services, pure and without I/O so it is easy to unit test, for title, heading and section extraction and for splitting and joining optional YAML frontmatter.
  - It uses markdown-it-py (CommonMark-compliant, token stream for extracting headings) and PyYAML in `src/`.

## Ideas

- Split the frontmatter and store it separately. [Time](time.md) keeps it verbatim in `content_md` for now.
- `md_document_links`: rebuilt for a md_document on every save. It enables **backlinks** ("what links here") and detection of **broken links**. When a md_document is created, dangling links pointing to it get resolved. md_documents have no path, only a folder, tab and name, so the link format has to be defined first.
