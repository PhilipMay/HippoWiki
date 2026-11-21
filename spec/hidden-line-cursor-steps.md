# Cursor on Hidden Lines – Steps

## Goal

In live preview the arrow keys jump over the fence lines of a fenced code block, so the cursor never reaches them and
their ` ``` ` never shows, though `markdown-editor.md` says that the lines of the cursor show all their marks. After
this plan, Arrow Up and Arrow Down stop on every hidden line, a fence line or the underline of a setext heading, which
then shows its Markdown and can be edited like any other line.

## Scope

- In: Arrow Up and Arrow Down without modifiers in live preview, onto the opening and the closing fence line of a
  fenced code block and the underline of a setext heading; the goal column of the cursor across such a line; the rule
  in `markdown-editor.md`.
- Not in:
  - Source mode, which hides no line.
  - Shift+Arrow Up and Shift+Arrow Down: a selection shows every line from its first to its last, so a hidden line it
    passes over shows its Markdown already.
  - Page Up, Page Down, Home, End and the moves by word.
  - The reduced height of a hidden line and clicks on it: a click on a hidden line already puts the cursor there.
  - The rendered table, which the cursor reaches through a click on a cell, and the blocks that hide no line.
  - Touch screens, where the cursor is put by a tap.

## Checklist

- [x] Arrow keys stop on hidden lines
- [ ] Wrap-up

## Arrow keys stop on hidden lines

### Goal

Arrow Down on the line above a hidden line, and Arrow Up on the line below it, put the cursor on the hidden line, which
then shows its Markdown. The next arrow key moves on from there as usual.

### Build

- In `src/features/pages/editor/preview-plugin.ts`, a keymap for `ArrowUp` and `ArrowDown` in `livePreview()`, so that
  it acts only in live preview and leaves with it when the mode switches to source mode. It runs before the default
  keymap of CodeMirror; the keys of the picker on `[[` keep acting first while its list is open.
- The command moves each cursor of the selection as CodeMirror would (`view.moveVertically`). Where that move lands
  further away than the next line in its direction, and the next line is a hidden line, the cursor goes onto the hidden
  line instead: at the goal column of the move, at most the length of the line, and with that goal column kept, so that
  the following arrow key returns to the column the cursor came from. Every other move stays the one of CodeMirror, so
  a wrapped line is still walked through line by line on the screen. The command returns `false` when it changes no
  cursor, so that the default keymap acts.
- A line is hidden when the decorations of the view plugin give it the class `PREVIEW_CLASS.hiddenLine` of
  `live-preview.ts`, so that the command and what the screen shows cannot disagree. A line outside the visible ranges,
  which has no decorations, counts as shown.
- A selection that is not empty is moved by CodeMirror as before.
- In `spec/markdown-editor.md`, under "What live preview shows" or "Editing", the rule: Arrow Up and Arrow Down stop on
  a hidden line, the fence line of a code block or the underline of a setext heading, which then shows its Markdown.
  Under "Decisions" the reason: a hidden line is so short that the move of CodeMirror by the height of a line passes
  over it; rejected: showing the fence lines while the cursor is on the line next to the block, which would make the
  text jump on every arrow key next to a code block.

### Test

- End to end, in `e2e/editor-preview.spec.ts`, in live preview with the content
  `above\n\n```js\nlet a = 1;\n```\n\nbelow`:
  - Arrow Down from the first line visits every line in order; on line 3 the line shows ` ```js ` and the other fence
    stays hidden, on line 5 it shows ` ``` `, and on the other lines both stay hidden.
  - Arrow Up from the last line visits every line in the reverse order, with the same lines shown.
  - From the end of a line longer than the fence line, Arrow Down twice crosses the opening fence line and puts the
    cursor in the code line at the column it came from, as far as that line reaches.
  - Typing on a fence line reached with the arrow keys changes the fence, for example `js` to `ts`, and the content
    holds the change.
- End to end, a setext heading `Title\n=====\n\nnext`: Arrow Up from `next` stops on the underline, which shows
  `=====`.
- End to end, a fenced code block without its closing fence at the end of the content: Arrow Down reaches the opening
  fence line and then the code lines.
- End to end, a long line above a code block that wraps on the screen: Arrow Down walks through its rows on the screen
  first, then onto the opening fence line.
- End to end, source mode with the same content: Arrow Down visits every line, as before.
- The complete `npm run test:e2e`, since this is the last step that changes anything but documentation.
- By hand in the browser: the arrow keys over a code block and a setext heading in a long page, and the arrow keys of
  the picker on `[[` next to a code block.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Check that `spec/markdown-editor.md` holds the rule and the decision of the first step as built, and that its
   pointers to the code and the tests are still right.
2. `roadmap.md` holds no item of this fix; check that this is still so.
3. `README.md` needs no new command; check that this is still so.
4. Delete this step file. The plan has no requirements file, so no requirement IDs are in the code or the tests.
5. Remove this step file from the spec catalog in `CLAUDE.md`. The entry of `spec/markdown-editor.md` stays, since its
   question does not change.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass: the wrap-up changes only documentation,
  so `npm run check`.
