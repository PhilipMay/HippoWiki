# Wiki Links – Steps

## Goal

Writers and AI apps link one page of a folder to another with `[[target]]` or `[[target|label]]`, where the target
names the page as its address does. The page view renders such a link as a link to the page it names, marks a link
whose page does not exist and leads Writers to create that page; the Markdown editor shows the links in live preview
and offers a picker on `[[`. A move or rename of a page and a rename of a tab update the links to it in the same
write, and a page shows which pages link to it, in the browser and through `read_page`. The requirements are
`spec/wiki-links-requirements.md` (R1 to R33); every step names the requirements it covers.

## Scope

- In: wiki links within one folder; their rendering wherever content is rendered; the marking of missing links and
  creating a page from one, with a preset name on `?action=new`; live preview, marking and a `[[` picker in the
  Markdown editor; updating the links on a rename or move of a page and a rename of a tab, with a marked revision of
  every updated page; backlinks of a page in the browser and in `read_page`; the link grammar in the MCP instructions;
  a limit of 5,000 wiki links per page; an index of the links of every page, derived for the existing pages before the
  server serves.
- Not in:
  - links across folders;
  - section links (`[[page#section]]`), heading ids and embeds (`![[page]]`);
  - a list of the broken links of a folder and a list of pages that nothing links to, which stay on the roadmap;
  - redirects from old addresses, which stay on the roadmap;
  - updating links on a restore or a revert, and updating the links of deleted pages;
  - treating relative Markdown links to page addresses as wiki links: they keep working as today and are not updated
    on a rename;
  - formatted labels.

## Sessions

- Stop after "Link updates on a tab rename": the first session builds everything the server does and the page view
  and MCP show, the second the editor, the spec tests and the wrap-up.

## Checklist

- [x] Wiki link syntax and plain text
- [x] New page with a preset name
- [x] Rendering and missing links
- [x] Link index and backlinks
- [x] Link updates on a page move or rename
- [ ] Link updates on a tab rename
- [ ] Wiki links in live preview
- [ ] The `[[` picker
- [ ] Spec tests
- [ ] Wrap-up

## Wiki link syntax and plain text

### Goal

The one Markdown parser of the wiki knows wiki links: where they are, their target and label, and where the target
stands in the content. The title, the suggested name and the search text count a wiki link as its label or its target
as written; a save with more than 5,000 wiki links is refused; and the MCP instructions state the grammar. The page
view shows a wiki link as its text until "Rendering and missing links" makes it a link.

Requirements: R1, R4, R5 (the reading of a target), R13, R16, R18, R23, R25, R26, R31.

### Build

- The target rule (R1, R5, R13, R25): a target is a page name, or a tab name, one `/` and a page name, each following
  the name rule of `src/lib/names.ts` with its length limit and written exactly; anything else, a `#` included, is a
  target that breaks the rule. The rule lives in a pure module of the pages feature without imports of Zod or
  markdown-it, such as `src/features/pages/wiki-link-target.ts`, so that the editor can use it later; the pattern of a
  name moves where both `names.ts` and this module can import it without pulling in Zod (for example next to
  `NAME_MAX_LENGTH` in `src/lib/name-limits.ts`). A target names a page of the own folder only: the first part of
  `tab/name` is always a tab of the folder (R1).
- An inline rule `wiki_link` in `src/features/pages/markdown.ts`, before the rule of links: `[[`, the target up to the
  first `|` or `]]`, then an optional label up to `]]`, all on one line (R4, R31). It makes a token `wiki_link` with
  the target as written, the label or none, and the parsed target or the reason it is invalid. Code spans, code blocks
  and an escaped `\[` stay text, because markdown-it consumes them before the rule runs (R31). The label is plain text:
  the rule does not parse Markdown in it (R18). In a table cell markdown-it has already turned `\|` into `|`, so
  `[[setup\|Setup]]` there has the label "Setup" (R18). `![[setup]]` is the text `!` and a wiki link, because the
  image rule finds no image (R25).
- The position of every target in the content: the rule records where the target starts in the source, from the line
  map of its block and its place in the line, so that a rewrite in "Link updates on a page move or rename" replaces
  exactly the target and nothing else. Lines inside lists, quotes, tables and footnotes, whose block content markdown-it
  strips of its marks and indents, need care; a cell with `\|` before a link shifts the cell content.
- `src/features/pages/wiki-links.ts`, pure: `wikiLinksOf(content)`, the wiki links of the content in order, each with
  its target as written, its parsed target, its label and the position of its target, for the later steps.
- `plainText()` of `markdown.ts` adds the label of a wiki link, or its target as written without a label (R23), so
  that the title (`titleFromTokens()`) and the suggested name (`deriveName()` of a title) follow.
- `src/features/search/text.ts`: the search text holds the label, or the target as written without a label (R23). The
  prose for the language takes the label only, like the text of a link, and not a target, which is a name like an
  address: so a link update later changes the search text but never the language. `SEARCH_INDEX_VERSION` of
  `src/features/search/index-data.ts` counts up, so that the existing pages are derived again at the next start.
- The limit (R26): `CONTENT_MAX_WIKI_LINKS = 5_000` in `src/features/pages/limits.ts`; `analyseMarkdown()` counts the
  wiki links with the depth and the cells, and the content schema of `src/features/pages/schema.ts` refuses more with
  the field error "A page may hold at most 5,000 wiki links." at the content, at every save that checks the other
  limits, in the browser and through MCP.
- `src/features/pages/components/markdownToReact.tsx` shows a `wiki_link` token as its plain text, so that no content
  is lost before the next steps.
- The MCP instructions in `src/features/mcp/server.ts` state the grammar (R16): the target first and the label after
  `|`, a name and not a title, `tab/name` for a page in a tab, no `.md`, and that a link to a page that does not exist
  is allowed and shown as missing.

### Test

- Unit, `src/features/pages/wiki-links.test.ts` (new): the acceptance cases of R1, R4, R5 (how `[[setup]]` and
  `[[guides/setup]]` are read), R13, R18, R25 and R31; `wikiLinksOf()` for several links in one line and in one page;
  for every wiki link of a corpus of paragraphs, headings, nested lists, quotes, task items, tables with `\|`,
  footnotes and indented lines, the content at the recorded position is the target as written.
- Unit, the tests of the target module: valid and invalid targets, the length limit, `/` at the start, at the end and
  twice, upper case, `.md`, `#`, spaces.
- Unit, `src/features/pages/markdown.test.ts`: the `wiki_link` tokens; `![[setup]]`; a wiki link inside the text of a
  Markdown link and next to a footnote reference.
- Unit, `src/features/pages/derive.test.ts`: `# About [[setup|the setup]]` gives the title "About the setup",
  `# About [[guides/setup]]` gives "About guides/setup", and the suggested names that follow (R23).
- Unit, `src/features/search/text.test.ts`: the label in the search text and the prose, a target without a label in
  the search text only (R23).
- Unit, `src/features/pages/schema.test.ts`: 5,000 wiki links pass, 5,001 give the field error (R26).
- Unit, `src/features/mcp/tools.test.ts` or the tests of the server: the instructions of every role state the grammar
  (R16).
- Cost, `src/features/pages/markdown.cost.test.ts`: new inputs in `src/test/slow-markdown.ts` at the content limit,
  such as `[[` repeated, `[[a|` repeated, `[[a]]` repeated and `[[` between many code spans, parse within the budget;
  the cost tests of the search text and of live preview read the same inputs.
- Integration, `integration/search-index.test.ts`: a search for "the setup" finds a page holding
  `[[setup|the setup]]` (R23).
- End-to-end, `e2e/wiki-links.spec.ts` (new): a save with 5,001 wiki links in the editor is refused with the field error
  and stores nothing, one with 5,000 is stored; a page whose heading holds a wiki link gets the title of R23.
- End-to-end, `e2e/mcp-write.spec.ts`: `create_page`, `replace_page_content` and `edit_page_content` with 5,001 wiki
  links are refused with the error and change nothing (R26).

## New page with a preset name

### Goal

The editor of a new page takes a preset name: `?action=new&name=<name>` on a folder or a tab address opens it with
`name` proposed in the "Save page" dialog and the place of the address preselected, so that a missing link can lead
there in the next step.

Requirements: R15 (the address it leads to).

### Build

- `src/lib/addresses.ts`: the address of the new page editor with an optional preset name, for a folder and for a
  tab, and the parser of `name`.
- `folderAddressOf()` and `tabAddressOf()` of `src/features/folders/folder-query.ts` accept `name` only together with
  `action=new`. A name that breaks the name rule, an empty or repeated `name`, and `name` with another action, a view
  or no action show the not-found page.
- `NewPageView` and `NewPageForm` of `src/features/pages/components/`: the "Save page" dialog proposes the preset name
  instead of the name derived from the title; the user can change the name and the place as before.

### Test

- Unit, `src/lib/addresses.test.ts`: the address with and without a name.
- Unit, `src/features/folders/folder-query.test.ts`: `name` with `action=new` on a folder and a tab; a malformed,
  empty or repeated name, `name` with another action, a view or none.
- End-to-end, `e2e/create-page.spec.ts`: the dialog of `?action=new&name=faq` on the tab `guides` proposes `faq` in
  `guides`, and saving creates the page there; a malformed name shows the not-found page.

## Rendering and missing links

### Goal

Wiki links are links wherever content is rendered: to the page they name, with its title or their label, resolved
against the folder as it is now. A link to a missing page is marked, and leads a Writer, Manager or Owner to the new
page editor with its name and place preset; a link that cannot be created as written is marked text with a hint for
every role.

Requirements: R5, R6, R13, R14, R15, R18, R19, R20, R22, R25, R31, R32, R33.

### Build

- A read of the pages service that resolves the targets of a content in a folder: for each valid target the page that
  is not deleted and has that name and place, with its title, and for a missing one whether its tab exists. One query
  for the pages and one for the tabs, asking only for the targets of the content (at most 5,000). It checks the actor
  and the role like every read and returns `null` without them. A deleted page and a deleted tab are missing like
  ones that never existed (R20).
- `markdownToReact()` takes the resolution, the folder and whether the user may create pages (`mayDo()` of the role):
  - an existing page: a `Link` to its address from `pagePath()`, with the label, or the current title of the page
    without a label (R6);
  - a missing page in an existing place: in its own color and with a dashed underline, with the hint "Page does not
    exist" for pointer and screen reader users alike (R14); for a Writer and up a link to the new page editor of the
    previous step, for a Reader marked text without a link (R15);
  - a target that breaks the name rule or names a tab that does not exist: marked text without a link for every role,
    with the hint "Not a valid page name" or "Tab does not exist" (R19, R25);
  - every address is built by `src/lib/addresses.ts` from names that follow the name rule, and the label and the title
    are children as text, never HTML (R32).
- `MarkdownContent` passes them on, and every place that renders content gives it the folder and the role: the page
  view, with the delete dialog over it, a revision of a page and of a deleted page, and the view of a deleted page
  (R22). A comparison of revisions shows Markdown lines and stays as it is. The resolution is read on every view, so a
  page created, moved, renamed or restored later and a changed title show without a change of the linking page (R6,
  R33).

### Test

- Unit, `src/features/pages/service-reads.test.ts` and `service-access.test.ts`: the resolution for an admin, a user
  without a role and a database error.
- Unit, the conversion of the tokens: the four kinds of links, the hints and the accessible descriptions, a label
  `<b>x</b>` as text, no address other than one of the wiki (R14, R19, R32).
- Integration, `integration/page-service.test.ts`: a page `setup` directly in the folder and one in the tab `guides`
  resolve apart (R5); a deleted page and the pages of a deleted tab are missing, a restored page resolves again (R20).
- End-to-end, `e2e/wiki-links.spec.ts`:
  - R5 from a page directly in the folder and from a page in a tab; R6 with and without a label, and a changed
    heading of the target shown without a change of the linking page;
  - R14 the mark and the accessible description; R15 a Writer follows a missing link to the editor with the name and
    place preset in the "Save page" dialog and the link then leads to the new page, a Reader sees marked text;
  - R19 and R25 for a Writer and a Reader; R13 targets that show as missing although a similar page exists;
  - R18 a label with asterisks and a link in a table cell with `\|`; R31 a code span, a code block, `\[[` and a link
    over a line break show as text;
  - R20 a deleted page shown as missing to a Manager and a Reader, restored under its name and under another name;
  - R22 an old revision and a deleted page with its links; R32 the label as text; R33 a page created later.

## Link index and backlinks

### Goal

The wiki keeps an index of the wiki links of every page, stored with every content write and derived for the existing
pages before the server serves, so that the backlinks of a page and the pages a rename has to update are one indexed
read. A page shows the pages that link to it under "Linked from", and `read_page` returns them.

Requirements: R12, R17, R27 (a revert stores its links as they are).

### Build

- `prisma/schema.prisma` and a migration that only adds: a model of the wiki links of a page, one row per distinct
  valid target of the page, with the linking page, its folder, the tab name of the target (none for a page placed
  directly in the folder) and the page name, indexed by the folder, the tab name and the page name. Rows of deleted
  pages stay, so that a restore needs nothing; reads leave deleted pages out. `Page` gets the version of the
  derivation of its links, 0 for a page never derived, like `searchIndexVersion`.
- A service module of the pages feature, such as `src/features/pages/links-service.ts`: the store of the links of a
  content inside the transaction of a content write, the reads of the linking pages, and `indexOutdatedLinks()`.
  `createPage()` and `storeContentChange()` (saves and reverts) store the links in the transaction of the write; a
  revert stores the links of the old content as they are (R27).
- Every other writer of pages stores the links too, as it stores the search columns: `e2e/support/database.ts` and
  `prisma/seed.ts`.
- `indexOutdatedLinks()` derives the links of every page whose version of the derivation differs from the current
  one, deleted pages included, without changing the time of the last change, the last editor or the version of a page,
  and logs how many pages it derived; two runs at the same time do no harm. `scripts/search-index.ts` runs it after
  the search index, so that `npm run search:index` and the start of the container image derive both; its comments and
  output, and what `scripts/image.sh` checks of that output, follow.
- The read of the linking pages: the pages of the folder that are not deleted and hold a link to the name and place of
  the page, the page itself left out, sorted by title, each with its title, tab and name. It checks the actor and the
  role like every read.
- `PageView`: the section "Linked from" below the content, for every role: the title of each linking page as a link
  to it, with its tab, or "No page links here." (R12).
- `read_page` of `src/features/mcp/tools.ts` returns the linking pages with their name, tab and title, in the
  structured result and the text, with its output schema in `tool-schemas.ts` (R17).

### Test

- Unit: the links a content gives the index (distinct, valid targets only, a link of the page to itself included);
  the service reads for an admin, no role and a database error; `read_page` with linking pages.
- Integration, `integration/wiki-links-service.test.ts` (new): the index after creating, saving and reverting a page
  (R27); the linking pages sorted by title, without the page itself and without deleted pages, and again after a
  restore (R12); `indexOutdatedLinks()` derives the pages of an older version, keeps their time, last editor and
  version, and changes nothing on a second run.
- End-to-end, `e2e/wiki-links.spec.ts`: "Linked from" lists two linking pages by title and leads to them, a page
  without one shows "No page links here.", a deleted linking page disappears (R12).
- End-to-end, `e2e/mcp-read.spec.ts`: `read_page` of a page linked from two pages returns both (R17).
- `npm run image:build` and `npm run image:smoke` pass, because the start of the image now derives the links.
- The complete end-to-end suite runs, because `e2e/support/` changes.

## Link updates on a page move or rename

### Goal

A move or rename of a page changes every wiki link to it in the pages of the folder, the page itself included, in the
same write: only the target, the label as written. Each updated page gets a revision by the user who moved or
renamed, marked as a link update, and its version counts up. The dialog says how many pages will be updated, and
`move_or_rename_page` names them.

Requirements: R7, R8, R9, R10, R21, R26 (the update is never refused for the limit), R27, R29.

### Build

- `rewriteWikiLinks()` in `src/features/pages/wiki-links.ts`: the content with every wiki link whose target names the
  old name and place changed to the new one, at the positions of the parse, and everything else, labels included, as
  it was (R7). Its result is never checked against the content limits (R21, R26).
- `PageRevision` gets the mark of a revision recorded by a link update (a migration that only adds a column with a
  default). The history of a page shows the mark (`PageHistory.tsx`), as it shows a revert.
- The update in the links service, inside the transaction of the move: it reads the pages of the folder that are not
  deleted and hold a link to the old name and place, from the index, and stores for each its new content, the title
  and the search text derived from it (the language stays, see the first step), its links, the next version, the actor
  as its last editor with the channel, and a marked revision by the actor with that channel (R10). Deleted pages are
  not read and keep their content, versions and history (R29).
- The order of writes in a folder: every content write takes a shared transaction lock on its folder (an advisory lock
  of PostgreSQL), a move or rename and a tab rename an exclusive one. So the update waits for the content saves that
  are running, sees every link stored before it, and no save adds a link to the old name while it runs (R8, R9).
- `moveOrRenamePage()` of the pages service stores the move and the update in one interactive transaction: a refused
  or failed move changes no page (R8). A move to the own name and place updates nothing. The result carries the pages
  whose links were updated, and the log line of the move their number.
- `MoveOrRenamePageDialog`: the number of pages that hold links to the page and will be updated, the page itself
  included when it links to itself, read when the dialog is rendered (R9).
- `move_or_rename_page` returns the updated pages with their name, tab and title, in the structured result and the
  text (R9).

### Test

- Unit, `src/features/pages/wiki-links.test.ts`: `rewriteWikiLinks()` keeps labels, `\|` in tables, code and other
  targets, changes several links in one line and a link of the page to itself.
- Unit, `src/features/pages/service-writes.test.ts` and `src/features/mcp/tools.test.ts`: the result of a move with
  updated pages; a failure of the update fails the move.
- Integration, `integration/wiki-links-service.test.ts`:
  - R7 labels kept and the renamed page's link to itself; R8 a move refused for a taken name or an older version
    changes no page, a stored one leaves no link to the old name and place;
  - R10 the revision of each updated page: its user, channel and mark, the version counted up, the last editor;
  - R21 a linking page of 99,999 characters grows past the content limit and is stored;
  - R29 a deleted page keeps its link, versions and history;
  - the lock: a content save that adds a link to the old name and commits while the move waits is updated too.
- Integration cost, `integration/wiki-link-update.cost.test.ts` (new): a rename that updates 1,000 linking pages stays
  within a budget set from a measurement, with a margin for the CI runner.
- End-to-end, `e2e/wiki-link-updates.spec.ts` (new): the scenario of the requirements: the dialog says that links in 2
  pages will be updated, both pages hold `[[guides/install]]` with their labels, the history of each shows the marked
  revision "by <user> via web" and the page view names the user; an editor opened on a linking page before the rename
  has its save refused as changed (R10); a move into another tab; a revert to a revision that holds the old target
  stores it as it is, and it shows as missing (R27).
- End-to-end, `e2e/mcp-write.spec.ts`: `move_or_rename_page` lists the updated pages (R9). The specs of moving and of
  the history run as well: `e2e/move-or-rename-page.spec.ts`, `e2e/page-history.spec.ts`, `e2e/revert-page.spec.ts`,
  and `e2e/smoke.spec.ts` for the migration.

## Link updates on a tab rename

### Goal

A rename of a tab, in the browser and through `rename_tab`, changes every wiki link into the tab by the rules of a page
rename, and the dialog and the result name the pages it updates.

Requirements: R11, R30, with R8, R10, R21 and R29 for the tab.

### Build

- `renameTab()` of `src/features/folders/service.ts` stores the rename and the update of every link whose target is in
  the old tab, any page name, in one interactive transaction with the exclusive lock of the folder, through the update
  of the previous step. A rename to the own name updates nothing. The result carries the updated pages, and the log
  line their number.
- The "Rename tab" dialog (`NameDialog` for a tab) shows the number of pages that hold links into the tab and will be
  updated, read when the dialog is rendered (R30); the "Rename folder" dialog stays as it is.
- `rename_tab` returns the updated pages with their name, tab and title (R30).

### Test

- Unit, `src/features/folders/service.test.ts` and `src/features/mcp/tools.test.ts`: the result with updated pages;
  a failure of the update fails the rename.
- Integration, `integration/folder-service.test.ts`: R11 `[[guides/setup|the setup]]` becomes
  `[[docs/setup|the setup]]` with a marked revision; a rename to a taken name changes no page; a deleted page keeps its
  links.
- End-to-end, `e2e/wiki-link-updates.spec.ts`: the dialog says that links in 2 pages will be updated, and the pages
  hold the new tab name; `e2e/mcp-manager.spec.ts`: `rename_tab` lists the pages (R30); `e2e/tabs.spec.ts`.
- The complete end-to-end suite runs, as the last step of the first session that changes code.

## Wiki links in live preview

### Goal

Live preview shows wiki links as the page view does: as links with their brackets hidden off the cursor lines, with
the title of the target from the page list of the folder, missing ones marked; Ctrl+click or Cmd+click opens what the
page view leads to in a new browser tab.

Requirements: R2, R24, R28.

### Build

- The editor gets the page list of the folder when it opens: `NewPageView` and the edit form read the pages (tab,
  name, title) and the tabs of the folder through `queries.ts` and pass them, with the folder name, to
  `MarkdownEditor`, which hands them to the editor state.
- An extension of the Lezer parser in `src/features/pages/editor/extensions.ts` that reads wiki links by the target
  rule of the first step (the module without imports), on one line, not in code and not after `\`.
- `live-preview.ts`: off the cursor lines a wiki link shows its label, or the title of its target from the page list,
  styled as a link; on the cursor lines its Markdown (R2, R28). A missing target is marked as in the page view (R24):
  the page list as of opening, so a page created elsewhere stays missing until the editor is opened again.
- `preview-plugin.ts`: Ctrl+click or Cmd+click opens in a new tab the page address, or for a missing page in an
  existing place the new page editor with its name and place; an invalid target or a missing tab opens nothing
  (R28). A plain click and a tap only put the cursor there, as for other links.
- `src/test/editor-content.ts` gets wiki links, so that the cost test of live preview covers them.

### Test

- Unit, `src/features/pages/editor/live-preview.test.ts` and the tests of the extensions: the decorations off and on
  the cursor line, the title from the page list, the label, the mark of a missing link, code and `\[[` as text.
- Cost, `src/features/pages/editor/live-preview.cost.test.ts` on the inputs of the first step and on
  `EDITOR_PAGE` with wiki links.
- End-to-end, `e2e/editor-wiki-links.spec.ts` (new): R2 off and on the cursor line; R28 the title shown, Ctrl+click
  opens the page in a new tab and leaves the editor as it was, opens the new page editor for a missing page, and opens
  nothing for `[[Setup Guide]]`; R24 a missing link marked, and a page created in another tab after opening still
  shown as missing. `e2e/editor-preview.spec.ts` runs as well.

## The `[[` picker

### Goal

Typing `[[` in the editor opens a list of the pages of the folder, filtered as the user types on; choosing a page
inserts its link as one change.

Requirements: R3.

### Build

- `@codemirror/autocomplete`, already installed with `@codemirror/lang-markdown`, becomes a dependency of its own in
  `package.json`, at its latest stable version that `@codemirror/lang-markdown` accepts.
- A completion source in the editor modules that opens after `[[`, lists the pages of the page list of the previous
  step with their title and place, and filters them by title and name as the user types on. Choosing a page replaces
  `[[` and the typed text with `[[name]]` or `[[tab/name]]`, without a label, as one change that one undo reverts.
  Without a match the list says "No page found"; Esc closes it and leaves the text as typed.
- The keys of the list (arrows, Enter, Esc) act only while it is open, so that Enter in a list item and Esc then Tab
  work as before. The list is usable by touch at phone width, with entries of at least 24 pixels.
- Nothing is inserted without a choice: the editor still never changes the Markdown on its own.

### Test

- Unit: the completion source (when it opens, the filter by title and name, the inserted text, "No page found").
- End-to-end, `e2e/editor-wiki-links.spec.ts`: typing `[[` and part of a title lists the matching pages; choosing a
  page in `guides` inserts `[[guides/setup]]`, and one undo reverts it; Esc leaves `[[` and the typed text; Enter
  continues a list while no picker is open. `e2e/editor-phone.spec.ts`: a tap on an entry inserts it.
  `e2e/editor.spec.ts` runs as well.

## Spec tests

### Goal

Tests written from the requirements alone check the feature as built.

Requirements: all, as `spec/wiki-links-requirements.md` states them.

### Build

- Start the `spec-tester` agent (`.claude/agents/spec-tester.md`) with `spec/wiki-links-requirements.md` and wait for
  it. The tests it keeps belong to this step. A finding with High confidence within the scope of this plan is fixed
  here, with the failing test of its Evidence added back; any other finding stops the plan, as "When a step cannot be
  finished" in `spec/step-plan-workflow.md` says.

### Test

- The tests the agent keeps pass, with the commands in "When a step is done" in `spec/step-plan-workflow.md`.
- The complete end-to-end suite runs here when the wrap-up changes only documentation; otherwise the wrap-up runs it.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Write `spec/wiki-links.md`, the feature spec of wiki links, as "Feature specs" in `spec/step-plan-workflow.md`
   says, with the rules and decisions of `spec/wiki-links-requirements.md` that still hold: the syntax and the target,
   the display and missing links, the update on a move, a rename and a tab rename, backlinks, AI apps, the editor and
   the limit; its "Current limits" name what "Scope" leaves out. Extend the specs that "Effect on existing features"
   of the requirements names: `pages.md` (the lifted limit, the limit of 5,000 wiki links, the preset name of
   `?action=new`, the plain text of a wiki link), `content-structure.md` (moves and renames change the linking pages,
   the last editor of those pages, the numbers in the dialogs, "No links between pages" leaves its current limits),
   `page-history.md` (the mark, revisions of other pages recorded by a rename), `optimistic-locking.md` (renames count
   up the versions of the linking pages), `search.md` (the label or target in the search text, and the derivation at
   the start that also derives the links), `mcp.md` (the grammar in the instructions, `read_page`, the results of
   `move_or_rename_page` and `rename_tab`, the limit), `markdown-editor.md` (live preview of wiki links, the picker,
   which reverses the decision against completion, the page list loaded at opening, the new modules) and
   `page-deletion.md` (links into deleted pages show as missing, a restore changes no link). Update
   `container-image.md` for the derivation of the links at the start, `architecture.md` for the new modules, the model
   of the links and the lock of content writes per folder, `testing.md` for new helpers and inputs, and `tech.md` for
   `@codemirror/autocomplete`.
2. In `roadmap.md`, remove "Wiki links", and reduce "Backlinks and broken links" to a list of the broken links of a
   folder and a list of the pages that nothing links to.
3. Check that `README.md` has all the commands a developer needs, among them what `npm run search:index` derives, and
   that its summary of what the prototype can do covers wiki links, backlinks and the update on a rename.
4. Delete this step file, `spec/wiki-links-requirements.md` and `spec/wiki-link-ideas.md`, the research whose options
   the requirements decided. Replace every requirement ID in the comments of the code and the tests by the section of
   `spec/wiki-links.md` that holds the rule now, or drop it and keep its sentence.
5. Update the spec catalog in `CLAUDE.md`: add `spec/wiki-links.md`, remove this step file, the requirements file and
   the research file, and change the entries of the extended specs only where their question changes.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass, with the complete end-to-end suite when
  this step changes the code or the tests.
- `npm run docs:check` finds every file that the new and extended specs name.
