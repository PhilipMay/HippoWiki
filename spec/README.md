# HippoWiki Specification

Each topic has one home here, and other documents link to it. Documents open with their rules, and library details are
in an "Implementation Notes" section at the end.

## Reading Order

Read these in order for a first overview:

1. [Goals and Non-Goals](goals.md): what HippoWiki is and is not.
2. [Architecture](architecture.md): the stack, the package layout and the layer rules.
3. [Entities](entities.md): content rules and database tables.
4. [Users and Rights](users-and-rights.md): who can do what, and the user lifecycle.
5. [History and Revisions](history-revisions.md): tracked changes, versions and revert.
6. [Request Checks](request-checks.md): check order, rejected operations and error format.
7. [Authentication](authentication.md): login, token check and the auth middleware.
8. [MCP](mcp.md): what is specific to the MCP adapter.

Look these up when you need them:

- [Time](time.md): how points in time are stored and sent.
- [Testing](testing.md): the test kinds and the cases that are easy to miss.
- [Deployment](deployment.md): containers, Keycloak, the reverse proxy and backups.
- [Roadmap](roadmap.md): next steps and open points.
- [Gaps](gaps.md): open gaps in the specification, with suggested fixes.

## Glossary

- **md_document**: a Markdown document. It belongs to a tab, and a tab belongs to a folder.
- **default tab**: the tab named "" that every folder has.
- **live**: an item is live when it and all its parents are not deleted.
- **hidden**: an item the user can not see, because they have no right on its folder or it is deleted. It gets the same
  response as a missing item, apart from the exceptions in [Deleted Items](request-checks.md#deleted-items).
- **root admin**: the one permanent admin, a user named `admin`.
- **principal**: the authenticated user of a request, as the services receive it.
- **credential check**: the step that turns a token into a principal, by verifying the token and looking up the user.
- **unit of work**: one database session and transaction. Each public service method uses one, and the credential lookup
  has its own.
- **entry**: one numbered change in the history of a folder.
- **revision**: a full snapshot of an item, written with an entry.
- **version**: the counter of a md_document, which grows with each of its revisions.
- **number**: the position of an entry in the history of a folder, taken from the revision counter of the folder.
