"use client";

import DialogContentText from "@mui/material/DialogContentText";
import { useActionState, useId, useRef } from "react";

import ActionDialog, { DialogForm, DialogFormActions } from "@/components/ActionDialog";
import PasswordChangeFields from "@/features/auth/components/PasswordChangeFields";
import { type PasswordChangeFormAction } from "@/features/auth/forms";

type ChangeOwnPasswordDialogProps = {
  /** Server Action that changes the password; it returns the errors to show, or redirects on success. */
  action: PasswordChangeFormAction;
  /** The account address without the action, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog "Change password" of the own account: the current password, the new one and its repetition, with the same
 * fields as the forced password change. It says that the other browsers are logged out. The account page renders it
 * for `?action=change-password`, so it is open from the start; closing it leads to the account.
 */
export default function ChangeOwnPasswordDialog({ action, closeHref }: ChangeOwnPasswordDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const formId = useId();
  const currentRef = useRef<HTMLInputElement>(null);

  return (
    <ActionDialog title="Change password" closeHref={closeHref} pending={pending} focusRef={currentRef}>
      <DialogForm
        id={formId}
        action={formAction}
        message={state.message}
        lead={
          <DialogContentText>
            All your other browsers are logged out with the change; this one stays logged in.
          </DialogContentText>
        }
      >
        <PasswordChangeFields state={state} currentRef={currentRef} />
      </DialogForm>
      <DialogFormActions
        closeHref={closeHref}
        formId={formId}
        pending={pending}
        label="Change password"
        pendingLabel="Changing…"
      />
    </ActionDialog>
  );
}
