# Goals and Non-Goals

## Goals

- A **knowledge management server** whose content consists of **Markdown documents**.
- **One core, two front doors**:
  - **MCP** (Model Context Protocol) so that AI systems like Claude and ChatGPT can list, read and write knowledge.
  - **REST API** so that web clients, scripts and other services can do the same.
- **Multi-user** with an **admin** role and a permanent **root admin**.
- **Authenticated access only**: every request needs an authenticated user, there is no public or anonymous access to
  md_documents, tabs, folders, users or the API description. The only exceptions are the health route and the routes the
  login method needs, which expose no content. They are listed in [Architecture](architecture.md).
- Implemented in **Python**, with PostgreSQL as the only data store.
- Full **revision history** of every md_document, tab and folder (important when AI agents edit content).

## Non-Goals (for now)

- No web UI. The REST API is designed so that any frontend can be built on top of it later.
- No search.
- No file-based storage. Markdown lives in the database.
- No file storage like images or other documents like .doc or .ppt files.
