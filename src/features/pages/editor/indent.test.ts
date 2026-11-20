import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { indentTransaction } from "@/features/pages/editor/indent";

/** The state of `doc`, with the cursor at the `|` in it, or the selection between two `|`. */
function stateOf(marked: string): EditorState {
  const first = marked.indexOf("|");
  const second = marked.indexOf("|", first + 1);
  const doc = marked.replaceAll("|", "");
  const selection = second < 0 ? EditorSelection.cursor(first) : EditorSelection.range(first, second - 1);
  return EditorState.create({ doc, selection });
}

function tab(state: EditorState, direction: 1 | -1 = 1): EditorState {
  return state.update(indentTransaction(state, direction)).state;
}

describe("Tab and Shift+Tab (R26)", () => {
  it("nests a bullet item under the item above it, and Shift+Tab reverts it", () => {
    const indented = tab(stateOf("- a\n- |b"));
    expect(indented.doc.toString()).toBe("- a\n  - b");
    expect(tab(indented, -1).doc.toString()).toBe("- a\n- b");
  });

  it("indents an item below a numbered item by three spaces, and Shift+Tab reverts it", () => {
    const indented = tab(stateOf("1. a\n|2. b"));
    expect(indented.doc.toString()).toBe("1. a\n   2. b");
    expect(tab(indented, -1).doc.toString()).toBe("1. a\n2. b");
  });

  it("nests an item under its sibling, not under a deeper item between them", () => {
    expect(tab(stateOf("- a\n  - x\n- |b")).doc.toString()).toBe("- a\n  - x\n  - b");
    expect(tab(stateOf("- a\n  text of a\n- |b")).doc.toString()).toBe("- a\n  text of a\n  - b");
  });

  it("outdents a nested item to the column of its parent item", () => {
    expect(tab(stateOf("- a\n  - b\n    - |c"), -1).doc.toString()).toBe("- a\n  - b\n  - c");
  });

  it("indents every line of a selection", () => {
    expect(tab(stateOf("|one\ntwo\nthree|")).doc.toString()).toBe("  one\n  two\n  three");
    expect(tab(stateOf("|- a\n- b\n- c|")).doc.toString()).toBe("  - a\n  - b\n  - c");
  });

  it("does not include the line a selection ends at the start of", () => {
    expect(tab(stateOf("|one\n|two")).doc.toString()).toBe("  one\ntwo");
  });

  it("indents the line with the cursor in its middle and inserts no tab", () => {
    const indented = tab(stateOf("some| text"));
    expect(indented.doc.toString()).toBe("  some text");
    expect(indented.selection.main.head).toBe(6);
  });

  it("outdents any other line by the indent unit, and leaves a line without an indent as it is", () => {
    expect(tab(stateOf("    te|xt"), -1).doc.toString()).toBe("  text");
    expect(tab(stateOf(" te|xt"), -1).doc.toString()).toBe("text");
    expect(tab(stateOf("te|xt"), -1).doc.toString()).toBe("text");
  });
});
