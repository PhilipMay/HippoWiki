"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { useActionState, useId, useState } from "react";

import { deletePage } from "@/features/pages/actions";

type DeletePageButtonProps = {
  pageId: string;
  /** Title of the page, named in the confirmation dialog. */
  title: string;
};

/** "Delete" button that asks for confirmation in a dialog, then deletes the page and returns to the list. */
export default function DeletePageButton({ pageId, title }: DeletePageButtonProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(deletePage.bind(null, pageId), {});
  const titleId = useId();
  const descriptionId = useId();

  const close = () => {
    if (!pending) setOpen(false);
  };

  return (
    <>
      <Button variant="outlined" color="error" onClick={() => setOpen(true)}>
        Delete
      </Button>
      <Dialog open={open} onClose={close} aria-labelledby={titleId} aria-describedby={descriptionId}>
        <DialogTitle id={titleId}>Delete page?</DialogTitle>
        <DialogContent>
          {state.message && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {state.message}
            </Alert>
          )}
          <DialogContentText id={descriptionId} sx={{ overflowWrap: "anywhere" }}>
            “{title}” will be deleted permanently.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Box component="form" action={formAction}>
            <Button type="submit" variant="contained" color="error" disabled={pending}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>
    </>
  );
}
