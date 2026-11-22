import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { editorExtensions } from "@/features/pages/editor/extensions";
import { tableModel, tables, tablesField } from "@/features/pages/editor/tables";

/** A folder with the page `setup` placed directly in it, titled "Setup". */
const PAGE_LIST = {
  pages: [{ tab: null, name: "setup", title: "Setup", address: "/folders/f/setup.md" }],
  files: [],
  places: [
    { tab: null, newPageAddress: "/folders/f?action=new&name=", uploadAddress: "/folders/f?action=upload&name=" },
  ],
};

const OPTIONS = { newPage: false, labelId: "label", descriptionId: "description", pageList: PAGE_LIST };

function stateOf(doc: string, selection = EditorSelection.single(doc.length)): EditorState {
  const state = EditorState.create({ doc, selection, extensions: [editorExtensions(OPTIONS), tables] });
  ensureSyntaxTree(state, doc.length);
  return state;
}

/** The model of the first table of `doc`. */
function modelOf(doc: string) {
  const state = stateOf(doc);
  let table: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = null;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "Table" && !table) table = node.node;
    },
  });
  if (!table) throw new Error("no table");
  const model = tableModel(state, table);
  const text = (cells: { segments: { text: string }[] }[]) =>
    cells.map((cell) => cell.segments.map((s) => s.text).join(""));
  return { model, state, header: text(model.header), rows: model.rows.map(text) };
}

describe("wiki links in a rendered table", () => {
  it("shows them as live preview does, with \\| as the | between target and label", () => {
    const { model } = modelOf("| a | b | c |\n| - | - | - |\n| [[setup]] | [[setup\\|Set \\| up]] | [[faq]] |");
    expect(model.rows[0]?.map((cell) => cell.segments)).toEqual([
      [{ text: "Setup", classes: ["cm-lp-link"] }],
      [{ text: "Set | up", classes: ["cm-lp-link"] }],
      [{ text: "faq", classes: ["cm-lp-missing-link"], title: "Page does not exist" }],
    ]);
  });
});

describe("tableModel", () => {
  const doc = [
    "| Left | Center | Right | None |",
    "| :--- | :----: | ----: | ---- |",
    "| a | b | c | d |",
    "| e |",
    "| f | g | h | i | j |",
  ].join("\n");

  it("reads the header, the alignment of each column and the rows, filled up or cut to the header", () => {
    const { model, header, rows } = modelOf(doc);
    expect(header).toEqual(["Left", "Center", "Right", "None"]);
    expect(model.alignments).toEqual(["left", "center", "right", null]);
    expect(rows).toEqual([
      ["a", "b", "c", "d"],
      ["e", "", "", ""],
      ["f", "g", "h", "i"],
    ]);
  });

  it("knows where the text of every cell starts", () => {
    const { model } = modelOf(doc);
    const offsets = [...model.header, ...model.rows.flat()].map((cell) => cell.offset);
    for (const [index, cell] of [...model.header, ...model.rows.flat()].entries()) {
      if (cell.text !== "") expect(doc.slice(offsets[index], (offsets[index] ?? 0) + cell.text.length)).toBe(cell.text);
    }
    // A cell that the row is filled up with starts at the end of the row.
    expect(model.rows[1]?.[1]?.offset).toBe(doc.indexOf("| e |") + "| e |".length);
  });

  it("keeps an escaped pipe and a pipe in inline code in their cell and formats the inline elements", () => {
    const { model, header, rows } = modelOf("| a | b |\n|---|---|\n| x \\| y | `p\\|q` **bold** [link](/x) |");
    expect(header).toEqual(["a", "b"]);
    expect(rows).toEqual([["x | y", "p\\|q bold link"]]);
    const classes = model.rows[0]?.[1]?.segments.map((segment) => segment.classes.join(" "));
    expect(classes).toEqual(["cm-lp-code", "", "cm-lp-strong", "", "cm-lp-link"]);
  });

  it("reads a table without pipes at the start and the end of its lines", () => {
    const { header, rows } = modelOf("a | b\n--|--\n1 | 2");
    expect(header).toEqual(["a", "b"]);
    expect(rows).toEqual([["1", "2"]]);
  });
});

describe("tablesField", () => {
  const doc = "# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nlast";
  const tableFrom = doc.indexOf("| a");
  const tableTo = doc.indexOf("| 4 |") + 5;

  /** The ranges the field replaces by a rendered table. */
  function replaced(state: EditorState): [number, number][] {
    const ranges: [number, number][] = [];
    state.field(tablesField).between(0, state.doc.length, (from, to) => void ranges.push([from, to]));
    return ranges;
  }

  it("replaces a table without the cursor by a rendered table", () => {
    expect(replaced(stateOf(doc))).toEqual([[tableFrom, tableTo]]);
  });

  it("leaves every line of the table as Markdown with the cursor or a selection in any of its lines", () => {
    for (const pos of [tableFrom, doc.indexOf("|---"), doc.indexOf("3"), tableTo]) {
      expect(replaced(stateOf(doc, EditorSelection.single(pos))), String(pos)).toEqual([]);
    }
    expect(replaced(stateOf(doc, EditorSelection.single(0, tableFrom + 1)))).toEqual([]);
  });

  it("renders the table again when the cursor leaves it, and follows a change before it", () => {
    const inside = stateOf(doc, EditorSelection.single(doc.indexOf("3")));
    const outside = inside.update({ selection: EditorSelection.single(doc.length) }).state;
    expect(replaced(outside)).toEqual([[tableFrom, tableTo]]);
    const typed = outside.update({ changes: { from: 7, insert: "!" } }).state;
    expect(replaced(typed)).toEqual([[tableFrom + 1, tableTo + 1]]);
  });
});

describe("the way into a table with the keyboard", () => {
  const doc = "# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nlast";
  const tableFrom = doc.indexOf("| a");
  const tableTo = doc.indexOf("| 2 |") + 5;

  /** The head of the cursor after a move with the keyboard from `from` to `to`. */
  function move(from: number, to: number): number {
    const state = stateOf(doc, EditorSelection.single(from));
    return state.update({ selection: EditorSelection.single(to), userEvent: "select" }).state.selection.main.head;
  }

  it("stops at the end of a rendered table when moving up from the line below it", () => {
    expect(move(tableTo + 1, tableFrom - 1)).toBe(tableTo);
  });

  it("stops at the start of a rendered table when moving down from the line above it", () => {
    expect(move(tableFrom - 1, tableTo + 1)).toBe(tableFrom);
  });

  it("lets a click and a longer move pass", () => {
    const state = stateOf(doc, EditorSelection.single(tableTo + 1));
    const click = state.update({ selection: EditorSelection.single(0), userEvent: "select.pointer" }).state;
    expect(click.selection.main.head).toBe(0);
    expect(move(doc.length, 0)).toBe(0);
  });
});
