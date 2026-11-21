"use client";

import Alert from "@mui/material/Alert";
import { useActionState } from "react";

import { ConfirmDialog } from "@/components/ActionDialog";
import { LOCK_VERSION_FIELD } from "@/features/files/fields";
import type { FileRevertFormAction } from "@/features/files/forms";

type RevertFileDialogProps = {
  /** Server Action that reverts the file to the version; it returns the error to show, or redirects on success. */
  action: FileRevertFormAction;
  /** The version by its number, time and user, as the server formats them: "version 1 of <time> by alice via web". */
  versionLabel: string;
  /** The lock version of the file the dialog was rendered with, which the revert is based on. */
  lockVersion: number;
  /** The message that the file was changed after the dialog was opened, after a refused revert. */
  changedMessage?: string;
  /** The details page of the file, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog "Revert file" that names the version and says that the revert stores it again as the newest version, so that
 * no version is lost. The route renders it for `?action=revert&version=<n>` over the details page of the file.
 */
export default function RevertFileDialog({
  action,
  versionLabel,
  lockVersion,
  changedMessage,
  closeHref,
}: RevertFileDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <ConfirmDialog
      title="Revert file"
      closeHref={closeHref}
      formAction={formAction}
      pending={pending}
      message={state.message}
      lead={
        <>
          <input type="hidden" name={LOCK_VERSION_FIELD} value={lockVersion} />
          {changedMessage && <Alert severity="warning">{changedMessage}</Alert>}
        </>
      }
      description={`Set the file back to ${versionLabel}? This stores its content again as the newest version; no version is lost.`}
      label="Revert"
      pendingLabel="Reverting…"
    />
  );
}
