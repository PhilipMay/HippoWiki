# Goals and Non-Goals

## Goals

- A **wiki server** whose content consists of **Markdown documents**.
- A **REST API** as the one way in. The web client uses it, and scripts can use it in the same way. It is also the only
  way to administer the system.
- A **web client** on top of the REST API. Its details are planned later, see [Web Client](roadmap.md#web-client).
- **Multi-user** with one permanent **admin**, who manages users, folders and rights and has no access to content.
- **Authenticated access only**: every request needs an authenticated user, there is no public or anonymous access to
  md_documents, tabs, folders, users or the API description. The only exceptions are the
  [public routes](authentication.md#public-routes), which expose no content.
- Implemented in **Python**, with PostgreSQL as the only data store.
- Full **revision history** of every md_document, tab and folder.

## Non-Goals (for now)

Search, multi-language content, attachments and import or export need a design once they come into scope.

- No MCP and no OAuth. They come after the pure wiki works.
- No search.
- No multi-language content.
- No file-based storage. Markdown lives in the database.
- No attachments or other files like images, pdf, .doc or .ppt. A design has to cover their storage (DB, filesystem, S3)
  and how Markdown references them.
- No import or export.

What comes next is in the [Roadmap](roadmap.md).
