// The extensions of the state of the Markdown editor. A module that only the browser loads, through the dynamic import
// of `mount.ts`, so that the code of CodeMirror is in a chunk of its own (see "Loading" in the requirements, R39). It
// has no server-only imports and needs no DOM, so its unit tests build an `EditorState` in Node.js.

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { commonmarkLanguage, markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { GFM } from "@lezer/markdown";

/** What the extensions of an editor depend on. */
export type EditorOptions = {
  /** Whether the editor writes a new page: only then the empty editor shows the placeholder `# Title` (R40). */
  newPage: boolean;
  /** The id of the visible label "Content", which names the content element (R36). */
  labelId: string;
  /** The id of the helper text or the field error below the editor, which describes the content element (R36, R37). */
  descriptionId: string;
};

/** The placeholder of the empty editor of a new page, a hint at the title heading that is never saved (R40). */
export const NEW_PAGE_PLACEHOLDER = "# Title";

/**
 * The language of the editor: CommonMark with the GitHub Flavored Markdown extensions (tables, strikethrough, task
 * lists, autolinks), without the subscript, superscript and emoji syntax of `markdownLanguage`, so that the editor's
 * parse stays close to the markdown-it rules of the page view (R10). No languages are loaded for fenced code. The
 * completion of HTML tags and the paste of an address as a link are off, because both change the text on their own
 * (R5, R32).
 */
function language(): Extension {
  return markdown({
    base: commonmarkLanguage,
    extensions: GFM,
    completeHTMLTags: false,
    pasteURLAsLink: false,
    addKeymap: false,
  });
}

/**
 * The theme of the editor: monospace like the textarea it replaces, at least about 16 lines tall, and without a
 * scroller of its own, so that it grows with its content and the page scrolls (R41). Long lines wrap.
 */
const theme = EditorView.theme({
  "&": { fontSize: "0.875rem" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "monospace", lineHeight: 1.6, overflow: "visible" },
  ".cm-content": { minHeight: "calc(16 * 1.6em)", padding: "16.5px 0" },
  ".cm-line": { padding: "0 14px" },
});

/**
 * The extensions of the editor state. The editor never changes the content on its own: no autoformatting, no closing
 * brackets, no trimming (R5); pasting stays the plain-text paste of CodeMirror (R32).
 */
export function editorExtensions({ newPage, labelId, descriptionId }: EditorOptions): Extension[] {
  return [
    language(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    newPage ? placeholder(NEW_PAGE_PLACEHOLDER) : [],
    EditorView.contentAttributes.of({
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
      "aria-labelledby": labelId,
      "aria-describedby": descriptionId,
    }),
    EditorView.lineWrapping,
    theme,
  ];
}
