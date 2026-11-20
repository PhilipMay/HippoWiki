// Tables in live preview (R8): a GitHub Flavored Markdown table shows as a rendered table, and as its whole Markdown
// while the cursor or a selection is in it. Block widgets must come from the state, so the tables are a state field.

import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, StateField, type Range, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

/** The alignment of a column, from the delimiter row. */
type Alignment = "left" | "center" | "right" | null;

/** A piece of the text of a cell, with the classes of the inline elements it lies in. */
type Segment = { text: string; classes: string[] };

/** A cell: its text, where that text starts relative to the start of the table, and its formatted pieces. */
type TableCell = { text: string; offset: number; segments: Segment[] };

/** What a table shows: its header, the alignment of each column and its rows, each with the columns of the header. */
type TableModel = { header: TableCell[]; alignments: Alignment[]; rows: TableCell[][] };

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

/** The classes of the inline elements of a cell, as live preview styles them, and the names of their marks. */
const INLINE: Record<string, { className: string; marks: string[] }> = {
  StrongEmphasis: { className: "cm-lp-strong", marks: ["EmphasisMark"] },
  Emphasis: { className: "cm-lp-emphasis", marks: ["EmphasisMark"] },
  Strikethrough: { className: "cm-lp-strikethrough", marks: ["StrikethroughMark"] },
  InlineCode: { className: "cm-lp-code", marks: ["CodeMark"] },
  Link: { className: "cm-lp-link", marks: ["LinkMark", "URL", "LinkTitle", "LinkLabel"] },
};

/**
 * The formatted pieces of the text from `from` to `to` of `node`: bold, italic, strikethrough, inline code and the text
 * of links as in live preview, without their marks; an escape shows the character it escapes; everything else stays
 * its text. `marks` are the names of the marks of `node`, which are left out.
 */
function segmentsOf(
  state: EditorState,
  node: SyntaxNode,
  from: number,
  to: number,
  classes: string[],
  marks: readonly string[] = [],
): Segment[] {
  const segments: Segment[] = [];
  const text = (start: number, end: number) => {
    if (end > start) segments.push({ text: state.sliceDoc(start, end), classes });
  };
  let pos = from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue;
    text(pos, child.from);
    pos = child.to;
    if (marks.includes(child.name)) continue;
    const inline = INLINE[child.name];
    if (child.name === "Link" && inline) {
      // The text of a link is what lies between its first two marks, `[` and `]`.
      const [open, close] = child.getChildren("LinkMark");
      if (open && close) {
        segments.push(...segmentsOf(state, child, open.to, close.from, [...classes, inline.className], inline.marks));
      }
    } else if (inline) {
      segments.push(...segmentsOf(state, child, child.from, child.to, [...classes, inline.className], inline.marks));
    } else if (child.name === "Escape") {
      segments.push({ text: state.sliceDoc(child.from + 1, child.to), classes });
    } else if (child.firstChild) {
      segments.push(...segmentsOf(state, child, child.from, child.to, classes));
    } else {
      text(child.from, child.to);
    }
  }
  text(pos, to);
  return segments;
}

/** The cells of a row of the table, split at its delimiters, which the parser does not count inside an escape. */
function cellsOf(state: EditorState, row: SyntaxNode, tableFrom: number): TableCell[] {
  const line = state.doc.lineAt(row.from);
  const bounds: number[] = [];
  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableDelimiter") bounds.push(child.from);
  }
  const cells: TableCell[] = [];
  const starts = bounds[0] === undefined || state.sliceDoc(line.from, bounds[0]).trim() !== "" ? [line.from - 1] : [];
  const edges = [...starts, ...bounds];
  for (let index = 0; index < edges.length; index++) {
    const start = (edges[index] ?? 0) + 1;
    const end = edges[index + 1] ?? line.to;
    // A delimiter at the end of the line closes the last cell.
    if (index === edges.length - 1 && state.sliceDoc(start, end).trim() === "") break;
    const raw = state.sliceDoc(start, end);
    const leading = raw.length - raw.trimStart().length;
    const from = start + leading;
    const to = from + raw.trim().length;
    cells.push({ text: raw.trim(), offset: from - tableFrom, segments: segmentsOf(state, row, from, to, []) });
  }
  return cells;
}

/** The alignment of each column of the delimiter row, such as `:--`, `:-:` and `--:`. */
function alignmentsOf(text: string): Alignment[] {
  const cells = text.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.map((cell) => {
    const spec = cell.trim();
    const left = spec.startsWith(":");
    const right = spec.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
}

/**
 * The model of a table node: the header cells, the alignment of each column, and the rows, each filled up or cut to
 * the columns of the header as the page view does; every cell with the position of its text in the table.
 */
export function tableModel(state: EditorState, table: SyntaxNode): TableModel {
  const headerNode = table.getChild("TableHeader");
  const header = headerNode ? cellsOf(state, headerNode, table.from) : [];
  let delimiterRow = "";
  for (let child = table.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableDelimiter") delimiterRow = state.sliceDoc(child.from, child.to);
  }
  const alignments = header.map((_cell, index) => alignmentsOf(delimiterRow)[index] ?? null);
  const rows = table.getChildren("TableRow").map((row) => {
    const cells = cellsOf(state, row, table.from).slice(0, header.length);
    const end = state.doc.lineAt(row.from).to - table.from;
    while (cells.length < header.length) cells.push({ text: "", offset: end, segments: [] });
    return cells;
  });
  return { header, alignments, rows };
}

/** The rendered table, built with DOM calls only (R31). Two widgets of the same table text are equal. */
class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly model: TableModel,
  ) {
    super();
  }

  override eq(other: TableWidget) {
    return other.source === this.source;
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-lp-table";
    const table = document.createElement("table");
    const cell = (tag: "th" | "td", content: TableCell, alignment: Alignment) => {
      const element = document.createElement(tag);
      if (tag === "th") element.setAttribute("scope", "col");
      if (alignment) element.style.textAlign = alignment;
      for (const segment of content.segments) {
        if (segment.classes.length === 0) {
          element.append(document.createTextNode(segment.text));
        } else {
          const span = document.createElement("span");
          span.className = segment.classes.join(" ");
          span.textContent = segment.text;
          element.append(span);
        }
      }
      // A click on a cell puts the cursor at the start of its text in the Markdown, which then shows the whole table.
      element.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const start = view.posAtDOM(wrapper);
        view.dispatch({ selection: { anchor: start + content.offset }, scrollIntoView: true, userEvent: "select" });
        view.focus();
      });
      return element;
    };
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    this.model.header.forEach((content, index) =>
      headRow.append(cell("th", content, this.model.alignments[index] ?? null)),
    );
    head.append(headRow);
    const body = document.createElement("tbody");
    for (const row of this.model.rows) {
      const tr = document.createElement("tr");
      row.forEach((content, index) => tr.append(cell("td", content, this.model.alignments[index] ?? null)));
      body.append(tr);
    }
    table.append(head, body);
    wrapper.append(table);
    return wrapper;
  }

  override ignoreEvent() {
    return true;
  }
}

/** The blocks that may hold a table. */
const CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);

/** Whether any selection range touches a line of the range from `from` to `to`. */
export function touched(state: EditorState, from: number, to: number): boolean {
  const first = state.doc.lineAt(from).from;
  const last = state.doc.lineAt(to).to;
  return state.selection.ranges.some((range) => range.from <= last && range.to >= first);
}

/** The decorations of the tables that lie in the range from `from` to `to`, and the extent of those tables. */
function tablesIn(state: EditorState, from: number, to: number) {
  const decorations: Range<Decoration>[] = [];
  let start = from;
  let end = to;
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      // Tables lie in the document, in quotes and in list items; no other block holds one.
      if (node.name !== "Table") return CONTAINERS.has(node.name);
      const tableFrom = state.doc.lineAt(node.from).from;
      const tableTo = state.doc.lineAt(node.to).to;
      start = Math.min(start, tableFrom);
      end = Math.max(end, tableTo);
      if (!touched(state, tableFrom, tableTo)) {
        const widget = new TableWidget(state.sliceDoc(tableFrom, tableTo), tableModel(state, node.node));
        decorations.push(Decoration.replace({ widget, block: true }).range(tableFrom, tableTo));
      }
      return false;
    },
  });
  return { decorations, from: start, to: end };
}

/** The ranges of the document whose tables a transaction may have changed, in the new document. */
function dirtyRanges(tr: Transaction): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => ranges.push({ from: fromB, to: toB }));
  if (tr.selection || tr.docChanged) {
    for (const range of tr.startState.selection.ranges) {
      ranges.push({ from: tr.changes.mapPos(range.from, -1), to: tr.changes.mapPos(range.to, 1) });
    }
    for (const range of tr.state.selection.ranges) ranges.push({ from: range.from, to: range.to });
  }
  // The background parse reaches further into the document: the tables there are new.
  const before = syntaxTree(tr.startState).length;
  const after = syntaxTree(tr.state).length;
  if (after > tr.changes.mapPos(before)) ranges.push({ from: tr.changes.mapPos(before), to: after });
  return ranges;
}

/**
 * The tables of live preview: every table whose lines no selection range touches is replaced by a rendered table. The
 * field maps its decorations through changes and rebuilds only the tables that a change, a move of the selection or the
 * background parse touches, so that a large page stays fast (R38).
 */
export const tablesField = StateField.define<DecorationSet>({
  create: (state) => Decoration.set(tablesIn(state, 0, state.doc.length).decorations, true),
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const range of dirtyRanges(tr)) {
      const from = tr.state.doc.lineAt(Math.min(range.from, tr.state.doc.length)).from;
      const to = tr.state.doc.lineAt(Math.min(range.to, tr.state.doc.length)).to;
      const found = tablesIn(tr.state, from, to);
      next = next.update({
        filter: (decoFrom, decoTo) => decoTo < found.from || decoFrom > found.to,
        filterFrom: found.from,
        filterTo: found.to,
        add: found.decorations,
        sort: true,
      });
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * A move of the cursor with the keyboard from the line right below or above a rendered table would jump over it, since
 * the cursor passes over a block widget; it stops at the edge of the table instead, which then shows its Markdown, so
 * that a table is reached with the keyboard too.
 */
const enterTables = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged || !tr.selection || !tr.isUserEvent("select") || tr.isUserEvent("select.pointer")) return tr;
  const { doc } = tr.startState;
  const before = tr.startState.selection;
  const after = tr.selection;
  if (before.ranges.length > 1 || after.ranges.length > 1 || !after.main.empty) return tr;
  const from = before.main.head;
  const to = after.main.head;
  let stop: number | null = null;
  tr.startState.field(tablesField).between(Math.min(from, to), Math.max(from, to), (tableFrom, tableTo) => {
    if (to < tableFrom && tableTo < from && doc.lineAt(from).number === doc.lineAt(tableTo).number + 1) stop = tableTo;
    if (from < tableFrom && tableTo < to && doc.lineAt(from).number === doc.lineAt(tableFrom).number - 1) {
      stop = tableFrom;
    }
  });
  return stop === null ? tr : [tr, { selection: EditorSelection.cursor(stop), sequential: true }];
});

/** The tables of live preview and the way into them with the keyboard. */
export const tables = [tablesField, enterTables];
