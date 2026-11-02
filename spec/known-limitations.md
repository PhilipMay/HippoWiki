# Known Limitations

This documents what still needs to be done and is missing.

- finish the auth concept, see [Still Missing: Authentication](#still-missing-authentication), before implementing REST and MCP
- optimistic locking via `version`
- how can md_documents, tabs, folders and users be deleted, and how can users be deactivated?
  - no column supports deactivation yet, and the credential check must reject deactivated users
  - the root admin can never be deleted or deactivated, see [Entity Rules](entity-rules.md#root-admin)
- `created_by` nullability: decide together with user deletion, because `ON DELETE SET NULL` needs the column to be nullable.
- Name rules for tabs and users: [Request Checks](request-checks.md#validation) defines the format only for folders and md_documents. [Entity Rules](entity-rules.md#names) already fixes the empty name and the name `admin`.
- versioning of md_documents, tabs and folders
- `updated_at`: [Time](time.md) describes how it is set, but no table has the column yet. Decide together with versioning whether tables get it or revisions replace it.
- REST API planning
- MCP planning
- Mounting the MCP app: open points are listed in [MCP](mcp.md#open-mounting-the-mcp-app).
- MCP resources: the first version has tools only. Adding resources needs their errors, the identical 404 and tests defined, because a failed resource read is a protocol error in the SDK.
- Search: design and implement it once it is in scope, see [Goals](goals.md), including `SearchService` and its filters.
- Attachments, other documents like pdf and images: storage (DB, filesystem, S3) and how Markdown references them.
- Multi-language support (content and search).
- Import/export (Markdown folder, Obsidian vault, frontmatter mapping).
  - It adds a pure `markdown/` package without I/O, for title, heading and section extraction and for splitting and joining YAML frontmatter.
  - It uses markdown-it-py (CommonMark-compliant, token stream for extracting headings) and PyYAML in `src/`.
- Limits: maximum document size, number of revisions to keep.
- Request body limit: the [Auth Middleware](auth-middleware.md#request-body-limit) answers 413 for a body over the limit, but its value is still open.
  - It has to leave room for the largest allowed document.
  - The reverse proxy needs a matching limit.
  - The SDK limits MCP bodies to 4 MiB by itself and answers with its own 413 body (`transport_security.py:15`). So the limit stays at or below that, or `max_request_body_size` is set as well.
- Concurrency beyond optimistic locking (merge strategy for conflicting AI/human edits?).
- Browser clients: same origin only for now. A preflight `OPTIONS` carries no credentials, so the auth middleware would reject it with 401. If origins get allowed, CORS wraps outside the auth middleware and is configured by an allowlist that is empty by default, with a preflight test.
- Hosting and TLS for remote MCP access.
- Backup and restore strategy.
- Database monitoring: health reports liveness only, so a database outage does not show up in it.

## Still Missing: Authentication

- Login method: define passwords, API tokens, OAuth or a mix, including what MCP clients need. The `users` table still has no credential column. The credential check in `auth/credentials.py`, the `WWW-Authenticate` scheme of the 401 and the login routes among the public routes depend on this decision.
- Root admin credential: `hippowiki init` creates the user without a credential until the login method is decided. Define how the root admin gets a credential, how a lost one is recovered, and that credential changes can not lock it out, since revoking its credentials would effectively deactivate it.
- Token lifecycle: define hashed storage, expiry and revocation.
- AI agents: decide whether an agent acts as its user or has its own account, and whether a token can have fewer rights than its user, such as read-only.
- Rights changes: check rights on every request, so a revoked right takes effect immediately.
- Login protection and audit: specify password hashing and rate limiting if passwords are used, and log logins and rights changes.

## Ideas

- split frontmatter and store it separately
- `md_document_links`: Rebuilt for a md_document on every save. Enables **backlinks** ("what links here") and detection of **broken links**.
  When a md_document is created, dangling links pointing to its path get resolved.
