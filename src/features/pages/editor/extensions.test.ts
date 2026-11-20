import { redo, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { editorExtensions, NEW_PAGE_PLACEHOLDER } from "@/features/pages/editor/extensions";

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
