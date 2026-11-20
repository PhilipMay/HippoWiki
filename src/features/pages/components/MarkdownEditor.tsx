"use client";

import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import { useEffect, useEffectEvent, useId, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

import type { EditorHandle } from "@/features/pages/editor/mount";

/** The helper text below the editor, which a field error replaces (R36, R37). */
const HELPER_TEXT =
  "Markdown (GitHub Flavored Markdown), starting with the title heading: # Title. Press Esc, then Tab, to leave the editor.";

/** The minimum height of the editor and of the read-only field before it, in lines (R41). */
const MIN_LINES = 16;

type MarkdownEditorProps = {
  /** The content the editor starts with. */
  initialContent: string;
  /** Whether the editor writes a new page: only then the empty editor shows the placeholder `# Title`. */
  newPage: boolean;
  /** The field error of the last save, which replaces the helper text, or nothing. */
  error?: string | null;
  /**
   * The id of the form that submits the hidden field `content`, when the editor is not inside it, such as the form of
   * the "Save page" dialog of a new page.
   */
  form?: string;
  /** Set to the editor once it is ready, so that the form can read its content. */
  editorRef?: RefObject<EditorHandle | null>;
  /** Set to the element that takes the focus: the read-only field, then the content element of the editor. */
  contentRef?: RefObject<HTMLElement | null>;
  /** Called once the editor is ready; until then the form keeps "Save" disabled. */
  onReady(): void;
};

/**
 * The Markdown editor of a page, CodeMirror 6, in place of a textarea (R1). Until it is ready, its place shows the
 * content as a read-only field, also without JavaScript (R29). Once hydrated it loads the code of the editor with a
 * dynamic `import()`, so that only the editor loads it (R39), and replaces the read-only field with the editor, with
 * the same content and the focus at its start. The content leaves the editor through the hidden field `content`,
 * updated on every change without a React render.
 */
export default function MarkdownEditor({
  initialContent,
  newPage,
  error,
  form,
  editorRef,
  contentRef,
  onReady,
}: MarkdownEditorProps) {
  const [editor, setEditor] = useState<EditorHandle | null>(null);
  const labelId = useId();
  const descriptionId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const readOnlyRef = useRef<HTMLTextAreaElement>(null);

  // The options are read once, when the editor is created: a new page and the ids never change for a mounted form.
  const create = useEffectEvent((mount: typeof import("@/features/pages/editor/mount").mountEditor) => {
    const parent = containerRef.current;
    const field = fieldRef.current;
    if (!parent || !field) return null;
    field.value = initialContent;
    const handle = mount({
      parent,
      initialContent,
      newPage,
      labelId,
      descriptionId,
      onChange: (changed) => {
        field.value = changed.content();
      },
    });
    // The read-only field is removed in the same task in which the editor is created, so that the two never carry the
    // name "Content" at the same time.
    flushSync(() => setEditor(handle));
    if (editorRef) editorRef.current = handle;
    if (contentRef) contentRef.current = handle.contentElement;
    handle.focus();
    onReady();
    return handle;
  });

  useEffect(() => {
    let cancelled = false;
    let handle: EditorHandle | null = null;
    import("@/features/pages/editor/mount")
      .then(({ mountEditor }) => {
        if (!cancelled) handle = create(mountEditor);
      })
      // A chunk that fails to load leaves the content read-only and "Save" disabled.
      .catch(() => {});
    return () => {
      cancelled = true;
      handle?.destroy();
    };
  }, []);

  useEffect(() => {
    editor?.setInvalid(!!error);
  }, [editor, error]);

  const lines = initialContent.split("\n").length;

  return (
    <FormControl fullWidth error={!!error}>
      <FormLabel id={labelId} sx={{ mb: 1 }} onClick={() => (editor ?? readOnlyRef.current)?.focus()}>
        Content
      </FormLabel>
      <Box
        sx={{
          border: 1,
          borderColor: error ? "error.main" : "rgba(0, 0, 0, 0.23)",
          borderRadius: 1,
          bgcolor: "background.paper",
          "&:hover": { borderColor: error ? "error.main" : "text.primary" },
          "&:focus-within": { borderColor: error ? "error.main" : "primary.main", boxShadow: 1 },
        }}
      >
        {!editor && (
          <Box
            component="textarea"
            ref={(element: HTMLTextAreaElement | null) => {
              readOnlyRef.current = element;
              if (contentRef && element) contentRef.current = element;
            }}
            readOnly
            value={initialContent}
            rows={Math.max(MIN_LINES, lines)}
            spellCheck={false}
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            aria-invalid={!!error}
            sx={{
              display: "block",
              width: "100%",
              border: 0,
              outline: 0,
              resize: "none",
              bgcolor: "transparent",
              color: "text.primary",
              p: "16.5px 14px",
              fontFamily: "monospace",
              fontSize: "0.875rem",
              lineHeight: 1.6,
            }}
          />
        )}
        <div ref={containerRef} />
      </Box>
      <FormHelperText id={descriptionId}>{error ?? HELPER_TEXT}</FormHelperText>
      {/* Its value is set only by the editor: a `defaultValue` would be written back by React on every render, such as
          the one after a refused save, and "Save" is disabled until the editor is ready. */}
      <input ref={fieldRef} type="hidden" name="content" form={form} />
    </FormControl>
  );
}
