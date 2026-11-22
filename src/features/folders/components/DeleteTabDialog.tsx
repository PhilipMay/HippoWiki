"use client";

import Button from "@mui/material/Button";
import DialogActions from "@mui/material/DialogActions";
import { useActionState, useEffect, useRef } from "react";

import { ConfirmDialog } from "@/components/ActionDialog";
import Link from "@/components/Link";
import type { TabDeleteFormAction } from "@/features/folders/forms";

type DeleteTabDialogProps = {
  /** Server Action that deletes the tab; it returns the state to show, or redirects to the folder on success. */
  action: TabDeleteFormAction;
  /** The name of the tab, as its address shows it. */
  tabName: string;
  /** The number of pages in the tab when the dialog was rendered. */
  pageCount: number;
  /** The number of files in the tab when the dialog was rendered. */
  fileCount: number;
  /** The tab address without the action, where closing the dialog leads. */
  closeHref: string;
  /** The folder address, the only way left once the tab no longer exists. */
  folderHref: string;
};

/** What goes with the tab: its pages and files, in singular, plural and none. */
function contentsText(pageCount: number, fileCount: number): string {
  const count = (number: number, item: string) => `${number} ${item}${number === 1 ? "" : "s"}`;
  if (fileCount === 0) {
    if (pageCount === 0) return "It has no pages, so no page is deleted with it.";
    return pageCount === 1 ? "Its 1 page is deleted with it." : `Its ${pageCount} pages are deleted with it.`;
  }
  if (pageCount === 0) return `Its ${count(fileCount, "file")} ${fileCount === 1 ? "is" : "are"} deleted with it.`;
  return `Its ${count(pageCount, "page")} and ${count(fileCount, "file")} are deleted with it.`;
}

/**
 * Dialog "Delete tab" that names the tab and the number of its pages and files, and says that they can be restored one
 * by one from the deleted items of the folder while the tab itself cannot. The route renders it for `?action=delete`, so
 * it is open from the start; closing it leads to the tab address, or to the folder once the tab no longer exists.
 */
export default function DeleteTabDialog({
  action,
  tabName,
  pageCount,
  fileCount,
  closeHref,
  folderHref,
}: DeleteTabDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const gone = state.tabGone === true;
  const backRef = useRef<HTMLAnchorElement>(null);

  // The focused "Delete" is gone with the tab, so the focus moves to the only way left, where the Escape key still
  // reaches the dialog.
  useEffect(() => {
    if (gone) backRef.current?.focus();
  }, [gone]);

  return (
    <ConfirmDialog
      title="Delete tab"
      closeHref={gone ? folderHref : closeHref}
      formAction={formAction}
      pending={pending}
      message={state.message}
      description={
        <>
          Delete the tab {tabName}? {contentsText(pageCount, fileCount)}{" "}
          {pageCount + fileCount > 0 &&
            `${fileCount === 0 ? "The pages" : pageCount === 0 ? "The files" : "They"} can be restored one by one from the deleted items of the folder. `}
          The tab itself cannot be restored.
        </>
      }
      label="Delete"
      pendingLabel="Deleting…"
      color="error"
      actions={
        gone ? (
          <DialogActions>
            <Button component={Link} href={folderHref} ref={backRef}>
              Back to the folder
            </Button>
          </DialogActions>
        ) : undefined
      }
    />
  );
}
