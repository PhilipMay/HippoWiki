// Tests written from `spec/markdown-editor-requirements.md` alone, for the rules or the parts of rules that the other
// tests of the editor leave open.

import { undo } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { FORMAT_COMMANDS, type FormatAction } from "@/features/pages/editor/commands";
import { contentLimit } from "@/features/pages/editor/content-limit";
import { continueMarkup, editorExtensions, endEmptyQuote } from "@/features/pages/editor/extensions";
import { indentTransaction } from "@/features/pages/editor/indent";
import { toggleTask } from "@/features/pages/editor/live-preview";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";

const OPTIONS = { newPage: false, labelId: "label", descriptionId: "description" };

/** The state of the editor with the cursor at the `|` in the text, or the selection between two `|`. */
function stateOf(marked: string): EditorState {
  const first = marked.indexOf("|");
  const second = marked.indexOf("|", first + 1);
  const doc = marked.replaceAll("|", "");
  const selection = second < 0 ? EditorSelection.cursor(first) : EditorSelection.range(first, second - 1);
  const state = EditorState.create({ doc, selection, extensions: [editorExtensions(OPTIONS), contentLimit()] });
  ensureSyntaxTree(state, doc.length);
  return state;
}

function run(state: EditorState, command: StateCommand): EditorState {
  let next = state;
  command({ state, dispatch: (tr) => (next = tr.state) });
  return next;
}

/** The content after the action of a button on the marked text. */
function apply(marked: string, action: FormatAction): string {
  return run(stateOf(marked), FORMAT_COMMANDS[action]).doc.toString();
}

/** The content after Enter, as the keymap of the editor runs it. */
function enter(marked: string): string {
  return run(stateOf(marked), (target) => endEmptyQuote(target) || continueMarkup(target)).doc.toString();
}

describe("the line buttons remove their own mark (R21)", () => {
  // markdown-editor-requirements.md, "Toolbar", R21: a line button removes its mark when the lines already have it.
  it.each([
    ["numbered list", "numbered", "|1. one\n2. two\n3. three|", "one\ntwo\nthree"],
    ["task list", "task", "|- [ ] one\n- [ ] two|", "one\ntwo"],
    ["heading 1", "heading1", "# |A", "A"],
    ["heading 2", "heading2", "## |A", "A"],
  ] as const)("%s on lines that have its mark removes it", (_name, action, marked, expected) => {
    expect(apply(marked, action)).toBe(expected);
  });

  // markdown-editor-requirements.md, "Toolbar", R21: a line button sets its mark on every line of the selection.
  it("bullet list on lines of which only some have the mark sets it on every line, without doubling it", () => {
    expect(apply("|- one\ntwo\n- three|", "bullet")).toBe("- one\n- two\n- three");
  });
});

describe("Enter in lists and quotes (R12)", () => {
  // markdown-editor-requirements.md, "Editing comforts", R12: the next item starts with the same mark.
  it.each([
    ["a * item", "* one|", "* one\n* "],
    ["a + item", "+ one|", "+ one\n+ "],
    ["a 1) item", "1) one|", "1) one\n2) "],
    ["an unticked task item", "- [ ] open|", "- [ ] open\n- [ ] "],
  ])("after %s starts the next item with the same mark", (_name, marked, expected) => {
    expect(enter(marked)).toBe(expected);
  });

  // markdown-editor-requirements.md, "Editing comforts", R12: Enter on an empty item ends the list.
  it.each([
    ["numbered item", "1. one\n2. |", "1. one\n"],
    ["task item", "- [ ] one\n- [ ] |", "- [ ] one\n"],
  ])("on an empty %s removes the mark and leaves an empty line", (_name, marked, expected) => {
    expect(enter(marked)).toBe(expected);
  });
});

describe("the content limit for changes other than typing and pasting (R27)", () => {
  /** Text of `length` characters: a line with `marked` at its end, filled up in front with `x`. */
  function filled(length: number, marked: string): string {
    return `${"x".repeat(length - marked.replaceAll("|", "").length - 1)}\n${marked}`;
  }

  // markdown-editor-requirements.md, "Content limit", R27: any other change that would go past the limit is not made.
  it("at 99,999 characters the bold button changes nothing", () => {
    const state = stateOf(filled(CONTENT_MAX_LENGTH - 1, "|word|"));
    expect(run(state, FORMAT_COMMANDS.bold).doc).toBe(state.doc);
  });

  it.each([
    ["Enter in a list", (state: EditorState) => run(state, continueMarkup)],
    ["Tab", (state: EditorState) => state.update(indentTransaction(state, 1)).state],
    ["the link button", (state: EditorState) => run(state, FORMAT_COMMANDS.link)],
    ["the task list button", (state: EditorState) => run(state, FORMAT_COMMANDS.task)],
  ])("at 99,999 characters %s changes nothing", (_name, act) => {
    const state = stateOf(filled(CONTENT_MAX_LENGTH - 1, "- one|"));
    expect(act(state).doc.toString()).toBe(state.doc.toString());
  });

  // markdown-editor-requirements.md, "Content limit", R27: only a change that would go past the limit is refused.
  it("at 100,000 characters a change that does not go past the limit is made", () => {
    const task = stateOf(filled(CONTENT_MAX_LENGTH, "- [ ] a|"));
    const box = task.doc.length - "[ ] a".length;
    expect(task.update(toggleTask(task, box) ?? {}).state.doc.toString()).toMatch(/- \[x\] a$/);

    const bold = stateOf(filled(CONTENT_MAX_LENGTH, "|**word**|"));
    expect(run(bold, FORMAT_COMMANDS.bold).doc.toString()).toMatch(/\nword$/);
  });
});

describe("the content is kept byte for byte (R5)", () => {
  // markdown-editor-requirements.md, "The stored content", R5: the editor never changes the Markdown on its own.
  it.each([
    ["a line separator and a paragraph separator", "# Title\n\na b c"],
    ["a byte order mark", "﻿# Title\n\ntext"],
    ["a no-break space, a zero-width space and a joiner", "# Title\n\na b​c‍d"],
    ["a form feed, a vertical tab and a next line", "# Title\n\na\fb\vc\u0085d"],
    ["combining marks and an emoji sequence", "# Title\n\né 👩‍👩‍👧 🇩🇪"],
  ])("gives back content with %s", (_name, content) => {
    expect(EditorState.create({ doc: content, extensions: editorExtensions(OPTIONS) }).doc.toString()).toBe(content);
  });
});

describe("the history of a task box (R16)", () => {
  // markdown-editor-requirements.md, "What live preview shows formatted", R16: one change that undo reverts, also
  // right after typing.
  it("a tick right after typing is one change of its own that one undo reverts", () => {
    const typed = stateOf("- [ ] a|").update({ changes: { from: 7, insert: "b" }, userEvent: "input.type" }).state;
    const ticked = typed.update(toggleTask(typed, 2) ?? {}).state;
    expect(ticked.doc.toString()).toBe("- [x] ab");
    expect(run(ticked, undo).doc.toString()).toBe("- [ ] ab");
  });
});
