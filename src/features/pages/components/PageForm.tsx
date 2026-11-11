"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useActionState, useState } from "react";

import Link from "@/components/Link";
import {
  CONTENT_MAX_LENGTH,
  SLUG_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  type PageFormState,
  type PageInput,
} from "@/features/pages/schema";

type PageFormProps = {
  /** Server Action that stores the page; it returns the errors to show, or redirects on success. */
  action: (prevState: PageFormState, formData: FormData) => Promise<PageFormState>;
  /** Values the form starts with, e.g. the current page when editing. */
  initialValues?: PageInput;
  /** Where "Cancel" leads. */
  cancelHref: string;
};

const emptyValues: PageInput = { title: "", slug: "", content: "" };

/** Form for the title, slug and Markdown content of a page, used to create and to edit pages. */
export default function PageForm({ action, initialValues = emptyValues, cancelHref }: PageFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // Controlled fields keep the entered values when the action returns errors; React resets only uncontrolled fields
  // after a submission.
  const [title, setTitle] = useState(initialValues.title);
  const [slug, setSlug] = useState(initialValues.slug);
  const [content, setContent] = useState(initialValues.content);

  const titleError = state.fieldErrors?.title?.[0];
  const slugError = state.fieldErrors?.slug?.[0];
  const contentError = state.fieldErrors?.content?.[0];

  return (
    // `noValidate`: the server validates, and its errors are shown at the fields instead of browser bubbles.
    <Stack component="form" action={formAction} noValidate spacing={3}>
      {state.message && <Alert severity="error">{state.message}</Alert>}
      <TextField
        name="title"
        label="Title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
        autoFocus
        fullWidth
        error={!!titleError}
        helperText={titleError}
        slotProps={{ htmlInput: { maxLength: TITLE_MAX_LENGTH } }}
      />
      <TextField
        name="slug"
        label="Slug"
        value={slug}
        onChange={(event) => setSlug(event.target.value)}
        required
        fullWidth
        error={!!slugError}
        helperText={slugError ?? `Address: /pages/${slug.trim()}`}
        slotProps={{ htmlInput: { maxLength: SLUG_MAX_LENGTH, spellCheck: false, autoCapitalize: "none" } }}
      />
      <TextField
        name="content"
        label="Content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        multiline
        minRows={16}
        fullWidth
        error={!!contentError}
        helperText={contentError ?? "Markdown (GitHub Flavored Markdown)"}
        slotProps={{
          htmlInput: { maxLength: CONTENT_MAX_LENGTH, spellCheck: false },
          input: { sx: { fontFamily: "monospace", fontSize: "0.875rem", lineHeight: 1.6 } },
        }}
      />
      <Stack direction="row" spacing={2}>
        <Button type="submit" variant="contained" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button component={Link} href={cancelHref}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  );
}
