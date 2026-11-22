import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import { undo } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { editorExtensions } from "@/features/pages/editor/extensions";
import { NO_PAGE_FOUND, wikiLinkCompletions } from "@/features/pages/editor/wiki-link-picker";
import type { EditorPageList } from "@/features/pages/editor/wiki-links";

const PAGE_LIST: EditorPageList = {
  pages: [
    { tab: "guides", name: "setup", title: "Setup guide", address: "/folders/f/guides/setup.md" },
    { tab: null, name: "onboarding", title: "Onboarding", address: "/folders/f/onboarding.md" },
    { tab: null, name: "first-week", title: "First week", address: "/folders/f/first-week.md" },
  ],
  files: [],
  places: [
    { tab: null, newPageAddress: "/folders/f?action=new&name=", uploadAddress: "/folders/f?action=upload&name=" },
    {
      tab: "guides",
      newPageAddress: "/folders/f/guides?action=new&name=",
      uploadAddress: "/folders/f/guides?action=upload&name=",
    },
  ],
};

/** The state of the editor with the text, the cursor at `¦` in it, or at its end without one. */
function stateOf(text: string, pageList: typeof PAGE_LIST | null = PAGE_LIST): EditorState {
  const cursor = text.includes("¦") ? text.indexOf("¦") : text.length;
  const doc = text.replace("¦", "");
  const options = { newPage: false, labelId: "l", descriptionId: "d" };
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: editorExtensions(pageList ? { ...options, pageList } : options),
  });
  ensureSyntaxTree(state, doc.length);
  return state;
}

/** The entries the picker lists at the cursor, as title and place, or `null` where it does not open. */
function entriesAt(text: string, pageList: typeof PAGE_LIST | null = PAGE_LIST) {
  const state = stateOf(text, pageList);
  const result = wikiLinkCompletions(new CompletionContext(state, state.selection.main.head, false));
  return result && result.options.map(({ label, detail }) => (detail ? `${label} (${detail})` : label));
}

/** Chooses the entry with the label at the cursor, through a view that only dispatches, and returns the state after. */
function choose(text: string, label: string, pageList: EditorPageList = PAGE_LIST): EditorState {
  let state = stateOf(text, pageList);
  const result = wikiLinkCompletions(new CompletionContext(state, state.selection.main.head, false));
  const entry = result?.options.find((option: Completion) => option.label === label);
  if (!result || !entry || typeof entry.apply !== "function") throw new Error(`no entry ${label}`);
  const view = {
    get state() {
      return state;
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  entry.apply(view, entry, result.from, result.to ?? result.from);
  return state;
}

describe("the picker of wiki links", () => {
  it("opens after [[ with every page, sorted by title, each with its place", () => {
    expect(entriesAt("See [[")).toEqual([
      "First week (Directly in the folder)",
      "Onboarding (Directly in the folder)",
      "Setup guide (Tab guides)",
    ]);
  });

  it("filters by title and by name as the user types on, ignoring case", () => {
    expect(entriesAt("[[GUIDE")).toEqual(["Setup guide (Tab guides)"]);
    expect(entriesAt("[[guides/se")).toEqual(["Setup guide (Tab guides)"]);
    expect(entriesAt("[[first-")).toEqual(["First week (Directly in the folder)"]);
    expect(entriesAt("[[i")).toHaveLength(3);
  });

  it('says "No page found" when nothing matches', () => {
    expect(entriesAt("[[nothing")).toEqual([NO_PAGE_FOUND]);
  });

  it("does not open without [[, after a | or ]], over a line break, in code or after a backslash", () => {
    for (const text of ["[", "[[a|b", "[[a]] b", "[[a\nb", "`[[¦`", "```\n[[", "    [[", "\\[["]) {
      expect(entriesAt(text)).toBeNull();
    }
    expect(entriesAt("\\\\[[")).toHaveLength(3);
  });

  it("does not open without a page list", () => {
    expect(entriesAt("[[", null)).toBeNull();
  });

  it("replaces [[ and the typed text with the link of the chosen page, without a label", () => {
    const chosen = choose("Read [[setu¦ now", "Setup guide");
    expect(chosen.doc.toString()).toBe("Read [[guides/setup]] now");
    expect(chosen.selection.main.head).toBe("Read [[guides/setup]]".length);
    expect(choose("[[on", "Onboarding").doc.toString()).toBe("[[onboarding]]");
  });

  it("replaces a ]] right after the cursor as well", () => {
    expect(choose("[[on¦]] x", "Onboarding").doc.toString()).toBe("[[onboarding]] x");
  });

  it("inserts the link as one change that one undo reverts to the text as typed", () => {
    const typed = stateOf("x").update({ changes: { from: 1, insert: " [[setu" }, userEvent: "input.type" }).state;
    let state = typed;
    const result = wikiLinkCompletions(new CompletionContext(state, state.doc.length, false));
    const entry = result?.options[0];
    if (!result || !entry || typeof entry.apply !== "function") throw new Error("no entry");
    const view = {
      get state() {
        return state;
      },
      dispatch: (spec: TransactionSpec) => {
        state = state.update(spec).state;
      },
    } as unknown as EditorView;
    entry.apply(view, entry, result.from, result.to ?? result.from);
    expect(state.doc.toString()).toBe("x [[guides/setup]]");
    undo({ state, dispatch: (tr) => (state = tr.state) });
    expect(state.doc.toString()).toBe("x [[setu");
  });
});

describe("the files in the picker of wiki links", () => {
  /** The page list with the image `guides/network-diagram.png` and the PDF `report.pdf`. */
  const WITH_FILES: EditorPageList = {
    ...PAGE_LIST,
    files: [
      { tab: null, name: "report.pdf", address: "/files/f/report.pdf", image: null },
      {
        tab: "guides",
        name: "network-diagram.png",
        address: "/files/f/guides/network-diagram.png",
        image: { width: 640, height: 480 },
      },
    ],
  };

  it("lists the files after the pages, by target, each marked as a file with its place", () => {
    expect(entriesAt("[[", WITH_FILES)).toEqual([
      "First week (Directly in the folder)",
      "Onboarding (Directly in the folder)",
      "Setup guide (Tab guides)",
      "guides/network-diagram.png (File in tab guides)",
      "report.pdf (File directly in the folder)",
    ]);
  });

  it("filters the files by their name and tab as the user types on", () => {
    expect(entriesAt("[[dia", WITH_FILES)).toEqual(["guides/network-diagram.png (File in tab guides)"]);
    expect(entriesAt("[[.PDF", WITH_FILES)).toEqual(["report.pdf (File directly in the folder)"]);
  });

  it("inserts the link of a chosen file without a label", () => {
    expect(choose("See [[dia", "guides/network-diagram.png", WITH_FILES).doc.toString()).toBe(
      "See [[guides/network-diagram.png]]",
    );
    expect(choose("[[rep", "report.pdf", WITH_FILES).doc.toString()).toBe("[[report.pdf]]");
  });
});
