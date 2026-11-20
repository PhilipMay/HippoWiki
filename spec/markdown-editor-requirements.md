# Markdown Editor – Requirements

Status: approved

## Goal

Writers edit the Markdown of a page in a real Markdown editor, CodeMirror 6, instead of the plain textarea: editing
gets the comforts of a code editor, and an inline live preview in the style of Obsidian shows the formatting while
writing, with the Markdown marks visible only where the cursor is. The stored content stays the Markdown the user
typed, so pages, their history, search and MCP work as before.

## Users and roles

- Writers, Managers and Owners of a folder use the editor wherever they edit the content of a page today: a new page
  (`?action=new`) and an existing page (`?action=edit`). Who may edit stays as in `folder-roles.md`.
- Readers never see the editor; AI apps change pages through MCP and are not affected.

## Scenarios

- A writer opens "Edit" on a page. The content is shown in live preview: headings, emphasis, links and lists look
  formatted, and the line with the cursor shows its Markdown. The writer edits, switches to source mode to fix a
  table, switches back, and saves. The page view shows the result.
- A writer creates a new page in a tab, writes the title heading and some text in live preview, saves and gives the
  page its name in the "Save page" dialog, as today.

## Requirements

### Where the editor is used

- R1: The editor must replace the plain Markdown textarea both when a new page is written and when an existing page is
  edited, with the same behaviour in both places.
  - Acceptance: `?action=new` on a folder or tab and `?action=edit` on a page show the editor; neither shows the
    plain textarea.

- R40: The empty editor of a new page must show a grey placeholder `# Title` on its first line, which disappears as
  soon as anything is typed and is never saved.
  - Acceptance: `?action=new` shows `# Title` in grey; typing a character removes it; "Save" on the empty editor
    shows the error of the missing title heading.
- R41: The editor must be at least about 16 lines tall and grow with its content, so that the page scrolls; while the
  editor is in view, its toolbar must stick to the top of the window.
  - Acceptance: in a long page, scrolling to the end of the content keeps the toolbar and the mode switch visible at
    the top of the window; a page of a few lines shows an editor of about 16 lines.

### Live preview and source mode

- R2: The editor must offer two modes, live preview and source mode, and the user must be able to switch between them
  while editing without losing the content, the cursor position or the undo history.
  - Acceptance: switching the mode back and forth keeps the text unchanged, the cursor where it was, and undo still
    reverts the edits made before the switch.
- R3: In live preview, the Markdown marks of an element must be hidden and the element shown formatted, except on the
  line where the cursor is, and on every line of a selection, which show all their marks. A table is the one
  exception: it shows its Markdown as a whole (R8).
  - Acceptance: `## Heading` on another line shows as a larger heading without `##`; with the cursor anywhere on that
    line, `##` is visible, and so is every other mark of that line.
- R4: In source mode, the whole content must show as Markdown with all marks visible.
  - Acceptance: every character of the content is visible in source mode.
- R18: The editor must start in the mode last chosen in the same browser, and in live preview in a browser where no
  mode was chosen yet. The choice is kept only in the browser.
  - Acceptance: switch to source mode, save, open "Edit" on another page: it starts in source mode; in a fresh browser
    it starts in live preview.

### What live preview shows formatted

- R6: Live preview must show these elements formatted, with their marks hidden: bold, italic, strikethrough, inline
  code, headings of every level, links, bullet and numbered lists, task list boxes, block quotes, fenced code blocks,
  horizontal rules and tables.
  - Acceptance: for each element, a line with it shows it formatted without its marks while the cursor is on another
    line.
- R7: A link must show only its text, styled as a link; a list item its bullet or number as a list mark; a task item a
  checkbox, ticked or not as in the text; a block quote a bar instead of `>`; a fenced code block a monospace box
  without the fence lines; a horizontal rule a line.
  - Acceptance: each of these is visible as described in live preview.
- R8: A table must show as a rendered table in live preview, and as its Markdown, every line of it, while the cursor
  or a selection is in the table. A click on a rendered table puts the cursor into its Markdown at that place.
  - Acceptance: a GitHub Flavored Markdown table shows as a table with its header, rows and column alignment; moving
    the cursor into it shows the whole table as Markdown, moving it out renders it again.
- R16: A click on a task list box in live preview must switch it between `[ ]` and `[x]` in the text, as one change that
  undo reverts. It is stored only by "Save", like every other edit.
  - Acceptance: a click on an unticked box changes `- [ ] a` to `- [x] a`; Ctrl+Z or Cmd+Z changes it back.
- R17: A plain click on a link in live preview must put the cursor there and so show its Markdown; Ctrl+click or
  Cmd+click must open the link in a new browser tab, so that the editor is never left. Only a link that the page view
  would make a link opens (see the safe addresses in "Rendering" of `pages.md`).
  - Acceptance: a click on a link shows `[text](address)`; Ctrl+click or Cmd+click on `[a](https://example.com)` opens
    it in a new tab and the editor keeps its content; Ctrl+click or Cmd+click on `[a](javascript:alert(1))` opens
    nothing.
- R34: On a touch screen, a tap on a link in live preview must only put the cursor there; a link is not opened from the
  editor, but from the page view.
  - Acceptance: at phone size, a tap on a link shows its Markdown and no new tab opens.
- R9: Images must stay their Markdown text in live preview; they are not shown.
  - Acceptance: `![alt](/x.png)` shows as its Markdown, with the cursor on another line too.
- R10: What the editor shows formatted is a help for writing; the page view decides how a page looks. Where the two
  differ, the content and the page view stay as they are.
  - Acceptance: the stored content, the title, the limits and the page view of a page do not depend on how the editor
    showed it.

### Editing comforts

- R11: In source mode, the Markdown must be shown with syntax highlighting.
  - Acceptance: headings, emphasis, links, code and list marks are colored differently from plain text.
- R12: Enter at the end of a list item or quote line must start the next item or line with the same mark (the next
  number in a numbered list, an unticked box in a task list); Enter on an empty item must end the list or quote.
  - Acceptance: Enter after `- one` gives `- `; after `3. three` gives `4. `; after `- [x] done` gives `- [ ] `; Enter
    on an empty `- ` removes the mark and leaves an empty line.
- R13: The editor must have a search and replace panel, opened with Ctrl+F or Cmd+F while the editor has focus, with
  replace and replace all.
  - Acceptance: searching finds every occurrence in the content, also in hidden marks; replace all replaces them in
    one step that one undo reverts.
- R14: The editor must have a formatting toolbar; see "Toolbar".
  - Acceptance: the toolbar is shown above the editor in both modes.
- R15: Undo and redo must work for every change in the editor, with the usual keys.
  - Acceptance: Ctrl+Z or Cmd+Z reverts the last change, Ctrl+Shift+Z, Cmd+Shift+Z or Ctrl+Y repeats it.

### Toolbar

- R19: The toolbar must have these buttons: bold, italic, strikethrough, inline code, a heading menu with "Normal
  text", heading 1, heading 2 and heading 3, link, bullet list, numbered list and task list. Each button has a tooltip with its name, and with its shortcut where it has one.
  - Acceptance: each button is visible, reachable with the keyboard, and has an accessible name.
- R20: An inline button (bold, italic, strikethrough, inline code) must add its marks around the selection, or remove
  them when the selection is already marked so; without a selection it must insert the marks with the cursor between
  them.
  - Acceptance: bold on the selection `word` gives `**word**`; bold again gives `word`; bold without a selection gives
    `****` with the cursor in the middle.
- R21: A line button (heading level, bullet list, numbered list, task list) must set its mark on every line of the
  selection, or on the line of the cursor, or remove it when the lines already have it; a heading level replaces
  another heading level, a list mark another list mark, and "Normal text" removes the heading mark.
  - Acceptance: bullet list on three selected lines gives `- ` before each; again removes them; numbered list on
    three lines gives `1. `, `2. `, `3. `; heading 2 on `# A` and on `#### A` gives `## A`; "Normal text" on `## A`
    gives `A`.
- R22: The link button must turn the selection into `[selection](address)` with the cursor on `address`, and without a
  selection insert `[](address)` with the cursor in the text part.
  - Acceptance: link on `docs` gives `[docs](address)` with `address` selected for typing.
- R23: Every action of a button must be one change that one undo reverts, and must leave the focus in the editor.
  - Acceptance: after a button, Ctrl+Z or Cmd+Z restores the text before it, and typing goes on in the editor.
- R24: Bold, italic and link must also be done with Ctrl+B, Ctrl+I and Ctrl+K, or Cmd+B, Cmd+I and Cmd+K on a Mac,
  while the editor has focus, the same as their buttons.
  - Acceptance: Ctrl+B or Cmd+B on a selection does the same as the bold button.
- R25: The switch between live preview and source mode must be at the right end of the toolbar, always visible while
  editing, and show which mode is on.
  - Acceptance: the switch names both modes, marks the current one, and is reachable with the keyboard.

### Keyboard

- R26: Tab must indent the line of the cursor or the lines of the selection, a list item becoming nested, and
  Shift+Tab outdent them. After Esc, the next Tab or Shift+Tab must move the focus out of the editor instead. A hint
  near the editor names this.
  - Acceptance: Tab on `- b` below `- a` nests it; Esc then Tab focuses the next control after the editor; Esc then
    Shift+Tab the control before it.

### Content limit

- R27: The editor must not accept more than the content limit of a page, 100,000 characters counted with plain line
  breaks (see "Content and title" in `pages.md`): typing stops at the limit, a paste that would go past it is cut to
  fit, and any other change that would go past it, such as a toolbar button or Enter in a list, is not made.
  - Acceptance: at 100,000 characters a typed character is not added; pasting 10 characters at 99,995 adds the first
    5; at 99,999 characters the bold button changes nothing.
- R28: From 90,000 characters on, the editor must show a counter "n / 100,000" below it, updated while typing.
  - Acceptance: at 89,999 characters no counter shows; at 90,000 it shows "90,000 / 100,000".

### Loading

- R29: Until the editor is ready, its place must show the content as read-only plain text and "Save" must be
  disabled; then the editor replaces it with the same content. Without JavaScript the content stays read-only, as
  today.
  - Acceptance: with JavaScript turned off, `?action=edit` shows the Markdown as text that cannot be changed and a
    disabled "Save"; with JavaScript, the editor appears with the same content and "Save" turns enabled.

### Phones and touch screens

- R30: The editor must be fully usable by touch at phone width: writing and selecting text, live preview with its task
  boxes, the toolbar, the mode switch, "Save" and "Cancel". On a narrow screen the toolbar wraps or scrolls sideways;
  no part of the editor is out of reach.
  - Acceptance: an end-to-end test at phone size edits a page, uses a toolbar button and the mode switch, and saves.

### Safety and pasting

- R31: Raw HTML in the content must show as its text in both modes, never rendered and never run, as in the page view.
  - Acceptance: `<b>x</b>`, `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>` show as these characters in
    live preview; no script runs and no image is requested.
- R32: Pasted text must be added as plain text, without the formatting of its source.
  - Acceptance: pasting a bold heading copied from a web page adds only its words.
- R33: The browser's spell check must stay off in the editor, as in the textarea today.
  - Acceptance: a misspelled word is not underlined.

### Leaving with unsaved changes

- R35: When the content differs from the content the editor was opened with, leaving the editor must ask first:
  closing or reloading the browser tab shows the browser's own question whether to leave, and following a link of the
  app or pressing "Cancel" shows the dialog "Discard changes?" with "Discard" and "Keep editing", "Keep editing"
  focused. Saving never asks, and without a change nothing asks. The back button of the browser leaves without a
  question.
  - Acceptance: after typing a character, "Cancel" shows "Discard changes?"; "Keep editing" keeps the editor with the
    typed character, "Discard" leads where "Cancel" leads; after undoing the character, "Cancel" leaves without a
    question; "Save" leaves without a question.

### Errors and screen readers

- R36: The editor must have the accessible name "Content" and below it a helper text that says the content is Markdown
  (GitHub Flavored Markdown) starting with the title heading `# Title`, and names Esc then Tab to leave the editor.
  - Acceptance: a screen reader names the editor "Content"; the helper text is shown below it.
- R37: A field error of a save (no title heading, a limit, a character the wiki cannot store) must replace the helper
  text, mark the editor as invalid for screen readers and move the focus into the editor, as the textarea does today.
  The editor keeps the content entered.
  - Acceptance: saving content without `# Title` shows the error below the editor, the editor has focus and is
    announced as invalid, and the content is unchanged.

### Speed

- R38: In a page of 100,000 characters with tables and lists, typing, moving the cursor, scrolling and switching the
  mode must show no noticeable delay on a current laptop, and the editor must be ready within about 2 seconds of the
  page loading.
  - Acceptance: a person checks it with such a page; the editor appears with the content within about 2 seconds.
- R39: The code of the editor must be loaded only where the editor is used, never by the page view, the lists or other
  pages.
  - Acceptance: opening a page view loads none of the editor's code.

### The stored content

- R5: The editor must never change the Markdown on its own: what is saved is exactly the text the user typed or
  pasted, also after switching modes.
  - Acceptance: opening a page and saving it without a change stores nothing (see "Saves without a change" in
    `pages.md`); a page with unusual Markdown keeps it byte for byte after an edit elsewhere in the page.

## Scope

- In: the editor for new pages and for editing pages, in the browser: live preview and source mode, syntax
  highlighting, lists continued on Enter, search and replace, the toolbar with its shortcuts, Tab to indent, the
  counter near the content limit, the question before leaving with unsaved changes, use on phones and tablets.
- Not in: changes to storage, the page view, the history, search or MCP; toolbar buttons for quotes, code blocks,
  horizontal rules and tables; shortcuts other than those of bold, italic and link; images shown in live preview;
  slash commands; the derived title shown while editing.

## Effect on existing features

- `pages.md`: the content is still Markdown edited as text, but in the editor of this feature; "raw Markdown editing
  in a textarea" in "Current limits" is lifted. Its other rules stay: the title heading, the limits, saves without a
  change, the "Save page" dialog of a new page and the page view.
- `optimistic-locking.md`: unchanged; after a refused save the editor shows the page as stored, without asking about
  unsaved changes, since the save itself left the editor.
- MCP, the history, search, folders and tabs, deleted pages, login and OAuth: unchanged.
- `tech.md`: CodeMirror 6 becomes a package of the stack, and its Markdown parser a second parser, used only to show
  the content in the editor; markdown-it stays the only parser for everything else.
- `roadmap.md`: the entry "Rich editor" (TipTap or Milkdown) is replaced by this feature; slash commands and the
  derived title shown while editing stay on the roadmap as later additions to this editor.

## Decisions

- The main purpose is better Markdown editing: the comforts of a code editor, with the live preview as one of its
  features.
- CodeMirror 6 is set by the user. Its code adds weight to the browser, which is why it is loaded only by the editor
  (R39). It is the rich editor of the roadmap; TipTap and Milkdown are dropped. Rejected:
  CodeMirror as an interim step before a WYSIWYG editor.
- The live preview uses the Markdown parser of the editor (Lezer, which CodeMirror brings) only to show the content
  in the editor; markdown-it stays the only parser for the title, the limits, the page view and search. markdown-it
  cannot drive the editor: it would parse the whole content again on every key and gives no positions within a line.
  Rejected: requiring the editor to show every page exactly as the page view does, an open-ended list of differences.
- In live preview the line with the cursor shows all its marks: predictable, and the text does not shift while the
  cursor moves along a line. Rejected: only the marks of the element at the cursor, as in Obsidian; the whole block.
- Images stay Markdown text in live preview.
- The toolbar has buttons for text, headings, links and lists, which toggle on the selection; quotes, code blocks,
  rules and tables are typed. Rejected: buttons that always insert, which double the marks on a second click.
- Bold, italic and link also have the usual shortcuts, so that keyboard users can format without the mouse. Rejected:
  formatting only through the toolbar.
- The heading menu offers headings 1 to 3 and "Normal text"; deeper levels are typed.
- Typing and pasting stop at the content limit, as in the textarea, with a counter from 90 % of it. Rejected: accepting
  more and refusing it at save, which lets a user type work that cannot be stored; stopping without a message.
- Before the editor is ready the content shows read-only, as the textarea does today. Rejected: a loading indicator
  that hides the content.
- Tab indents, as in code editors and Obsidian; Esc then Tab leaves the editor, so the keyboard is never trapped.
  Rejected: Tab moving the focus, as in the textarea.
- The editor is made for phones and tablets as well, since a wiki is also edited on the go. Rejected: desktop first.
- Raw HTML is text in the editor as in the page view, so that content of another user never runs code. Rejected:
  rendering harmless tags, which would show something the page view does not.
- Pasting adds plain text. Rejected: converting pasted HTML to Markdown, which needs a converter package and gives
  results that depend on the source.
- Spell check stays off, so that code and addresses get no false marks.
- On touch screens links are not opened from the editor, so that no icons go into the text. Rejected: an "open" icon
  next to each link.
- Leaving with unsaved changes asks first, since a click or a closed tab would otherwise lose work, in a dialog of the
  app for its own links and "Cancel". Rejected: no question, as with the textarea; the confirm box of the browser,
  whose look differs by browser.
- The back button of the browser is not held: the App Router of Next.js has no supported way to hold it. Rejected: an
  extra history entry that catches the back button, which is fragile and can make the back button need two presses.
- Errors and screen readers work as with the textarea. Rejected: marking the line an error concerns, which needs the
  checks of the server to report lines.
- The editor stays fluid at the content limit, and its code is loaded only by the editor. Rejected: a promise only on
  loading.
- The mode switch is in the toolbar. Rejected: next to "Save" and "Cancel".
- The editor grows with its content and its toolbar sticks to the top of the window, so that the toolbar and the mode
  switch stay visible with one scroll area. Rejected: an editor of fixed height that scrolls inside itself.
- An empty editor shows the placeholder `# Title`, a hint at the title heading that is never saved. Rejected: an empty
  editor; a prefilled `# `, which is real text and would count as a change.
- A table turns to Markdown as a whole while the cursor is in it, since it spans many lines. Rejected: editing the
  cells inside the rendered table, as in Obsidian, at a much larger cost.
- A click on a task box ticks it in the text; a plain click on a link edits it, Ctrl+click or Cmd+click opens it in a
  new tab, so that unsaved text is never lost by a click. Rejected: boxes for display only; links never opened; links
  opened by a plain click.
- The mode is remembered per browser, with nothing stored on the server. Rejected: a setting of the user account; no
  memory.
- Live preview and source mode, like Obsidian. Rejected: live preview only, which makes complex Markdown such as
  tables hard to edit; a third, rendered read-only preview.

## Open questions
