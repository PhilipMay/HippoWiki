// The view plugin of live preview: it builds the decorations of `live-preview.ts` for the visible ranges, again when
// the document, the selection or the viewport changes, and opens links with Ctrl+click or Cmd+click (R17).

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { Prec, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

import { livePreviewDecorations } from "@/features/pages/editor/live-preview";
import { tables } from "@/features/pages/editor/tables";
import { isSafeAddress } from "@/features/pages/safe-address";
import { theme as appTheme } from "@/lib/theme";

/** How long a click on a reference link may parse the document to find its definition, in milliseconds. */
const PARSE_TIMEOUT = 200;

/** A link label as Markdown compares it: without its brackets, case and runs of white space. */
function normalizeLabel(label: string): string {
  return label
    .replace(/^\[|\]$/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** The address of the definition of a reference link with the given label, or `null` when the content has none. */
function definitionOf(state: EditorState, label: string): string | null {
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT) ?? syntaxTree(state);
  const wanted = normalizeLabel(label);
  let address: string | null = null;
  tree.iterate({
    enter: (node) => {
      if (address !== null) return false;
      if (node.name !== "LinkReference") return node.name === "Document";
      const nodeLabel = node.node.getChild("LinkLabel");
      const url = node.node.getChild("URL");
      if (nodeLabel && url && normalizeLabel(state.sliceDoc(nodeLabel.from, nodeLabel.to)) === wanted) {
        address = state.sliceDoc(url.from, url.to);
      }
      return false;
    },
  });
  return address;
}

/** The address of a bare address as the page view links it: `www.` gets `http://`, an email address `mailto:`. */
function bareAddress(text: string): string {
  if (/^www\./i.test(text)) return `http://${text}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text) && text.includes("@")) return `mailto:${text}`;
  return text;
}

/**
 * The address of the link at `pos`: of an inline link, an autolink or a bare address, and of a reference link the
 * address of its definition in the content. `null` where there is no link, and inside an image.
 */
function linkAddressAt(state: EditorState, pos: number): string | null {
  for (let node = syntaxTree(state).resolveInner(pos, 1); ;) {
    if (node.name === "Image") return null;
    if (node.name === "Link") {
      const url = node.getChild("URL");
      if (url) return state.sliceDoc(url.from, url.to);
      const label = node.getChild("LinkLabel");
      const text = node.getChildren("LinkMark");
      // A full reference `[text][label]` names its label; a collapsed or shortcut one `[text]` is its own label.
      if (label) return definitionOf(state, state.sliceDoc(label.from, label.to));
      const [open, close] = text;
      return open && close ? definitionOf(state, state.sliceDoc(open.to, close.from)) : null;
    }
    if (node.name === "Autolink") {
      const url = node.getChild("URL");
      return url ? state.sliceDoc(url.from, url.to) : null;
    }
    if (node.name === "URL" && !["Link", "Autolink", "LinkReference"].includes(node.parent?.name ?? "")) {
      return bareAddress(state.sliceDoc(node.from, node.to));
    }
    if (!node.parent) return null;
    node = node.parent;
  }
}

const previewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = livePreviewDecorations(view.state, view.visibleRanges);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = livePreviewDecorations(update.state, update.view.visibleRanges);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      // Ctrl+click or Cmd+click opens a link in a new browser tab, so that the editor is never left; a plain click
      // puts the cursor there, as does a tap on a touch screen, which has no modifier (R17, R34). Only an address that
      // the page view would make a link of opens.
      mousedown(event, view) {
        if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const address = linkAddressAt(view.state, pos);
        if (address === null) return false;
        if (isSafeAddress(address)) {
          const url = new URL(address, view.dom.ownerDocument.baseURI);
          view.dom.ownerDocument.defaultView?.open(url.href, "_blank", "noopener");
        }
        // The editor keeps its content, and the cursor does not move, also for an address that opens nothing.
        return true;
      },
    },
  },
);

const { palette, typography } = appTheme;

/** The styles of live preview, in the font of the page view; source mode stays monospace. */
const previewTheme = EditorView.theme({
  ".cm-scroller": { fontFamily: typography.fontFamily ?? "sans-serif", fontSize: "1rem", lineHeight: 1.6 },
  ".cm-lp-heading": { fontWeight: 600, lineHeight: 1.3 },
  ".cm-lp-h1": { fontSize: "1.75em", paddingTop: "0.4em" },
  ".cm-lp-h2": { fontSize: "1.45em", paddingTop: "0.3em" },
  ".cm-lp-h3": { fontSize: "1.25em", paddingTop: "0.2em" },
  ".cm-lp-h4": { fontSize: "1.1em" },
  ".cm-lp-strong": { fontWeight: "bold" },
  ".cm-lp-emphasis": { fontStyle: "italic" },
  ".cm-lp-strikethrough": { textDecoration: "line-through" },
  ".cm-lp-code": {
    fontFamily: "monospace",
    fontSize: "0.875em",
    backgroundColor: palette.action.hover,
    borderRadius: "4px",
    padding: "0.1em 0.3em",
  },
  ".cm-lp-link, .cm-lp-link *": { color: palette.primary.main, textDecoration: "underline" },
  ".cm-lp-hidden-line": { fontSize: "0", lineHeight: "0.5rem" },
  ".cm-lp-list-mark, .cm-lp-list-mark *": { color: palette.text.secondary },
  ".cm-lp-bullet": { display: "inline-block", minWidth: "0.6em", color: palette.text.secondary },
  ".cm-lp-task": {
    width: "1.1em",
    height: "1.1em",
    margin: "0 0.35em 0 0",
    verticalAlign: "-0.15em",
    cursor: "pointer",
    accentColor: palette.primary.main,
  },
  // On a touch screen the box is a touch target of the minimum size of WCAG 2.2 (R30).
  "@media (pointer: coarse)": {
    ".cm-lp-task": { width: "24px", height: "24px", verticalAlign: "middle" },
  },
  // One bar per level of the quote, 12px apart.
  ".cm-lp-quote": {
    color: palette.text.secondary,
    paddingLeft: "calc(14px + var(--quote-depth) * 12px)",
    background: `repeating-linear-gradient(to right, ${palette.divider} 0 3px, transparent 3px 12px) 14px 0 / calc(var(--quote-depth) * 12px) 100% no-repeat`,
  },
  ".cm-lp-code-block": {
    fontFamily: "monospace",
    fontSize: "0.875em",
    backgroundColor: palette.action.hover,
  },
  ".cm-lp-table": { overflowX: "auto", padding: "0.25em 0" },
  ".cm-lp-table table": { borderCollapse: "collapse", cursor: "text" },
  ".cm-lp-table th, .cm-lp-table td": {
    border: `1px solid ${palette.divider}`,
    padding: "0.25em 0.75em",
    textAlign: "left",
    verticalAlign: "top",
  },
  ".cm-lp-table th": { fontWeight: 600, backgroundColor: palette.action.hover },
  ".cm-lp-rule": {
    display: "inline-block",
    width: "100%",
    verticalAlign: "middle",
    borderTop: `2px solid ${palette.divider}`,
  },
});

/** Live preview: its decorations, its link clicks and its styles. */
export function livePreview(): Extension {
  // Over the theme of the editor, whose monospace font is that of source mode.
  return [previewPlugin, tables, Prec.highest(previewTheme)];
}
