# Markdown Editor – Steps

## Goal

Writers edit the Markdown of a page in a CodeMirror 6 editor instead of the plain textarea, with the comforts of a
code editor: syntax highlighting, lists continued on Enter, search and replace, a formatting toolbar and Tab to indent.
An inline live preview in the style of Obsidian shows the formatting while writing, with the Markdown marks visible only
on the lines of the cursor, and a source mode shows the whole Markdown. The stored content stays exactly the Markdown
the user typed, so pages, their history, search and MCP work as before.

The requirements, with their IDs and acceptance criteria, are in `spec/markdown-editor-requirements.md`; every step
names the IDs it covers.

## Scope

- In: everything that `markdown-editor-requirements.md` puts in scope: the editor for new pages and for editing pages
  in the browser, live preview and source mode, syntax highlighting, lists continued on Enter, search and replace, the
  toolbar with its shortcuts, Tab to indent, the counter near the content limit, the question before leaving with
  unsaved changes, use on phones and tablets.
- Not in: changes to storage, the page view, the history, search or MCP; toolbar buttons for quotes, code blocks,
  horizontal rules and tables; shortcuts other than those of bold, italic and link; images shown in live preview;
  slash commands; the derived title shown while editing; editing the cells of a rendered table; any server-side
  change, such as new checks of the content.

## Checklist

- [x] Editor in source mode
- [x] Editing comforts
- [x] Content limit and counter
- [x] Toolbar
- [x] Live preview of inline elements and the mode switch
- [x] Live preview of blocks
- [x] Tables in live preview
- [x] Leaving with unsaved changes
- [x] Phones and speed
- [ ] Spec tests
- [ ] Wrap-up

## Sessions

The plan is built in three sessions. A session ends after these steps (see "Step plans" in `step-plan-workflow.md`):

- "Toolbar": the editor works in source mode with all its comforts, its limit and its toolbar.
- "Leaving with unsaved changes": live preview and the question before leaving are done.

The third session builds "Phones and speed", "Spec tests" and the wrap-up.

## Editor in source mode

### Goal

The CodeMirror editor replaces the textarea of a new page and of an edited page, in source mode only, with the same
loading, errors, accessible name and stored content as the textarea (R1, R4, R5, R15, R29, R31, R32, R33, R36, R37,
R39, R40, and the height of R41). The end-to-end tests work with the editor through helpers of their own.

### Build

- Add the CodeMirror packages that the code imports, each in its latest stable version: `@codemirror/state`,
  `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lang-markdown`, and
  `@lezer/markdown` for the GFM extensions. Not the `codemirror` package with its `basicSetup`, which brings
  autocompletion, closing brackets and other changes of the text that R5 does not allow. Later steps add
  `@codemirror/search` and `@lezer/highlight` when they import them. `npm install` must pass with `strict-peer-deps`.
- The editor's language is `markdown()` of `@codemirror/lang-markdown` with `commonmarkLanguage` as its base and the GFM
  extensions of `@lezer/markdown` (tables, strikethrough, task lists, autolinks), without the subscript, superscript and
  emoji syntax of `markdownLanguage`, so that the editor's parse stays close to the markdown-it rules of the page view
  (R10). No languages are loaded for the code of fenced code blocks.
- Code under `src/features/pages/editor/`, the modules of the editor that only the browser loads, without server-only
  imports:
  - `extensions.ts`: the extensions of the editor state, as a function of the options of the editor (new page or not):
    the language, the undo history with its keymap and the default keymap (R15), the placeholder `# Title` for a new
    page (R40), the content attributes `spellcheck="false"`, `autocorrect="off"` and `autocapitalize="off"` (R33), the
    accessible name and description (R36, R37), the theme (monospace in source mode, a minimum height of about 16
    lines and no scroller of its own, so that the editor grows with its content and the page scrolls, R41). Pasting
    stays the plain-text paste of CodeMirror (R32).
  - `mount.ts`: creates the `EditorView` in a given element with the initial content and the options, and returns a
    small handle for the React component: the content, focus, the invalid state and the description, and destroy.
    It reports every change of the document to a callback.
  - Unit tests next to the modules, in the `node` environment of Vitest: they build an `EditorState` with the
    extensions and need no DOM.
- `src/features/pages/components/MarkdownEditor.tsx`, a Client Component used by `PageForm` and `NewPageForm` in place
  of their `TextField` (R1):
  - It renders, on the server and until the editor is ready, the content as a read-only field labelled "Content", as
    the textarea does today, with the helper text below it (R29). After hydration it loads `editor/mount.ts` with a
    dynamic `import()`, so that the code of CodeMirror is in a chunk of its own that only the editor loads; the page
    view, which shares its route with `?action=edit`, never loads it (R39). Read the lazy loading guide of the
    installed Next.js (`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`) first.
  - Once the editor is mounted it replaces the read-only field, with the same content, the focus in the editor and the
    cursor at the start of the content, as the textarea had it. The read-only field and the editor never carry the name
    "Content" at the same time, so that the locators of the tests stay unique. It tells its form when it is ready, and
    "Save" stays disabled until then, also after hydration (R29).
  - The content leaves the editor through one hidden field `content` per editor, updated on every change of the
    document without a React render per key (R38). `PageForm` submits it with its form; in `NewPageForm`, "Save" reads
    the content from the editor for the title check, and the hidden field is the one that the "Save page" dialog
    submits (tied to its form with the `form` attribute, or the dialog's own hidden field filled from the editor, as
    long as each editor has one field `content`).
  - The accessible name "Content", the helper text and the field error: the content element of the editor
    (`role="textbox"`, `aria-multiline`) is named by the visible label "Content" and described by the helper text
    below it, which says that the content is Markdown (GitHub Flavored Markdown) starting with the title heading
    `# Title` and that Esc, then Tab, leaves the editor (R36, R26). A field error of a save replaces the helper text,
    sets `aria-invalid` on the content element, and `useFocusOnFirstError()` focuses the content element (R37). The
    content stays as entered.
  - The `key` of `changedPageForm()` still remounts `PageForm` after a refused save, so the editor starts anew with the
    content as stored (see `optimistic-locking.md`).
- Raw HTML in the content stays text: the editor never renders HTML, and nothing of the content becomes a DOM element
  other than text (R31).
- The editor never changes the content on its own: no autoformatting, no closing brackets, no trimming, and the content
  it hands out is `state.doc.toString()`, whose line breaks are plain as the server stores them (R5).
- `e2e/support/editor.ts`, the helpers of the end-to-end tests for the editor, used by every spec that writes or reads
  the content of a page:
  - `contentEditor(page)`: the editor by its role and its name "Content".
  - `fillContent(page, text)`: replaces the whole content, in a way CodeMirror reads as input, line breaks included;
    the step chooses it (`locator.fill()` on the content element, or select all and `keyboard.insertText()`) and checks
    that it gives exactly the text, also with 100,000 characters.
  - `expectContent(page, text)`: asserts the exact content through the hidden field `content`, the one CSS selector of
    the helpers; testing.md gets this exception in the wrap-up.
  - `pasteContent(page, data)`: dispatches a `paste` event with the given `text/plain` and `text/html` data on the
    content element, for the tests of pasting.
- Move every spec that used the textarea to these helpers: `e2e/create-page.spec.ts`, `e2e/edit-page.spec.ts`,
  `e2e/hydration.spec.ts`, `e2e/all-pages.spec.ts`, `e2e/delete-page.spec.ts`, `e2e/delete-tab.spec.ts`,
  `e2e/deleted-pages.spec.ts`, `e2e/folder-roles.spec.ts`, `e2e/change-password.spec.ts`, and any other that a search
  for `getByLabel("Content")` finds. A test that removed the `maxlength` of the textarea to submit too much content
  sends it as a crafted request instead, by changing the submitted data in the form's `formdata` event (see
  `testing.md`). The test of the cursor at the start of the content checks it by typing a character and expecting it
  at the start.

### Test

- Unit tests (`src/features/pages/editor/extensions.test.ts`): the state of the editor has the history, and undo and
  redo restore the content (R15); the placeholder is part of the extensions of a new page only (R40); the content
  attributes turn spell check off (R33); `toString()` of a state created from content with unusual Markdown (trailing
  spaces, tabs, a setext heading, raw HTML, a lone `\`) gives the content back byte for byte (R5).
- End-to-end tests, new spec `e2e/editor.spec.ts`:
  - `?action=new` on a folder and on a tab and `?action=edit` show the editor and no textarea (R1).
  - Every character of the content is visible in the editor (R4).
  - Opening a page and saving it without a change stores nothing: version, last editor and time stay (R5); a page with
    unusual Markdown keeps it byte for byte after an edit at its end (R5).
  - `?action=new` shows `# Title` in grey as placeholder; typing a character removes it; "Save" on the empty editor
    shows the error of the missing title heading (R40).
  - A page of a few lines shows an editor of about 16 lines; a long page makes the page scroll, not the editor (R41,
    the toolbar part follows in "Toolbar").
  - `<b>x</b>`, `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>` show as these characters; the editor
    holds no `script` or `img` element, no image is requested and no dialog opens (R31).
  - Pasting `text/html` of a bold heading with its `text/plain` adds only the words (R32).
  - The content element has `spellcheck="false"` (R33).
  - The editor is named "Content" and described by the helper text (R36); a save without a title heading shows the
    error below the editor, the editor has focus and `aria-invalid="true"`, and the content is unchanged (R37).
  - Ctrl+Z reverts the last change, Ctrl+Shift+Z and Ctrl+Y repeat it (R15; Cmd on a Mac is the same keymap entry of
    CodeMirror, `Mod`).
  - Opening a page view, a folder, a tab and the list of all pages loads no script that holds the code of CodeMirror,
    such as the class name `cm-content`; the edit address does (R39). The test reads the bodies of the loaded
    `/_next/static/` scripts.
- `e2e/hydration.spec.ts`: with JavaScript disabled, `?action=new` and `?action=edit` show the content read-only and a
  disabled "Save" (R29). With JavaScript, the editor appears with the same content and "Save" turns enabled (R29, in
  `e2e/editor.spec.ts`).
- The moved specs pass unchanged in what they check.
- Every spec changes `e2e/support/`, so the complete end-to-end suite runs in this step.

## Editing comforts

### Goal

Source mode gets syntax highlighting, Enter continues lists and quotes, search and replace is at hand, and Tab indents
while Esc then Tab leaves the editor (R11, R12, R13, R26).

### Build

- Add `@codemirror/search`, `@lezer/highlight` and `@codemirror/language`, which the first step left out because its
  code did not import it yet (knip reports a dependency that nothing imports).
- Syntax highlighting in source mode: a `HighlightStyle` of the editor for the tags of the Markdown parser (headings,
  emphasis, strong, strikethrough, links and addresses, inline code and code blocks, list and quote marks, the other
  marks), with colors from the theme of `src/lib/theme.ts` (R11).
- Enter: `insertNewlineContinueMarkupCommand({ nonTightLists: false })` of `@codemirror/lang-markdown`, in a keymap
  of the editor's own instead of the keymap of `markdown()`, whose command makes a tight list loose on an empty second
  item instead of ending it: the next item with the same mark, the next number, an unticked box after a task item,
  `> ` after a quote line; Enter on an empty item ends the list (R12). A command of its own before it ends a quote on
  an empty quote line, which CodeMirror would continue until a second empty one. Its renumbering of the following
  items of a numbered list is part of the same change and one undo reverts it.
- Search and replace: `search()` with the search panel at the top of the editor and `searchKeymap`, opened with
  `Mod-f` while the editor has focus, with replace and replace all (R13). Replace all is one change in the history.
  The labels of the panel stay those of CodeMirror.
- Tab and Shift+Tab, in `src/features/pages/editor/indent.ts` (R26):
  - Tab indents the line of the cursor or every line of the selection, wherever the cursor is in the line. A list
    item is indented to the content column of the item above it, so that it becomes its child (`- b` below `- a`
    becomes `  - b`, an item below `1. a` gets three spaces); any other line by the indent unit of the editor.
  - Shift+Tab outdents the same lines by the same rule, back to the column of the parent item.
  - Esc, then Tab or Shift+Tab, moves the focus to the next or the previous control instead. The tab focus mode of
    `@codemirror/view` that Escape turns on lasts only two seconds, so the editor remembers Esc itself until the next
    key that is not Tab or a modifier, and its Tab commands leave the key to the browser then.

### Test

- Unit tests (`src/features/pages/editor/indent.test.ts`, `src/features/pages/editor/extensions.test.ts`), with
  commands run on an `EditorState`:
  - Enter after `- one` gives `- `; after `3. three` gives `4. `; after `- [x] done` gives `- [ ] `; after `> quote`
    gives `> `; Enter on an empty `- ` removes the mark and leaves an empty line (R12).
  - Tab on `- b` below `- a` gives `  - b`; on a line below `1. a` three spaces; Shift+Tab reverts both; Tab on three
    selected lines indents all three; Tab with the cursor in the middle of a line indents the line and inserts no tab
    (R26).
  - Replace all of a word that occurs three times, once inside hidden marks such as `**word**`, replaces all three in
    one change that one undo reverts (R13).
- End-to-end tests in `e2e/editor.spec.ts`:
  - In source mode, a heading, emphasis, a link, code and a list mark get other colors than plain text (R11), checked
    with the computed color of their elements.
  - Enter at the end of `- one` continues the list (R12).
  - Ctrl+F opens the search panel; a search finds every occurrence; replace all replaces them and one Ctrl+Z reverts
    it (R13).
  - Tab on `- b` below `- a` nests it; Esc then Tab focuses the next control after the editor; Esc then Shift+Tab the
    control before it (R26). The helper text names Esc then Tab (R36).

## Content limit and counter

### Goal

The editor accepts no more than the content limit of a page and shows a counter near it (R27, R28).

### Build

- `src/features/pages/editor/content-limit.ts`: a transaction filter of the editor state with `CONTENT_MAX_LENGTH` of
  `src/features/pages/limits.ts`. The length is that of the document, which counts every line break as one character,
  as the server counts the content (R27):
  - A change that keeps the content within the limit, or that does not make it longer, passes. So content that is
    already over a limit lowered later can still be opened and shortened.
  - Typing beyond the limit adds nothing; a paste that would go past it is cut to the characters that fit, counted in
    code units as the server counts them, without splitting a surrogate pair.
  - Every other change that would go past the limit, such as a toolbar button, Enter in a list or replace all, is not
    made at all.
- The counter "n / 100,000" below the editor, from 90,000 characters on, formatted with `en-US` grouping and updated
  while typing; below that it is not rendered (R28). The editor reports its length to the component without a React
  render per key while the content is below 90,000 characters.

### Test

- Unit tests (`src/features/pages/editor/content-limit.test.ts`): at 100,000 characters a typed character is not
  added; pasting 10 characters at 99,995 adds the first 5; a paste that would split a surrogate pair at the limit adds
  one character less; at 99,999 characters a change of more than one character that is not a paste, such as the one
  of a toolbar button, changes nothing; deleting at 100,005 characters works; line breaks count as one character
  (R27).
- End-to-end tests, new spec `e2e/editor-limit.spec.ts`, which fills pages near the limit and is therefore its own
  file: at 100,000 characters a typed character is not added; pasting 10 characters at 99,995 adds the first 5 (R27);
  at 89,999 characters no counter shows; typing one character shows "90,000 / 100,000" (R28). The specs in
  `e2e/edit-page.spec.ts` of content over the limit, sent as a crafted request or stored before a lower limit, still
  show the error of the server.

## Toolbar

### Goal

A formatting toolbar above the editor, in both modes, with toggling buttons, the shortcuts of bold, italic and link,
and a place for the mode switch; it sticks to the top of the window while the editor is in view (R14, R19, R20, R21,
R22, R23, R24, the toolbar part of R41).

### Build

- `src/features/pages/editor/commands.ts`, pure commands on the editor state, each one change that one undo reverts
  (each with `isolateHistory`, so that it never joins the typing before it, R23):
  - `toggleInline(mark)` for bold `**`, italic `*`, strikethrough `~~` and inline code `` ` ``: adds the marks around
    every selection range, or removes them when the range is already marked so, the marks just inside or just outside
    the selection; without a selection it inserts the pair with the cursor between them (R20). Bold on `**word**` with
    `word` selected, italic inside bold and other combinations follow the syntax tree, so that `*` of italic is not
    mistaken for half of `**`.
  - `setLineMark(kind)` for heading 1 to 3, "Normal text", bullet list, numbered list and task list: sets the mark on
    every line of the selection or on the line of the cursor, keeping the indent of the line; when every one of these
    lines already has it, it removes it. A heading level replaces another level of any depth, a list mark another list
    mark (a numbered list numbers the lines `1.`, `2.`, `3.`), and "Normal text" removes the heading mark (R21).
  - `insertLink()`: `[selection](address)` with `address` selected; without a selection `[](address)` with the cursor
    in the text part (R22).
- A keymap with higher precedence than the default keymap: `Mod-b` bold, `Mod-i` italic (in place of
  `selectParentSyntax` of the default keymap), `Mod-k` link (R24).
- `src/features/pages/components/EditorToolbar.tsx`: a `role="toolbar"` named "Formatting", above the editor, with
  Material UI icon buttons for bold, italic, strikethrough, inline code, a heading menu ("Normal text", heading 1,
  heading 2, heading 3), link, bullet list, numbered list and task list (R19). Each button has an accessible name and a
  tooltip with its name and, for bold, italic and link, its shortcut, written as Ctrl+B or ⌘B by the platform. The
  buttons keep the focus in the editor: they do not take it on mouse down, and after a command the editor is focused
  again (R23). They are disabled until the editor is ready. The right end of the toolbar holds the place of the mode
  switch of a later step.
- The toolbar sticks to the top of the window while the editor is in view (`position: sticky`, with a background, above
  the content of the editor), and it wraps its buttons onto a second row when the window is narrow (R41, R30).

### Test

- Unit tests (`src/features/pages/editor/commands.test.ts`):
  - Bold on the selection `word` gives `**word**`; bold again gives `word`; bold without a selection gives `****` with
    the cursor in the middle; the same for italic, strikethrough and inline code; italic on a word inside `**...**`
    adds `*` (R20).
  - Bullet list on three selected lines gives `- ` before each; again removes them; numbered list on three lines gives
    `1. `, `2. `, `3. `; task list gives `- [ ] `; bullet list on numbered lines replaces the numbers; heading 2 on
    `# A` and on `#### A` gives `## A`; "Normal text" on `## A` gives `A` (R21).
  - Link on `docs` gives `[docs](address)` with `address` selected; without a selection `[](address)` with the cursor
    between the brackets (R22).
  - Each command adds one entry to the history: one undo restores the text before it (R23).
- End-to-end tests, new spec `e2e/editor-toolbar.spec.ts`:
  - The toolbar is shown above the editor; each button is visible, reachable with the keyboard and has an accessible
    name; the heading menu offers its four entries (R14, R19).
  - Bold and a line button do what the unit tests say, through the browser; after a button, Ctrl+Z restores the text
    and typing goes on in the editor (R20, R21, R23).
  - Link on a selected word selects `address` for typing (R22).
  - Ctrl+B, Ctrl+I and Ctrl+K do the same as their buttons (R24).
  - In a long page, scrolling to the end of the content keeps the toolbar visible at the top of the window (R41).
- This is the last step of the first session that changes more than documentation: the complete end-to-end suite runs
  here.

## Live preview of inline elements and the mode switch

### Goal

Live preview becomes the default mode: inline elements and headings are shown formatted with their marks hidden,
except on the lines of the cursor and of a selection, links open with Ctrl+click or Cmd+click, and a switch in the
toolbar changes between live preview and source mode, remembered in the browser (R2, R3, R6 for its inline elements and
headings, R7 for links, R9, R10, R17, R18, R25, R31 in live preview, R34).

### Build

- `src/features/pages/editor/live-preview.ts`: a pure function from the editor state and a range of the document to the
  decorations of live preview, walking the syntax tree of that range:
  - The lines touched by any selection range, the line of a cursor included, are left as Markdown with all their marks
    (R3).
  - Headings of every level, ATX and setext: the line gets the style of its level, the `#` marks and the space after
    them are hidden; the underline of a setext heading is hidden like a fence line (see "Live preview of blocks") (R6).
  - Bold, italic, strikethrough and inline code: the marks are hidden and the text gets its style (R6).
  - Links, autolinks and bare addresses: only the text of the link shows, styled as a link; the brackets, the address
    and the title are hidden (R7). A link whose address `isSafeAddress()` refuses stays its Markdown text, as the page
    view shows it.
  - Images stay their Markdown text, also the link syntax inside them (R9); raw HTML stays text (R31). Elements that
    the editor's parser reads otherwise than markdown-it are shown as the editor's parser reads them; nothing of this
    reaches the content (R10).
- `src/features/pages/editor/preview-plugin.ts`: the view plugin that builds these decorations for the visible ranges
  and again when the document, the selection or the viewport changes, and the mouse handler of links (R17):
  - A plain click on a link puts the cursor there, so its line shows its Markdown.
  - Ctrl+click or Cmd+click opens the address of an inline link, an autolink or a bare address, and of a reference link
    the address of its definition in the content, in a new browser tab with `noopener`, resolved against the address
    of the editor; the editor keeps its content and the cursor does not move. Only an address that `isSafeAddress()`
    accepts opens; any other opens nothing (R17).
  - A tap on a touch screen has no modifier, so it only puts the cursor there (R34).
- `isSafeAddress()` and `SAFE_PROTOCOLS` move from `src/features/pages/markdown.ts` into a module without imports,
  `src/features/pages/safe-address.ts`, which `markdown.ts` imports, so that the editor uses the one list of safe
  addresses without bringing markdown-it into its chunk (see "UI" in `architecture.md`).
- The mode (R2, R18, R25):
  - A compartment of the editor holds live preview or source mode, with the highlighting of source mode in both, so
    that a switch reconfigures it and keeps the document, the selection and the undo history (R2).
  - `src/features/pages/editor/mode.ts`: the key of the mode in `localStorage` and the parse of its stored value; an
    unknown value, no value or a storage that throws gives live preview, and a storage that throws on writing is
    ignored (R18).
  - The switch at the right end of the toolbar: a toggle of two buttons, "Live preview" and "Source", the current one
    pressed (`aria-pressed`), reachable with the keyboard and always visible while editing (R25). It switches the
    mode and stores it. The two are standalone toggle buttons in a group, each a stop of Tab: the button group of
    Material UI has a single stop that does not follow the pressed button when the buttons never take the focus.
  - The editor starts in the stored mode, and in live preview without one (R18).
- The styles of live preview (heading sizes, emphasis, code, link color) come from the theme of the editor, in the
  font of the page view; source mode stays monospace.

### Test

- Unit tests (`src/features/pages/editor/live-preview.test.ts`), on an `EditorState` with the syntax tree parsed to the
  end (`ensureSyntaxTree`):
  - `## Heading` on another line than the cursor: `##` and the space are hidden, the line has the heading style; with
    the cursor anywhere on that line nothing on the line is hidden; a selection over three lines shows all marks on all
    three (R3, R6).
  - For bold, italic, strikethrough, inline code, every heading level, a setext heading, an inline link, an autolink
    and a bare address: the marks are hidden and the text is styled (R6, R7).
  - `![alt](/x.png)` and raw HTML get no decoration (R9, R31).
- `src/features/pages/safe-address.test.ts` takes over the tests of `isSafeAddress()` from `markdown.test.ts`.
- Unit tests (`src/features/pages/editor/mode.test.ts`): the stored value of each mode is read back; no value, an
  unknown value and a throwing storage give live preview (R18).
- End-to-end tests, new spec `e2e/editor-preview.spec.ts`:
  - For each inline element, a line with it shows it formatted without its marks while the cursor is on another line;
    moving the cursor onto the line shows every mark of the line (R3, R6).
  - A click on a link shows `[text](address)`; Ctrl+click on `[a](https://example.com)` opens a new tab with that
    address (answered with `page.route()`, so no request leaves the test) and the editor keeps its content; Ctrl+click
    on `[a](javascript:alert(1))` opens nothing (R17).
  - `![alt](/x.png)` shows as its Markdown, also with the cursor on another line, and no image is requested (R9); the
    raw HTML of R31 shows as text in live preview and no script runs.
  - The switch names both modes and marks the current one; switching back and forth keeps the text and the cursor,
    and undo still reverts an edit made before the switch (R2, R25). Source mode shows every character (R4).
  - Switch to source mode, save, open "Edit" on another page: it starts in source mode; a new browser context starts
    in live preview (R18).
  - The stored content does not depend on the mode it was edited in (R5, R10).

## Live preview of blocks

### Goal

Live preview shows lists, task boxes, block quotes, fenced code blocks and horizontal rules formatted, and a click on a
task box ticks it in the text (R6 for these blocks, R7, R16).

### Build

- `live-preview.ts` adds the decorations of the blocks, with the same rule of the cursor lines (R3, R6, R7):
  - Bullet list items: the bullet mark is replaced by a list mark widget; numbered items keep their number, styled as
    a list mark.
  - Task items: `[ ]` and `[x]` are replaced by a checkbox widget, ticked as in the text; in a bullet list it takes
    the place of the bullet, as in the page view.
  - Block quotes: `>` and the space after it are hidden and the line gets a bar at its left, nested quotes one bar per
    level.
  - Fenced code blocks: the lines of the code get a monospace box; the fence lines keep their place as lines, so that
    the cursor can move onto them, but their text is hidden and their height reduced, and they show as Markdown when the
    cursor is on them. Indented code blocks get the box as well.
  - Horizontal rules: the line is replaced by a line widget.
- Widgets build their DOM only with `document.createElement` and text nodes, never with HTML strings (R31).
- The checkbox widget is a real checkbox with an accessible name. A click on it switches `[ ]` and `[x]` (or `[X]`) in
  the text as one change with `isolateHistory`, so one undo reverts it, without moving the cursor onto its line; it is
  stored only by "Save", like every other edit (R16). It is usable by touch (R30).

### Test

- Unit tests in `live-preview.test.ts`: for a bullet item, a numbered item, a task item ticked and not, a nested list,
  a quote and a nested quote, a fenced code block with its fence lines, an indented code block and a horizontal rule,
  the decorations hide the marks and add the widgets and line styles described above while the cursor is elsewhere,
  and none of them on the lines of the cursor (R3, R6, R7). The command of the checkbox turns `- [ ] a` into
  `- [x] a` and back, as one entry of the history (R16).
- End-to-end tests in `e2e/editor-preview.spec.ts`:
  - Each block element shows as R7 describes while the cursor is on another line, and as Markdown with the cursor on
    its line (R6, R7).
  - A click on an unticked box changes `- [ ] a` to `- [x] a`; Ctrl+Z changes it back; the page is not saved until
    "Save" (R16).

## Tables in live preview

### Goal

A GitHub Flavored Markdown table shows as a rendered table in live preview, and as its whole Markdown while the cursor
or a selection is in it; a click on the rendered table puts the cursor into its Markdown at that place (R8, the table
exception of R3).

### Build

- `src/features/pages/editor/tables.ts`:
  - A pure function from the syntax node of a table to its model: the header cells, the alignment of each column from
    the delimiter row, the rows, each row filled up or cut to the columns of the header as the page view does, and the
    position of every cell in the document.
  - A state field of block decorations (block widgets must come from the state, not from a view plugin) that replaces
    every table whose lines no selection range touches by a table widget; with the cursor or a selection anywhere in
    the table, its lines show as Markdown, every line of it (R3, R8). It maps its decorations through changes and
    rebuilds only the tables that a change or a move of the selection touches, so that a large page stays fast (R38).
- The table widget renders a `table` with its header, its rows and the alignment of each column, built with DOM calls
  only. The inline elements of a cell (bold, italic, strikethrough, inline code, the text of links) are formatted as in
  live preview; everything else of a cell stays its text. Two widgets of the same table text are equal, so that typing
  elsewhere does not redraw them.
- A click on a cell of the rendered table puts the cursor at the start of the text of that cell in the Markdown, which
  then shows the whole table as Markdown (R8).
- The cursor passes over a block widget when it moves with the keyboard, so a move up or down from the line right
  below or above a rendered table stops at the edge of the table instead, which then shows its Markdown: a table is
  reached with the keyboard too.

### Test

- Unit tests (`src/features/pages/editor/tables.test.ts`): the model of a table with a header, three rows, left,
  center and right alignment, a row with fewer and one with more cells than the header, escaped pipes and inline code
  with a pipe; the positions of the cells; the state field replaces a table without the cursor, and leaves every line
  of it as Markdown with the cursor or a selection in any of its lines (R8).
- End-to-end tests in `e2e/editor-preview.spec.ts`: a table shows as a table with its header, rows and column
  alignment; moving the cursor into it shows the whole table as Markdown, moving it out renders it again; a click on a
  cell of the second row puts the cursor at that cell in the Markdown (R8).

## Leaving with unsaved changes

### Goal

Leaving the editor with unsaved changes asks first: the browser's own question when the tab is closed or reloaded, and
the dialog "Discard changes?" for the links of the app and "Cancel" (R35).

### Build

- The editor reports whether its content differs from the content it was opened with, compared without a React render
  per key (for example with `Text.eq` against the initial document). Undoing back to the initial content makes it clean
  again.
- `src/features/pages/components/useUnsavedChangesGuard.ts` (a hook used by `PageForm` and `NewPageForm`), while the
  content differs:
  - A `beforeunload` listener that asks the browser's own question when the tab is closed or reloaded.
  - A click listener in the capture phase on the document for plain left clicks on links of the app: same origin, no
    `target`, no `download`, no modifier key. It cancels the navigation and opens the dialog with the address of the
    link. Links opened in a new tab and the links in the editor are not held.
  - Both listeners are removed when the content is clean again, when the form is submitted and when the component
    unmounts, so that saving never asks and no listener outlives the editor.
- `src/features/pages/components/DiscardChangesDialog.tsx`: the dialog "Discard changes?" with "Discard" and "Keep
  editing", "Keep editing" focused once the dialog has entered (`focusOnEntered`). "Keep editing" closes it and keeps
  the editor with its content; "Discard" navigates to the address of the link with the router, "Cancel" included.
- The back button of the browser is not held (see the decision in the requirements).
- After a save refused as changed, the editor is remounted with the page as stored and is clean, so nothing asks (see
  `optimistic-locking.md`).

### Test

- End-to-end tests, new spec `e2e/editor-leave.spec.ts`, on `?action=edit` and on `?action=new`:
  - After typing a character, "Cancel" shows "Discard changes?" with "Keep editing" focused; "Keep editing" keeps the
    editor with the typed character; "Discard" leads where "Cancel" leads (R35).
  - After undoing the character, "Cancel" leaves without a question; without a change no link asks (R35).
  - After typing, a link of the app bar shows the dialog, and "Discard" follows it (R35).
  - After typing, closing the page with `runBeforeUnload` raises a `beforeunload` dialog; without a change it does not
    (R35).
  - "Save" leaves without a question, also through the "Save page" dialog of a new page; after the save, closing the
    page view raises no `beforeunload` dialog (R35).
  - The back button leaves without a question, and the page it leads to raises no `beforeunload` dialog (R35).
  - A save refused as changed shows the stored content, and "Cancel" then leaves without a question.
- The tests of `e2e/create-page.spec.ts` and `e2e/edit-page.spec.ts` that type and then press "Cancel" go through
  "Discard".
- This is the last step of the second session that changes more than documentation: the complete end-to-end suite runs
  here.

## Phones and speed

### Goal

The editor is fully usable by touch at phone width, and stays fluid with a page at the content limit (R30, R34, R38).

### Build

- At phone width the toolbar wraps its buttons, the mode switch stays visible, the editor and its buttons fit the width
  without a horizontal scroll of the page, and the task boxes and the buttons have touch targets of a usable size (R30).
  Fix what the tests below show.
- `src/test/editor-content.ts`: a page of 100,000 characters with headings, lists, task lists, quotes, code blocks and
  tables, for the cost tests and for the manual check.
- Fix what the cost tests show, for example a decoration that walks the whole document on every key.
- Decision of this step, approved by the user: `@lezer/markdown` itself takes seconds for some of the inputs of
  `src/test/slow-markdown.ts` (one parse of `[a](` repeated about 3 s, of lists nested 50,000 deep about 3.5 s, of
  `[a][` and `*a` about 1 s, also as plain CommonMark), and the editor parses the content twice while it opens. This is
  accepted as a current limit of the editor for such content, not worked around: the budget of 2 s for building covers
  the parse only for the page of `src/test/editor-content.ts`, and for the slow inputs the decorations and the tables on
  the parsed tree. Typing stays within its budget for every input. The wrap-up names the limit in "Current limits" of
  `markdown-editor.md`.

### Test

- Cost test `src/features/pages/editor/live-preview.cost.test.ts` (project `cost`), on the page of
  `src/test/editor-content.ts` and on the inputs of `src/test/slow-markdown.ts`: creating the state of the page, parsing
  it to the end and building the decorations of live preview and the tables of the whole document stays below 2 s, and
  for every input the decorations and the tables of the whole document on the parsed tree stay below 2 s; a typed
  character in the middle of the page, with the syntax tree updated and the decorations of a screen of lines and the
  table field updated, stays below 50 ms on average over 100 characters (R38).
- End-to-end tests, new spec `e2e/editor-phone.spec.ts`, at phone size with touch (`viewport`, `hasTouch`,
  `isMobile`): edit a page by tapping into the editor and typing, select text (with the keys of the cursor: Playwright
  cannot drive the handles of a native selection by touch), use a toolbar button and the mode switch,
  tap a task box, and save; the page view shows the result; every button of the toolbar and "Save" and "Cancel" lie
  within the width of the window and are touch targets of at least 24 by 24 pixels, the minimum of WCAG 2.2, as is the
  task box (R30). A tap on a link shows its Markdown and no new tab opens (R34).
- Manual checks for the user: in a page of 100,000 characters with tables and lists, typing, moving the cursor,
  scrolling and switching the mode show no noticeable delay on a current laptop, and the editor appears with the
  content within about 2 seconds of the page loading (R38); the editor on a real phone or tablet (R30).

## Spec tests

### Goal

Tests written from `spec/markdown-editor-requirements.md` alone check the editor against its exact contract.

### Build

- Start the `spec-tester` agent (`.claude/agents/spec-tester.md`) with `spec/markdown-editor-requirements.md`, wait for
  it, and keep the tests it reports as useful.
- A finding with High confidence within the scope of this plan is fixed here, and the failing test of its Evidence is
  added back with the fix; any other finding stops the plan (see "Step plans" in `step-plan-workflow.md`).

### Test

- The tests the agent keeps pass, with the fixes of this step.
- This is the last step that changes more than documentation: the complete end-to-end suite runs here.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Write `spec/markdown-editor.md` as the feature spec of the editor (see "Feature specs" in `step-plan-workflow.md`):
   its purpose; pointers to `src/features/pages/editor/`, `src/features/pages/components/MarkdownEditor.tsx`,
   `EditorToolbar.tsx`, `DiscardChangesDialog.tsx`, `useUnsavedChangesGuard.ts` and their tests and specs; the rules
   that still hold from the requirements (where the editor is used, the two modes and what live preview shows, the
   toolbar and its shortcuts, the keyboard, the content limit and the counter, loading, phones, safety and pasting,
   leaving with unsaved changes, errors and screen readers, speed, the stored content); "Decisions" with the decisions
   of the requirements and of this plan (the editor's parser, the dynamic loading, the hidden field, the table widget);
   "Current limits" (images not shown, no slash commands, cells of a table not editable while rendered, the back
   button not held, the labels of the search panel those of CodeMirror). Update:
   - `pages.md`: the content is edited in the editor of `markdown-editor.md`; the routes point there; the rule that
     the editor counts the content as the server does stays; the limit "raw Markdown editing in a textarea" goes.
   - `optimistic-locking.md`: after a refused save the editor shows the page as stored without asking about unsaved
     changes.
   - `tech.md`: CodeMirror 6 and its packages, and Lezer as a second Markdown parser used only to show the content in
     the editor; markdown-it stays the only parser for everything else.
   - `architecture.md`: the modules of `src/features/pages/editor/`, loaded only with a dynamic import, and
     `safe-address.ts`; the rule of "UI" that Markdown is parsed only with markdown-it, with the editor's display as the
     one exception.
   - `testing.md`: the helpers of `e2e/support/editor.ts` and the CSS selector of the hidden field `content`; unit
     tests of the editor on an `EditorState` in the `node` environment; the cost test of live preview; the new specs.
2. Remove "Rich editor" from `roadmap.md` and add slash commands and the derived title shown while editing as later
   additions to the editor.
3. Check that `README.md` has all the commands a developer needs, and that its summary of what the prototype can do
   names the Markdown editor with live preview and source mode.
4. Delete this step file and `spec/markdown-editor-requirements.md`. Replace every requirement ID (R1 to R41) in the
   comments of the code and the tests by the section of `markdown-editor.md` that holds the rule now, or drop the ID and
   keep the sentence.
5. Update the spec catalog in `CLAUDE.md`: add `spec/markdown-editor.md` with its question, remove this step file and
   the requirements file, and change the entry of `pages.md` only if its question changes.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
- A search for `R1` to `R41`, `markdown-editor-requirements` and `markdown-editor-steps` in `src/`, `e2e/`, `spec/`,
  `README.md` and `CLAUDE.md` finds nothing.
