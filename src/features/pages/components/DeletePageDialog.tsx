"use client";

import { useActionState } from "react";

import { ConfirmDialog } from "@/components/ActionDialog";
import PageVersionField from "@/features/pages/components/PageVersionField";
import type { PageDeleteFormAction } from "@/features/pages/forms";

type DeletePageDialogProps = {
  /** Server Action that deletes the page; it returns the error to show, or redirects on success. */
  action: PageDeleteFormAction;
  /** The name of the page, as its address shows it (with `.md`). */
  pageLabel: string;
  /** The version of the page the dialog was rendered with, which the delete is based on. */
  version: number;
  /** The message that the page was changed after the dialog was opened, after a refused delete. */
  changedMessage?: string;
  /** The page address without the action, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog "Delete page" that names the page and says that it can be restored later from the folder's deleted pages. The
 * route renders it for `?action=delete`, so it is open from the start; closing it leads to the page address.
 */
export default function DeletePageDialog({
  action,
  pageLabel,
  version,
  changedMessage,
  closeHref,
}: DeletePageDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <ConfirmDialog
      title="Delete page"
      closeHref={closeHref}
      formAction={formAction}
      pending={pending}
      message={state.message}
      lead={<PageVersionField version={version} changedMessage={changedMessage} />}
      description={`Delete the page ${pageLabel}? You can restore it later from the deleted pages of its folder.`}
      label="Delete"
      pendingLabel="Deleting…"
      color="error"
    />
  );
}
