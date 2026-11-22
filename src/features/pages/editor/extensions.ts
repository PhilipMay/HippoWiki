// The extensions of the state of the Markdown editor. A module that only the browser loads, through the dynamic import
// of `mount.ts`, so that the code of CodeMirror is in a chunk of its own (see "Loading" in `markdown-editor.md`). It
// has no server-only imports and needs no DOM, so its unit tests build an `EditorState` in Node.js.

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  commonmarkLanguage,
  deleteMarkupBackward,
  insertNewlineContinueMarkupCommand,
  markdown,
} from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { Prec, type Extension, type StateCommand } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { GFM } from "@lezer/markdown";

import { formatKeymap } from "@/features/pages/editor/commands";
import { contentLimit } from "@/features/pages/editor/content-limit";
import { indentExtensions, indentKeymap } from "@/features/pages/editor/indent";
import { wikiLinkPicker } from "@/features/pages/editor/wiki-link-picker";
import { editorPageList, wikiLinkSyntax, type EditorPageList } from "@/features/pages/editor/wiki-links";
import { theme as appTheme } from "@/lib/theme";

/** What the extensions of an editor depend on. */
export type EditorOptions = {
  /** Whether the editor writes a new page: only then the empty editor shows the placeholder `# Title`. */
  newPage: boolean;
  /** The id of the visible label "Content", which names the content element. */
  labelId: string;
  /** The id of the helper text or the field error below the editor, which describes the content element. */
  descriptionId: string;
  /**
   * The pages, files and places of the folder as of opening the editor, which wiki links are resolved against; without
   * it, a wiki link shows as missing and opens nothing.
   */
  pageList?: EditorPageList;
};

/** The placeholder of the empty editor of a new page, a hint at the title heading that is never saved. */
export const NEW_PAGE_PLACEHOLDER = "# Title";

/**
 * The language of the editor: CommonMark with the GitHub Flavored Markdown extensions (tables, strikethrough, task
 * lists, autolinks) and wiki links, without the subscript, superscript and emoji syntax of `markdownLanguage`, so that the editor's
 * parse stays close to the markdown-it rules of the page view. No languages are loaded for fenced code. The
 * completion of HTML tags and the paste of an address as a link are off, because both change the text on their own
 *. The keymap of Enter is the editor's own (`markupKeymap`).
 */
function language(): Extension {
  return markdown({
    base: commonmarkLanguage,
    extensions: [GFM, wikiLinkSyntax],
    completeHTMLTags: false,
    pasteURLAsLink: false,
    addKeymap: false,
  });
}

/**
 * Enter on a quote line that holds nothing but its marks, with the cursor at its end, removes the last level of the
 * quote, so that the quote ends. The command of CodeMirror would continue it and end it only after a second
 * empty line.
 */
export const endEmptyQuote: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (state.selection.ranges.length > 1 || !range.empty) return false;
  const line = state.doc.lineAt(range.head);
  const match = /^((?:[ \t]*>)*?)[ \t]*>[ \t]*$/.exec(line.text);
  if (!match || range.head !== line.to) return false;
  // Only a line of a quote, not one that looks like it inside a code block.
  const start = syntaxTree(state).resolveInner(range.head, -1);
  let node: typeof start | null = start;
  while (node && node.name !== "Blockquote") {
    if (node.name === "FencedCode" || node.name === "CodeBlock") return false;
    node = node.parent;
  }
  if (!node) return false;
  const keep = match[1] ?? "";
  const insert = keep === "" ? "" : `${keep} `;
  dispatch(
    state.update({
      changes: { from: line.from, to: line.to, insert },
      selection: { anchor: line.from + insert.length },
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};

/**
 * Enter continues a list or a quote with the same mark: the next item, the next number (renumbering the items after it
 * in the same change), an unticked box after a task item, `> ` after a quote line. On an empty item it removes the
 * mark and leaves an empty line, which ends the list. `nonTightLists: false` keeps CodeMirror from making a
 * tight list loose instead on the second item. Backspace right after a mark removes one level of it.
 */
export const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

const markupKeymap = Prec.high(
  keymap.of([
    { key: "Enter", run: endEmptyQuote },
    { key: "Enter", run: continueMarkup },
    { key: "Backspace", run: deleteMarkupBackward },
  ]),
);

const { palette } = appTheme;

/**
 * The syntax highlighting of source mode, with the colors of the theme of the app: headings, emphasis, links,
 * code and the marks each get a color of their own, different from plain text.
 */
const highlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: palette.primary.main, fontWeight: "bold" },
  { tag: tags.emphasis, color: palette.secondary.main, fontStyle: "italic" },
  { tag: tags.strong, color: palette.secondary.main, fontWeight: "bold" },
  { tag: tags.strikethrough, color: palette.text.secondary, textDecoration: "line-through" },
  { tag: tags.link, color: palette.info.dark },
  { tag: tags.url, color: palette.info.dark, textDecoration: "underline" },
  { tag: tags.monospace, color: palette.success.dark },
  { tag: [tags.processingInstruction, tags.atom, tags.escape, tags.character], color: palette.warning.dark },
  { tag: [tags.quote, tags.labelName, tags.string], color: palette.text.secondary },
  { tag: [tags.contentSeparator, tags.comment], color: palette.text.disabled },
]);

/**
 * The theme of the editor: monospace like the textarea it replaces, at least about 16 lines tall, and without a
 * scroller of its own, so that it grows with its content and the page scrolls. Long lines wrap.
 */
const theme = EditorView.theme({
  "&": { fontSize: "0.875rem" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "monospace", lineHeight: 1.6, overflow: "visible" },
  ".cm-content": { minHeight: "calc(16 * 1.6em)", padding: "16.5px 0" },
  ".cm-line": { padding: "0 14px" },
  // The search panel sticks below the toolbar of the editor, which sets the variable to its height.
  ".cm-panels-top": { top: "var(--editor-toolbar-height, 0px)" },
});

/**
 * Whether the data of a paste or a drop carries files, such as an image copied or dragged from the desktop. The editor
 * uploads nothing (see "Current limits" in `markdown-editor.md`).
 */
export function carriesFiles(data: Pick<DataTransfer, "files" | "types"> | null): boolean {
  return data !== null && (data.files.length > 0 || Array.from(data.types).includes("Files"));
}

/**
 * A paste or drop that carries files changes nothing, instead of the text that CodeMirror would read from a dropped
 * file or the name of a pasted one; a paste or drop of text works as before.
 */
const ignoreFiles = EditorView.domEventHandlers({
  paste: (event) => {
    if (!carriesFiles(event.clipboardData)) return false;
    event.preventDefault();
    return true;
  },
  drop: (event) => {
    if (!carriesFiles(event.dataTransfer)) return false;
    event.preventDefault();
    return true;
  },
});

/**
 * The extensions of the editor state. The editor never changes the content on its own: no autoformatting, no closing
 * brackets, no trimming; pasting stays the plain-text paste of CodeMirror, and a paste or drop of files changes
 * nothing; the picker on `[[` inserts a link only when the user chooses a page or a file.
 */
export function editorExtensions({ newPage, labelId, descriptionId, pageList }: EditorOptions): Extension[] {
  return [
    language(),
    pageList ? editorPageList.of(pageList) : [],
    wikiLinkPicker(),
    contentLimit(),
    syntaxHighlighting(highlightStyle),
    history(),
    markupKeymap,
    formatKeymap,
    // The search panel sits at the top of the editor and opens with Mod-f; its labels are those of CodeMirror.
    search({ top: true }),
    indentExtensions,
    keymap.of([...indentKeymap, ...searchKeymap, ...defaultKeymap, ...historyKeymap]),
    newPage ? placeholder(NEW_PAGE_PLACEHOLDER) : [],
    EditorView.contentAttributes.of({
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
      "aria-labelledby": labelId,
      "aria-describedby": descriptionId,
    }),
    EditorView.lineWrapping,
    ignoreFiles,
    theme,
  ];
}
