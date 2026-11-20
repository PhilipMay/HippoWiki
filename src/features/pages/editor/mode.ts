// The mode of the editor, live preview or source mode, remembered in the browser. A module without imports, so
// that the editor component reads it before the code of CodeMirror is loaded.

/** The two modes of the editor. */
export type EditorMode = "live" | "source";

/** The key of the mode in `localStorage`. */
export const MODE_STORAGE_KEY = "hippowiki.editor-mode";

/** The mode a stored value means: source mode for its own value, live preview for anything else or nothing. */
function parseMode(value: string | null): EditorMode {
  return value === "source" ? "source" : "live";
}

/** The mode last chosen in this browser; live preview without one and when the storage cannot be read. */
export function readMode(storage: () => Pick<Storage, "getItem">): EditorMode {
  try {
    return parseMode(storage().getItem(MODE_STORAGE_KEY));
  } catch {
    return "live";
  }
}

/** Remembers the mode in this browser; a storage that cannot be written is ignored, and the mode holds until reload. */
export function storeMode(storage: () => Pick<Storage, "setItem">, mode: EditorMode): void {
  try {
    storage().setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Private windows and blocked storage throw; the choice is then not remembered.
  }
}
