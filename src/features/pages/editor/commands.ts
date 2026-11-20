// The formatting commands of the toolbar and its shortcuts (R20 to R24): pure commands on the editor state. Each is one
// change with `isolateHistory`, so that it never joins the typing before it and one undo reverts it (R23).

import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  Prec,
  type ChangeSpec,
  type EditorState,
  type SelectionRange,
  type StateCommand,
  type TransactionSpec,
} from "@codemirror/state";
import { keymap } from "@codemirror/view";

import { selectedLines } from "@/features/pages/editor/indent";

/** The actions of the toolbar, by which the toolbar runs the commands without loading the code of CodeMirror. */
export type FormatAction =
  | "bold"
  | "italic"
  | "strikethrough"
  | "code"
  | "normal"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bullet"
  | "numbered"
  | "task"
  | "link";

/** An inline element: its mark and the node of the syntax tree it makes. */
type Inline = { mark: string; node: string; markNode: string };

const INLINE = {
  bold: { mark: "**", node: "StrongEmphasis", markNode: "EmphasisMark" },
  italic: { mark: "*", node: "Emphasis", markNode: "EmphasisMark" },
  strikethrough: { mark: "~~", node: "Strikethrough", markNode: "StrikethroughMark" },
  code: { mark: "`", node: "InlineCode", markNode: "CodeMark" },
} satisfies Record<string, Inline>;

/** Text that is only marks of inline elements, which may lie between the marks of an element and its text. */
const NESTED_MARKS = /^[*_~`]*$/;

/** How long a command may parse the document to find the element at the selection, in milliseconds. */
const PARSE_TIMEOUT = 100;

/** The transaction of a command: one change of its own in the history, as input of the user. */
function formatting(spec: TransactionSpec): TransactionSpec {
  return { ...spec, annotations: isolateHistory.of("full"), scrollIntoView: true, userEvent: "input.format" };
}

/** The syntax tree of the state, parsed at least up to `pos`. */
function treeUpTo(state: EditorState, pos: number) {
  return ensureSyntaxTree(state, pos, PARSE_TIMEOUT) ?? syntaxTree(state);
}

/**
 * The element of the given kind that the range marks: one whose text is exactly the range, with the marks just outside
 * it, or one whose whole extent, marks included, is the range. Found in the syntax tree, so that `*` of italic is never
 * taken for half of `**` of bold. Returns the positions of its opening and closing marks.
 */
function markedElement(state: EditorState, range: SelectionRange, inline: Inline) {
  for (let node = treeUpTo(state, range.to).resolveInner(range.from, 1); ;) {
    if (node.name === inline.node) {
      const open = node.firstChild;
      const close = node.lastChild;
      if (open?.name === inline.markNode && close?.name === inline.markNode && open.to <= close.from) {
        // Marks of other elements may lie between, as the `**` of bold inside italic in `***word***`.
        const inside =
          open.to <= range.from &&
          close.from >= range.to &&
          NESTED_MARKS.test(state.sliceDoc(open.to, range.from)) &&
          NESTED_MARKS.test(state.sliceDoc(range.to, close.from));
        const whole = node.from === range.from && node.to === range.to;
        if (inside || whole) return { open, close, whole };
      }
    }
    if (!node.parent) return null;
    node = node.parent;
  }
}

/**
 * Bold, italic, strikethrough or inline code (R20): adds the marks around every selection range, or removes them when
 * the range is already marked so, the marks just inside or just outside it; without a selection it inserts the pair
 * with the cursor between them, or removes an empty pair around the cursor.
 */
function toggleInline(inline: Inline): StateCommand {
  const { mark } = inline;
  return ({ state, dispatch }) => {
    const spec = state.changeByRange((range) => {
      const element = range.empty ? null : markedElement(state, range, inline);
      if (element) {
        const { open, close, whole } = element;
        const changes = [
          { from: open.from, to: open.to },
          { from: close.from, to: close.to },
        ];
        const removed = open.to - open.from;
        const from = whole ? range.from : range.from - removed;
        const to = whole ? range.to - removed - (close.to - close.from) : range.to - removed;
        return { changes, range: EditorSelection.range(from, to) };
      }
      if (
        range.empty &&
        state.sliceDoc(range.from - mark.length, range.from) === mark &&
        state.sliceDoc(range.from, range.from + mark.length) === mark
      ) {
        return {
          changes: { from: range.from - mark.length, to: range.from + mark.length },
          range: EditorSelection.cursor(range.from - mark.length),
        };
      }
      return {
        changes: [
          { from: range.from, insert: mark },
          { from: range.to, insert: mark },
        ],
        range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
      };
    });
    dispatch(state.update(formatting(spec)));
    return true;
  };
}

/**
 * The marks at the start of a line: its indent (1), a list mark (2: a bullet 3 or a number 4) with the spaces after it
 * (5) and a task box (6), and a heading mark after them (7).
 */
const LINE_MARKS = /^([ \t]*)(?:(([-+*])|(\d{1,9}[.)]))([ \t]+|$)(\[[ xX]\](?:[ \t]+|$))?)?(#{1,6}(?:[ \t]+|$))?/;

type LineMarks = {
  indent: string;
  /** The list mark with the spaces after it and a task box, or "". */
  list: string;
  kind: "bullet" | "numbered" | "task" | null;
  /** The heading mark with the space after it, or "". */
  heading: string;
  level: number;
};

function lineMarks(text: string): LineMarks {
  const match = LINE_MARKS.exec(text);
  const [, indent = "", mark, bullet, , space = "", task, heading = ""] = match ?? [];
  return {
    indent,
    list: mark === undefined ? "" : `${mark}${space}${task ?? ""}`,
    kind: mark === undefined ? null : task !== undefined ? "task" : bullet !== undefined ? "bullet" : "numbered",
    heading,
    level: /^#*/.exec(heading)?.[0].length ?? 0,
  };
}

type LineMark = "normal" | "heading1" | "heading2" | "heading3" | "bullet" | "numbered" | "task";

/**
 * Heading 1 to 3, "Normal text", bullet list, numbered list and task list (R21): sets the mark on every line of the
 * selection or on the line of the cursor, keeping the indent of the line; when every one of these lines already has it,
 * it removes it. A heading level replaces another level of any depth, a list mark another list mark, a numbered list
 * numbers the lines `1.`, `2.`, `3.`, and "Normal text" removes the heading mark. Empty lines of a selection of several
 * lines keep no mark.
 */
function setLineMark(kind: LineMark): StateCommand {
  return ({ state, dispatch }) => {
    const all = selectedLines(state);
    const lines = all.length > 1 ? all.filter((line) => line.text.trim() !== "") : all;
    const marks = lines.map((line) => lineMarks(line.text));
    const level = kind.startsWith("heading") ? Number(kind.slice("heading".length)) : 0;
    const remove =
      kind === "normal" ||
      (level > 0 ? marks.every((mark) => mark.level === level) : marks.every((mark) => mark.kind === kind));

    const changes: ChangeSpec[] = lines.map((line, index) => {
      const mark = marks[index] as LineMarks;
      const listFrom = line.from + mark.indent.length;
      const headingFrom = listFrom + mark.list.length;
      if (kind === "normal" || level > 0) {
        const insert = remove ? "" : `${"#".repeat(level)} `;
        return { from: headingFrom, to: headingFrom + mark.heading.length, insert };
      }
      const insert = remove ? "" : kind === "bullet" ? "- " : kind === "task" ? "- [ ] " : `${index + 1}. `;
      return { from: listFrom, to: headingFrom, insert };
    });
    const changeSet = state.changes(changes);
    // A cursor or selection end within the marks of a line moves after its new marks, onto the text of the line.
    const marksEnd = new Map(
      lines.map((line, index) => {
        const mark = marks[index] as LineMarks;
        return [line.number, line.from + mark.indent.length + mark.list.length + mark.heading.length];
      }),
    );
    const map = (pos: number) => {
      const line = state.doc.lineAt(pos);
      const end = marksEnd.get(line.number);
      return changeSet.mapPos(end !== undefined && pos < end ? end : pos, 1);
    };
    const selection = EditorSelection.create(
      state.selection.ranges.map((range) => EditorSelection.range(map(range.anchor), map(range.head))),
      state.selection.mainIndex,
    );
    dispatch(state.update(formatting({ changes: changeSet, selection })));
    return true;
  };
}

/** The address that a new link gets, selected for typing. */
const ADDRESS = "address";

/**
 * A link (R22): `[selection](address)` with `address` selected; without a selection `[](address)` with the cursor in
 * the text part.
 */
const insertLink: StateCommand = ({ state, dispatch }) => {
  const spec = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const insert = `[${text}](${ADDRESS})`;
    const selection = range.empty
      ? EditorSelection.cursor(range.from + 1)
      : EditorSelection.range(range.from + text.length + 3, range.from + text.length + 3 + ADDRESS.length);
    return { changes: { from: range.from, to: range.to, insert }, range: selection };
  });
  dispatch(state.update(formatting(spec)));
  return true;
};

/** The command of each action of the toolbar. */
export const FORMAT_COMMANDS: Record<FormatAction, StateCommand> = {
  bold: toggleInline(INLINE.bold),
  italic: toggleInline(INLINE.italic),
  strikethrough: toggleInline(INLINE.strikethrough),
  code: toggleInline(INLINE.code),
  normal: setLineMark("normal"),
  heading1: setLineMark("heading1"),
  heading2: setLineMark("heading2"),
  heading3: setLineMark("heading3"),
  bullet: setLineMark("bullet"),
  numbered: setLineMark("numbered"),
  task: setLineMark("task"),
  link: insertLink,
};

/** The shortcuts of bold, italic and link (R24), before the default keymap, whose Mod-i selects the parent syntax. */
export const formatKeymap = Prec.high(
  keymap.of([
    { key: "Mod-b", run: FORMAT_COMMANDS.bold },
    { key: "Mod-i", run: FORMAT_COMMANDS.italic },
    { key: "Mod-k", run: FORMAT_COMMANDS.link },
  ]),
);
