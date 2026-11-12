"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import { useRouter } from "next/navigation";
import { useActionState, useId } from "react";

import Link from "@/components/Link";
import type { PageDeleteFormAction } from "@/features/pages/forms";
import { useHydrated } from "@/lib/hydration";

type DeletePageDialogProps = {
  /** Server Action that deletes the page; it returns the error to show, or redirects on success. */
  action: PageDeleteFormAction;
  /** The name of the page, as its address shows it (with `.md`). */
  pageLabel: string;
  /** The page address without the action, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog "Delete page" that names the page and says that it can be restored later from the folder's deleted pages. The
 * route renders it for `?action=delete`, so it is open from the start; closing it leads to the page address.
 */
export default function DeletePageDialog({ action, pageLabel, closeHref }: DeletePageDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const formId = useId();
  // The dialog is part of the server-rendered page. A click before hydration would do nothing, so "Delete" is disabled
  // until then.
  const hydrated = useHydrated();

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
      aria-describedby={descriptionId}
      // Without a portal the dialog is in the server-rendered HTML, like the rest of the page.
      disablePortal
    >
      <DialogTitle id={titleId}>Delete page</DialogTitle>
      <DialogContent>
        <Box component="form" id={formId} action={formAction}>
          <Stack spacing={3}>
            {state.message && <Alert severity="error">{state.message}</Alert>}
            <DialogContentText id={descriptionId} sx={{ overflowWrap: "anywhere" }}>
              Delete the page {pageLabel}? You can restore it later from the deleted pages of its folder.
            </DialogContentText>
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        {/* A link, so it works without JavaScript as well. */}
        <Button component={Link} href={closeHref} disabled={pending}>
          Cancel
        </Button>
        {/* Outside the form element, so it is tied to the form by its id. */}
        <Button type="submit" form={formId} variant="contained" color="error" disabled={pending || !hydrated}>
          {pending ? "Deleting…" : "Delete"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
