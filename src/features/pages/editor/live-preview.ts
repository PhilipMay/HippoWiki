// The decorations of live preview: a pure function from the editor state and ranges of the
// document to the decorations that show the Markdown formatted, walking the syntax tree of the editor's parser. What
// it shows is a help for writing; nothing of it reaches the content.

import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range, TransactionSpec } from "@codemirror/state";
import { Decoration, WidgetType, type DecorationSet, type EditorView } from "@codemirror/view";

import { linkDestination } from "@/features/pages/editor/link-address";
import { touched } from "@/features/pages/editor/tables";
import { editorPageList, insideLink, readWikiLink, showWikiLink } from "@/features/pages/editor/wiki-links";
import { isSafeAddress } from "@/features/pages/safe-address";

/**
 * The classes of live preview, which the theme of `preview-plugin.ts` styles; its arrow keys read the class of a hidden
 * line.
 */
export const PREVIEW_CLASS = {
  heading: (level: number) => `cm-lp-heading cm-lp-h${level}`,
  strong: "cm-lp-strong",
  emphasis: "cm-lp-emphasis",
  strikethrough: "cm-lp-strikethrough",
  code: "cm-lp-code",
  link: "cm-lp-link",
  /** A wiki link to a page that does not exist, or that cannot be created as written. */
  missingLink: "cm-lp-missing-link",
  /** A line whose text is hidden and whose height is reduced, such as the underline of a setext heading. */
  hiddenLine: "cm-lp-hidden-line",
  /** The number of a numbered list item. */
  listMark: "cm-lp-list-mark",
  /** A line of a block quote; its depth sets the number of bars. */
  quote: "cm-lp-quote",
  /** A line of a fenced or indented code block. */
  codeBlock: "cm-lp-code-block",
} as const;

// The widgets build their DOM with `document.createElement` and text nodes only, never from HTML.

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
 * that one undo reverts, without moving the cursor onto its line; a tap on a touch screen is a click as well.
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

/**
 * The title of the page a wiki link without a label names, in the place of its target. The editor handles its events,
 * so that a click puts the cursor there and Ctrl+click or Cmd+click opens the page, as on the text of a link.
 */
class TitleWidget extends WidgetType {
  constructor(readonly title: string) {
    super();
  }

  override eq(other: TitleWidget) {
    return other.title === this.title;
  }

  toDOM() {
    const title = document.createElement("span");
    title.className = PREVIEW_CLASS.link;
    title.textContent = this.title;
    return title;
  }

  override ignoreEvent() {
    return false;
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

/** The first and the last line of each selection range: these lines show their Markdown. */
function selectedLines(state: EditorState): { first: number; last: number }[] {
  return state.selection.ranges.map((range) => ({
    first: state.doc.lineAt(range.from).number,
    last: state.doc.lineAt(range.to).number,
  }));
}

/**
 * The decorations of live preview for the given ranges of the document, such as the visible ranges of a view. The
 * ranges are sorted and do not overlap. Only the nodes in the ranges are visited, and the decorations of a block go to
 * its lines in the ranges, so that a large block outside the screen costs nothing on a key.
 */
export function livePreviewDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): DecorationSet {
  const { doc } = state;
  const pages = state.facet(editorPageList);
  // The lines of the selection, and of every table that a selection touches, show their Markdown.
  const editingSpans = selectedLines(state);
  const editing = (number: number) => editingSpans.some(({ first, last }) => first <= number && number <= last);
  const decorations: Range<Decoration>[] = [];
  const lineOf = (pos: number) => doc.lineAt(pos).number;
  /** Whether the text from `from` to `to` lies on one line that shows formatted, away from the cursor. */
  const previewed = (from: number, to: number) => lineOf(from) === lineOf(to) && !editing(lineOf(from));
  /** Hides the text from `from` to `to` where its line shows formatted. */
  const hide = (from: number, to: number) => {
    if (to > from && previewed(from, to)) decorations.push(hidden.range(from, to));
  };
  /**
   * Styles the text from `from` to `to` where every line it touches shows formatted. Text over several lines lies in
   * no table, so for it the selection alone decides.
   */
  const style = (from: number, to: number, className: string) => {
    if (to <= from) return;
    if (lineOf(from) === lineOf(to) ? editing(lineOf(from)) : touched(state, from, to)) return;
    decorations.push(Decoration.mark({ class: className }).range(from, to));
  };
  const lineStyle = (pos: number, className: string) =>
    decorations.push(Decoration.line({ class: className }).range(doc.lineAt(pos).from));
  /** Styles the line `number` where it shows formatted: the blocks show their Markdown on the lines of the cursor. */
  const blockLine = (number: number, className: string) => {
    if (!editing(number)) lineStyle(doc.line(number).from, className);
  };
  /** Replaces the text from `from` to `to` by a widget where its line shows formatted. */
  const replace = (from: number, to: number, decoration: Decoration) => {
    if (previewed(from, to)) decorations.push(decoration.range(from, to));
  };
  /** Hides a line such as a fence line: it keeps its place as a line, with its text hidden and its height reduced. */
  const hideLine = (number: number) => {
    if (editing(number)) return;
    const line = doc.line(number);
    lineStyle(line.from, PREVIEW_CLASS.hiddenLine);
    hide(line.from, line.to);
  };
  // The depth of quotes on each line, which sets the number of bars of the line.
  const quoteDepth = new Map<number, number>();

  // A node that reaches into two of the ranges is decorated once; its children are still visited in each range, and
  // the decorations of its lines go to the lines of each range. Only a node that starts before a range can have been
  // visited in an earlier one.
  const seen = new Set<string>();
  // The last line that an earlier range has decorated, so that a line split between two ranges is decorated once.
  let doneLine = 0;
  for (const { from, to } of ranges) {
    const firstLine = Math.max(lineOf(from), doneLine + 1);
    const lastLine = lineOf(to);
    doneLine = Math.max(doneLine, lastLine);
    /** The numbers of the lines from `fromPos` to `toPos` that lie in this range. */
    const linesIn = function* (fromPos: number, toPos: number) {
      const last = Math.min(lineOf(toPos), lastLine);
      for (let number = Math.max(lineOf(fromPos), firstLine); number <= last; number++) yield number;
    };
    // The depth of quotes at the node that is entered.
    let quoteLevel = 0;
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        // Images stay their Markdown text, the link syntax inside them included.
        if (name === "Image") return false;
        if (name === "Blockquote") quoteLevel++;
        const key = () => `${name}:${node.from}:${node.to}`;
        const again = node.from < from && seen.has(key());
        if (node.to > to) seen.add(key());

        // A table is rendered by the field of `tables.ts`, or shows its whole Markdown while the cursor or a selection
        // is in it: then no line of it is decorated.
        if (name === "Table") {
          const first = lineOf(node.from);
          const last = lineOf(node.to);
          if (!touched(state, doc.line(first).from, doc.line(last).to)) return false;
          editingSpans.push({ first, last });
          return;
        }

        const heading = name.endsWith("Heading", name.length - 1) ? /^(?:ATX|Setext)Heading([1-6])$/.exec(name) : null;
        if (heading) {
          const level = Number(heading[1]);
          const marks = node.node.getChildren("HeaderMark");
          if (name.startsWith("ATX")) {
            if (again) return;
            lineStyle(node.from, PREVIEW_CLASS.heading(level));
            for (const mark of marks) {
              // The space after an opening mark and the space before a closing one are hidden with it.
              if (mark.from === node.from) hide(mark.from, Math.min(mark.to + 1, node.to));
              else hide(doc.sliceString(mark.from - 1, mark.from) === " " ? mark.from - 1 : mark.from, mark.to);
            }
          } else {
            const underline = marks[marks.length - 1];
            const underlineLine = underline ? lineOf(underline.from) : -1;
            for (const number of linesIn(node.from, node.to)) {
              if (number === underlineLine) hideLine(number);
              else lineStyle(doc.line(number).from, PREVIEW_CLASS.heading(level));
            }
          }
          return;
        }

        if (name === "Blockquote") {
          for (const number of linesIn(node.from, node.to)) {
            quoteDepth.set(number, Math.max(quoteLevel, quoteDepth.get(number) ?? 0));
          }
          return;
        }

        if (name === "FencedCode") {
          const first = lineOf(node.from);
          const last = lineOf(node.to);
          const marks = node.node.getChildren("CodeMark");
          const closed = marks.length > 1 && lineOf(marks[marks.length - 1]?.from ?? node.from) !== first;
          for (const number of linesIn(node.from, node.to)) {
            if (number === first || (closed && number === last)) hideLine(number);
            else blockLine(number, PREVIEW_CLASS.codeBlock);
          }
          return false;
        }

        if (name === "CodeBlock") {
          for (const number of linesIn(node.from, node.to)) blockLine(number, PREVIEW_CLASS.codeBlock);
          return false;
        }

        // Every other decoration lies on one line or styles a range once; a node of an earlier range has it already.
        if (again) return name === "Autolink" || name === "HorizontalRule" ? false : undefined;

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
          // A link that the page view would not make, such as one to `javascript:`, also when written with an entity,
          // stays its text.
          if (address && !isSafeAddress(linkDestination(doc.sliceString(address.from, address.to)))) return false;
          if (!previewed(node.from, node.to)) return;
          style(open.to, close.from, PREVIEW_CLASS.link);
          hide(open.from, open.to);
          hide(close.from, node.to);
          return;
        }

        // A wiki link shows its label, or the title of the page it names, as a link; one that leads to no page shows
        // its label or target marked as missing, with the hint of the page view as its title.
        if (name === "WikiLink") {
          if (!previewed(node.from, node.to) || insideLink(node.node)) return false;
          const link = readWikiLink(state, node.node, false);
          if (!link) return false;
          const shown = showWikiLink(pages, link);
          hide(node.from, link.label === null ? link.targetFrom : link.labelFrom);
          if (shown.exists && link.label === null) {
            decorations.push(
              Decoration.replace({ widget: new TitleWidget(shown.text) }).range(link.targetFrom, link.targetTo),
            );
          } else {
            const from = link.label === null ? link.targetFrom : link.labelFrom;
            const to = link.label === null ? link.targetTo : link.labelTo;
            const className = shown.exists ? PREVIEW_CLASS.link : PREVIEW_CLASS.missingLink;
            const attributes = shown.hint === null ? undefined : { title: shown.hint };
            decorations.push(Decoration.mark({ class: className, attributes }).range(from, to));
          }
          hide(link.label === null ? link.targetTo : link.labelTo, node.to);
          return false;
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

        if (name === "HorizontalRule") {
          replace(node.from, node.to, rule);
          return false;
        }

        // A bare address, which the page view makes a link of as well.
        if (name === "URL" && !["Link", "Autolink", "LinkReference"].includes(node.node.parent?.name ?? "")) {
          style(node.from, node.to, PREVIEW_CLASS.link);
        }
        return;
      },
      leave: (node) => {
        if (node.name === "Blockquote") quoteLevel--;
      },
    });
  }
  for (const [number, depth] of quoteDepth) {
    if (editing(number)) continue;
    const line = doc.line(number);
    decorations.push(
      Decoration.line({ class: PREVIEW_CLASS.quote, attributes: { style: `--quote-depth: ${depth}` } }).range(
        line.from,
      ),
    );
  }
  return Decoration.set(decorations, true);
}
