import { redo, undo } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { replaceAll, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import {
  continueMarkup,
  editorExtensions,
  endEmptyQuote,
  NEW_PAGE_PLACEHOLDER,
} from "@/features/pages/editor/extensions";

const OPTIONS = { labelId: "label", descriptionId: "description" };

function stateOf(doc: string, newPage = false): EditorState {
  return EditorState.create({ doc, extensions: editorExtensions({ ...OPTIONS, newPage }) });
}

/** Runs a command on the state and returns the state after it. */
function run(
  state: EditorState,
  command: (target: { state: EditorState; dispatch: (tr: Transaction) => void }) => boolean,
) {
  let next = state;
  command({ state, dispatch: (tr) => (next = tr.state) });
  return next;
}

/** The attributes of the content element that the extensions of the state set, merged as CodeMirror merges them. */
function contentAttributes(state: EditorState): Record<string, string> {
  return Object.assign(
    {},
    ...state.facet(EditorView.contentAttributes).map((value) => (typeof value === "function" ? {} : value)),
  ) as Record<string, string>;
}

describe("editorExtensions", () => {
  it("keeps an undo history whose undo and redo restore the content (R15)", () => {
    const typed = stateOf("# Page").update({ changes: { from: 6, insert: "\n\nText" } }).state;
    expect(typed.doc.toString()).toBe("# Page\n\nText");

    const undone = run(typed, undo);
    expect(undone.doc.toString()).toBe("# Page");
    expect(run(undone, redo).doc.toString()).toBe("# Page\n\nText");
  });

  it("shows the placeholder only in the editor of a new page (R40)", () => {
    // The placeholder of CodeMirror is a decoration of the view, which also names it in `aria-placeholder`.
    expect(contentAttributes(stateOf("", true))["aria-placeholder"]).toBe(NEW_PAGE_PLACEHOLDER);
    expect(contentAttributes(stateOf("", false))).not.toHaveProperty("aria-placeholder");
  });

  it("turns spell check, autocorrect and autocapitalization off and names the content element (R33, R36)", () => {
    expect(contentAttributes(stateOf(""))).toMatchObject({
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
      "aria-labelledby": "label",
      "aria-describedby": "description",
    });
  });

  it.each([
    ["trailing spaces", "# Title  \nline with two trailing spaces  \n"],
    ["tabs", "# Title\n\n\tindented\twith tabs\n"],
    ["a setext heading", "Title\n=====\n\nText\n---\n"],
    ["raw HTML", '# Title\n\n<div class="x"><b>bold</b></div>\n<script>alert(1)</script>\n'],
    ["a lone backslash", "# Title\n\\\n\\"],
    ["no line break at the end", "# Title\n\nlast"],
    ["empty lines at the end", "# Title\n\n\n\n"],
  ])("gives back content with %s byte for byte (R5)", (_name, content) => {
    expect(stateOf(content).doc.toString()).toBe(content);
  });
});

describe("Enter (R12)", () => {
  /** The content after Enter with the cursor at the end of `doc`, as the keymap of the editor runs it. */
  function enterAtEnd(doc: string): string {
    const state = stateOf(doc).update({ selection: EditorSelection.cursor(doc.length) }).state;
    ensureSyntaxTree(state, state.doc.length);
    return run(state, (target) => endEmptyQuote(target) || continueMarkup(target)).doc.toString();
  }

  it.each([
    ["a bullet item", "- one", "- one\n- "],
    ["a numbered item", "1. one\n2. two\n3. three", "1. one\n2. two\n3. three\n4. "],
    ["a ticked task item", "- [x] done", "- [x] done\n- [ ] "],
    ["a quote line", "> quote", "> quote\n> "],
  ])("after %s starts the next one with the same mark", (_name, doc, expected) => {
    expect(enterAtEnd(doc)).toBe(expected);
  });

  it("renumbers the items after a new numbered item, as one change that one undo reverts", () => {
    const doc = "1. one\n2. two";
    const state = stateOf(doc).update({ selection: EditorSelection.cursor(6) }).state;
    ensureSyntaxTree(state, state.doc.length);
    const entered = run(state, continueMarkup);
    expect(entered.doc.toString()).toBe("1. one\n2. \n3. two");
    expect(run(entered, undo).doc.toString()).toBe(doc);
  });

  it.each([
    ["the second item", "- one\n- ", "- one\n"],
    ["the first item", "- ", ""],
    ["a quote line", "> quote\n> ", "> quote\n"],
    ["a nested quote line", "> > quote\n> > ", "> > quote\n> "],
  ])("on an empty %s removes the mark and leaves an empty line", (_name, doc, expected) => {
    expect(enterAtEnd(doc)).toBe(expected);
  });

  it("does not treat a > in a code block as a quote", () => {
    expect(enterAtEnd("```\n>")).toBe("```\n>");
  });
});

describe("replace all (R13)", () => {
  it("replaces every occurrence, also inside marks, in one change that one undo reverts", () => {
    const doc = "# word\n\n**word** and word";
    const searching = stateOf(doc).update({
      effects: setSearchQuery.of(new SearchQuery({ search: "word", replace: "term" })),
    }).state;
    const view = {
      state: searching,
      dispatch: (spec: Parameters<EditorView["dispatch"]>[0]) => {
        view.state = view.state.update(spec as never).state;
      },
    };

    expect(replaceAll(view as unknown as EditorView)).toBe(true);
    expect(view.state.doc.toString()).toBe("# term\n\n**term** and term");
    expect(run(view.state, undo).doc.toString()).toBe(doc);
  });
});
