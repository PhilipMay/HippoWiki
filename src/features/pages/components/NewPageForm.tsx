"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useActionState, useId, useState } from "react";

import Link from "@/components/Link";
import { createPage } from "@/features/pages/actions";
import { deriveSlug, deriveTitle } from "@/features/pages/derive";
import { CONTENT_MAX_LENGTH, SLUG_MAX_LENGTH, TITLE_MAX_LENGTH } from "@/features/pages/limits";

/**
 * Form for a new page that asks only for the Markdown content. "Save" opens a dialog that asks for title and slug,
 * prefilled from the first heading of the content.
 */
export default function NewPageForm() {
  const [content, setContent] = useState("");
  const [open, setOpen] = useState(false);
  // A new key for every opening remounts the dialog, so that title and slug are derived again and errors of an earlier
  // attempt are gone.
  const [dialogKey, setDialogKey] = useState(0);

  const openDialog = () => {
    setDialogKey((key) => key + 1);
    setOpen(true);
  };

  return (
    <Stack spacing={3}>
      <TextField
        label="Content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        multiline
        minRows={16}
        autoFocus
        fullWidth
        helperText="Markdown (GitHub Flavored Markdown). The first heading suggests the title."
        slotProps={{
          htmlInput: { maxLength: CONTENT_MAX_LENGTH, spellCheck: false },
          input: { sx: { fontFamily: "monospace", fontSize: "0.875rem", lineHeight: 1.6 } },
        }}
      />
      <Stack direction="row" spacing={2}>
        <Button type="button" variant="contained" onClick={openDialog}>
          Save
        </Button>
        <Button component={Link} href="/pages">
          Cancel
        </Button>
      </Stack>
      <SavePageDialog key={dialogKey} open={open} content={content} onClose={() => setOpen(false)} />
    </Stack>
  );
}

type SavePageDialogProps = {
  open: boolean;
  /** The Markdown content of the new page, submitted with title and slug. */
  content: string;
  onClose: () => void;
};

/** Dialog "Save page" that asks for title and slug and creates the page. */
function SavePageDialog({ open, content, onClose }: SavePageDialogProps) {
  const [state, formAction, pending] = useActionState(createPage, {});
  const [title, setTitle] = useState(() => deriveTitle(content));
  const [slug, setSlug] = useState(() => deriveSlug(deriveTitle(content)));
  // The slug follows the title until the user edits it.
  const [slugEdited, setSlugEdited] = useState(false);
  const titleId = useId();
  const formId = useId();

  const titleError = state.fieldErrors?.title?.[0];
  const slugError = state.fieldErrors?.slug?.[0];
  const message = state.message ?? state.fieldErrors?.content?.[0];

  const close = () => {
    if (!pending) onClose();
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby={titleId}>
      <DialogTitle id={titleId}>Save page</DialogTitle>
      <DialogContent>
        {/* The dialog renders in a portal, outside the content field's tree, so the content is submitted in a hidden
            field. `noValidate`: the server validates, and its errors are shown at the fields. */}
        <Box component="form" id={formId} action={formAction} noValidate>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {message && <Alert severity="error">{message}</Alert>}
            <TextField
              name="title"
              label="Title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (!slugEdited) setSlug(deriveSlug(event.target.value));
              }}
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
              onChange={(event) => {
                setSlug(event.target.value);
                setSlugEdited(true);
              }}
              required
              fullWidth
              error={!!slugError}
              helperText={slugError ?? `Address: /pages/${slug.trim()}`}
              slotProps={{ htmlInput: { maxLength: SLUG_MAX_LENGTH, spellCheck: false, autoCapitalize: "none" } }}
            />
            <input type="hidden" name="content" value={content} />
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={pending}>
          Cancel
        </Button>
        {/* Outside the form element, so it is tied to the form by its id. */}
        <Button type="submit" form={formId} variant="contained" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
