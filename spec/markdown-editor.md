# HippoWiki – Markdown Editor

The Markdown editor as built: writers edit the Markdown of a page in a CodeMirror 6 editor with the comforts of a code
editor, and an inline live preview in the style of Obsidian shows the formatting while writing, with the Markdown
marks visible only on the lines of the cursor. The stored content stays exactly the Markdown the user typed, so pages,
their history, search and MCP work on it as before. What a page is, its title and its limits are described in
`pages.md`.

Code: `src/features/pages/editor/`, the modules that only the browser loads:

- `extensions.ts`: the extensions of the editor state, its language, keymaps, highlighting and theme;
- `mount.ts`: creates the editor and its handle for the React component;
- `commands.ts`: the commands of the toolbar and their shortcuts;
- `indent.ts`: Tab and Shift+Tab, and Esc then Tab to leave the editor;
- `content-limit.ts`: the content limit;
- `live-preview.ts`: the decorations of live preview;
- `preview-plugin.ts`: the view plugin of live preview, its styles and the opening of links;
- `tables.ts`: the rendered tables;
- `link-address.ts`: the address of a link as the page view reads it;
- `wiki-links.ts`: the wiki links of the parser, the page list of the folder and what a wiki link shows and leads to;
- `wiki-link-picker.ts`: the picker on `[[`;
- `mode.ts`: the mode kept in the browser.

The components are `src/features/pages/components/MarkdownEditor.tsx`, `EditorToolbar.tsx`,
`DiscardChangesDialog.tsx` and `useUnsavedChangesGuard.ts`, used by `PageForm.tsx` and `NewPageForm.tsx`. The safe
addresses of links are in `src/features/pages/safe-address.ts`, shared with the page view. The page list of the
folder, with the addresses of its pages, is built on the server by `src/features/pages/editor-page-list.ts`.

Tests:

- unit: the tests in `src/features/pages/editor/` and `src/features/pages/safe-address.test.ts`;
- cost: `src/features/pages/editor/live-preview.cost.test.ts`, on the pages of `src/test/editor-content.ts` and
  `src/test/slow-markdown.ts`;
- end-to-end: `e2e/editor.spec.ts`, `e2e/editor-preview.spec.ts`, `e2e/editor-toolbar.spec.ts`,
  `e2e/editor-limit.spec.ts`, `e2e/editor-leave.spec.ts`, `e2e/editor-phone.spec.ts`, `e2e/editor-spec-tests.spec.ts`,
  `e2e/editor-wiki-links.spec.ts`
  and `e2e/hydration.spec.ts`, with the helpers of `e2e/support/editor.ts`.

## Where the editor is used

- The editor is the field of the content wherever a page is written in the browser: a new page (`?action=new` on a
  folder or a tab) and an existing page (`?action=edit`), with the same behaviour in both. Who may edit follows
  `folder-roles.md`; Readers never see the editor, and AI apps change pages through MCP.
- The empty editor of a new page shows the placeholder `# Title` in grey, a hint at the title heading that is never
  saved and disappears as soon as anything is typed.
- The editor is at least about 16 lines tall and grows with its content, so that the page scrolls, not the editor.
  While the editor is in view, its toolbar sticks to the top of the window.

## Live preview and source mode

- The editor has two modes, switched in its toolbar: live preview and source mode. A switch keeps the content, the
  cursor and the undo history.
- Live preview shows the Markdown formatted with its marks hidden, except on every line of the cursor and of a
  selection, which show all their marks. A table is the one exception: it shows its whole Markdown while the cursor or
  a selection is anywhere in it.
- Source mode shows the whole content as Markdown with every mark, with syntax highlighting.
- The editor starts in the mode last chosen in the same browser, and in live preview where no mode was chosen yet. The
  choice is kept only in the browser.

## What live preview shows

- Bold, italic, strikethrough and inline code show their style; headings of every level, ATX and setext, show the
  size of their level.
- A link, an autolink and a bare address show only their text, styled as a link. A link whose address the page view
  would not make a link stays its Markdown text.
- A wiki link shows its label, or the title of its page, styled as a link, and a link to a missing page is marked as
  in the page view, against the page list of the folder read when the editor opened (see "The editor" in
  `wiki-links.md`).
- A bullet item shows a bullet, a numbered item its number as a list mark, a task item a checkbox ticked as in the
  text; a block quote shows a bar per level instead of `>`; a fenced code block shows a monospace box, its fence lines
  hidden; a horizontal rule shows a line.
- A GitHub Flavored Markdown table shows as a rendered table with its header, its rows and the alignment of its
  columns. A click on a cell puts the cursor at that cell in the Markdown, which then shows the whole table.
- Images stay their Markdown text, and raw HTML stays its text; nothing of the content becomes an element of the page
  other than text.
- A click on a task box switches it between `[ ]` and `[x]` in the text as one change that one undo reverts. It is
  stored only by "Save", like every other edit.
- A plain click on a link puts the cursor there, so that it shows its Markdown. Ctrl+click or Cmd+click opens it in a
  new browser tab, so that the editor is never left: an inline link, an autolink, a bare address, and of a reference
  link the address of its definition. It opens the address the page view links to, with the escapes and entities of
  the Markdown decoded, and only an address that the page view would make a link of (see "Rendering" in `pages.md`).
  A wiki link opens what the page view leads to, and nothing when it cannot be created as written.
- On a touch screen a tap on a link only puts the cursor there; links are opened from the page view.
- What the editor shows formatted is a help for writing; the page view decides how a page looks. Where the editor's
  parser reads the Markdown otherwise than the page view, the content and the page view stay as they are.

## Editing

- Enter at the end of a list item or a quote line starts the next one with the same mark: the next number, an unticked
  box after a task item, `> ` after a quote line. Enter on an empty item or quote line ends the list or quote.
- Search and replace opens with Ctrl+F or Cmd+F while the editor has focus. It finds every occurrence, also in the
  marks that live preview hides, and replace all is one change that one undo reverts.
- Undo and redo work for every change, with Ctrl+Z or Cmd+Z, and Ctrl+Shift+Z, Cmd+Shift+Z or Ctrl+Y.
- Tab indents the line of the cursor or every line of the selection, a list item becoming the child of the item above
  it, and Shift+Tab outdents them. After Esc, the next Tab or Shift+Tab moves the focus out of the editor instead, so
  that the keyboard is never trapped. The helper text below the editor names this.
- Typing `[[` opens a picker of the pages of the folder, and choosing one inserts its wiki link as one change that one
  undo reverts (see "The editor" in `wiki-links.md`). Its keys act only while it is open.
- Pasting adds plain text, without the formatting of its source.
- The spell check of the browser is off in the editor.

## Toolbar

- The toolbar above the editor, in both modes, has buttons for bold, italic, strikethrough, inline code, a heading menu
  ("Normal text", heading 1 to heading 3), link, bullet list, numbered list and task list. Each has an accessible name
  and a tooltip with its name, and with its shortcut where it has one.
- The inline buttons add their marks around the selection, or remove them where the selection is already marked so;
  without a selection they insert the marks with the cursor between them.
- The line buttons set their mark on every line of the selection or on the line of the cursor, or remove it where the
  lines already have it. A heading level replaces another level, a list mark another list mark, and "Normal text"
  removes the heading mark.
- The link button turns the selection into `[selection](address)` with `address` selected, and inserts `[](address)`
  with the cursor in the text part without a selection.
- Every button is one change that one undo reverts, and leaves the focus in the editor.
- Bold, italic and link have the shortcuts Ctrl+B, Ctrl+I and Ctrl+K, or Cmd+B, Cmd+I and Cmd+K on a Mac.
- The switch between live preview and source mode is at the right end of the toolbar, always visible while editing,
  and marks the current mode.

## Content limit

- The editor accepts no more than the content limit of a page, 100,000 characters counted with plain line breaks as
  the server counts them (`CONTENT_MAX_LENGTH` in `src/features/pages/limits.ts`, see "Content and title" in
  `pages.md`):
  - typing stops at the limit;
  - a paste that would go past it is cut to the characters that fit;
  - any other change that would go past it, such as a toolbar button or Enter in a list, is not made.
- A change that does not make the content longer is always made, so content over a limit lowered later can still be
  opened and shortened.
- From 90,000 characters on, a counter "n / 100,000" below the editor shows the length, updated while typing.

## Loading

- Until the editor is ready, its place shows the content as read-only text and "Save" is disabled; then the editor
  replaces it with the same content. Without JavaScript the content stays read-only.
- The code of the editor is loaded only where the editor is used: the page view, the lists and every other page load
  none of it.

## Phones and touch screens

- The editor is usable by touch at phone width: writing, the toolbar, which wraps onto more rows, the mode switch, the
  task boxes, "Save" and "Cancel". No part of the editor is wider than the window, and its buttons and task boxes are
  touch targets of at least 24 by 24 pixels.

## Leaving with unsaved changes

- While the content differs from the content the editor was opened with, leaving asks first: closing or reloading the
  browser tab shows the browser's own question, and a link of the app or "Cancel" shows the dialog "Discard changes?"
  with "Discard" and "Keep editing". Undoing back to the content as opened makes the editor clean again.
- Saving never asks, and without a change nothing asks. Links opened in a new tab and the links in the editor are not
  held. The back button of the browser leaves without a question.
- After a save refused as changed by somebody else, the editor shows the page as stored and asks nothing (see
  `optimistic-locking.md`).

## Errors and screen readers

- The editor is named "Content" and described by the helper text below it, which says that the content is GitHub
  Flavored Markdown starting with the title heading `# Title` and that Esc, then Tab, leaves the editor.
- A field error of a save of an edited page (no title heading, a limit, a character the wiki cannot store) replaces the
  helper text, marks the editor as invalid for screen readers and moves the focus into it. The content stays as
  entered.
- For a new page, "Save" checks the title heading at the editor in the same way. The other errors of the content come
  back from the server in the "Save page" dialog, as with the textarea before the editor.

## Speed

- In a page of 100,000 characters with tables and lists, typing, moving the cursor, scrolling and switching the mode
  show no noticeable delay on a current laptop, and the editor is ready within about 2 seconds of the page loading.
  The decorations of live preview are built only for the lines on the screen, and the tables are rebuilt only where a
  change or a move of the selection touches them.

## The stored content

- The editor never changes the Markdown on its own: no autoformatting, no closing brackets, no trimming. The picker on
  `[[` inserts a link only when the user chooses a page. What is saved
  is exactly the text the user typed or pasted, also after switching the mode, so opening a page and saving it without
  a change stores nothing (see "Saves without a change" in `pages.md`).

## Decisions

**The editor**

- CodeMirror 6, set by the user, is the editor of the wiki; the main purpose is better Markdown editing, with the
  comforts of a code editor and the live preview as one of its features. Rejected: TipTap and Milkdown; CodeMirror as
  an interim step before a WYSIWYG editor.
- Its code adds weight to the browser, so `MarkdownEditor` loads it with a dynamic import after hydration, in a chunk
  of its own, and only where the editor is used. `safe-address.ts` and `link-address.ts` keep markdown-it out of that
  chunk. Rejected: a promise only on loading.
- The editor uses the packages it needs one by one, not the `codemirror` package with its `basicSetup`, which brings
  autocompletion, closing brackets and other changes of the text. Completion is used for the picker of wiki links
  only, which inserts nothing without a choice (see "Decisions" in `wiki-links.md`); this reverses the earlier
  decision against completion for wiki links.
- The content leaves the editor through one hidden field `content` per editor, updated on every change without a React
  render per key, so that the forms submit it as they submitted the textarea.
- Before the editor is ready the content shows read-only, as the textarea did. Rejected: a loading indicator that hides
  the content.
- Pasting adds plain text. Rejected: converting pasted HTML to Markdown, which needs a converter and gives results that
  depend on the source.
- Spell check stays off, so that code and addresses get no false marks.
- Tab indents, as in code editors and Obsidian; Esc then Tab leaves the editor. Rejected: Tab moving the focus, as in
  the textarea.

**Live preview**

- Live preview reads the content with the Markdown parser of the editor, Lezer, configured as CommonMark with the
  GitHub Flavored Markdown extensions, only to show it in the editor; markdown-it stays the only parser for the title,
  the limits, the page view and search. markdown-it cannot drive the editor: it would parse the whole content again on
  every key and gives no positions within a line. Rejected: showing every page exactly as the page view does, an
  open-ended list of differences.
- The lines of the cursor show all their marks: predictable, and the text does not shift while the cursor moves along a
  line. Rejected: only the marks of the element at the cursor, as in Obsidian; the whole block.
- A table is rendered as a widget and turns to Markdown as a whole while the cursor is in it, since it spans many
  lines; a click on a cell leads into its Markdown. Rejected: editing the cells inside the rendered table, as in
  Obsidian, at a much larger cost.
- Live preview and source mode, like Obsidian. Rejected: live preview only, which makes complex Markdown such as tables
  hard to edit; a third, rendered read-only preview.
- The mode is remembered per browser, with nothing stored on the server. Rejected: a setting of the user account; no
  memory.
- A click on a task box ticks it in the text; a plain click on a link edits it, Ctrl+click or Cmd+click opens it in a
  new tab, so that unsaved text is never lost by a click. Rejected: boxes for display only; links never opened; links
  opened by a plain click.
- Links open the address that the page view links to, decoded as markdown-it decodes it, so that Ctrl+click and the
  page view agree. Rejected: opening the address as written in the Markdown.
- On touch screens links are not opened from the editor, so that no icons go into the text. Rejected: an "open" icon
  next to each link.
- Raw HTML is text, as in the page view, so that content of another user never runs code. Rejected: rendering harmless
  tags.

**Toolbar and limits**

- The toolbar has buttons for text, headings, links and lists, which toggle on the selection; quotes, code blocks,
  rules and tables are typed. Rejected: buttons that always insert, which double the marks on a second click.
- Bold, italic and link also have the usual shortcuts, so that keyboard users format without the mouse.
- The heading menu offers headings 1 to 3 and "Normal text"; deeper levels are typed.
- The mode switch is in the toolbar. Rejected: next to "Save" and "Cancel".
- The editor grows with its content and its toolbar sticks to the top of the window, so that the toolbar and the mode
  switch stay visible with one scroll area. Rejected: an editor of fixed height that scrolls inside itself.
- Typing and pasting stop at the content limit, with a counter from 90 % of it. Rejected: accepting more and refusing
  it at save, which lets a user type work that cannot be stored.
- An empty editor of a new page shows the placeholder `# Title`. Rejected: an empty editor; a prefilled `# `, which is
  real text and would count as a change.

**Leaving and errors**

- Leaving with unsaved changes asks first, in a dialog of the app for its own links and "Cancel". Rejected: no
  question, as with the textarea; the confirm box of the browser, whose look differs by browser.
- The back button of the browser is not held: the App Router of Next.js has no supported way to hold it. Rejected: an
  extra history entry that catches the back button, which is fragile.
- Errors and screen readers work as with the textarea, the errors of the server for a new page included. Rejected:
  marking the line an error concerns, which needs the checks of the server to report lines.
- The editor is made for phones and tablets as well, since a wiki is also edited on the go. Rejected: desktop first.

## Current limits

- Images are not shown in live preview; they stay their Markdown text.
- No slash commands, and the title derived from the content is not shown while editing.
- The cells of a rendered table cannot be edited in place; the cursor goes into the Markdown of the table.
- No toolbar buttons for quotes, code blocks, horizontal rules and tables, and no shortcuts other than those of bold,
  italic and link.
- The back button of the browser leaves without asking about unsaved changes.
- The labels of the search panel are those of CodeMirror.
- The parser of the editor, `@lezer/markdown`, is slow on some content built to slow a parser down, such as tens of
  thousands of `[a](` in one paragraph or lists nested 50,000 deep: one parse takes one to several seconds, and the
  editor parses the content twice while it opens, so such a page opens slowly in the editor. The page view, which
  markdown-it renders, is not affected. Typing stays fluid in such a page, except in lists nested 50,000 deep: they
  are one line, so every typed character makes the parser parse all of it again, which takes tens of milliseconds
  per character. The cost test holds the code of live preview to its budget on these inputs and the whole editor on a
  page of real content.
- Selecting text by touch on a phone is checked by hand only; the end-to-end tests select with the keys of the cursor.
