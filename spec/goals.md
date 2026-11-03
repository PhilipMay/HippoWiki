# Goals and Non-Goals

## Goals

- A **knowledge management server** whose content consists of **Markdown documents**.
- **One core, two front doors**:
  - **MCP** (Model Context Protocol) so that AI systems like Claude and ChatGPT can list, read and write knowledge. It
    is not open to the admin and offers no admin operations.
  - **REST API** so that a web GUI, scripts and other services can do the same. It is the only way to administer the
    system.
- **Multi-user** with one permanent **admin**, who manages users, folders and rights and has no access to content.
- **Authenticated access only**: every request needs an authenticated user, there is no public or anonymous access to
  md_documents, tabs, folders, users or the API description. The only exceptions are the
  [public routes](authentication.md#public-routes), which expose no content.
- Implemented in **Python**, with PostgreSQL as the only data store.
- Full **revision history** of every md_document, tab and folder (important when AI agents edit content).

## Non-Goals (for now)

Search, multi-language content, attachments and import or export need a design once they come into scope.

- No web UI yet. A Web GUI for admins and normal users comes [later](roadmap.md#later). Supporting it is the main
  purpose of the REST API, which is designed so that any frontend can be built on top of it.
- No search, including `SearchService`, its filters and multi-language search.
- No multi-language content.
- No file-based storage. Markdown lives in the database.
- No attachments or other files like images, pdf, .doc or .ppt. A design has to cover their storage (DB, filesystem, S3)
  and how Markdown references them.
- No import or export (Markdown folder, Obsidian vault, frontmatter mapping).
  - It adds a `markdown/` package used by the services, pure and without I/O so it is easy to unit test, for title,
    heading and section extraction and for splitting and joining optional YAML frontmatter.
  - It uses markdown-it-py (CommonMark-compliant, token stream for extracting headings) and PyYAML in `src/`.

What comes next is in the [Roadmap](roadmap.md).
