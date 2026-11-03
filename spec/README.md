# HippoWiki Specification

Each topic has one home here, and other documents link to it.

## Read in Order

Read these in order for a first overview:

01. [Goals and Non-Goals](goals.md): what HippoWiki is and is not.
02. [Architecture](architecture.md): the big picture, composition and transactions.
03. [Content](content.md): folders, tabs, md_documents, names, deleting and restoring.
04. [Rights](rights.md): who can do what in a folder.
05. [Users](users.md): own account, the admin, passwords and deactivating.
06. [History and Revisions](history-revisions.md): tracked changes, versions and revert.
07. [Request Checks](request-checks.md): check order, leaks and deleted items.
08. [Authentication](authentication.md): token check, the auth middleware and public routes.
09. [REST](rest.md): the routes and the response fields.
10. [MCP](mcp.md): the tools and what else is specific to the MCP adapter.

## Look Up When Needed

Rules and reference:

- [Errors](errors.md): the REST error format and MCP tool errors.
- [Lists](lists.md): paging and list order, on REST and MCP.
- [Limits](limits.md): every fixed limit, with document size and request body size.
- [Time](time.md): how points in time are stored and sent.
- [Connectors](connectors.md): how AI agents, scripts and web clients log in, and why OAuth.
- [OAuth Server](oauth-server.md): the built-in login: clients, login page, tokens and login protection.

Implementation:

- [Database Tables](database.md): tables, indexes and constraints.
- [Tech Stack](tech-stack.md): the chosen technologies.
- [Package Layout](package-layout.md): the code structure and the layer rules.
- [Implementation Notes](implementation-notes.md): library behaviour to work around, by library.
- [Testing](testing.md): the test kinds.
- [Test Cases](test-cases.md): the cases that are easy to miss.

Operations and planning:

- [Deployment](deployment.md): containers, the reverse proxy and backups.
- [Configuration and Failure Modes](configuration-and-failure-modes.md): what to configure for each component and what
  can go wrong.
- [Roadmap](roadmap.md): next steps and open points.

## Glossary

- **md_document**: a Markdown document. It belongs to a tab, and a tab belongs to a folder.
- **default tab**: the tab named "" that every folder has.
- **live**: an item is live when it and all its parents are not deleted.
- **hidden**: an item the user can not see, because they have no right on its folder or it is deleted. It gets the same
  response as a missing item, apart from the exceptions in [Deleted Items](request-checks.md#deleted-items).
- **admin**: the one permanent administrator, a user named `admin`, who has no access to content.
- **principal**: the authenticated user of a request, as the services receive it.
- **credential check**: the step that turns a token into a principal, by looking up the hash of the token and its user.
- **trusted client**: a product on the allowlist of the [OAuth Server](oauth-server.md#trusted-clients), which logs in
  with the URL of its metadata document.
- **own client**: a client the operator created on the server, see [Own Clients](oauth-server.md#own-clients).
- **family**: the tokens that came from one authorization code, see [Tokens](oauth-server.md#tokens).
- **unit of work**: one database session and transaction. Each public service method uses one, and the credential lookup
  has its own.
- **entry**: one numbered change in the history of a folder.
- **revision**: a full snapshot of an item, written with an entry.
- **version**: the counter of a md_document, which grows with each of its revisions.
- **number**: the position of an entry in the history of a folder, taken from the revision counter of the folder.
- **(service)**: marks a rule that table constraints can not express, so the service layer enforces it.
