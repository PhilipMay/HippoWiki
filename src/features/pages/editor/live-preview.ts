// The decorations of live preview (R3, R6, R7, R9, R10, R31): a pure function from the editor state and ranges of the
// document to the decorations that show the Markdown formatted, walking the syntax tree of the editor's parser. What
// it shows is a help for writing; nothing of it reaches the content.

import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range, TransactionSpec } from "@codemirror/state";
import { Decoration, WidgetType, type DecorationSet, type EditorView } from "@codemirror/view";

import { isSafeAddress } from "@/features/pages/safe-address";

/** The classes of live preview, which the theme of `preview-plugin.ts` styles. */
const PREVIEW_CLASS = {
  heading: (level: number) => `cm-lp-heading cm-lp-h${level}`,
  strong: "cm-lp-strong",
  emphasis: "cm-lp-emphasis",
  strikethrough: "cm-lp-strikethrough",
  code: "cm-lp-code",
  link: "cm-lp-link",
  /** A line whose text is hidden and whose height is reduced, such as the underline of a setext heading. */
  hiddenLine: "cm-lp-hidden-line",
  /** The number of a numbered list item. */
  listMark: "cm-lp-list-mark",
  /** A line of a block quote; its depth sets the number of bars. */
  quote: "cm-lp-quote",
  /** A line of a fenced or indented code block. */
  codeBlock: "cm-lp-code-block",
} as const;

// The widgets build their DOM with `document.createElement` and text nodes only, never from HTML (R31).

/** The bullet of a bullet list item, in the place of its mark. */
class BulletWidget extends WidgetType {
  override eq() {
    return true;
  }

  toDOM() {
    const bullet = document.createElement("span");
    bullet.className = "cm-lp-bullet";
    bullet.textContent = "•";
    return bullet;
  }
}

/**
 * The box of a task item, ticked as in the text. A click on it ticks or unticks the item in the text as one change
 * that one undo reverts, without moving the cursor onto its line (R16); a tap on a touch screen is a click as well.
 */
class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly label: string,
  ) {
    super();
  }

  override eq(other: TaskWidget) {
    return other.checked === this.checked && other.label === this.label;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lp-task";
    box.checked = this.checked;
    box.setAttribute("aria-label", this.label);
    // The editor neither moves the cursor nor takes the focus from the box.
    box.addEventListener("mousedown", (event) => event.preventDefault());
    box.addEventListener("click", (event) => {
      // The box shows the text, which the change below redraws.
      event.preventDefault();
      const spec = toggleTask(view.state, view.posAtDOM(box));
      if (spec) view.dispatch(spec);
    });
    return box;
  }

  override ignoreEvent() {
    return true;
  }
}

/** A horizontal rule, in the place of its line. */
class RuleWidget extends WidgetType {
  override eq() {
    return true;
  }

  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-lp-rule";
    rule.setAttribute("role", "separator");
    return rule;
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });

/**
 * The change that ticks or unticks the task box `[ ]`, `[x]` or `[X]` that starts at `pos`, as one entry of the
 * history; `null` where no task box starts.
 */
export function toggleTask(state: EditorState, pos: number): TransactionSpec | null {
  const box = state.sliceDoc(pos, pos + 3);
  if (!/^\[[ xX]\]$/.test(box)) return null;
  return {
    changes: { from: pos + 1, to: pos + 2, insert: box[1] === " " ? "x" : " " },
    annotations: isolateHistory.of("full"),
    userEvent: "input",
  };
}

/** The style of an inline element and the name of its marks in the syntax tree. */
const INLINE_STYLES: Record<string, { className: string; mark: string }> = {
  StrongEmphasis: { className: PREVIEW_CLASS.strong, mark: "EmphasisMark" },
  Emphasis: { className: PREVIEW_CLASS.emphasis, mark: "EmphasisMark" },
  Strikethrough: { className: PREVIEW_CLASS.strikethrough, mark: "StrikethroughMark" },
  InlineCode: { className: PREVIEW_CLASS.code, mark: "CodeMark" },
};

const hidden = Decoration.replace({});

/** The numbers of the lines that any selection range touches, the line of a cursor included (R3). */
function cursorLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let number = state.doc.lineAt(range.from).number; number <= last; number++) lines.add(number);
  }
  return lines;
}

/** The decorations of live preview for the given ranges of the document, such as the visible ranges of a view. */
export function livePreviewDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): DecorationSet {
  const { doc } = state;
  const editing = cursorLines(state);
  const decorations: Range<Decoration>[] = [];
  const lineOf = (pos: number) => doc.lineAt(pos).number;
  /** Whether the text from `from` to `to` lies on one line that shows formatted, away from the cursor. */
  const previewed = (from: number, to: number) => lineOf(from) === lineOf(to) && !editing.has(lineOf(from));
  /** Hides the text from `from` to `to` where its line shows formatted. */
  const hide = (from: number, to: number) => {
    if (to > from && previewed(from, to)) decorations.push(hidden.range(from, to));
  };
  /** Styles the text from `from` to `to` where every line it touches shows formatted. */
  const style = (from: number, to: number, className: string) => {
    if (to <= from) return;
    for (let number = lineOf(from); number <= lineOf(to); number++) if (editing.has(number)) return;
    decorations.push(Decoration.mark({ class: className }).range(from, to));
  };
  const lineStyle = (pos: number, className: string) =>
    decorations.push(Decoration.line({ class: className }).range(doc.lineAt(pos).from));
  /** Styles the line of `pos` where it shows formatted: the blocks show their Markdown on the lines of the cursor. */
  const blockLine = (pos: number, className: string) => {
    if (!editing.has(lineOf(pos))) lineStyle(pos, className);
  };
  /** Replaces the text from `from` to `to` by a widget where its line shows formatted. */
  const replace = (from: number, to: number, decoration: Decoration) => {
    if (previewed(from, to)) decorations.push(decoration.range(from, to));
  };
  /** Hides a line such as a fence line: it keeps its place as a line, with its text hidden and its height reduced. */
  const hideLine = (number: number) => {
    if (editing.has(number)) return;
    const line = doc.line(number);
    lineStyle(line.from, PREVIEW_CLASS.hiddenLine);
    hide(line.from, line.to);
  };
  // The depth of quotes on each line, which sets the number of bars of the line.
  const quoteDepth = new Map<number, number>();

  // A node that reaches into two of the ranges is decorated once; its children are still visited in each range.
  const seen = new Set<string>();
  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const key = `${name}:${node.from}:${node.to}`;
        if (seen.has(key)) return name === "Image" ? false : undefined;
        seen.add(key);
        // Images stay their Markdown text, the link syntax inside them included (R9).
        if (name === "Image") return false;

        const heading = /^(?:ATXHeading|SetextHeading)([1-6])$/.exec(name);
        if (heading) {
          const level = Number(heading[1]);
          const marks = node.node.getChildren("HeaderMark");
          if (name.startsWith("ATX")) {
            lineStyle(node.from, PREVIEW_CLASS.heading(level));
            for (const mark of marks) {
              // The space after an opening mark and the space before a closing one are hidden with it.
              if (mark.from === node.from) hide(mark.from, Math.min(mark.to + 1, node.to));
              else hide(doc.sliceString(mark.from - 1, mark.from) === " " ? mark.from - 1 : mark.from, mark.to);
            }
          } else {
            const underline = marks[marks.length - 1];
            for (let number = lineOf(node.from); number <= lineOf(node.to); number++) {
              const line = doc.line(number);
              if (underline && line.from <= underline.from && underline.from <= line.to) {
                if (!editing.has(number)) {
                  lineStyle(line.from, PREVIEW_CLASS.hiddenLine);
                  hide(line.from, line.to);
                }
              } else {
                lineStyle(line.from, PREVIEW_CLASS.heading(level));
              }
            }
          }
          return;
        }

        const inline = INLINE_STYLES[name];
        if (inline) {
          const marks = node.node.getChildren(inline.mark);
          const open = marks[0];
          const close = marks[marks.length - 1];
          if (!open || !close || open === close) return;
          style(open.to, close.from, inline.className);
          if (previewed(node.from, node.to)) {
            hide(open.from, open.to);
            hide(close.from, close.to);
          }
          return;
        }

        if (name === "Link") {
          const marks = node.node.getChildren("LinkMark");
          const open = marks[0];
          const close = marks[1];
          const address = node.node.getChild("URL");
          if (!open || !close || open.from !== node.from) return;
          // A link that the page view would not make, such as one to `javascript:`, stays its text (R10).
          if (address && !isSafeAddress(doc.sliceString(address.from, address.to))) return false;
          if (!previewed(node.from, node.to)) return;
          style(open.to, close.from, PREVIEW_CLASS.link);
          hide(open.from, open.to);
          hide(close.from, node.to);
          return;
        }

        if (name === "Autolink") {
          const address = node.node.getChild("URL");
          if (!address || !isSafeAddress(doc.sliceString(address.from, address.to))) return false;
          if (!previewed(node.from, node.to)) return false;
          style(address.from, address.to, PREVIEW_CLASS.link);
          hide(node.from, address.from);
          hide(address.to, node.to);
          return false;
        }

        if (name === "Blockquote") {
          let depth = 1;
          for (let parent = node.node.parent; parent; parent = parent.parent) if (parent.name === "Blockquote") depth++;
          for (let number = lineOf(node.from); number <= lineOf(node.to); number++) {
            quoteDepth.set(number, Math.max(depth, quoteDepth.get(number) ?? 0));
          }
          return;
        }

        if (name === "QuoteMark") {
          hide(node.from, doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to);
          return;
        }

        if (name === "ListMark") {
          const item = node.node.parent;
          const task = item?.getChild("Task")?.getChild("TaskMarker");
          if (item?.parent?.name === "OrderedList") style(node.from, node.to, PREVIEW_CLASS.listMark);
          // The box of a task item takes the place of the bullet, as in the page view.
          else if (task) hide(node.from, task.from);
          else replace(node.from, node.to, bullet);
          return;
        }

        if (name === "TaskMarker") {
          const marker = doc.sliceString(node.from, node.to);
          const label = doc.sliceString(node.to, doc.lineAt(node.to).to).trim() || "Task";
          replace(node.from, node.to, Decoration.replace({ widget: new TaskWidget(marker !== "[ ]", label) }));
          return;
        }

        if (name === "FencedCode") {
          const first = lineOf(node.from);
          const last = lineOf(node.to);
          const marks = node.node.getChildren("CodeMark");
          const closed = marks.length > 1 && lineOf(marks[marks.length - 1]?.from ?? node.from) !== first;
          hideLine(first);
          for (let number = first + 1; number <= last; number++) {
            if (closed && number === last) hideLine(number);
            else blockLine(doc.line(number).from, PREVIEW_CLASS.codeBlock);
          }
          return false;
        }

        if (name === "CodeBlock") {
          for (let number = lineOf(node.from); number <= lineOf(node.to); number++) {
            blockLine(doc.line(number).from, PREVIEW_CLASS.codeBlock);
          }
          return false;
        }

        if (name === "HorizontalRule") {
          replace(node.from, node.to, rule);
          return false;
        }

        // A bare address, which the page view makes a link of as well (R7).
        if (name === "URL" && !["Link", "Autolink", "LinkReference"].includes(node.node.parent?.name ?? "")) {
          style(node.from, node.to, PREVIEW_CLASS.link);
        }
        return;
      },
    });
  }
  for (const [number, depth] of quoteDepth) {
    if (editing.has(number)) continue;
    const line = doc.line(number);
    decorations.push(
      Decoration.line({ class: PREVIEW_CLASS.quote, attributes: { style: `--quote-depth: ${depth}` } }).range(
        line.from,
      ),
    );
  }
  return Decoration.set(decorations, true);
}
