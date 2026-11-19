"use client";

import { useActionState } from "react";

import { ConfirmDialog } from "@/components/ActionDialog";
import type { LogOutOthersFormAction } from "@/features/auth/forms";

type LogOutOtherBrowsersDialogProps = {
  /** Server Action that ends the other sessions; it returns the error to show, or redirects on success. */
  action: LogOutOthersFormAction;
  /** The account address without the action, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog "Log out other browsers" that says what happens and asks for no password: every other browser of the account
 * is logged out, this one stays logged in, and the password stays. The account page renders it for
 * `?action=log-out-others`, so it is open from the start; closing it leads to the account and ends nothing.
 */
export default function LogOutOtherBrowsersDialog({ action, closeHref }: LogOutOtherBrowsersDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <ConfirmDialog
      title="Log out other browsers"
      closeHref={closeHref}
      formAction={formAction}
      pending={pending}
      message={state.message}
      description="Log out all your other browsers? They have to log in again; this browser stays logged in, and your password stays the same."
      label="Log out other browsers"
      pendingLabel="Logging out…"
    />
  );
}
