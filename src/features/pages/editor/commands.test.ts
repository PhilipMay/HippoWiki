import { undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { FORMAT_COMMANDS, type FormatAction } from "@/features/pages/editor/commands";
import { editorExtensions } from "@/features/pages/editor/extensions";

const OPTIONS = { newPage: false, labelId: "label", descriptionId: "description" };

/** The state of the text with the cursor at the `|` in it, or the selection between two `|`. */
function stateOf(marked: string): EditorState {
  const first = marked.indexOf("|");
  const second = marked.indexOf("|", first + 1);
  const doc = marked.replaceAll("|", "");
  const selection = second < 0 ? EditorSelection.cursor(first) : EditorSelection.range(first, second - 1);
  return EditorState.create({ doc, selection, extensions: editorExtensions(OPTIONS) });
}

function run(state: EditorState, command: StateCommand): EditorState {
  let next = state;
  command({ state, dispatch: (tr) => (next = tr.state) });
  return next;
}

/** The text after the action, with the cursor or the selection marked by `|` as in `stateOf()`. */
function apply(marked: string, action: FormatAction): string {
  return show(run(stateOf(marked), FORMAT_COMMANDS[action]));
}

function show(state: EditorState): string {
  const { from, to } = state.selection.main;
  const doc = state.doc.toString();
  return from === to
    ? `${doc.slice(0, from)}|${doc.slice(from)}`
    : `${doc.slice(0, from)}|${doc.slice(from, to)}|${doc.slice(to)}`;
}

describe("the inline buttons (R20)", () => {
  it.each([
    ["bold", "**"],
    ["italic", "*"],
    ["strikethrough", "~~"],
    ["code", "`"],
  ] as const)(
    "%s adds its marks around the selection, removes them again, and inserts a pair without a selection",
    (action, mark) => {
      const added = apply("a |word| b", action);
      expect(added).toBe(`a ${mark}|word|${mark} b`);
      expect(apply(added, action)).toBe("a |word| b");
      expect(apply(`a |${mark}word${mark}| b`, action)).toBe("a |word| b");
      expect(apply("a | b", action)).toBe(`a ${mark}|${mark} b`);
      expect(apply(`a ${mark}|${mark} b`, action)).toBe("a | b");
    },
  );

  it("bold on bold text with only the word selected removes the bold marks", () => {
    expect(apply("**|word|**", "bold")).toBe("|word|");
  });

  it("italic on a word inside bold adds the marks of italic", () => {
    expect(apply("**|word|**", "italic")).toBe("***|word|***");
    expect(apply("***|word|***", "italic")).toBe("**|word|**");
  });

  it("italic removes the underscore marks of italic as well", () => {
    expect(apply("_|word|_", "italic")).toBe("|word|");
  });
});

describe("the line buttons (R21)", () => {
  it("bullet list sets the mark on every selected line and removes it again", () => {
    const added = apply("|one\ntwo\nthree|", "bullet");
    expect(added).toBe("- |one\n- two\n- three|");
    expect(apply(added, "bullet")).toBe("|one\ntwo\nthree|");
  });

  it("numbered list numbers the lines, task list adds unticked boxes", () => {
    expect(apply("|one\ntwo\nthree|", "numbered")).toBe("1. |one\n2. two\n3. three|");
    expect(apply("|one\ntwo|", "task")).toBe("- [ ] |one\n- [ ] two|");
  });

  it("a list mark replaces another list mark", () => {
    expect(apply("|1. one\n2. two|", "bullet")).toBe("- |one\n- two|");
    expect(apply("|- [x] one\n- two|", "numbered")).toBe("1. |one\n2. two|");
  });

  it("keeps the indent of a line and sets the mark on the line of the cursor", () => {
    expect(apply("  in|dented", "bullet")).toBe("  - in|dented");
  });

  it("a heading level replaces another level of any depth, again removes it, and Normal text removes it", () => {
    expect(apply("# |A", "heading2")).toBe("## |A");
    expect(apply("#### |A", "heading2")).toBe("## |A");
    expect(apply("|A", "heading1")).toBe("# |A");
    expect(apply("### |A", "heading3")).toBe("|A");
    expect(apply("## |A", "normal")).toBe("|A");
    expect(apply("|A", "normal")).toBe("|A");
  });
});

describe("the link button (R22)", () => {
  it("turns the selection into a link with the address selected", () => {
    expect(apply("see |docs| here", "link")).toBe("see [docs](|address|) here");
  });

  it("inserts an empty link with the cursor in the text part", () => {
    expect(apply("see | here", "link")).toBe("see [|](address) here");
  });
});

describe("the history of the buttons (R23)", () => {
  it.each(Object.keys(FORMAT_COMMANDS) as FormatAction[])("%s is one change that one undo reverts", (action) => {
    // Typing just before the button would join one change of the history without the isolation.
    const typed = stateOf("# |word|").update({ changes: { from: 6, insert: "s" }, userEvent: "input.type" }).state;
    const formatted = run(typed, FORMAT_COMMANDS[action]);
    expect(formatted.doc.toString()).not.toBe("# words");
    expect(run(formatted, undo).doc.toString()).toBe("# words");
  });
});
