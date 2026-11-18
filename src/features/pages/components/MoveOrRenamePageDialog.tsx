"use client";

import { useActionState, useId, useRef, useState } from "react";

import ActionDialog, { DialogForm, DialogFormActions } from "@/components/ActionDialog";
import PageNameAndPlaceFields, { FOLDER_TARGET } from "@/features/pages/components/PageNameAndPlaceFields";
import PageVersionField from "@/features/pages/components/PageVersionField";
import type { PageMoveOrRenameFormAction } from "@/features/pages/forms";
import { useFocusOnFirstError, useSubmitInTransition } from "@/lib/form-hooks";
import { useHydrated } from "@/lib/hydration";

type MoveOrRenamePageDialogProps = {
  /** Server Action that stores name and place of the page; it returns the errors to show, or redirects on success. */
  action: PageMoveOrRenameFormAction;
  /** The name of the page's folder, for the address shown below the name. */
  folderName: string;
  /** The tabs of the page's folder, in display order. */
  tabs: { id: string; name: string }[];
  /** The id of the tab the page lives in, or `null` for a page placed directly in its folder. */
  currentTabId: string | null;
  /** The current name of the page, which the name field starts with. */
  initialName: string;
  /** The version of the page the dialog was rendered with, which the save is based on. */
  version: number;
  /** The message that the page was changed after the dialog was opened, after a refused save. */
  changedMessage?: string;
  /** The page address without the action, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog "Move or rename page" with the name of the page and a choice of its place: directly in the folder or one of
 * its tabs. Both are saved together; the address the page will get is shown below the name. The route renders it for
 * `?action=move-or-rename`, so it is open from the start; closing it leads to the page address.
 */
export default function MoveOrRenamePageDialog({
  action,
  folderName,
  tabs,
  currentTabId,
  initialName,
  version,
  changedMessage,
  closeHref,
}: MoveOrRenamePageDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // Controlled name and place keep the input when the action returns errors.
  const [name, setName] = useState(initialName);
  const [target, setTarget] = useState(currentTabId ?? FOLDER_TARGET);
  const nameRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  // The dialog is part of the server-rendered page. Input before hydration could be lost, so the name is read-only and
  // the places and "Save" are disabled until then.
  const hydrated = useHydrated();

  const nameError = state.fieldErrors?.name?.[0];
  // A move to the current name and place would change nothing. The name is trimmed as the server's name schema trims
  // it, so that the button and the server agree; the comparison is with the name and place the dialog was opened with,
  // while the server compares with those stored at the moment of the save. While it holds, "Save" is disabled, and with
  // it the submission by Enter in the name field, because it is the form's default button.
  const unchanged = name.trim() === initialName && target === (currentTabId ?? FOLDER_TARGET);

  useFocusOnFirstError(state, [["name", nameRef]]);
  // The radio buttons of the place are controlled.
  const submit = useSubmitInTransition(formAction);

  return (
    <ActionDialog title="Move or rename page" closeHref={closeHref} pending={pending} focusRef={nameRef}>
      <DialogForm
        id={formId}
        onSubmit={submit}
        message={state.message}
        lead={<PageVersionField version={version} changedMessage={changedMessage} />}
      >
        <PageNameAndPlaceFields
          folderName={folderName}
          tabs={tabs}
          name={name}
          onNameChange={setName}
          place={target}
          onPlaceChange={setTarget}
          nameError={nameError}
          nameRef={nameRef}
          locked={!hydrated}
        />
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
