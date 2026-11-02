# Known Limitations

This documents what still needs to be done and is missing.

- contraints for names are missing
- auth concept: before REST and MCP
- optimistic locking (Optimistic locking via `version`)
- how can md_documents, tabs and folders be deleted?
- `created_by` nullability: decide together with user deletion, because `ON DELETE SET NULL` needs the column to be nullable.
- Name rules for tabs and users: [Architecture](architecture.md) defines the format only for folders and documents.
- versioning of documents, tabs and folders
- `updated_at`: [Time](time.md) describes how it is set, but no table has the column yet. Decide together with versioning whether tables get it or revisions replace it.
- REST API plannning
- MCP planning
- MCP resources: the first version has tools only. Adding resources needs their errors, the identical 404 and tests defined, because a failed resource read is a protocol error in the SDK.
- Search is out of scope for now, see [Goals](goals.md). Design and implement it later, including `SearchService` and its filters.
- Attachments, other documents like pdf and images: storage (DB, filesystem, S3) and how Markdown references them.
- Multi-language support (content and search).
- Import/export (Markdown folder, Obsidian vault, frontmatter mapping).
- Limits: maximum document size, number of revisions to keep.
- Concurrency beyond optimistic locking (merge strategy for conflicting AI/human edits?).
- Web UI (out of scope for now, REST API first).
- Hosting and TLS for remote MCP access.
- Backup and restore strategy.
- Database monitoring: health reports liveness only, so a database outage does not show up in it.
- **Mounting the MCP app needs more than the spec describes** (`architecture.md:50`, `:67-68`, `deployment.md:12`)
  - Lifespan: `app.py` lists only the DB engine, but the session manager must run in the lifespan of the parent app,
    because Starlette does not run the lifespan of mounted apps. Otherwise requests fail with "Task group is not
    initialized" (`streamable_http_manager.py:140-146`, `:185`).
  - Path: `streamable_http_path` defaults to `/mcp`, so mounting at `/mcp` results in `/mcp/mcp`
    (`mcpserver/server.py:1291`).
  - Host check: by default the SDK enables DNS rebinding protection that allows only localhost hosts and origins
    (`mcpserver/server.py:1164-1168`). Behind the required reverse proxy, real requests would be rejected. The MCP
    transport tests run on a local port and can not notice this, so it needs a setting in the configuration.
- **Unknown fields are not rejected on MCP** (`api.md:12`, `:31`, `architecture.md:38-39`, `testing.md:37`)
  - The spec says request models forbid unknown fields and that both interfaces behave identically.
  - In `mcp` 2.3.0 the generated argument model has no `extra="forbid"` (`mcpserver/utilities/func_metadata.py:96-112`),
    so unknown top-level tool arguments are silently dropped. An AI client that misspells an optional argument gets
    success instead of an error.
  - Suggestion: decide whether to enforce this on MCP, for example with a wrapper, or document it as an accepted
    difference. Add a test either way, because the check order tests only cover "the body".

## Still Missing: Authentication

- Login method: define passwords, API tokens, OAuth or a mix, including what MCP clients need. The `users` table still has no credential column. The credential check in the auth middleware and the login routes among the public routes depend on this decision.
- Root admin credential: `hippowiki init` creates the user without a credential until the login method is decided. Define how the root admin gets a credential, how a lost one is recovered, and that credential changes can not lock it out, since revoking its credentials would effectively disable it.
- Token lifecycle: define hashed storage, expiry and revocation.
- AI agents: decide whether an agent acts as its user or has its own account, and whether a token can have fewer rights than its user, such as read-only.
- Rights changes: check rights on every request, so a revoked right takes effect immediately.
- Login protection and audit: specify password hashing and rate limiting if passwords are used, and log logins and rights changes.

## Ideas

- split frontmatter and store it seperately
- `document_links`: Rebuilt for a document on every save. Enables **backlinks** ("what links here") and detection of **broken links**.
  When a document is created, dangling links pointing to its path get resolved.
