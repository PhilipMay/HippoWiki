# HippoWiki – Wiki Links

Wiki links as built: Writers and AI apps link one page of a folder to another with `[[target]]` or
`[[target|label]]`, where the target names the page as its address does, instead of the full address
`/folders/<folder>/<tab>/<page>.md`. The page view renders such a link as a link to the page it names and marks a link
whose page does not exist; the Markdown editor shows the links in live preview and offers a picker on `[[`. A move or
rename of a page and a rename of a tab update the links to it, and a page shows which pages link to it. The raw
Markdown stays short and readable for people and AI apps, and a rename of the folder breaks no link. What a page is
is described in `pages.md`, folders, tabs and addresses in `content-structure.md`.

Code:

- the target and its rule: `src/features/pages/wiki-link-target.ts`, without imports of Zod or markdown-it;
- the parse: the inline rule `wiki_link` in `src/features/pages/markdown.ts`, and `src/features/pages/wiki-links.ts`
  (the links of a content with the place of each target, the targets the index stores, and the rewrite of targets);
- the page view: `src/features/pages/components/markdownToReact.tsx`, with `resolveWikiLinks()` of
  `src/features/pages/service.ts`, and the section "Linked from" in `src/features/pages/components/LinkedFrom.tsx`;
- the index of links, the backlinks, the update of links and the lock of the content writes of a folder:
  `src/features/pages/links-service.ts`, the models `PageLink`, `Page` (the version of the derivation of its links) and
  `PageRevision` (the mark of an update) in `prisma/schema.prisma`, and the migrations
  `prisma/migrations/20261120151123_wiki_links/` and `prisma/migrations/20261120152656_revision_links_updated/`;
- the moves, renames and tab renames that update links: `moveOrRenamePage()` of `src/features/pages/service.ts`,
  `renameTab()` of `src/features/folders/service.ts`, `MoveOrRenamePageDialog.tsx` and `NameDialog.tsx`;
- the derivation of the links of the existing pages: `scripts/search-index.ts`;
- MCP: the instructions in `src/features/mcp/server.ts` and the results in `src/features/mcp/tools.ts`;
- the editor: `src/features/pages/editor/wiki-links.ts` (the extension of the parser, the page list and what a link
  shows and leads to), `src/features/pages/editor/wiki-link-picker.ts` (the picker), and
  `src/features/pages/editor-page-list.ts` (the page list with its addresses, built on the server).

Tests: `src/features/pages/wiki-links.test.ts`, `src/features/pages/wiki-link-target.test.ts`,
`src/features/pages/wiki-links.spec-tests.test.ts`, `src/features/pages/markdown.test.ts`,
`src/features/pages/derive.test.ts`, `src/features/pages/schema.test.ts`, `src/features/search/text.test.ts`,
`src/features/mcp/tools.test.ts`, `src/features/pages/editor/wiki-links.test.ts`,
`src/features/pages/editor/wiki-link-picker.test.ts`, `src/features/pages/editor/live-preview.test.ts`,
`src/features/pages/editor-page-list.test.ts`, `integration/wiki-links-service.test.ts`,
`integration/wiki-links.spec-tests.test.ts`, `integration/wiki-link-update.cost.test.ts`,
`integration/page-service.test.ts`, `integration/folder-service.test.ts`, `integration/search-index.test.ts`,
`e2e/wiki-links.spec.ts`, `e2e/wiki-link-updates.spec.ts`, `e2e/wiki-links-spec-tests.spec.ts`,
`e2e/editor-wiki-links.spec.ts`, `e2e/mcp-read.spec.ts`, `e2e/mcp-write.spec.ts` and `e2e/mcp-manager.spec.ts`.

## Syntax and target

- A wiki link is written `[[target]]` or `[[target|label]]`: the target first, the label after the first `|`, up to the
  first `]]`, all on one line. An empty label counts as none; an empty target makes no link.
- The target names a page as its address does, the same from every page of the folder: `[[name]]` is the page of
  that name placed directly in the folder, `[[tab/name]]` the page of that name in that tab. It never leads into
  another folder: the first part of `tab/name` is always a tab of the own folder, also when a folder has that name.
- A link leads to whichever page has the name and place it names when it is shown, however that page got there:
  created, moved, renamed or restored.
- Only exact names link: a target must follow the name rule of tabs and pages (see "Names" in
  `content-structure.md`), with at most one `/` between a tab name and a page name, written exactly as the names are
  stored. Anything else, such as a title, upper case, spaces, `.md` or a second `/`, breaks the rule and shows as a
  missing link (see "Missing links").
- Section links and embeds are not part of the syntax, and nothing is reserved for them: `[[setup#install]]` is a
  target that breaks the name rule, and `![[setup]]` is the character `!` followed by a link.
- The label is plain text, shown exactly as written; Markdown inside it is not formatted. In a cell of a table, the
  `|` between target and label is written `\|`, as GitHub Flavored Markdown tables require.
- `[[...]]` is text, not a wiki link, inside a code span or a code block, after a backslash (`\[[`), inside the text of
  a Markdown link, and when it spans a line break. Such text is never changed by an update of links and never counts
  as a backlink.
- Relative Markdown links to page addresses are no wiki links: they work as before, and they are not counted, marked
  or updated.

## Display

- Wiki links are shown the same way wherever content is rendered: the page view, the delete dialog over it, a
  revision of a page, the view of a deleted page and its revisions. Each is resolved against the folder as it is now,
  so an old revision shows a link to a page created later as a link.
- A link to an existing page shows its label or, without one, the current title of that page, which follows a change
  of the heading without a change of the linking page.
- A link leads only to the address that the wiki builds from the names of its folder, tab and page, and its label and
  the title it shows reach the page as text, never as HTML.
- Where the content is read as plain text, for the title, the suggested name and the search text, a wiki link counts
  as its label, or as its target as written without one; never as the title of another page, so that the stored title
  and the search text never depend on other pages. The language of a page is detected from the labels only, not from
  targets, so that an update of links never changes it.
- A comparison of revisions shows Markdown lines and shows wiki links as written.

## Missing links

- A link whose target is no page of the folder shows as missing: in a color of its own and with a dashed underline, a
  second cue that does not rely on color, and with a hint for pointer and screen reader users alike.
- For a Writer, Manager or Owner a link to a missing page in a place that exists leads to the editor of a new page,
  `?action=new&name=<name>` on the folder or the tab of the link, whose "Save page" dialog proposes the name and
  preselects the place (see "Routes" in `pages.md`). For a Reader it is marked text, not a link.
- A link that cannot be created as written, because its target breaks the name rule or names a tab that does not
  exist, is marked text for every role, with a hint that says why.
- A link into a deleted page or a deleted tab shows as missing for every role, Managers and Owners included, with
  nothing that tells that the page was deleted. A restore changes no link: restored under its old name and place, the
  page is found by its links again; restored under another, the links stay missing.

## Updates on a move or rename

- When a page is moved or renamed, every wiki link to it in the pages of the folder, the moved page itself included,
  is changed to the new name and place. Only the target changes; the label stays as written, and every other byte of
  the content stays as it was. A move to the own name and place updates nothing.
- The links are updated always, in the same write as the move: either the move and all the updates are stored, or
  nothing is. A move that is refused changes no page. The update takes the links as they are when the move is stored,
  so a page that gained a link while the dialog was open is updated as well; a content save that runs at the same time
  either ends before the update and is updated, or starts after it.
- The "Move or rename page" dialog says how many pages hold links to the page and will be updated, as the folder holds
  them when the dialog is opened; `move_or_rename_page` names the pages whose links it updated.
- Each page whose content an update changes gets a revision by the user who moved, with the channel of the move,
  marked in its history as links updated after a rename or move; that user becomes its last editor, and its version
  counts up, so that an editor, a dialog or an AI app that holds the older version is refused as changed (see
  `page-history.md` and `optimistic-locking.md`).
- The update is never refused because of the content limits: a page that it makes longer than the content limit, or
  that is already over a limit lowered later, is updated all the same. Such a page can be viewed, moved and deleted,
  and saved again once it is within the limits.
- Deleted pages are not updated: their content, versions and history stay as they are, and a restored page can hold
  links to old names.
- A revert stores the content of the old revision as it is, its wiki links included, without changing or checking
  them, so a link to an old name then shows as missing.

## Updates on a tab rename

- When a tab is renamed, in the browser or through `rename_tab`, every wiki link into the tab, to any page of it, is
  changed to the new tab name by the rules of "Updates on a move or rename". A link to a page of the same name placed
  directly in the folder is no link into the tab and stays. A rename to the own name updates nothing.
- The "Rename tab" dialog says how many pages hold links into the tab and will be updated, and `rename_tab` names the
  pages whose links it updated. The "Rename folder" dialog says nothing of links: a rename of the folder breaks none.

## Backlinks

- The view of a page shows, for every role, the other pages of the folder that link to it, in a section "Linked from"
  below the content: the title of each linking page as a link to it, with its tab, sorted by title, or a sentence that
  no page links here. Deleted pages are not listed, and a page that links to itself does not list itself.
- `read_page` returns the same pages, with their name, tab and title.

## The index of links

- The wiki keeps the wiki links of every page in an index, one entry per distinct valid target of a page, so that the
  backlinks, the numbers of the dialogs and the pages an update has to change are one indexed read. Every content
  write stores the links of the content in the same write, also a revert and the writes of the test helpers and the
  seed. The entries of deleted pages stay, so that a restore needs nothing; the reads leave deleted pages out.
- Every content write of a folder waits for a move, a rename or a tab rename of that folder that is running, and those
  wait for the content writes that are running, so that an update sees every link stored before it.
- The links of the pages stored before the index, and of every page after an update that changes how the links are
  derived, are derived before the server serves, by the same run that derives the search index (`npm run
search:index`, and the start of the container image, see "Operation" in `search.md`). The run changes neither the
  time of the last change, nor the last editor, nor the version of a page, logs how many pages it derived, and two
  runs at the same time do no harm.

## AI apps

- The instructions of every MCP connection state the grammar: the target first and the label after `|`, a name and not
  a title, `tab/name` for a page in a tab, no `.md`, and that a link to a page that does not exist is allowed and shown
  as missing (see `mcp.md`).
- AI apps read and write wiki links in the raw Markdown; a target maps directly to the arguments of `read_page`, its
  tab and its name.

## The editor

- Live preview shows a wiki link as a link, with its brackets and its target hidden except on the lines of the cursor,
  as it shows other links: its label, or without one the title of its page from the page list of the folder. A link
  to a missing page is marked as in the page view, with its hint. A rendered table shows its wiki links the same way.
- The page list is read when the editor opens, so a page created, moved or renamed elsewhere afterwards shows as
  before until the editor is opened again.
- Ctrl+click or Cmd+click on a wiki link opens, in a new browser tab, what the page view leads to: the page, or for a
  missing page in a place that exists the editor of a new page with its name and place preset; a link that cannot be
  created as written opens nothing. A plain click and a tap put the cursor there.
- Typing `[[` opens a picker with the pages of the folder, each with its title and place, filtered by title and name
  as the user types on. Choosing a page, with the keyboard or by touch, replaces `[[` and the typed text with
  `[[name]]` or `[[tab/name]]`, without a label, as one change that one undo reverts. Without a match the picker says
  that no page was found; Esc closes it and leaves the text as typed. The picker does not open in code or after a
  backslash. Its keys act only while it is open, so Enter in a list and Esc then Tab work as before.
- Nothing is inserted without a choice: the editor still never changes the Markdown on its own (see
  `markdown-editor.md`).

## The limit

- A page holds at most 5,000 wiki links (`CONTENT_MAX_WIKI_LINKS` in `src/features/pages/limits.ts`), counting every
  link, a target that breaks the name rule included, and no text in code. A save with more is refused with a field
  error at the content, in the browser and through MCP, like the other limits of the content (see "Content and title"
  in `pages.md`). The update of links on a move or rename is never refused for it.

## Decisions

The syntax and the target:

- Target first, `[[target|label]]`, as in MediaWiki, Obsidian, DokuWiki and Foam: the most common order and the one AI
  models have seen most. Rejected: label first, as in Gollum and GitLab.
- A target names a page as its address does, the same from every page. Rejected: a lookup in the linking page's own
  tab first, which lets one page be linked in several forms; the name anywhere in the folder, where a new page can
  silently take over existing links.
- Only exact names link, and a target that breaks the rule shows as missing, so that the writer sees the mistake and
  an update has one spelling to find. Rejected: names derived from what is written, as the save dialog suggests them;
  such targets left as plain text.
- The label is plain text, like the title. Rejected: inline Markdown in labels, which needs more parsing in the page
  view and in the editor.
- Section links and embeds follow the plain rules and are not reserved. Rejected: leaving them as unmarked text.
- Code, escapes and line breaks keep `[[...]]` as text, as Markdown does for its own links.
- Relative Markdown links to page addresses stay as they are. Rejected: treating them like wiki links, which doubles
  the forms to find and rewrite, and they hold the folder name.

The display:

- A link without a label shows the current title, which is friendlier than a technical name and follows title
  changes. Accepted with it: the view of a page depends on the titles of other pages. Rejected: the name as written.
- Revisions and deleted pages resolve their links against the folder as it is now, so that every rendered content
  looks alike. Accepted with it: an old revision can show a link as missing that worked then. Rejected: wiki links as
  plain text outside the page view.
- The plain text of a link is its label or its target as written, so that the stored title and the search text never
  depend on other pages. Rejected: the target's title at the time of saving, which goes stale.
- A missing link is marked by more than color and leads Writers to create the page, since a link to a page still to be
  written is how a wiki grows. Rejected: no way to create it from the link; a link to the not-found page.
- A missing link that cannot be created as written is text with a hint for every role, so that nobody lands in a save
  dialog with an invalid name or a missing tab. Rejected: the editor without a preset.
- Links into deleted pages and tabs are missing for every role, as a deleted page is invisible and its name free at
  once (`page-deletion.md`); a restore changes no link. Rejected: updating links at a restore under a new name, which
  would be wrong when another page took the old name; a "deleted" hint for Managers.

The update of links:

- Links are updated on every move and rename, so that links keep working, in the same write, with the number of
  affected pages shown beforehand. Rejected: links that break on a rename, to be fixed by a later feature; an option to
  skip the update, which leaves broken links and two outcomes to explain; an update without any notice.
- Only the target is replaced; the label stays as written, as in every system that rewrites links.
- An updated page gets a revision by the renaming user with a mark, so that its history stays complete and tells the
  update from an edit. Rejected: a revision without a mark, which looks like an edit; keeping the old last editor,
  which breaks the rule that the last editor names the latest change.
- The moved page's links to itself are updated too, so that a self-link never breaks. Rejected: leaving the moved
  page's content untouched.
- Deleted pages are not updated, so that a page nobody sees gets no revisions from renames. Accepted with it: a
  restored page can hold links to old names. Rejected: updating deleted pages too.
- The update ignores the content limits, as moving and renaming do, so that a rename never fails because of other
  pages. Rejected: refusing the rename; skipping the page, which leaves a broken link.
- Tab renames update links too, since `[[tab/name]]` holds the tab, and report the pages like a page rename.
- A revert stores the old content as it is, as the history promises. Rejected: a warning in the revert dialog about
  links that lead nowhere today.
- The links are kept in an index stored with every content write, so that the backlinks and the pages to update are
  one indexed read instead of a parse of every page of the folder. The content writes of a folder and its renames
  take a lock of the folder, so that no save adds a link to an old name while its rename runs. Rejected: a parse of
  every page at a rename, whose cost grows with the folder.

Backlinks, AI apps and the editor:

- Backlinks are a section below the content, shown to every role, listing only other pages. Rejected: a view of their
  own; both; listing a page that links to itself.
- AI apps get the grammar in the instructions and the backlinks in `read_page`. Rejected: the grammar only; a tool of
  its own for links.
- The editor shows wiki links in live preview as the page view does, marks missing ones and offers a picker on `[[`,
  which reverses the earlier decision against completion in the editor; it still inserts only what the user chooses.
  Rejected: live preview only; no editor support; the target as written in live preview.
- The picker inserts the target without a label, so that the link shows the live title. Rejected: the title as a
  label, which goes stale.
- The editor marks missing links with the page list that the picker needs anyway, as of opening the editor, with the
  addresses built on the server, so that the code of the editor needs no module of addresses. Rejected: no mark in
  the editor; a read of the server on every key.
- A page holds at most 5,000 wiki links, a guard for the page view, the backlinks and the update on a rename, like the
  limit on table cells. Rejected: no limit beyond the content length.

## Current limits

- No links across folders.
- No section links (`[[page#section]]`), heading ids or embeds (`![[page]]`).
- No list of the broken links of a folder and no list of the pages that nothing links to (see `roadmap.md`).
- No redirects from old addresses (see `roadmap.md`).
- A restore or a revert updates no links, and the links of deleted pages are never updated.
- Relative Markdown links to page addresses are not treated as wiki links and are not updated on a rename.
- No formatted labels.
- The editor resolves links against the pages as of opening it, not as they change while it is open.
- `\[[target]]` in live preview shows `[target]` styled like a reference link, as the editor shows every `[text]`;
  the page view shows it as text.
