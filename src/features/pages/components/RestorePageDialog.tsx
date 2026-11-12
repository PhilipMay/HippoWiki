"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type SubmitEvent } from "react";

import Link from "@/components/Link";
import PageNameAndPlaceFields from "@/features/pages/components/PageNameAndPlaceFields";
import type { PageRestoreFormAction } from "@/features/pages/forms";
import { useHydrated } from "@/lib/hydration";

type RestorePageDialogProps = {
  /** Server Action that restores the page; it returns the errors to show, or redirects on success. */
  action: PageRestoreFormAction;
  /** The name of the page's folder, for the address shown below the name. */
  folderName: string;
  /** The tabs of the page's folder, in display order. */
  tabs: { id: string; name: string }[];
  /** The name the page had when it was deleted, which the name field starts with. */
  initialName: string;
  /** The address of the deleted page without the action, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog "Restore page" with the name of the page and a choice of its place inside its folder: directly in the folder
 * or one of its tabs. No place is preselected, because the place of a deleted page is forgotten; the address the page
 * will get is shown below the name once a place is chosen. The route renders it for `?action=restore`, so it is open
 * from the start; closing it leads to the deleted page.
 */
export default function RestorePageDialog({
  action,
  folderName,
  tabs,
  initialName,
  closeHref,
}: RestorePageDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // Controlled name and place keep the input when the action returns errors.
  const [name, setName] = useState(initialName);
  const [place, setPlace] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const placeRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const titleId = useId();
  const formId = useId();
  // The dialog is part of the server-rendered page. Input before hydration could be lost, so the name is read-only and
  // the places and "Save" are disabled until then.
  const hydrated = useHydrated();

  const nameError = state.fieldErrors?.name?.[0];
  const placeError = state.fieldErrors?.place?.[0];

  // Field errors come back from the Server Action, so the focus moves once the new state arrives: to the name if it has
  // an error, otherwise to the place. Message-only states leave the focus where it is.
  useEffect(() => {
    if (state.fieldErrors?.name) nameRef.current?.focus();
    else if (state.fieldErrors?.place) placeRef.current?.focus();
  }, [state]);

  // The form calls the action itself instead of passing it as the form's `action`: React resets a form after its
  // action, and that reset puts the radio buttons back to the initial choice, out of sync with the controlled one.
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

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
      // `autoFocus` does not hold here, because the dialog focuses itself on opening, so the name field is focused once
      // the dialog has entered.
      slotProps={{ transition: { onEntered: () => nameRef.current?.focus() } }}
    >
      <DialogTitle id={titleId}>Restore page</DialogTitle>
      <DialogContent>
        {/* `noValidate`: the server validates, and its errors are shown at the fields. */}
        <Box component="form" id={formId} onSubmit={submit} noValidate>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {state.message && <Alert severity="error">{state.message}</Alert>}
            <PageNameAndPlaceFields
              folderName={folderName}
              tabs={tabs}
              name={name}
              onNameChange={setName}
              place={place}
              onPlaceChange={setPlace}
              nameError={nameError}
              nameRef={nameRef}
              placeError={placeError}
              placeRef={placeRef}
              locked={!hydrated}
            />
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button component={Link} href={closeHref} disabled={pending}>
          Cancel
        </Button>
        {/* Outside the form element, so it is tied to the form by its id. */}
        <Button type="submit" form={formId} variant="contained" disabled={pending || !hydrated}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
