"use client";

import Alert from "@mui/material/Alert";
import { useActionState } from "react";

import { ConfirmDialog } from "@/components/ActionDialog";
import { LOCK_VERSION_FIELD } from "@/features/files/fields";
import type { FileDeleteFormAction } from "@/features/files/forms";

type DeleteFileDialogProps = {
  /** Server Action that deletes the file; it returns the error to show, or redirects on success. */
  action: FileDeleteFormAction;
  /** The name of the file with its extension. */
  fileName: string;
  /** How many pages show or link the file, whose links then show as missing. */
  linkingPages: number;
  /** The lock version of the file the dialog was rendered with, which the delete is based on. */
  lockVersion: number;
  /** The message that the file was changed after the dialog was opened, after a refused delete. */
  changedMessage?: string;
  /** The details page of the file, where closing the dialog leads. */
  closeHref: string;
};

/** What the delete does to the pages that show or link the file. */
function linksText(pages: number): string {
  if (pages === 0) return "";
  return pages === 1
    ? " Its links in 1 page will show as missing."
    : ` Its links in ${pages} pages will show as missing.`;
}

/**
 * Dialog "Delete file" that names the file and says that it can be restored, with its versions, from the deleted items
 * of the folder. The route renders it for `?action=delete` over the details page of the file.
 */
export default function DeleteFileDialog({
  action,
  fileName,
  linkingPages,
  lockVersion,
  changedMessage,
  closeHref,
}: DeleteFileDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <ConfirmDialog
      title="Delete file"
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
      description={`Delete the file ${fileName}? It can be restored with its versions from the deleted items of the folder.${linksText(linkingPages)}`}
      label="Delete"
      pendingLabel="Deleting…"
      color="error"
    />
  );
}
