# Known Limitations

This documents what still needs to be done and is missing, most urgent first.

## Next Steps

In this order, because the later steps depend on the decisions of the earlier ones:

1. **Authentication**: finish the concept before implementing REST and MCP, see [Still Missing: Authentication](#still-missing-authentication).
2. **Revisions and optimistic locking**: [Goals](goals.md) asks for a full revision history of md_documents, tabs and folders, but [Tables and Entities](entities.md) has no revision table and no `version` column yet.
   - Define the revision tables and the `version` column that `VersionConflictError` relies on.
   - `updated_at`: [Time](time.md) describes how it is set, but no table has the column. Decide whether tables get it or revisions replace it.
   - Number of revisions to keep: any limit has to be reconciled with the goal of a full history.
3. **Delete and deactivate**: define how md_documents, tabs, folders and users can be deleted, how users can be deactivated, which right allows it and what happens to the revision history.
   - No column supports deactivation yet, and the credential check must reject deactivated users.
   - The root admin can never be deleted or deactivated, see [Entity Rules](entity-rules.md#root-admin).
   - `created_by` and `assigned_by`: decide their nullability together with user deletion, because `ON DELETE SET NULL` needs the column to be nullable.
4. **Name rules for tabs and users**: [Request Checks](request-checks.md#validation) defines the format only for folders and md_documents. [Entity Rules](entity-rules.md#names) already fixes the empty name and the name `admin`.
5. **Size limits**: set the maximum document size, then the request body limit.
   - The [Auth Middleware](auth-middleware.md#request-body-limit) answers 413 for a body over the limit, but its value is still open.
   - It has to leave room for the largest allowed document.
   - The reverse proxy needs a matching limit.
   - The SDK limits MCP bodies to 4 MiB by itself and answers with its own 413 body (`transport_security.py:15`). So the limit stays at or below that, or `max_request_body_size` is set as well.
6. **REST and MCP planning**: define the REST endpoints and the MCP tools. The open points of mounting the MCP app are listed in [MCP](mcp.md#open-mounting-the-mcp-app).

## Still Missing: Authentication

The login method comes first, because the other points depend on it.

- Login method: define passwords, API tokens, OAuth or a mix, including what MCP clients need. The `users` table still has no credential column. The credential check in `auth/credentials.py`, the `WWW-Authenticate` scheme of the 401 and the login routes among the public routes depend on this decision.
- Root admin credential: `hippowiki init` creates the user without a credential until the login method is decided. Define how the root admin gets a credential, how a lost one is recovered, and that credential changes can not lock it out, since revoking its credentials would effectively deactivate it.
- Token lifecycle: define hashed storage, expiry and revocation. A revoked right has to take effect on the next request, so a token must not carry rights that are not checked again.
- AI agents: decide whether an agent acts as its user or has its own account, and whether a token can have fewer rights than its user, such as read-only.
- Login protection and audit: specify password hashing and rate limiting if passwords are used, and log logins and rights changes.

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
