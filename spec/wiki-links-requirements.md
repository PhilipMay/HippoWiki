# Wiki Links – Requirements

Status: approved

## Goal

Writers and AI apps link one page of a folder to another with a short `[[...]]` link that names the page, instead of
the full address `/folders/<folder>/<tab>/<page>.md`. The page view renders such a link as a link to the page it
names, marks a link whose page does not exist, and the Markdown editor shows the links in live preview and helps to
write them with a picker on `[[`. When a page or a tab is renamed or moved, the links to it are updated, so that links
keep working, and a page shows which pages link to it. The raw Markdown stays short and readable for people and AI
apps, and a rename of the folder breaks no link.

## Users and roles

- Writers, Managers and Owners of a folder write wiki links in the Markdown editor in the browser.
- AI apps write and read wiki links in the raw Markdown of a page through MCP, with the role of their connection.
- Every role of the folder, Readers included, follows wiki links in the page view and sees the backlinks of a page.
- Whoever may rename or move a page or rename a tab, as `folder-roles.md` says, also updates the links in the other
  pages of the folder by doing so; every such user may edit every page of the folder.
- Admins see no content (`folder-roles.md`); wiki links change nothing for them.

## Scenarios

- A Writer edits the page "Onboarding" in the tab `guides`, types `[[`, picks "Setup guide" from the list that opens,
  and the editor inserts `[[guides/setup]]`. In live preview the link shows "Setup guide" as a link; after saving,
  the page view links to the page.
- A Reader opens "Onboarding" and follows the link to the setup guide.
- A Writer links `[[guides/faq]]`, a page that does not exist yet. The page view marks the link as missing; the Writer
  follows it, writes the page in the editor and saves it as `faq` in the tab `guides`, which the "Save page" dialog
  proposes. The link now leads to the new page.
- A Writer renames the page `setup` of the tab `guides` to `install`. The dialog says that links in 2 pages will be
  updated; after saving, both pages hold `[[guides/install]]`, with their labels as written, and their history shows
  the update as a marked revision by that Writer.
- A Reader opens "Setup guide" and sees under "Linked from" that "Onboarding" and "First week" link to it.
- An AI app reads a page through MCP, finds `[[guides/setup]]` in its Markdown and reads the linked page with
  `read_page`, tab `guides` and name `setup`.

## Requirements

### Syntax and target

- R1: A wiki link must lead only to a page of the same folder as the page that holds it.
  - Acceptance: no wiki link leads into another folder, whatever it names; `[[other-folder/setup]]` is read as the tab
    `other-folder` of the own folder.
- R4: A wiki link must be written `[[target]]` or `[[target|label]]`, the target first and the label after a `|`.
  - Acceptance: `[[setup|Setup guide]]` links the page `setup` with the text "Setup guide"; `[[Setup guide|setup]]`
    does not link the page `setup`.
- R5: The target must name a page as its address does, from any page of the folder: `[[name]]` is the page of that
  name placed directly in the folder, `[[tab/name]]` the page of that name in that tab.
  - Acceptance: in a folder with a page `setup` directly in it and a page `setup` in the tab `guides`, `[[setup]]`
    links the first and `[[guides/setup]]` the second, from a page directly in the folder and from a page in any tab
    alike.
- R33: A link must lead to whichever page has the name and place it names at the time it is shown, however that page
  got there: created, moved, renamed or restored.
  - Acceptance: `[[guides/faq]]` shows as missing; after a page is created, or another page is renamed or moved, as
    `faq` in the tab `guides`, the same link leads to that page without a change of the linking page.
- R13: Only exact names must link: a target must follow the name rule of tabs and pages (lowercase letters and digits
  in groups joined by single hyphens), with at most one `/` between a tab and a page name, written exactly as the name
  is stored. A target that breaks the rule shows as a missing link.
  - Acceptance: `[[Setup Guide]]`, `[[setup.md]]`, `[[Guides/Setup]]` and `[[guides/setup/more]]` show as missing
    links, also when a page `setup-guide`, `setup` or `guides/setup` exists.
- R25: A target with a `#`, such as `[[setup#install]]`, must be read like any other target that breaks the name
  rule, and `![[setup]]` as the character `!` followed by a wiki link: section links and embeds are not part of this
  feature, and nothing is reserved for them.
  - Acceptance: `[[setup#install]]` shows marked as missing with the hint "Not a valid page name"; `![[setup]]` shows
    "!" followed by a link to `setup`.
- R18: The label must be plain text, shown exactly as written; Markdown inside it is not formatted. Inside a cell of a
  table, the `|` between target and label must be written `\|`, as GitHub Flavored Markdown tables require.
  - Acceptance: `[[setup|**Setup**]]` shows the text `**Setup**` with its asterisks; `[[setup\|Setup]]` in a table
    cell links the page `setup` with the text "Setup".
- R31: `[[...]]` must be text, not a wiki link, inside a code span or a code block, after a backslash (`\[[`), and
  when it spans a line break. Such text is never changed by an update of links and never counts as a backlink.
  - Acceptance: `` `[[setup]]` ``, `[[setup]]` in a fenced code block and `\[[setup]]` show as text; a `[[setup` at the
    end of one line and `]]` on the next show as text; renaming `setup` changes none of them.
- R26: A page must hold at most 5,000 wiki links: a save with more is refused with the field error "A page may hold at
  most 5,000 wiki links." at the content, in the browser and through MCP. The update of links on a rename is never
  refused for it.
  - Acceptance: a save with 5,000 wiki links is stored; one with 5,001 is refused with the field error and stores
    nothing.

### Display

- R6: A link without a label must show the current title of the page it names; a link with a label must show the
  label as written.
  - Acceptance: `[[guides/setup]]` shows "Setup guide" while that page's title is "Setup guide", and shows the new
    title after its heading is changed, without a change of the linking page; `[[guides/setup|the setup]]` shows "the
    setup".
- R22: Wiki links must be shown the same way, resolved against the folder as it is now, wherever content is rendered:
  the page view, a revision of the page, the view of a deleted page and its revisions, and the delete dialog.
  - Acceptance: a revision from before a page `setup` was created shows `[[setup]]` as an ordinary link once `setup`
    exists; the view of a deleted page shows its links like the page view.
- R23: Where the content is read as plain text, for the title, the suggested name and the search text, a wiki link
  must count as its label, or as its target as written when it has no label; never as the title of another page.
  - Acceptance: a page whose heading is `# About [[setup|the setup]]` gets the title "About the setup", and one with
    `# About [[guides/setup]]` gets "About guides/setup"; a search for "the setup" finds a page holding
    `[[setup|the setup]]`.
- R32: A wiki link must lead only to the address that the wiki builds from the names of its folder, tab and page, and
  its label and the title it shows must reach the page as text, never as HTML.
  - Acceptance: no target makes a link to another host or with another protocol; a label `<b>x</b>` shows those
    characters as text.

### Missing links

- R14: A wiki link whose target is no page of the folder must be shown as missing: in a color of its own and with a
  second cue that does not rely on color (a dashed underline), and with the hint "Page does not exist" for pointer and
  screen reader users alike.
  - Acceptance: `[[no-such-page]]` shows marked with the dashed underline, and its accessible description says that
    the page does not exist; an existing target shows as an ordinary link.
- R15: For a Writer, Manager or Owner a missing link must open the editor of a new page with the name and the place of
  the link preset in the "Save page" dialog; for a Reader it must be marked text, not a link.
  - Acceptance: a Writer who follows `[[guides/setup]]` to a missing page gets the new page editor, and its "Save
    page" dialog proposes the name `setup` in the tab `guides`; a Reader sees the marked text without a link.
- R19: A missing link that cannot be created as written, because its target breaks the name rule or names a tab that
  does not exist, must be marked text for every role, not a link, with a hint that says why: "Not a valid page name"
  or "Tab does not exist".
  - Acceptance: `[[Setup Guide]]` and `[[nosuchtab/setup]]` show marked, without a link, for a Writer and a Reader,
    with those hints.
- R20: A link into a deleted page or a deleted tab must show as missing for every role, Managers and Owners included,
  with nothing that tells that the page was deleted. A restore changes no link.
  - Acceptance: after `guides/setup` is deleted, `[[guides/setup]]` shows as missing to a Manager as to a Reader;
    after it is restored as `guides/setup` the link leads to it again; restored as `install`, the link stays missing
    and no page is changed.

### Rename and move

- R7: When a page is renamed or moved, every wiki link to it in the pages of the folder, the renamed page itself
  included, must be changed to its new name and place. Only the target is changed: the label stays as written.
  - Acceptance: after renaming `guides/setup` to `guides/install`, a page that held `[[guides/setup|the setup]]`
    holds `[[guides/install|the setup]]` and still leads to the renamed page; a link of the page to itself reads
    `[[guides/install]]`.
- R8: The links must be updated always, in the same write as the rename or move: either the rename or move and all the
  updates are stored, or nothing is.
  - Acceptance: a rename or move that is refused changes no page; one that is stored leaves no page with a link to the
    old name and place.
- R29: Deleted pages must not be updated by a rename or move: their content, versions and history stay as they are.
  - Acceptance: a deleted page that holds `[[guides/setup]]` still holds it after `guides/setup` is renamed, and shows
    it as missing after it is restored.
- R9: The "Move or rename page" dialog must say how many pages hold links to the page and will be updated, as the
  folder holds them when the dialog is opened, and the result of `move_or_rename_page` through MCP must name the pages
  whose links were updated. The update itself takes the links as they are when the rename or move is stored.
  - Acceptance: for a page linked from three other pages, the dialog says that links in 3 pages will be updated; the
    MCP result lists those three pages; a page that gained a link while the dialog was open is updated as well.
- R10: Each page whose content an update changes must get a revision by the user who renamed or moved, with the
  channel of that rename or move, and that user as its last editor; its history must mark the revision as links
  updated after a rename or move. Its version counts up, so that an editor, a dialog or an AI app that holds the older
  version is refused as changed, as with any other change.
  - Acceptance: after mike renames a page in the browser, the history of a linking page shows a new revision "by mike
    via web" with the mark, and the page view names mike as its last editor; an editor opened on that linking page
    before the rename has its save refused as changed.
- R21: The update of links must never be refused because of the content limits: a page that the update makes longer
  than the content limit, or that is already over a limit lowered later, is updated all the same.
  - Acceptance: a linking page of 99,999 characters is updated by a rename to a longer name and then exceeds the limit;
    it can be viewed, moved and deleted, and saved again once it is within the limit.
- R11: When a tab is renamed, in the browser or through `rename_tab`, every wiki link into the tab must be changed to
  the new tab name by the same rules as a page rename (R7, R8, R10, R21, R29), keeping labels as written.
  - Acceptance: after renaming the tab `guides` to `docs`, `[[guides/setup|the setup]]` in any page of the folder
    reads `[[docs/setup|the setup]]`, with a marked revision.
- R30: The "Rename tab" dialog must say how many pages hold links into the tab and will be updated, and the result of
  `rename_tab` must name the pages whose links were updated, as for a page rename (R9).
  - Acceptance: for a tab whose pages are linked from two pages, the dialog says that links in 2 pages will be
    updated, and `rename_tab` lists them.
- R27: A revert of a page to an earlier revision must store the content of that revision as it is, its wiki links
  included, without changing or checking them.
  - Acceptance: a page reverted to a revision that holds `[[guides/setup]]`, after that page was renamed to
    `guides/install`, holds `[[guides/setup]]`, which then shows as missing.

### Backlinks

- R12: The view of a page must show which other pages of the folder link to it, for every role, in a section "Linked
  from" below the content: the title of each linking page as a link to it, with its tab, sorted by title. Deleted
  pages are not listed.
  - Acceptance: a page linked from "Onboarding" and "First week" lists both by title, each leading to its page; a
    page that no other page links to shows "No page links here."; a linking page that is deleted disappears from the
    list.

### AI apps

- R16: The instructions of an MCP connection must state the grammar of wiki links: the target first, a name and not a
  title, `tab/name` for a page in a tab, no `.md`, and that a link to a missing page is allowed and shown as missing.
  - Acceptance: the instructions of a connection contain these rules.
- R17: `read_page` must return, besides the content, the other pages of the folder that link to the page, as the
  section "Linked from" lists them (R12).
  - Acceptance: `read_page` of a page linked from two pages returns both, with their tab and name.

### Editor

- R2: Live preview of the Markdown editor must show a wiki link as a link, with its brackets hidden except on the lines
  of the cursor, as it shows other links.
  - Acceptance: in live preview a wiki link off the cursor line shows only its text, styled as a link; on the cursor
    line it shows its Markdown.
- R28: In live preview a link without a label must show the title of its target from the page list, as the page view
  does. Ctrl+click or Cmd+click on a wiki link must open, in a new browser tab, what the page view leads to: the
  target page, or for a missing page the new page editor with its name and place preset; a link that cannot be
  created as written opens nothing.
  - Acceptance: `[[guides/setup]]` shows "Setup guide" in live preview off the cursor line; Ctrl+click opens the page
    in a new tab and leaves the editor as it was; Ctrl+click on `[[Setup Guide]]` opens nothing.
- R24: Live preview must mark links to missing pages as the page view does, against the pages of the folder as they
  were when the editor was opened.
  - Acceptance: `[[no-such-page]]` shows marked in live preview off the cursor line; a page created elsewhere after
    the editor was opened is still shown as missing until the editor is opened again.
- R3: Typing `[[` in the editor must open a list of the pages of the folder, each with its title and place, filtered
  by title and name as the user types on; choosing a page inserts `[[name]]` or `[[tab/name]]` with the closing
  brackets and no label. With no match the list says "No page found"; Esc closes it and leaves the typed text. It works
  with the keyboard and by touch.
  - Acceptance: typing `[[` and part of a title lists the matching pages; choosing a page in the tab `guides` inserts
    `[[guides/setup]]` as one change that one undo reverts; Esc leaves `[[` and the typed text as they are; a tap on an
    entry on a phone inserts it.

## Scope

- In: wiki links within one folder; their rendering wherever content is rendered; the marking of missing links and
  creating a page from one; live preview, marking and a `[[` picker in the Markdown editor; updating the links on a
  rename or move of a page and a rename of a tab; backlinks of a page in the browser and in `read_page`; the link
  grammar in the MCP instructions; a limit of 5,000 wiki links per page.
- Not in:
  - links across folders;
  - section links (`[[page#section]]`), heading ids and embeds (`![[page]]`);
  - a list of the broken links of a folder and a list of pages that nothing links to, which stay on the roadmap;
  - redirects from old addresses, which stay on the roadmap;
  - updating links on a restore or a revert, and updating the links of deleted pages;
  - treating relative Markdown links to page addresses as wiki links: they keep working as today and are not updated
    on a rename;
  - formatted labels.

## Effect on existing features

- `pages.md`: "no `[[wiki links]]`" among its current limits is lifted; the content gets a third limit at save, 5,000
  wiki links; `?action=new` on a folder or a tab accepts a preset name and place for the "Save page" dialog; the plain
  text of a wiki link for the title and the suggested name is its label or target.
- `content-structure.md`: "Moving or renaming does not validate or touch the content" stays true for the moved or
  renamed page's own content except its links to itself, but a move or rename of a page and a rename of a tab now
  change the content of the pages that link to them. Under "Last editor", the user of such a rename or move becomes
  the last editor of every page whose links it updates. The "Move or rename page" and "Rename tab" dialogs name the
  number of pages that will be updated.
- `page-history.md`: revisions recorded by a link update carry a mark of their own, as a revert does; a rename or move
  can now record revisions of other pages, while it still records none of its own other than for links to itself.
- `optimistic-locking.md`: a page rename or move and a tab rename count up the versions of the pages whose links they
  update, so that open editors, dialogs and AI apps holding those pages are refused as changed.
- `search.md`: the search text holds the label or target of a wiki link.
- `mcp.md`: the instructions state the link grammar; `read_page` returns the linking pages; `move_or_rename_page` and
  `rename_tab` name the pages whose links they updated; `replace_page_content`, `edit_page_content` and `create_page`
  are refused above 5,000 wiki links.
- `markdown-editor.md`: the editor gets a picker on `[[`, which reverses the decision against autocompletion for wiki
  links; it still never changes the Markdown on its own, as the picker inserts only what the user chooses. Live
  preview shows wiki links and marks missing ones, with the page list of the folder loaded when the editor opens.
- `page-deletion.md`: unchanged; links into deleted pages show as missing, and a restore changes no link.

## Decisions

- The first version covers wiki links, editor support, the update of links on rename and move, and backlinks, because
  links that break on every rename defeat their purpose, and the update needs to know who links where anyway.
  Rejected: links and editor only, with renames breaking links until a later feature; a large version with anchors
  and redirects; a list of broken links now, which stays on the roadmap.
- Target first, `[[target|label]]`, as in MediaWiki, Obsidian, DokuWiki and Foam: the most common order and the one AI
  models have seen most. Rejected: label first, as in Gollum and GitLab.
- A target names a page as its address does, the same from every page. It maps directly to the arguments of
  `read_page` for AI apps. Rejected: a lookup in the linking page's own tab first, which lets one page be linked in
  several forms; the name anywhere in the folder, where a new page can silently take over existing links.
- Only exact names link, and a target that breaks the name rule shows as missing, so that the writer sees the mistake
  and the update has one spelling to find. Rejected: names derived from what is written, as the save dialog suggests
  them; such targets left as plain text.
- The label is plain text, like the title. Rejected: inline Markdown in labels, which needs more parsing in the page
  view and in the editor.
- Section links and embeds follow the plain rules and are not reserved. Rejected: leaving them as unmarked text.
- Code, escapes and line breaks keep `[[...]]` as text, as Markdown does for its own links.
- A page holds at most 5,000 wiki links, a guard for the page view, the backlinks and the update on rename, like the
  limit on table cells. Rejected: no limit beyond the content length.
- A link without a label shows the current title, which is friendlier than a technical name and follows title
  changes. Accepted with it: the view of a page depends on the titles of other pages. Rejected: the name as written.
- Revisions and deleted pages resolve their links against the folder as it is now, like the page view, so that every
  rendered content looks alike. Accepted with it: an old revision can show a link as missing that worked then.
  Rejected: wiki links as plain text outside the page view.
- The plain text of a link is its label or its target as written, so that the stored title and the search text never
  depend on other pages. Rejected: the target's title at the time of saving, which goes stale.
- A missing link is marked by more than color and leads Writers to create the page, since a link to a page still to be
  written is how a wiki grows. Rejected: no way to create it from the link; a link to the not-found page.
- A missing link that cannot be created as written is text with a hint for every role, so that nobody lands in a save
  dialog with an invalid name or a missing tab. Rejected: the editor without a preset.
- Links into deleted pages and tabs are missing for every role, as a deleted page is invisible and its name free at
  once (`page-deletion.md`); a restore changes no link. Rejected: updating links at a restore under a new name, which
  would be wrong when another page took the old name; a "deleted" hint for Managers.
- Links are updated always and in the same write as the rename or move, with the number of affected pages shown
  beforehand. Rejected: an option to skip the update, which leaves broken links and two outcomes to explain; an update
  without any notice.
- Only the target of a link is replaced; its label stays as written, as in every system that rewrites links.
- An updated page gets a revision by the renaming user with a mark, so that its history stays complete and tells the
  update from an edit. Rejected: a revision without a mark, which looks like an edit; keeping the old last editor,
  which breaks the rule that the last editor names the latest change.
- The renamed page's links to itself are updated too, with a marked revision, so that a self-link never breaks.
  Rejected: leaving the renamed page's content untouched.
- Deleted pages are not updated, so that a page nobody sees gets no revisions from renames. Accepted with it: a
  restored page can hold links to old names. Rejected: updating deleted pages too.
- The update of links ignores the content limits, as moving and renaming do (`pages.md`), so that a rename never fails
  because of other pages. Rejected: refusing the rename; skipping the page, which leaves a broken link.
- Tab renames update links too, since `[[tab/name]]` holds the tab, and report the pages like a page rename. Rejected:
  links that break on a tab rename; a silent update.
- A revert stores the old content as it is, as the history promises. Rejected: a warning in the revert dialog about
  links that lead nowhere today.
- Backlinks are a section below the content, shown to every role, and list only other pages. Rejected: a view of
  their own; both; listing a page that links to itself.
- Relative Markdown links to page addresses stay as they are today: they are not updated, counted or marked. Rejected:
  treating them like wiki links, which doubles the forms to find and rewrite, and they hold the folder name.
- AI apps get the link grammar in the instructions and the backlinks in `read_page`. Rejected: the grammar only; a
  tool of its own for links.
- The editor shows wiki links in live preview as the page view does, marks missing ones, and offers a picker on `[[`.
  It needs no new package: the parser of the editor accepts own inline syntax, and the completion package of
  CodeMirror is already installed with `@codemirror/lang-markdown`. Rejected: live preview only; no editor support;
  the target as written in live preview.
- The picker inserts the target without a label, so that the link shows the live title. Rejected: the title as a
  label, which goes stale.
- The editor marks missing links with the page list of the folder that the picker needs anyway, as of opening the
  editor. Rejected: no mark in the editor.

## Open questions
