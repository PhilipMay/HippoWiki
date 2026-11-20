import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { editorExtensions } from "@/features/pages/editor/extensions";
import { livePreviewDecorations } from "@/features/pages/editor/live-preview";
import { livePreview } from "@/features/pages/editor/preview-plugin";
import { tablesField } from "@/features/pages/editor/tables";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import { EDITOR_PAGE } from "@/test/editor-content";
import { SLOW_INPUTS } from "@/test/slow-markdown";

// Wall-clock budgets of live preview (R38): this file runs in the Vitest project `cost`, never under coverage and
// never next to other test files. The view plugin of live preview needs a view, so the tests build its decorations
// with the pure function it calls, for the ranges the view would ask for.

const OPTIONS = { newPage: false, labelId: "label", descriptionId: "description" };

/** How many lines around the cursor count as one screen of the editor, the margin of the viewport included. */
const SCREEN_LINES = 60;

/** How many characters the typing test types. */
const TYPED = 100;

/** The budgets are asserted by the tests themselves; the parse before them is not timed, so this only ends a hang. */
const TIMEOUT = { timeout: 60_000 };

/** The state of the editor in live preview with `content`, the cursor at its start as the editor opens it. */
function create(content: string): EditorState {
  return EditorState.create({ doc: content, extensions: [editorExtensions(OPTIONS), livePreview()] });
}

/** The lines of one screen around `pos`. */
function screenAround(state: EditorState, pos: number) {
  const line = state.doc.lineAt(pos).number;
  const half = SCREEN_LINES / 2;
  return {
    from: state.doc.line(Math.max(1, line - half)).from,
    to: state.doc.line(Math.min(state.doc.lines, line + half)).to,
  };
}

const inputs: Record<string, string> = { "the editor page": EDITOR_PAGE, ...SLOW_INPUTS };

/** The decorations of live preview and the tables of the whole document, the tree parsed to the end before. */
function decorateAll(state: EditorState): EditorState {
  livePreviewDecorations(state, [{ from: 0, to: state.doc.length }]);
  // A transaction takes over the tree parsed to the end, which adds the tables of the whole document to the field.
  const next = state.update({}).state;
  next.field(tablesField);
  return next;
}

/** The state of the editor with `content`, the tree parsed to the end. */
function parsed(content: string): EditorState {
  const state = create(content);
  ensureSyntaxTree(state, state.doc.length, 10_000);
  return state;
}

describe("the cost of live preview (R38)", () => {
  it("builds the state, the tree, the decorations and the tables of the editor page within 2 s", () => {
    expect(EDITOR_PAGE.length).toBe(CONTENT_MAX_LENGTH);
    const start = performance.now();
    decorateAll(parsed(EDITOR_PAGE));
    expect(performance.now() - start).toBeLessThan(2_000);
  });

  for (const [name, content] of Object.entries(inputs)) {
    // The parser of the editor, @lezer/markdown, takes seconds for some of the slow inputs on its own, so the budget
    // covers the code of live preview on the parsed tree (see "Phones and speed" in the step plan).
    it(`builds the decorations and the tables of ${name} on the parsed tree within 2 s`, TIMEOUT, () => {
      expect(content.length).toBeLessThanOrEqual(CONTENT_MAX_LENGTH);
      const state = parsed(content);
      const start = performance.now();
      decorateAll(state);
      expect(performance.now() - start).toBeLessThan(2_000);
    });

    it(`types a character in the middle of ${name} within 50 ms on average`, TIMEOUT, () => {
      let state = parsed(content).update({}).state;
      let pos = Math.floor(state.doc.length / 2);
      state = state.update({ selection: EditorSelection.cursor(pos) }).state;
      const start = performance.now();
      for (let typed = 0; typed < TYPED; typed++) {
        state = state.update({
          changes: { from: pos, insert: "a" },
          selection: EditorSelection.cursor(pos + 1),
          userEvent: "input.type",
        }).state;
        pos += 1;
        const screen = screenAround(state, pos);
        ensureSyntaxTree(state, screen.to, 10_000);
        livePreviewDecorations(state, [screen]);
        state.field(tablesField);
      }
      expect((performance.now() - start) / TYPED).toBeLessThan(50);
    });
  }
});
