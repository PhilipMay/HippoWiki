# HippoWiki – Pages

The wiki page feature as built: a page is a Markdown document whose title comes from its first heading. Where pages
live (folders, tabs, names and addresses) is described in `content-structure.md`, deleting and restoring pages in
`page-deletion.md`, how changes of the same page at the same time are told apart in `optimistic-locking.md`.

Code: `src/features/pages/` (the model is `Page` in `prisma/schema.prisma`, the length limits are in
`src/features/pages/limits.ts`, the title and the suggested name in `src/features/pages/derive.ts`, the Markdown
parser in `src/features/pages/markdown.ts` and the page view in `src/features/pages/components/markdownToReact.tsx`),
routes under `src/app/folders/`. Tests: `src/features/pages/derive.test.ts`, `src/features/pages/markdown.test.ts`,
`src/features/pages/schema.test.ts`,
`src/features/pages/forms.test.ts`, `src/features/pages/actions.test.ts`, `e2e/create-page.spec.ts`,
`e2e/edit-page.spec.ts`, `e2e/pages.spec.ts`, `integration/page-service.test.ts`.

## Content and title

- A page's content is Markdown, edited as raw text. It must start with a title heading, `# Title`, after optional
  blank lines; content without one is refused. Nothing else counts as a title heading: not a setext heading, not a
  `##` heading, and not a heading after any other block. The exact rule is in `titleFromContent()`.
- The title is the text of that heading, as plain text. It is never entered directly and is derived again on every
  save, so changing the heading changes the title. Titles need not be unique.
- The content is stored with plain line breaks: CRLF and CR become LF before it is checked. Its length limit counts
  the content with plain line breaks, as the editor counts it, so content that fits the editor is never refused for
  its length. Content with a NUL character is refused with a field error, because the database cannot store it.
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
  `content-structure.md`), "Edit" and "Move or rename" for a Writer and "Delete" for a Manager (see
  `folder-roles.md`), then the rendered content.
  The content's `#` heading is the page's only level-one heading; the browser tab shows the stored title.
- `?action=edit`: the content in the editor; no title or name field. Saving shows the page. A save is refused when
  the page was changed after the editor was opened; the editor then shows the page as stored (see
  `optimistic-locking.md`).
- `?action=move-or-rename`: see `content-structure.md`. `?action=delete`: see `page-deletion.md`.
- `GET /api/health`: `{ "status": "ok" }` while the database is reachable, status 503 and a logged error otherwise.

## Rendering

- The content is parsed by markdown-it, the only Markdown parser of the wiki: the title, the page view and the name
  the save dialog suggests all come from the same parse rules (`markdown.ts`).
- It supports CommonMark and these features of GitHub Flavored Markdown: tables with alignment, strikethrough, task
  lists, footnotes and links from bare addresses. What differs from GitHub: strikethrough only with `~~`, not with a
  single `~`; links from bare addresses as linkify-it finds them, which also links a bare domain with a known
  top-level domain such as `example.com`; no inline footnotes (`^[text]`), as on GitHub.
- Raw HTML is shown as text and never rendered.
- A link or image becomes one only with a relative address or an address of `http`, `https`, `mailto`, `irc`, `ircs`
  or `xmpp`; with any other address, such as `javascript:`, `vbscript:` or `data:` in any spelling, it stays its
  Markdown text.
- Markdown images are shown only from the wiki itself: the Content Security Policy (`img-src 'self' data:`, see
  "Security headers" in `architecture.md`) makes the browser block an image of another host, and a `data:` image stays
  its Markdown text.
- The page view puts text into the page only as text, never as HTML. Footnotes are listed at the end of the page, and
  their ids start with `user-content-`, so that no id of the content can clobber a global of the browser.
- If the content cannot be rendered, the page view shows its source as text and logs the error without the content;
  the page and its actions stay usable.

## Decisions

- The title is derived from the content's heading instead of being entered in a field of its own. It is still stored
  as a column, for the page lists and the browser tab.
- Pages are rendered on the server, not in the browser:
  - Rendering in the browser before a save would leave pages saved through MCP, or another client without a browser,
    without a render, and the stored HTML would not be derived from the Markdown.
  - Rendering in the browser on every view would put the page text only behind JavaScript, slow down the first
    display, and keep public pages out of search engines. The server parses the content anyway (the title, and later
    links and search).

- markdown-it parses in time linear in the length of the content: in a benchmark of the inputs that are slow for other
  parsers, it took at most about 0.1 s at the content limit, where micromark took up to 15 s and more than 60 s for
  nested lists. Its own footnote rule copies all tokens once per footnote; `markdown.ts` replaces it with a rule that
  makes the same tokens in one pass.
- The page view is converted from the tokens by code of its own instead of the HTML that markdown-it renders: no
  `dangerouslySetInnerHTML`, and the elements are the Material UI components of the rest of the app.
- Task lists are a rule of its own in `markdown.ts`, because the common plugins for them are no longer maintained.

## Current limits

- every user with a role on a folder reads all its pages; there are no roles per page (see `folder-roles.md`)
- only the last editor of a page is stored, not who created it
- a deleted page cannot be removed for good and is restored only into its own folder (see `page-deletion.md`)
- no search, no `[[wiki links]]`, no history, no attachments
- raw Markdown editing in a textarea
- the title comes only from a leading `# Title` heading: no setext headings, no front matter, no live display of the
  derived title while editing an existing page
- a page stored before titles were derived keeps its stored title until its next save
- no redirects from the previous address after a page is renamed or moved
- Markdown images only from the wiki itself: the browser blocks images of other hosts without a message in the page,
  and a `data:` image is shown as its Markdown text
- no math, heading ids, `[[wiki links]]` or syntax highlighting in the page view
