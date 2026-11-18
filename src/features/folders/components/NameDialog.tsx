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
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import Link from "@/components/Link";
import { focusOnEntered } from "@/lib/focus";
import { useHydrated } from "@/lib/hydration";
import type { NameFormAction } from "@/features/folders/forms";
import { NAME_MAX_LENGTH } from "@/lib/names";

type NameDialogProps = {
  /** Heading of the dialog, e.g. "New folder". */
  title: string;
  /** Server Action that stores the name; it returns the errors to show, or redirects on success. */
  action: NameFormAction;
  /**
   * The current name of the item when renaming: the field starts with it, and "Save" stays disabled while the name in
   * the field, without its surrounding spaces, is this name. Left out for a new item, whose field starts empty.
   */
  currentName?: string;
  /** The address without the action, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog that asks for the name of a folder or tab, used to create and to rename. The route renders it for an action
 * in the query string, so it is open from the start; closing it leads to the address without the action.
 */
export default function NameDialog({ title, action, currentName, closeHref }: NameDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // A controlled field keeps the entered name when the action returns errors; React resets only uncontrolled fields
  // after a submission.
  const [name, setName] = useState(currentName ?? "");
  const nameRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const titleId = useId();
  const formId = useId();
  // The dialog is part of the server-rendered page. Input before hydration could be lost, so the name is read-only
  // and "Save" is disabled until then.
  const hydrated = useHydrated();

  const nameError = state.fieldErrors?.name?.[0];
  // A rename to the current name would change nothing. The name is trimmed as the server's name schema trims it, so that
  // the button and the server agree; the comparison is with the name the dialog was opened with, while the server
  // compares with the name stored at the moment of the save.
  const unchanged = currentName !== undefined && name.trim() === currentName;

  // Field errors come back from the Server Action, not from a client event, so the focus moves once the new state
  // arrives. Each submission returns a new state object, so a repeated rejection moves the focus again; the initial
  // state and message-only states leave the focus where it is.
  useEffect(() => {
    if (state.fieldErrors?.name) nameRef.current?.focus();
  }, [state]);

  const close = () => {
    if (!pending) router.push(closeHref);
  };

  return (
    <Dialog
      open
      onClose={close}
      fullWidth
      maxWidth="sm"
      aria-labelledby={titleId}
      // Without a portal the dialog is in the server-rendered HTML, like the rest of the page.
      disablePortal
      // The name is the only field. `autoFocus` does not hold here, because the dialog focuses itself on opening, so
      // the name field is focused once the dialog has entered, unless the focus has moved into the dialog by then.
      slotProps={{ transition: { onEntered: (node) => focusOnEntered(node, nameRef.current) } }}
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent>
        {/* `noValidate`: the server validates, and its errors are shown at the field. */}
        <Box component="form" id={formId} action={formAction} noValidate>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {state.message && <Alert severity="error">{state.message}</Alert>}
            <TextField
              name="name"
              label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              inputRef={nameRef}
              required
              fullWidth
              error={!!nameError}
              helperText={nameError ?? "Lowercase letters, digits and single hyphens, e.g. release-notes"}
              slotProps={{
                htmlInput: {
                  maxLength: NAME_MAX_LENGTH,
                  spellCheck: false,
                  autoCapitalize: "none",
                  readOnly: !hydrated,
                },
              }}
            />
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button component={Link} href={closeHref} disabled={pending}>
          Cancel
        </Button>
        {/* Outside the form element, so it is tied to the form by its id. It is the default button of the form, so while it
            is disabled, Enter in the field submits nothing either. */}
        <Button type="submit" form={formId} variant="contained" disabled={pending || !hydrated || unchanged}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
