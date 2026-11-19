"use client";

import Checkbox from "@mui/material/Checkbox";
import DialogContentText from "@mui/material/DialogContentText";
import FormControlLabel from "@mui/material/FormControlLabel";
import { useActionState, useId, useRef, useState } from "react";

import ActionDialog, { DialogForm, DialogFormActions } from "@/components/ActionDialog";
import PasswordChangeFields from "@/features/auth/components/PasswordChangeFields";
import { DISCONNECT_APPS_FIELD, type PasswordChangeFormAction } from "@/features/auth/forms";
import { useSubmitInTransition } from "@/lib/form-hooks";
import { useHydrated } from "@/lib/hydration";

type ChangeOwnPasswordDialogProps = {
  /** Server Action that changes the password; it returns the errors to show, or redirects on success. */
  action: PasswordChangeFormAction;
  /** The account address without the action, where closing the dialog leads. */
  closeHref: string;
  /**
   * Whether to offer disconnecting all connected apps with the change: only for a user who has at least one. Never for
   * an admin, for a user without apps, or while OAuth is off.
   */
  offerDisconnectApps: boolean;
};

/**
 * Dialog "Change password" of the own account: the current password, the new one and its repetition, with the same
 * fields as the forced password change, and for a user with apps the choice "Also disconnect all my apps", not ticked
 * when the dialog opens. It says that the other browsers are logged out. The account page renders it for
 * `?action=change-password`, so it is open from the start; closing it leads to the account.
 */
export default function ChangeOwnPasswordDialog({
  action,
  closeHref,
  offerDisconnectApps,
}: ChangeOwnPasswordDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // A routine change keeps the apps; the choice is kept after an error of the form, also after a wait.
  const [disconnectApps, setDisconnectApps] = useState(false);
  const formId = useId();
  const currentRef = useRef<HTMLInputElement>(null);
  const hydrated = useHydrated();
  // The checkbox is controlled, and React would reset it after a form action.
  const submit = useSubmitInTransition(formAction);

  return (
    <ActionDialog title="Change password" closeHref={closeHref} pending={pending} focusRef={currentRef}>
      <DialogForm
        id={formId}
        onSubmit={submit}
        message={state.message}
        lead={
          <DialogContentText>
            All your other browsers are logged out with the change; this one stays logged in.
          </DialogContentText>
        }
      >
        <PasswordChangeFields state={state} currentRef={currentRef} />
        {offerDisconnectApps && (
          <FormControlLabel
            control={
              <Checkbox
                name={DISCONNECT_APPS_FIELD}
                checked={disconnectApps}
                onChange={(event) => setDisconnectApps(event.target.checked)}
                disabled={!hydrated}
              />
            }
            label="Also disconnect all my apps"
          />
        )}
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
