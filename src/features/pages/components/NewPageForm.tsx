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
import { useActionState, useId, useRef, useState } from "react";

import Link from "@/components/Link";
import { deriveName, titleFromContent } from "@/features/pages/derive";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import { TITLE_HEADING_MISSING_MESSAGE, type PageFormAction } from "@/features/pages/schema";
import { folderPath, pagePath } from "@/lib/addresses";
import { useHydrated } from "@/lib/hydration";
import { NAME_MAX_LENGTH } from "@/lib/names";

type NewPageFormProps = {
  /** Server Action that creates the page in its folder; it returns the errors to show, or redirects on success. */
  action: PageFormAction;
  /** Name of the folder the page is created in: "Cancel" leads there, and the dialog shows the new address. */
  folderName: string;
};

/**
 * Form for a new page that asks only for the Markdown content, which must start with a title heading (`# Title`).
 * "Save" derives the title and opens a dialog that shows it and asks for the name, prefilled from the title.
 */
export default function NewPageForm({ action, folderName }: NewPageFormProps) {
  const [content, setContent] = useState("");
  const [open, setOpen] = useState(false);
  // The title derived when "Save" was last pressed. It stays while the dialog closes, so the dialog does not change
  // during its exit transition.
  const [title, setTitle] = useState("");
  const [contentError, setContentError] = useState<string | null>(null);
  // A new key for every opening remounts the dialog, so that the name is derived again and errors of an earlier attempt
  // are gone.
  const [dialogKey, setDialogKey] = useState(0);
  // Input before hydration could be lost, so the content is read-only and "Save" is disabled until then.
  const hydrated = useHydrated();

  const save = () => {
    const derived = titleFromContent(content);
    if (derived === null) {
      setContentError(TITLE_HEADING_MISSING_MESSAGE);
      return;
    }
    setContentError(null);
    setDialogKey((key) => key + 1);
    setTitle(derived);
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
        error={!!contentError}
        helperText={contentError ?? "Markdown (GitHub Flavored Markdown), starting with the title heading: # Title"}
        slotProps={{
          htmlInput: { maxLength: CONTENT_MAX_LENGTH, spellCheck: false, readOnly: !hydrated },
          input: { sx: { fontFamily: "monospace", fontSize: "0.875rem", lineHeight: 1.6 } },
        }}
      />
      <Stack direction="row" spacing={2}>
        <Button type="button" variant="contained" onClick={save} disabled={!hydrated}>
          Save
        </Button>
        <Button component={Link} href={folderPath(folderName)}>
          Cancel
        </Button>
      </Stack>
      <SavePageDialog
        key={dialogKey}
        open={open}
        action={action}
        folderName={folderName}
        title={title}
        content={content}
        onClose={() => setOpen(false)}
      />
    </Stack>
  );
}

type SavePageDialogProps = NewPageFormProps & {
  open: boolean;
  /** The title derived from the content, shown read-only; the server derives it again on save. */
  title: string;
  /** The Markdown content of the new page, submitted with the name. */
  content: string;
  onClose: () => void;
};

/** Dialog "Save page" that shows the title, asks for the name and creates the page. */
function SavePageDialog({ open, action, folderName, title, content, onClose }: SavePageDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const [name, setName] = useState(() => deriveName(title));
  const nameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const formId = useId();

  const nameError = state.fieldErrors?.name?.[0];
  const message = state.message ?? state.fieldErrors?.content?.[0];

  const close = () => {
    if (!pending) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      fullWidth
      maxWidth="sm"
      aria-labelledby={titleId}
      // The name is the only field to edit. `autoFocus` does not hold here, because the dialog focuses itself on
      // opening, so the name field is focused once the dialog has entered.
      slotProps={{ transition: { onEntered: () => nameRef.current?.focus() } }}
    >
      <DialogTitle id={titleId}>Save page</DialogTitle>
      <DialogContent>
        {/* The dialog renders in a portal, outside the content field's tree, so the content is submitted in a hidden
            field. `noValidate`: the server validates, and its errors are shown at the fields. */}
        <Box component="form" id={formId} action={formAction} noValidate>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {message && <Alert severity="error">{message}</Alert>}
            {/* No `name`: the title is not submitted, the server derives it from the content. */}
            <TextField
              label="Title"
              value={title}
              fullWidth
              helperText="From the first heading of the content"
              slotProps={{ htmlInput: { readOnly: true } }}
            />
            <TextField
              name="name"
              label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              inputRef={nameRef}
              required
              fullWidth
              error={!!nameError}
              helperText={nameError ?? `Address: ${pagePath(folderName, null, name.trim())}`}
              slotProps={{ htmlInput: { maxLength: NAME_MAX_LENGTH, spellCheck: false, autoCapitalize: "none" } }}
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
