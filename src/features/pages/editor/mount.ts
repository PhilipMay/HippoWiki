// Creates the Markdown editor in the browser. `MarkdownEditor` loads this module with a dynamic `import()` once it has
// hydrated, so that the code of CodeMirror is in a chunk of its own that only the editor loads (R39).

import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { FORMAT_COMMANDS, type FormatAction } from "@/features/pages/editor/commands";
import { editorExtensions, type EditorOptions } from "@/features/pages/editor/extensions";
import type { EditorMode } from "@/features/pages/editor/mode";
import { livePreview } from "@/features/pages/editor/preview-plugin";

/** What `MarkdownEditor` needs of a mounted editor. */
export type EditorHandle = {
  /** The content element, which takes the focus and carries the accessible name. */
  contentElement: HTMLElement;
  /** The content as it is now, with plain line breaks, exactly as the server stores it (R5). */
  content(): string;
  /** The length of the content, counted as the server counts it: every line break is one character (R27). */
  length(): number;
  focus(): void;
  /** Runs a formatting action of the toolbar and focuses the editor again (R23). */
  format(action: FormatAction): void;
  /** Switches between live preview and source mode, keeping the document, the selection and the history (R2). */
  setMode(mode: EditorMode): void;
  /** Marks the content as invalid for screen readers, after a field error of a save (R37). */
  setInvalid(invalid: boolean): void;
  destroy(): void;
};

type MountOptions = EditorOptions & {
  /** The element the editor is created in. */
  parent: HTMLElement;
  /** The content the editor starts with. */
  initialContent: string;
  /** The mode the editor starts in. */
  mode: EditorMode;
  /** Called with the editor after every change of the document, without a React render. */
  onChange(handle: EditorHandle): void;
  /**
   * Called when the content starts or stops to differ from the content the editor was opened with, such as after an
   * undo back to it (R35); not on every change.
   */
  onDirtyChange(dirty: boolean): void;
};

/** The `aria-invalid` attribute of the content element, `"false"` as on the textarea before it. */
function invalidAttribute(invalid: boolean) {
  return EditorView.contentAttributes.of({ "aria-invalid": invalid ? "true" : "false" });
}

/** The extensions of a mode: live preview adds its decorations to the highlighting of source mode. */
function modeExtensions(mode: EditorMode) {
  return mode === "live" ? livePreview() : [];
}

/** Creates the editor in `parent`, with the cursor at the start of the content as the textarea had it. */
export function mountEditor({
  parent,
  initialContent,
  mode,
  onChange,
  onDirtyChange,
  ...options
}: MountOptions): EditorHandle {
  const invalid = new Compartment();
  const modes = new Compartment();
  let dirty = false;
  const state = EditorState.create({
    doc: initialContent,
    extensions: [
      editorExtensions(options),
      invalid.of(invalidAttribute(false)),
      modes.of(modeExtensions(mode)),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        onChange(handle);
        // `Text.eq` compares the documents without building a string of the content.
        const changed = !update.state.doc.eq(initialDoc);
        if (changed !== dirty) {
          dirty = changed;
          onDirtyChange(changed);
        }
      }),
    ],
  });
  const initialDoc = state.doc;
  const view = new EditorView({ state, parent });

  const handle: EditorHandle = {
    contentElement: view.contentDOM,
    content: () => view.state.doc.toString(),
    length: () => view.state.doc.length,
    focus: () => view.focus(),
    format: (action) => {
      FORMAT_COMMANDS[action](view);
      view.focus();
    },
    setMode: (next) => view.dispatch({ effects: modes.reconfigure(modeExtensions(next)) }),
    setInvalid: (value) =>
      view.dispatch({
        effects: invalid.reconfigure(invalidAttribute(value)),
      }),
    destroy: () => view.destroy(),
  };
  return handle;
}
