"use client";

import { useActionState } from "react";

import { ConfirmDialog } from "@/components/ActionDialog";
import type { RevokeAppFormAction } from "@/features/grants/forms";

type RevokeAppDialogProps = {
  /** Server Action that revokes the app; it returns the error to show, or redirects on success. */
  action: RevokeAppFormAction;
  /** The name of the connected app. */
  appName: string;
  /** The account address without the action, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog "Revoke app" that names the connected app and says that it loses its access at once. The account page renders
 * it for `?action=revoke`, so it is open from the start; closing it leads to the account.
 */
export default function RevokeAppDialog({ action, appName, closeHref }: RevokeAppDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <ConfirmDialog
      title="Revoke app"
      closeHref={closeHref}
      formAction={formAction}
      pending={pending}
      message={state.message}
      description={
        <>
          Revoke the access of the connected app <strong>{appName}</strong>? It stops working at once and has to be
          connected again to get access. This cannot be undone.
        </>
      }
      label="Revoke"
      pendingLabel="Revoking…"
      color="error"
    />
  );
}
