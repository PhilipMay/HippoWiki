"use client";

import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { useId, useRef } from "react";

import { focusOnEntered } from "@/lib/focus";

type DiscardChangesDialogProps = {
  open: boolean;
  /** Closes the dialog and keeps the editor with its content. */
  onKeepEditing(): void;
  /** Leaves the editor where the held link or "Cancel" leads. */
  onDiscard(): void;
};

/**
 * The dialog "Discard changes?" before the editor is left with unsaved changes (R35), with "Keep editing" focused once
 * the dialog has entered, so that Enter keeps the work.
 */
export default function DiscardChangesDialog({ open, onKeepEditing, onDiscard }: DiscardChangesDialogProps) {
  const titleId = useId();
  const keepRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onClose={onKeepEditing}
      aria-labelledby={titleId}
      slotProps={{ transition: { onEntered: (node) => focusOnEntered(node, keepRef.current) } }}
    >
      <DialogTitle id={titleId}>Discard changes?</DialogTitle>
      <DialogContent>
        <DialogContentText>The changes to the content are not saved and will be lost.</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onDiscard} color="error">
          Discard
        </Button>
        <Button ref={keepRef} onClick={onKeepEditing} variant="contained">
          Keep editing
        </Button>
      </DialogActions>
    </Dialog>
  );
}
