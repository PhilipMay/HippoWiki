"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import { useActionState, useId, useRef, useState } from "react";

import Link from "@/components/Link";
import MarkdownEditor from "@/features/pages/components/MarkdownEditor";
import PageNameAndPlaceFields, { FOLDER_TARGET } from "@/features/pages/components/PageNameAndPlaceFields";
import { deriveName, titleFromContent } from "@/features/pages/derive";
import type { EditorHandle } from "@/features/pages/editor/mount";
import type { PageFormAction } from "@/features/pages/forms";
import { TITLE_HEADING_MISSING_MESSAGE } from "@/features/pages/schema";
import { folderPath, tabPath } from "@/lib/addresses";
import { focusOnEntered } from "@/lib/focus";
import { useFocusOnFirstError, useSubmitInTransition } from "@/lib/form-hooks";

type NewPageFormProps = {
  /** Server Action that creates the page in the chosen place; it returns the errors to show, or redirects on success. */
  action: PageFormAction;
  /** Name of the folder the page is created in. */
  folderName: string;
  /** The tabs of the folder, in display order: the places the dialog offers besides the folder itself. */
  tabs: { id: string; name: string }[];
  /**
   * The tab the editor was opened for, or `null` for the folder itself: "Cancel" leads to this place, and the dialog
   * preselects it.
   */
  tab: { id: string; name: string } | null;
};

/**
 * Form for a new page that asks only for the Markdown content, which must start with a title heading (`# Title`).
 * "Save" derives the title and opens a dialog that asks for the name, prefilled from the title, and the place, with the
 * place the editor was opened for preselected.
 */
export default function NewPageForm({ action, folderName, tabs, tab }: NewPageFormProps) {
  const editorRef = useRef<EditorHandle>(null);
  const contentRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  // The title derived when "Save" was last pressed; the dialog suggests the name from it. The title is not submitted,
  // the server derives it again from the content.
  const [title, setTitle] = useState("");
  const [contentError, setContentError] = useState<string | null>(null);
  // A new key for every opening remounts the dialog, so that the name is derived again, the place starts with the one
  // the editor was opened for and errors of an earlier attempt are gone.
  const [dialogKey, setDialogKey] = useState(0);
  // The content is read-only and "Save" is disabled until the editor is ready, also after hydration.
  const [ready, setReady] = useState(false);
  // The form of the "Save page" dialog, which submits the hidden field of the editor.
  const formId = useId();

  const save = () => {
    const derived = titleFromContent(editorRef.current?.content() ?? "");
    if (derived === null) {
      setContentError(TITLE_HEADING_MISSING_MESSAGE);
      contentRef.current?.focus();
      return;
    }
    setContentError(null);
    setDialogKey((key) => key + 1);
    setTitle(derived);
    setOpen(true);
  };

  return (
    <Stack spacing={3}>
      <MarkdownEditor
        initialContent=""
        newPage
        error={contentError}
        form={formId}
        editorRef={editorRef}
        contentRef={contentRef}
        onReady={() => setReady(true)}
      />
      <Stack direction="row" spacing={2}>
        <Button type="button" variant="contained" onClick={save} disabled={!ready}>
          Save
        </Button>
        <Button component={Link} href={tab === null ? folderPath(folderName) : tabPath(folderName, tab.name)}>
          Cancel
        </Button>
      </Stack>
      <SavePageDialog
        key={dialogKey}
        open={open}
        action={action}
        folderName={folderName}
        tabs={tabs}
        initialTabId={tab?.id ?? null}
        title={title}
        formId={formId}
        onClose={() => setOpen(false)}
      />
    </Stack>
  );
}

type SavePageDialogProps = Omit<NewPageFormProps, "tab"> & {
  /** The id of the tab the editor was opened for, or `null` for the folder itself; the dialog preselects this place. */
  initialTabId: string | null;
  open: boolean;
  /** The title derived from the content, used to suggest the name; the server derives it again on save. */
  title: string;
  /** The id of the form, which the hidden field `content` of the editor is tied to. */
  formId: string;
  onClose: () => void;
};

/** Dialog "Save page" that asks for the name and the place and creates the page. */
function SavePageDialog({ open, action, folderName, tabs, initialTabId, title, formId, onClose }: SavePageDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // Controlled name and place keep the input when the action returns errors.
  const [name, setName] = useState(() => deriveName(title));
  const [place, setPlace] = useState(initialTabId ?? FOLDER_TARGET);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const nameError = state.fieldErrors?.name?.[0];
  const message = state.message ?? state.fieldErrors?.content?.[0];

  useFocusOnFirstError(state, [["name", nameRef]]);
  // The radio buttons of the place are controlled.
  const submit = useSubmitInTransition(formAction);

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
      // the dialog has entered, unless the focus has moved into the dialog by then (see `focusOnEntered`).
      slotProps={{ transition: { onEntered: (node) => focusOnEntered(node, nameRef.current) } }}
    >
      <DialogTitle id={titleId}>Save page</DialogTitle>
      <DialogContent>
        {/* The content is submitted by the hidden field of the editor, which is tied to this form by its id.
            `noValidate`: the server validates, and its errors are shown at the fields. */}
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
