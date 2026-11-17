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
import { useActionState, useEffect, useId, useRef } from "react";

import Link from "@/components/Link";
import type { TabDeleteFormAction } from "@/features/folders/forms";
import { useHydrated } from "@/lib/hydration";

type DeleteTabDialogProps = {
  /** Server Action that deletes the tab; it returns the state to show, or redirects to the folder on success. */
  action: TabDeleteFormAction;
  /** The name of the tab, as its address shows it. */
  tabName: string;
  /** The number of pages in the tab when the dialog was rendered. */
  pageCount: number;
  /** The tab address without the action, where closing the dialog leads. */
  closeHref: string;
  /** The folder address, the only way left once the tab no longer exists. */
  folderHref: string;
};

/** What goes with the tab: its pages, in singular, plural and none. */
function pagesText(pageCount: number): string {
  if (pageCount === 0) return "It has no pages, so no page is deleted with it.";
  if (pageCount === 1) return "Its 1 page is deleted with it.";
  return `Its ${pageCount} pages are deleted with it.`;
}

/**
 * Dialog "Delete tab" that names the tab and the number of its pages, and says that the pages can be restored one by
 * one from the deleted pages of the folder while the tab itself cannot. The route renders it for `?action=delete`, so
 * it is open from the start; closing it leads to the tab address, or to the folder once the tab no longer exists.
 */
export default function DeleteTabDialog({ action, tabName, pageCount, closeHref, folderHref }: DeleteTabDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const formId = useId();
  // The dialog is part of the server-rendered page. A click before hydration would do nothing, so "Delete" is disabled
  // until then.
  const hydrated = useHydrated();
  const gone = state.tabGone === true;
  const backRef = useRef<HTMLAnchorElement>(null);

  // The focused "Delete" is gone with the tab, so the focus moves to the only way left, where the Escape key still
  // reaches the dialog.
  useEffect(() => {
    if (gone) backRef.current?.focus();
  }, [gone]);

  const close = () => {
    if (!pending) router.push(gone ? folderHref : closeHref);
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
      <DialogTitle id={titleId}>Delete tab</DialogTitle>
      <DialogContent>
        <Box component="form" id={formId} action={formAction}>
          <Stack spacing={3}>
            {state.message && <Alert severity="error">{state.message}</Alert>}
            <DialogContentText id={descriptionId} sx={{ overflowWrap: "anywhere" }}>
              Delete the tab {tabName}? {pagesText(pageCount)}{" "}
              {pageCount > 0 && "The pages can be restored one by one from the deleted pages of the folder. "}
              The tab itself cannot be restored.
            </DialogContentText>
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        {gone ? (
          <Button component={Link} href={folderHref} ref={backRef}>
            Back to the folder
          </Button>
        ) : (
          <>
            {/* A link, so it works without JavaScript as well. */}
            <Button component={Link} href={closeHref} disabled={pending}>
              Cancel
            </Button>
            {/* Outside the form element, so it is tied to the form by its id. */}
            <Button type="submit" form={formId} variant="contained" color="error" disabled={pending || !hydrated}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
