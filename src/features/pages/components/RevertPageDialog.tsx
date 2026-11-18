"use client";

import { useActionState } from "react";

import { ConfirmDialog } from "@/components/ActionDialog";
import PageVersionField from "@/features/pages/components/PageVersionField";
import type { PageRevertFormAction } from "@/features/pages/forms";

type RevertPageDialogProps = {
  /** Server Action that reverts the page to the revision; it returns the error to show, or redirects on success. */
  action: PageRevertFormAction;
  /** The revision by its number, time and user, as the server formats them: "revision 2 of <time> by alice via web". */
  revisionLabel: string;
  /** The version of the page the dialog was rendered with, which the revert is based on. */
  version: number;
  /** The message that the page was changed after the dialog was opened, after a refused revert. */
  changedMessage?: string;
  /** The address of the revision, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog "Revert page" that names the revision and says that the revert records a new revision, so that nothing is
 * lost. The route renders it for `?action=revert&revision=<n>` over the view of the revision, so it is open from the
 * start; closing it leads to the revision.
 */
export default function RevertPageDialog({
  action,
  revisionLabel,
  version,
  changedMessage,
  closeHref,
}: RevertPageDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <ConfirmDialog
      title="Revert page"
      closeHref={closeHref}
      formAction={formAction}
      pending={pending}
      message={state.message}
      lead={<PageVersionField version={version} changedMessage={changedMessage} />}
      description={`Set the page back to ${revisionLabel}? This records a new revision with its content; no revision is lost.`}
      label="Revert"
      pendingLabel="Reverting…"
    />
  );
}
