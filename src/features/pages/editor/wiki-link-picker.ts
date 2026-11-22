// The picker of wiki links: typing `[[` opens a list of the pages and files of the folder from the page list of the
// editor, filtered by title and name as the user types on, and choosing a page or a file inserts its link. Nothing is inserted without a
// choice, so the editor still never changes the Markdown on its own.

import {
  autocompletion,
  closeCompletion,
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { editorPageList, type EditorPageList, type PageIndex } from "@/features/pages/editor/wiki-links";
import { wikiLinkTargetText } from "@/features/pages/wiki-link-target";
import { theme as appTheme } from "@/lib/theme";

type Page = EditorPageList["pages"][number];
type File = EditorPageList["files"][number];

/** The text of the entry that says that no page matches. */
export const NO_PAGE_FOUND = "No page found";

/** `[[` and the text typed after it on the line, up to the cursor, without `[`, `]` or `|`. */
const TYPED_LINK = /\[\[[^[\]|\n]*$/;

/** The nodes in which `[[` is text, so that the picker does not open. */
const CODE = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText", "HTMLBlock", "Comment"]);

/** The pages of the list sorted by title and then by their target, computed once per page list. */
const sortedPages = new WeakMap<PageIndex, Page[]>();

function byTitle(index: PageIndex): Page[] {
  let pages = sortedPages.get(index);
  if (!pages) {
    pages = [...index.list.pages].sort(
      (a, b) =>
        a.title.localeCompare(b.title, "en") || wikiLinkTargetText(a).localeCompare(wikiLinkTargetText(b), "en"),
    );
    sortedPages.set(index, pages);
  }
  return pages;
}

/**
 * The pages whose title or target (`name` or `tab/name`) holds the typed text, ignoring case, sorted by title; all
 * pages for no text.
 */
function matchingPages(index: PageIndex, typed: string): Page[] {
  const query = typed.trim().toLowerCase();
  const pages = byTitle(index);
  if (query === "") return pages;
  return pages.filter((page) => page.title.toLowerCase().includes(query) || wikiLinkTargetText(page).includes(query));
}

/** The files of the list sorted by their target, computed once per page list. */
const sortedFiles = new WeakMap<PageIndex, File[]>();

/** The files whose target (`name.ext` or `tab/name.ext`) holds the typed text, ignoring case, sorted by target. */
function matchingFiles(index: PageIndex, typed: string): File[] {
  let files = sortedFiles.get(index);
  if (!files) {
    files = [...index.list.files].sort((a, b) => wikiLinkTargetText(a).localeCompare(wikiLinkTargetText(b), "en"));
    sortedFiles.set(index, files);
  }
  const query = typed.trim().toLowerCase();
  return query === "" ? files : files.filter((file) => wikiLinkTargetText(file).includes(query));
}

/** Whether the `[[` at `pos` is text: escaped by a backslash, or inside code. */
function isText(state: EditorState, pos: number): boolean {
  let backslashes = 0;
  while (pos - backslashes > 0 && state.sliceDoc(pos - backslashes - 1, pos - backslashes) === "\\") backslashes++;
  if (backslashes % 2 === 1) return true;
  for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1); node;) {
    if (CODE.has(node.name)) return true;
    node = node.parent;
  }
  return false;
}

/** The entry of a page: its title and its place; choosing it inserts its link. */
function pageEntry(page: Page): Completion {
  return entry(page.title, page.tab === null ? "Directly in the folder" : `Tab ${page.tab}`, wikiLinkTargetText(page));
}

/** The entry of a file: its target, marked as a file with its place; choosing it inserts its link. */
function fileEntry(file: File): Completion {
  const target = wikiLinkTargetText(file);
  return {
    ...entry(target, file.tab === null ? "File directly in the folder" : `File in tab ${file.tab}`, target),
    type: "file",
  };
}

/** An entry of the picker with its label and detail; choosing it inserts the link of the target, without a label. */
function entry(label: string, detail: string, target: string): Completion {
  return {
    label,
    detail,
    apply: (view, completion, from, to) => {
      // `[[` and the text typed after it become the link; a `]]` right after the cursor is replaced with them.
      const start = from - 2;
      const end = view.state.sliceDoc(to, to + 2) === "]]" ? to + 2 : to;
      const insert = `[[${target}]]`;
      view.dispatch({
        changes: { from: start, to: end, insert },
        selection: { anchor: start + insert.length },
        annotations: [pickedCompletion.of(completion), isolateHistory.of("full")],
        userEvent: "input.complete",
        scrollIntoView: true,
      });
    },
  };
}

/** The entry shown when no page matches: choosing it only closes the list and leaves the text as typed. */
const noPageFound: Completion = {
  label: NO_PAGE_FOUND,
  apply: (view) => {
    closeCompletion(view);
  },
};

/**
 * The source of the picker: after `[[` on the line of the cursor, outside code and not after a backslash, the pages of
 * the folder that match the typed text and then its files, or the entry "No page found".
 */
export function wikiLinkCompletions(context: CompletionContext): CompletionResult | null {
  const index = context.state.facet(editorPageList);
  if (!index) return null;
  const typed = context.matchBefore(TYPED_LINK);
  if (!typed || isText(context.state, typed.from)) return null;
  const options = [
    ...matchingPages(index, typed.text.slice(2)).map(pageEntry),
    ...matchingFiles(index, typed.text.slice(2)).map(fileEntry),
  ];
  return {
    from: typed.from + 2,
    to: context.pos,
    options: options.length === 0 ? [noPageFound] : options,
    // The source filters by title and name itself, and runs again on every key.
    filter: false,
  };
}

const { palette, typography } = appTheme;

/** The list in the font of the app, with entries that a finger can hit, and no wider than a phone. */
const pickerTheme = EditorView.theme({
  ".cm-tooltip.cm-tooltip-autocomplete": { maxWidth: "min(28em, calc(100vw - 32px))" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: typography.fontFamily ?? "sans-serif",
    maxHeight: "16em",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    minHeight: "24px",
    lineHeight: "24px",
    padding: "2px 8px",
    whiteSpace: "normal",
  },
  "@media (pointer: coarse)": {
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { minHeight: "32px", lineHeight: "32px" },
  },
  ".cm-completionDetail": { marginLeft: "0.75em", fontStyle: "normal", color: palette.text.secondary },
});

/**
 * The picker on `[[`. Its keys (the arrows, Enter, Esc) act only while the list is open, so Enter in a list item and
 * Esc then Tab work as before.
 */
export function wikiLinkPicker(): Extension {
  return [autocompletion({ override: [wikiLinkCompletions], icons: false, activateOnTyping: true }), pickerTheme];
}
