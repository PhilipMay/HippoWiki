# HippoWiki – Pages

The wiki page feature as built: a page is a Markdown document whose title comes from its first heading. Where pages
live (folders, tabs, names and addresses) is described in `content-structure.md`, deleting and restoring pages in
`page-deletion.md`, how changes of the same page at the same time are told apart in `optimistic-locking.md`.

Code: `src/features/pages/` (the model is `Page` in `prisma/schema.prisma`, the length limits are in
`src/features/pages/limits.ts`, the title and the suggested name in `src/features/pages/derive.ts`, the Markdown
parser in `src/features/pages/markdown.ts` and the page view in `src/features/pages/components/markdownToReact.tsx`),
routes under `src/app/folders/`. Tests: `src/features/pages/derive.test.ts`, `src/features/pages/markdown.test.ts`,
`src/features/pages/markdown.cost.test.ts`, `src/features/pages/schema.test.ts`,
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
- The Markdown of the content has two limits besides its length, both in `src/features/pages/limits.ts` and checked
  at every save, in the browser and through MCP, with a field error at the content:
  - lists and quotes nested at most 20 deep, a list or quote inside another counting one level more: far more than a
    page needs, and it keeps the parse and the page view flat;
  - at most 10,000 table cells in all, counting the empty cells that fill a row up to the columns of its header: a
    small table with a header of many columns and many short rows would otherwise make a page view of millions of
    cells.
- The content of a page is validated when it is created or edited, and when it is reverted to an earlier revision,
  with the limits in force at the time of the revert (see `page-history.md`). Moving or renaming neither validates nor
  touches it, so a limit lowered later never blocks them.
- Every content change is recorded as a revision of the page; a save without a change records none and leaves the
  page itself as it is too (see "Saves without a change" and `page-history.md`).
- The forms send only what they change; a submitted title is ignored. The service validates again before it writes.

## Saves without a change

- A content save whose content is the same as the stored content of the page, in the browser editor or with
  `replace_page_content` through MCP, stores nothing: the page keeps its last editor, its channel, the time of its
  last change and its version, and no revision is recorded. So the last editor and the time name only who really
  changed the page, as its history does, and an empty save never makes the editor or dialog of another user fail as
  changed.
- Content counts as the same when it is equal once its line breaks are made plain, as the content is stored; any other
  difference, such as a space or an empty line at the end, is a change. Only the content is compared: a page whose
  stored title differs from the title its content gives keeps it, too.
- Such a save is checked like every other content save, in the same order: the role first, then the content with the
  limits in force, then the version it is based on. Content over a limit lowered after the page was stored is refused
  with the error of that limit, also when it is the stored content; a save based on another version than the page
  has, or on none, is refused as changed (see `optimistic-locking.md`); a save of a deleted page as gone.
- The browser and MCP answer as after every save: the editor leads to the page address without a notice, and
  `replace_page_content` returns the page with the version the call stated (see `mcp.md`).
- The server log records such a save in a line of its own, with the page and the channel, and not as "page updated",
  so that an operator sees which saves changed a page.
- Moving or renaming a page to its own name and place is no content save, but stores nothing either: the page keeps
  its last editor, its channel, the time of its last change and its version (see "Moving or renaming a page to its own
  name and place" in `content-structure.md`). Renaming a folder or tab to its own name stores nothing as well (see
  "Renaming to the same name" there). A revert always changes the content.

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
- The page address: the breadcrumb, the last update with its last editor and how it was made ("Last updated <time> by
  mike via mcp", see "Last editor" in `content-structure.md`), "Edit" and "Move or rename" for a Writer, "Delete" for a
  Manager (see `folder-roles.md`) and "History" for every role, then the rendered content.
  The content's `#` heading is the page's only level-one heading; the browser tab shows the stored title.
- `?action=edit`: the content in the editor; no title or name field. Saving shows the page. A save is refused when
  the page was changed after the editor was opened; the editor then shows the page as stored (see
  `optimistic-locking.md`).
- `?action=move-or-rename`: see `content-structure.md`. `?action=delete`: see `page-deletion.md`.
- `?view=history`, `?view=revision`, `?view=compare` and `?action=revert`: see `page-history.md`.
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

## The cost of the Markdown parse

The Markdown parse runs on the server at every save (twice in the browser, see "Decisions"), at every view of a page,
deleted pages and the delete dialog included, and in the browser when the save dialog suggests a name. It is the
costliest function of a page, and its guards are:

- The parse is linear in the length of the content: at the content limit its worst case, measured with the inputs
  that are slow for other parsers, takes about 0.1 s for the parse and well below 1 s with the page view. The page
  view of a table is its costliest case: a header of 3,000 columns with 3,000 rows of one cell becomes about 66,000
  cells and takes about 0.3 s on a developer machine and about three times as long on the CI runner.
  `src/features/pages/markdown.cost.test.ts` keeps these inputs below 2 s each, in a run of its own without coverage.
- The length of the content is checked before any parse, also in the MCP tool `create_page`, which checks the content
  before it derives a name from it.
- The depth of lists and quotes and the number of table cells are checked at every save (see "Content and title"),
  so that no page can be saved whose view is deep or large.
- markdown-it nests blocks only to `maxNesting` (`markdown.ts`), and the page view is built without recursion over the
  blocks, so no content can overflow the stack. If the page view fails anyway, it shows the source as text.

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
- The rows and cells of a table are plain elements, styled once at the table with the look of the small `TableCell` of
  Material UI: a `TableCell` costs about five times as much to render, and with it the page view of the largest table
  took about 0.7 s on a developer machine and more than 2 s on the CI runner.
- Task lists are a rule of its own in `markdown.ts`, because the common plugins for them are no longer maintained.
- A save in the browser validates the content in the form and again in the service, as `architecture.md` asks, and
  each validation parses it once. With a linear parse of at most about 0.1 s at the content limit, the second parse
  costs less than giving up the second validation.
- The depth and the cells are limited at save instead of parsing in a worker thread with a time limit: the parse is
  linear on every input measured, and a limit at save tells the author what to change.
- A save without a change stores nothing, so that the last editor, the time and the version name only real changes.
  Rejected: storing the page all the same, which made the user the last editor and refused the save of every other
  open editor.
- A save without a change is refused like every other save when it is based on an older version, so that one rule
  holds for every save and every caller. Rejected: accepting it because it would overwrite nothing.
- A save without a change is checked against the limits like every other save, so that the editor never accepts
  content it could not store. Rejected: letting it pass unchecked because it stores nothing.
- Content saves of pages store nothing without a change, because they are the saves that the history compares with;
  renames of folders and tabs to their own name, and moves and renames of pages to their own name and place, store
  nothing as well (see `content-structure.md`).
- The browser and MCP answer as after every save. Rejected: a notice in the browser and an extra field in the MCP
  result, which a user or an AI app does not need to go on.
- The log tells a save without a change from a stored one, so that an operator reading it sees which saves changed a
  page. Rejected: logging both as "page updated"; logging nothing.

## Current limits

- every user with a role on a folder reads all its pages; there are no roles per page (see `folder-roles.md`)
- only the last editor of a page is stored, not who created it; recording who created it is not planned
- a deleted page cannot be removed for good, which is not planned, and is restored only into its own folder, as a
  lasting rule (see `page-deletion.md`)
- a page has one content in one language; the same page in several languages is not planned
- no search, no `[[wiki links]]`, no attachments
- raw Markdown editing in a textarea
- the title comes only from a leading `# Title` heading: no setext headings, no front matter, no live display of the
  derived title while editing an existing page
- a page stored before titles were derived keeps its stored title until its next change of the content; a save without
  a change keeps it as well
- no redirects from the previous address after a page is renamed or moved
- Markdown images only from the wiki itself: the browser blocks images of other hosts without a message in the page,
  and a `data:` image is shown as its Markdown text
- no math, heading ids, `[[wiki links]]` or syntax highlighting in the page view
- a page stored before the limits on depth and table cells that goes past them can be viewed, moved and deleted, but
  saved only once it is within them; its view drops the levels past what markdown-it nests and fills table rows only
  up to about 65,000 empty cells
- inline Markdown nested past `maxNesting` of `markdown.ts` shows as text
