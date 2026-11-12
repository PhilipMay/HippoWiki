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
import { startTransition, useActionState, useId, useRef, useState, type SubmitEvent } from "react";

import Link from "@/components/Link";
import PageNameAndPlaceFields, { FOLDER_TARGET } from "@/features/pages/components/PageNameAndPlaceFields";
import { deriveName, titleFromContent } from "@/features/pages/derive";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import { TITLE_HEADING_MISSING_MESSAGE, type PageFormAction } from "@/features/pages/schema";
import { folderPath, tabPath } from "@/lib/addresses";
import { useHydrated } from "@/lib/hydration";

type NewPageFormProps = {
  /** Server Action that creates the page in the chosen place; it returns the errors to show, or redirects on success. */
  action: PageFormAction;
  /** Name of the folder the page is created in. */
  folderName: string;
  /** The tabs of the folder, in display order: the places the dialog offers besides the folder itself. */
  tabs: { id: string; name: string }[];
  /** Name of the tab the editor was opened for, or `null` for the folder itself. "Cancel" leads to this place. */
  tabName: string | null;
  /** The id of the tab the editor was opened for, or `null` for the folder itself; the dialog preselects this place. */
  initialTabId: string | null;
};

/**
 * Form for a new page that asks only for the Markdown content, which must start with a title heading (`# Title`).
 * "Save" derives the title and opens a dialog that asks for the name, prefilled from the title, and the place, with the
 * place the editor was opened for preselected.
 */
export default function NewPageForm({ action, folderName, tabs, tabName, initialTabId }: NewPageFormProps) {
  const [content, setContent] = useState("");
  const [open, setOpen] = useState(false);
  // The title derived when "Save" was last pressed; the dialog suggests the name from it. The title is not submitted,
  // the server derives it again from the content.
  const [title, setTitle] = useState("");
  const [contentError, setContentError] = useState<string | null>(null);
  // A new key for every opening remounts the dialog, so that the name is derived again, the place starts with the one
  // the editor was opened for and errors of an earlier attempt are gone.
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
        <Button component={Link} href={tabName === null ? folderPath(folderName) : tabPath(folderName, tabName)}>
          Cancel
        </Button>
      </Stack>
      <SavePageDialog
        key={dialogKey}
        open={open}
        action={action}
        folderName={folderName}
        tabs={tabs}
        initialTabId={initialTabId}
        title={title}
        content={content}
        onClose={() => setOpen(false)}
      />
    </Stack>
  );
}

type SavePageDialogProps = Omit<NewPageFormProps, "tabName"> & {
  open: boolean;
  /** The title derived from the content, used to suggest the name; the server derives it again on save. */
  title: string;
  /** The Markdown content of the new page, submitted with the name and the place. */
  content: string;
  onClose: () => void;
};

/** Dialog "Save page" that asks for the name and the place and creates the page. */
function SavePageDialog({
  open,
  action,
  folderName,
  tabs,
  initialTabId,
  title,
  content,
  onClose,
}: SavePageDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // Controlled name and place keep the input when the action returns errors.
  const [name, setName] = useState(() => deriveName(title));
  const [place, setPlace] = useState(initialTabId ?? FOLDER_TARGET);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const formId = useId();

  const nameError = state.fieldErrors?.name?.[0];
  const message = state.message ?? state.fieldErrors?.content?.[0];

  // The form calls the action itself instead of passing it as the form's `action`: React resets a form after its
  // action, and that reset puts the radio buttons back to the initial choice, out of sync with the controlled one.
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

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
      // `autoFocus` does not hold here, because the dialog focuses itself on opening, so the name field is focused once
      // the dialog has entered.
      slotProps={{ transition: { onEntered: () => nameRef.current?.focus() } }}
    >
      <DialogTitle id={titleId}>Save page</DialogTitle>
      <DialogContent>
        {/* The dialog renders in a portal, outside the content field's tree, so the content is submitted in a hidden
            field. `noValidate`: the server validates, and its errors are shown at the fields. */}
        <Box component="form" id={formId} onSubmit={submit} noValidate>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {message && <Alert severity="error">{message}</Alert>}
            {/* The dialog opens only after hydration, so the fields are never locked. */}
            <PageNameAndPlaceFields
              folderName={folderName}
              tabs={tabs}
              name={name}
              onNameChange={setName}
              place={place}
              onPlaceChange={setPlace}
              nameError={nameError}
              nameRef={nameRef}
              locked={false}
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
