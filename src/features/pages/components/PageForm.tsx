"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useActionState, useEffect, useRef, useState } from "react";

import Link from "@/components/Link";
import { CONTENT_MAX_LENGTH, SLUG_MAX_LENGTH } from "@/features/pages/limits";
import { type PageFormState, type PageFormValues } from "@/features/pages/schema";
import { useHydrated } from "@/lib/hydration";

type PageFormProps = {
  /** Server Action that stores the page; it returns the errors to show, or redirects on success. */
  action: (prevState: PageFormState, formData: FormData) => Promise<PageFormState>;
  /** Values the form starts with: the current page. */
  initialValues: PageFormValues;
  /** Where "Cancel" leads. */
  cancelHref: string;
};

/**
 * Form for the slug and Markdown content of a page, used to edit pages. The title is derived from the content's first
 * heading when the page is saved; the slug never changes automatically. New pages use `NewPageForm`.
 */
export default function PageForm({ action, initialValues, cancelHref }: PageFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // Controlled fields keep the entered values when the action returns errors; React resets only uncontrolled fields
  // after a submission.
  const [slug, setSlug] = useState(initialValues.slug);
  const [content, setContent] = useState(initialValues.content);
  // Input before hydration could be lost, so the fields are read-only and "Save" is disabled until then.
  const hydrated = useHydrated();

  const slugRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const slugError = state.fieldErrors?.slug?.[0];
  const contentError = state.fieldErrors?.content?.[0];

  // Field errors come back from the Server Action, not from a client event, so the focus moves once the new state
  // arrives: to the first field with an error. Each submission returns a new state object, so a repeated rejection
  // moves the focus again; the initial state and message-only states leave the focus where it is.
  useEffect(() => {
    if (state.fieldErrors?.slug) slugRef.current?.focus();
    else if (state.fieldErrors?.content) contentRef.current?.focus();
  }, [state]);

  return (
    // `noValidate`: the server validates, and its errors are shown at the fields instead of browser bubbles.
    <Stack component="form" action={formAction} noValidate spacing={3}>
      {state.message && <Alert severity="error">{state.message}</Alert>}
      <TextField
        name="slug"
        label="Slug"
        value={slug}
        onChange={(event) => setSlug(event.target.value)}
        required
        fullWidth
        inputRef={slugRef}
        error={!!slugError}
        helperText={slugError ?? `Address: /pages/${slug.trim()}`}
        slotProps={{
          htmlInput: {
            maxLength: SLUG_MAX_LENGTH,
            spellCheck: false,
            autoCapitalize: "none",
            readOnly: !hydrated,
          },
        }}
      />
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
