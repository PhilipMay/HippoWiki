// The decorations of live preview (R3, R6, R7, R9, R10, R31): a pure function from the editor state and ranges of the
// document to the decorations that show the Markdown formatted, walking the syntax tree of the editor's parser. What
// it shows is a help for writing; nothing of it reaches the content.

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";

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
} as const;

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

        // A bare address, which the page view makes a link of as well (R7).
        if (name === "URL" && !["Link", "Autolink", "LinkReference"].includes(node.node.parent?.name ?? "")) {
          style(node.from, node.to, PREVIEW_CLASS.link);
        }
        return;
      },
    });
  }
  return Decoration.set(decorations, true);
}
