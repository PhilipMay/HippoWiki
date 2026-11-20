// Tab and Shift+Tab of the Markdown editor (R26): they indent and outdent the lines of the cursor or the selection,
// nesting a list item under the item above it. After Esc, the next Tab or Shift+Tab moves the focus out of the editor
// instead, so that the keyboard is never trapped.

import { getIndentUnit, indentString } from "@codemirror/language";
import { countColumn, type EditorState, type Line, type TransactionSpec } from "@codemirror/state";
import { type Command, type EditorView, type KeyBinding, ViewPlugin } from "@codemirror/view";

/** A list item: its indent, then its mark (`-`, `+`, `*`, `1.` or `1)`) and the spaces after it. */
const LIST_ITEM = /^([ \t]*)((?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$))/;

/** Keys that do not end the wait for Tab after Esc, because they only modify the next key, such as Shift for Shift+Tab. */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

type LineInfo = {
  /** The column of the first character that is not a space or a tab. */
  indent: number;
  /** The width of the indent in characters of the line. */
  indentLength: number;
  /** The column of the content of a list item, after its mark and the spaces after it; `null` for any other line. */
  contentColumn: number | null;
  blank: boolean;
};

function lineInfo(state: EditorState, line: Line): LineInfo {
  const text = line.text;
  const indentLength = /^[ \t]*/.exec(text)?.[0].length ?? 0;
  const indent = countColumn(text.slice(0, indentLength), state.tabSize);
  const item = LIST_ITEM.exec(text);
  return {
    indent,
    indentLength,
    contentColumn: item ? countColumn(text.slice(0, item[0].length), state.tabSize) : null,
    blank: indentLength === text.length,
  };
}

/**
 * The column a list item is indented to by Tab: the content column of the item above it at the same level, so that it
 * becomes the child of that item (`- b` below `- a` becomes `  - b`, an item below `1. a` gets three spaces). Deeper
 * items and the text of items between them are passed over; `null` when there is no such item.
 */
function nestedColumn(state: EditorState, line: Line, info: LineInfo): number | null {
  for (let number = line.number - 1; number >= 1; number--) {
    const above = lineInfo(state, state.doc.line(number));
    if (above.blank) continue;
    if (above.contentColumn === null) {
      if (above.indent > info.indent) continue;
      return null;
    }
    if (above.indent > info.indent) continue;
    if (above.indent < info.indent) return null;
    return above.contentColumn > info.indent ? above.contentColumn : null;
  }
  return null;
}

/** The column a list item is outdented to by Shift+Tab: the column of its parent item; `null` when it has none. */
function parentColumn(state: EditorState, line: Line, info: LineInfo): number | null {
  for (let number = line.number - 1; number >= 1; number--) {
    const above = lineInfo(state, state.doc.line(number));
    if (above.blank) continue;
    if (above.contentColumn === null) {
      if (above.indent > 0) continue;
      return null;
    }
    if (above.indent < info.indent) return above.indent;
  }
  return null;
}

/** The lines that any selection range touches, each once, in document order. */
export function selectedLines(state: EditorState): Line[] {
  const lines = new Map<number, Line>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    // A selection that ends at the start of a line does not include that line.
    const lastPos = range.to > range.from && state.doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to;
    const last = state.doc.lineAt(lastPos).number;
    for (let number = first; number <= last; number++) lines.set(number, state.doc.line(number));
  }
  return [...lines.values()].sort((a, b) => a.number - b.number);
}

/** The transaction that indents (`direction` 1) or outdents (-1) every selected line by the rules above. */
export function indentTransaction(state: EditorState, direction: 1 | -1): TransactionSpec {
  const unit = getIndentUnit(state);
  const changes = selectedLines(state).flatMap((line) => {
    const info = lineInfo(state, line);
    let column: number;
    if (direction === 1) {
      column = (info.contentColumn !== null ? nestedColumn(state, line, info) : null) ?? info.indent + unit;
    } else {
      if (info.indent === 0) return [];
      column =
        (info.contentColumn !== null ? parentColumn(state, line, info) : null) ?? Math.max(0, info.indent - unit);
    }
    return [{ from: line.from, to: line.from + info.indentLength, insert: indentString(state, column) }];
  });
  return {
    changes,
    scrollIntoView: true,
    userEvent: direction === 1 ? "input.indent" : "delete.dedent",
  };
}

/** Remembers whether Esc was the last key pressed in the editor, so that the next Tab or Shift+Tab leaves it. */
const escapeTracker = ViewPlugin.fromClass(
  class {
    escaped = false;
  },
  {
    eventObservers: {
      keydown(event) {
        if (event.key === "Escape") this.escaped = true;
        else if (event.key !== "Tab" && !MODIFIER_KEYS.has(event.key)) this.escaped = false;
      },
      blur() {
        this.escaped = false;
      },
    },
  },
);

function indentCommand(direction: 1 | -1): Command {
  return (view: EditorView) => {
    const tracker = view.plugin(escapeTracker);
    // After Esc the key is not handled, so the browser moves the focus to the next or the previous control.
    if (tracker?.escaped) return false;
    if (view.state.readOnly) return false;
    view.dispatch(indentTransaction(view.state, direction));
    return true;
  };
}

/** Tab and Shift+Tab of the editor, and what tells them that Esc came first. */
export const indentKeymap: KeyBinding[] = [{ key: "Tab", run: indentCommand(1), shift: indentCommand(-1) }];

export const indentExtensions = [escapeTracker];
