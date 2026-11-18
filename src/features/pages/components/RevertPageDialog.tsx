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
import { VERSION_FIELD } from "@/features/pages/fields";
import type { PageRevertFormAction } from "@/features/pages/forms";
import { useHydrated } from "@/lib/hydration";

type RevertPageDialogProps = {
  /** Server Action that reverts the page to the revision; it returns the error to show, or redirects on success. */
  action: PageRevertFormAction;
  /** The revision by its number, time and user, as the server formats them: "revision 2 of <time> by alice via web". */
  revisionLabel: string;
  /** The version of the page the dialog was rendered with, which the revert is based on. */
  version: number;
  /** The message that the page was changed after the dialog was opened, after a refused revert. */
  changedMessage?: string;
  /** The address of the revision, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog "Revert page" that names the revision and says that the revert records a new revision, so that nothing is
 * lost. The route renders it for `?action=revert&revision=<n>` over the view of the revision, so it is open from the
 * start; closing it leads to the revision.
 */
export default function RevertPageDialog({
  action,
  revisionLabel,
  version,
  changedMessage,
  closeHref,
}: RevertPageDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const formId = useId();
  // The dialog is part of the server-rendered page. A click before hydration would do nothing, so "Revert" is disabled
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
      <DialogTitle id={titleId}>Revert page</DialogTitle>
      <DialogContent>
        <Box component="form" id={formId} action={formAction}>
          <input type="hidden" name={VERSION_FIELD} value={version} />
          <Stack spacing={3}>
            {changedMessage && <Alert severity="warning">{changedMessage}</Alert>}
            {state.message && <Alert severity="error">{state.message}</Alert>}
            <DialogContentText id={descriptionId} sx={{ overflowWrap: "anywhere" }}>
              Set the page back to {revisionLabel}? This records a new revision with its content; no revision is lost.
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
        <Button type="submit" form={formId} variant="contained" disabled={pending || !hydrated}>
          {pending ? "Reverting…" : "Revert"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
