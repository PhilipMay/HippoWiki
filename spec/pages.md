# HippoWiki – Pages

The wiki page feature as built: a page is a Markdown document whose title comes from its first heading. Where pages
live (folders, tabs, names and addresses) is described in `content-structure.md`, deleting and restoring pages in
`page-deletion.md`.

Code: `src/features/pages/` (the model is `Page` in `prisma/schema.prisma`, the length limits are in
`src/features/pages/limits.ts`, the title and the suggested name in `src/features/pages/derive.ts`), routes under
`src/app/folders/`. Tests: `src/features/pages/derive.test.ts`, `src/features/pages/schema.test.ts`,
`src/features/pages/forms.test.ts`, `src/features/pages/actions.test.ts`, `e2e/create-page.spec.ts`,
`e2e/edit-page.spec.ts`, `e2e/pages.spec.ts`, `integration/page-service.test.ts`.

## Content and title

- A page's content is Markdown, edited as raw text. It must start with a title heading, `# Title`, after optional
  blank lines; content without one is refused. Nothing else counts as a title heading: not a setext heading, not a
  `##` heading, and not a heading after any other block. The exact rule is in `titleFromContent()`.
- The title is the text of that heading, as plain text. It is never entered directly and is derived again on every
  save, so changing the heading changes the title. Titles need not be unique.
- The content of a page is validated when it is created or edited. Moving or renaming neither validates nor touches
  it, so a limit lowered later never blocks them.
- The forms send only what they change; a submitted title is ignored. The service validates again before it writes.

## Name

- A new page gets a name suggested from its title in the save dialog (`deriveName()`); the user can change it. A
  title in a non-Latin script suggests no name.
- The name never changes automatically, also not when the heading changes. Renaming is described in
  `content-structure.md`.

## Routes

A page has the address `/folders/<folder>/<page>.md` or, in a tab, `/folders/<folder>/<tab>/<page>.md`. Actions are
given as `?action=<action>` (see `content-structure.md`).

- `?action=new` on a folder or tab address: the editor for a new page. The content comes first; "Save" checks on the
  client that it has a title, then asks for the name and the place in the "Save page" dialog, which shows the address
  the page will get. Saving shows the new page.
- The page address: the breadcrumb, the last update with its last editor (see "Last editor" in
  `content-structure.md`), "Edit", "Move or rename" and "Delete", then the rendered content.
  The content's `#` heading is the page's only level-one heading; the browser tab shows the stored title.
- `?action=edit`: the content in the editor; no title or name field. Saving shows the page.
- `?action=move-or-rename`: see `content-structure.md`. `?action=delete`: see `page-deletion.md`.
- `GET /api/health`: `{ "status": "ok" }` while the database is reachable, status 503 and a logged error otherwise.

## Rendering

- The content is rendered as GitHub Flavored Markdown. Raw HTML is shown as text, and unsafe link addresses are
  removed.
- Markdown images are shown only from the wiki itself: the Content Security Policy (`img-src 'self' data:`, see
  "Security headers" in `architecture.md`) makes the browser block an image of another host, and an image whose
  address react-markdown does not keep, such as a `data:` address, is left out of the page.

## Decisions

- The title is derived from the content's heading instead of being entered in a field of its own. It is still stored
  as a column, for the page lists and the browser tab.
- Pages are rendered on the server, not in the browser:
  - Rendering in the browser before a save would leave pages saved through MCP, or another client without a browser,
    without a render, and the stored HTML would not be derived from the Markdown.
  - Rendering in the browser on every view would put the page text only behind JavaScript, slow down the first
    display, and keep public pages out of search engines. The server parses the content anyway (the title, and later
    links and search).

## Current limits

- no rights: everyone who is logged in can read and change every page (see `users-and-login.md`)
- only the last editor of a page is stored, not who created it
- a deleted page cannot be removed for good and is restored only into its own folder (see `page-deletion.md`)
- no search, no `[[wiki links]]`, no history, no attachments
- raw Markdown editing in a textarea
- the title comes only from a leading `# Title` heading: no setext headings, no front matter, no live display of the
  derived title while editing an existing page
- a page stored before titles were derived keeps its stored title until its next save
- no redirects from the previous address after a page is renamed or moved
- Markdown images only from the wiki itself: the browser blocks images of other hosts without a message in the page,
  and a `data:` image is left out of it
