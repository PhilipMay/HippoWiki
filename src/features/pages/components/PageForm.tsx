"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useActionState, useEffect, useRef, useState } from "react";

import Link from "@/components/Link";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import { type PageFormAction } from "@/features/pages/forms";
import { useHydrated } from "@/lib/hydration";

type PageFormProps = {
  /** Server Action that stores the content; it returns the errors to show, or redirects on success. */
  action: PageFormAction;
  /** The content the form starts with: the current content of the page. */
  initialContent: string;
  /** Where "Cancel" leads. */
  cancelHref: string;
};

/**
 * Form for the Markdown content of an existing page. The title is derived from the content's first heading when the
 * page is saved. The name is not part of the form; a page is moved or renamed in its own dialog. New pages use
 * `NewPageForm`.
 */
export default function PageForm({ action, initialContent, cancelHref }: PageFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // A controlled field keeps the entered content when the action returns errors; React resets only uncontrolled
  // fields after a submission.
  const [content, setContent] = useState(initialContent);
  // Input before hydration could be lost, so the content is read-only and "Save" is disabled until then.
  const hydrated = useHydrated();

  const contentRef = useRef<HTMLTextAreaElement>(null);

  const contentError = state.fieldErrors?.content?.[0];

  // Field errors come back from the Server Action, not from a client event, so the focus moves once the new state
  // arrives. Each submission returns a new state object, so a repeated rejection moves the focus again; the initial
  // state and message-only states leave the focus where it is.
  useEffect(() => {
    if (state.fieldErrors?.content) contentRef.current?.focus();
  }, [state]);

  return (
    // `noValidate`: the server validates, and its errors are shown at the field instead of browser bubbles.
    <Stack component="form" action={formAction} noValidate spacing={3}>
      {state.message && <Alert severity="error">{state.message}</Alert>}
      <TextField
        name="content"
        label="Content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        multiline
        minRows={16}
        autoFocus
        fullWidth
        inputRef={contentRef}
        error={!!contentError}
        helperText={contentError ?? "Markdown (GitHub Flavored Markdown), starting with the title heading: # Title"}
        slotProps={{
          htmlInput: { maxLength: CONTENT_MAX_LENGTH, spellCheck: false, readOnly: !hydrated },
          input: { sx: { fontFamily: "monospace", fontSize: "0.875rem", lineHeight: 1.6 } },
        }}
      />
      <Stack direction="row" spacing={2}>
        <Button type="submit" variant="contained" disabled={pending || !hydrated}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button component={Link} href={cancelHref}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  );
}
