import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { contentLimit } from "@/features/pages/editor/content-limit";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";

/** A state of `length` characters with the cursor at its end. */
function stateOfLength(length: number, text = "x".repeat(length)): EditorState {
  return EditorState.create({
    doc: text,
    selection: EditorSelection.cursor(text.length),
    extensions: contentLimit(),
  });
}

/** Inserts `insert` at the cursor as the given user event. */
function insert(state: EditorState, text: string, userEvent: string): EditorState {
  return state.update(state.replaceSelection(text), { userEvent, scrollIntoView: true }).state;
}

describe("contentLimit", () => {
  it("adds no typed character at the limit", () => {
    const state = stateOfLength(CONTENT_MAX_LENGTH);
    expect(insert(state, "y", "input.type").doc.length).toBe(CONTENT_MAX_LENGTH);
  });

  it("lets a typed character through below the limit", () => {
    expect(insert(stateOfLength(CONTENT_MAX_LENGTH - 1), "y", "input.type").doc.length).toBe(CONTENT_MAX_LENGTH);
  });

  it("cuts a paste to the characters that fit and puts the cursor after them", () => {
    const pasted = insert(stateOfLength(CONTENT_MAX_LENGTH - 5), "0123456789", "input.paste");
    expect(pasted.doc.length).toBe(CONTENT_MAX_LENGTH);
    expect(pasted.doc.sliceString(CONTENT_MAX_LENGTH - 5)).toBe("01234");
    expect(pasted.selection.main.head).toBe(CONTENT_MAX_LENGTH);
  });

  it("counts the text a paste replaces as free room", () => {
    const state = stateOfLength(CONTENT_MAX_LENGTH).update({
      selection: EditorSelection.range(CONTENT_MAX_LENGTH - 3, CONTENT_MAX_LENGTH),
    }).state;
    expect(insert(state, "0123456789", "input.paste").doc.sliceString(CONTENT_MAX_LENGTH - 3)).toBe("012");
  });

  it("does not split a surrogate pair at the limit", () => {
    const pasted = insert(stateOfLength(CONTENT_MAX_LENGTH - 3), "ab😀c", "input.paste");
    // "ab" and the high surrogate of the emoji would fit; the pair is not split, so one character less is added.
    expect(pasted.doc.sliceString(CONTENT_MAX_LENGTH - 3)).toBe("ab");
    expect(pasted.doc.length).toBe(CONTENT_MAX_LENGTH - 1);
  });

  it("does not make any other change that would go past the limit, such as a toolbar button", () => {
    const state = stateOfLength(CONTENT_MAX_LENGTH - 1);
    const changed = state.update({ changes: { from: 0, insert: "**" }, userEvent: "input" }).state;
    expect(changed.doc).toBe(state.doc);
  });

  it("lets a deletion through above the limit, as after a lower limit", () => {
    const state = stateOfLength(CONTENT_MAX_LENGTH + 5);
    const deleted = state.update({ changes: { from: 0, to: 1 }, userEvent: "delete.backward" }).state;
    expect(deleted.doc.length).toBe(CONTENT_MAX_LENGTH + 4);
  });

  it("counts a line break as one character", () => {
    const state = stateOfLength(CONTENT_MAX_LENGTH - 1);
    expect(insert(state, "\n", "input").doc.length).toBe(CONTENT_MAX_LENGTH);
    const withBreaks = stateOfLength(CONTENT_MAX_LENGTH, `${"x\n".repeat(CONTENT_MAX_LENGTH / 2)}`);
    expect(insert(withBreaks, "y", "input.type").doc.length).toBe(CONTENT_MAX_LENGTH);
  });
});
