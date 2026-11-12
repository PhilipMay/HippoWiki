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
import PageNameAndPlaceFields, { FOLDER_TARGET } from "@/features/pages/components/PageNameAndPlaceFields";
import type { PageMoveOrRenameFormAction } from "@/features/pages/schema";
import { useHydrated } from "@/lib/hydration";

type MoveOrRenamePageDialogProps = {
  /** Server Action that stores name and place of the page; it returns the errors to show, or redirects on success. */
  action: PageMoveOrRenameFormAction;
  /** The name of the page's folder, for the address shown below the name. */
  folderName: string;
  /** The tabs of the page's folder, in display order. */
  tabs: { id: string; name: string }[];
  /** The id of the tab the page lives in, or `null` for a page placed directly in its folder. */
  currentTabId: string | null;
  /** The current name of the page, which the name field starts with. */
  initialName: string;
  /** The page address without the action, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog "Move or rename page" with the name of the page and a choice of its place: directly in the folder or one of
 * its tabs. Both are saved together; the address the page will get is shown below the name. The route renders it for
 * `?action=move-or-rename`, so it is open from the start; closing it leads to the page address.
 */
export default function MoveOrRenamePageDialog({
  action,
  folderName,
  tabs,
  currentTabId,
  initialName,
  closeHref,
}: MoveOrRenamePageDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // Controlled name and place keep the input when the action returns errors.
  const [name, setName] = useState(initialName);
  const [target, setTarget] = useState(currentTabId ?? FOLDER_TARGET);
  const nameRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const titleId = useId();
  const formId = useId();
  // The dialog is part of the server-rendered page. Input before hydration could be lost, so the name is read-only and
  // the places and "Save" are disabled until then.
  const hydrated = useHydrated();

  const nameError = state.fieldErrors?.name?.[0];

  // Field errors come back from the Server Action, not from a client event, so the focus moves once the new state
  // arrives. Each submission returns a new state object, so a repeated rejection moves the focus again; the initial
  // state and message-only states leave the focus where it is.
  useEffect(() => {
    if (state.fieldErrors?.name) nameRef.current?.focus();
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
      <DialogTitle id={titleId}>Move or rename page</DialogTitle>
      <DialogContent>
        {/* `noValidate`: the server validates, and its errors are shown at the field. */}
        <Box component="form" id={formId} onSubmit={submit} noValidate>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {state.message && <Alert severity="error">{state.message}</Alert>}
            <PageNameAndPlaceFields
              folderName={folderName}
              tabs={tabs}
              name={name}
              onNameChange={setName}
              place={target}
              onPlaceChange={setTarget}
              nameError={nameError}
              nameRef={nameRef}
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
