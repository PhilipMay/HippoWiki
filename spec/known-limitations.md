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
