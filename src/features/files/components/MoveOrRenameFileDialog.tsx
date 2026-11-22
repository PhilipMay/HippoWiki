"use client";

import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import { useActionState, useId, useRef, useState } from "react";

import ActionDialog, { DialogForm, DialogFormActions } from "@/components/ActionDialog";
import { LOCK_VERSION_FIELD } from "@/features/files/fields";
import type { FileMoveOrRenameFormAction } from "@/features/files/forms";
import PageNameAndPlaceFields, { FOLDER_TARGET } from "@/features/pages/components/PageNameAndPlaceFields";
import { useFocusOnFirstError, useSubmitInTransition } from "@/lib/form-hooks";
import { useHydrated } from "@/lib/hydration";

/** What a move or rename does to the links and embeds of the file: how many pages it updates, or that none shows it. */
function linkUpdateNote(pages: number): string {
  if (pages === 0) return "No page shows or links this file.";
  return pages === 1 ? "Links in 1 page will be updated." : `Links in ${pages} pages will be updated.`;
}

type MoveOrRenameFileDialogProps = {
  /** Server Action that stores name and place of the file; it returns the errors to show, or redirects on success. */
  action: FileMoveOrRenameFormAction;
  /** The name of the folder of the file, for the address shown below the name. */
  folderName: string;
  /** The tabs of the folder, in display order. */
  tabs: { id: string; name: string }[];
  /** The id of the tab the file lives in, or `null` for a file placed directly in its folder. */
  currentTabId: string | null;
  /** The current name of the file with its extension, which the name field starts with. */
  initialName: string;
  /** How many pages show or link the file, which a move or rename updates. */
  linkingPages: number;
  /** The lock version of the file the dialog was rendered with, which the move is based on. */
  lockVersion: number;
  /** The message that the file was changed after the dialog was opened, after a refused move. */
  changedMessage?: string;
  /** The details page of the file, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog "Move or rename file" with the name of the file, its extension included, and a choice of its place: directly
 * in the folder or one of its tabs. Both are saved together; the address of the details page the file will get is
 * shown below the name, and the dialog says how many pages it updates. The route renders it for
 * `?action=move-or-rename` over the details page of the file.
 */
export default function MoveOrRenameFileDialog({
  action,
  folderName,
  tabs,
  currentTabId,
  initialName,
  linkingPages,
  lockVersion,
  changedMessage,
  closeHref,
}: MoveOrRenameFileDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // Controlled name and place keep the input when the action returns errors.
  const [name, setName] = useState(initialName);
  const [target, setTarget] = useState(currentTabId ?? FOLDER_TARGET);
  const nameRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  // The dialog is part of the server-rendered page; until hydration the name is read-only and "Save" is disabled.
  const hydrated = useHydrated();

  // A move to the current name and place would change nothing, so "Save" is disabled while they hold, as in "Move or
  // rename page"; the name is trimmed as the server's schema trims it.
  const unchanged = name.trim() === initialName && target === (currentTabId ?? FOLDER_TARGET);

  useFocusOnFirstError(state, [["name", nameRef]]);
  // The radio buttons of the place are controlled.
  const submit = useSubmitInTransition(formAction);

  return (
    <ActionDialog title="Move or rename file" closeHref={closeHref} pending={pending} focusRef={nameRef}>
      <DialogForm
        id={formId}
        onSubmit={submit}
        message={state.message}
        lead={
          <>
            <input type="hidden" name={LOCK_VERSION_FIELD} value={lockVersion} />
            {changedMessage && <Alert severity="warning">{changedMessage}</Alert>}
          </>
        }
      >
        <PageNameAndPlaceFields
          item="file"
          folderName={folderName}
          tabs={tabs}
          name={name}
          onNameChange={setName}
          place={target}
          onPlaceChange={setTarget}
          nameError={state.fieldErrors?.name?.[0]}
          nameRef={nameRef}
          locked={!hydrated}
        />
        <Typography variant="body2" color="text.secondary">
          {linkUpdateNote(linkingPages)}
        </Typography>
      </DialogForm>
      <DialogFormActions
        closeHref={closeHref}
        formId={formId}
        pending={pending}
        label="Save"
        pendingLabel="Saving…"
        disabled={unchanged}
      />
    </ActionDialog>
  );
}
