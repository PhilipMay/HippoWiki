"use client";

import { useActionState, useId, useRef, useState } from "react";

import ActionDialog, { DialogForm, DialogFormActions } from "@/components/ActionDialog";
import PageNameAndPlaceFields from "@/features/pages/components/PageNameAndPlaceFields";
import type { PageRestoreFormAction } from "@/features/pages/forms";
import { useFocusOnFirstError, useSubmitInTransition } from "@/lib/form-hooks";
import { useHydrated } from "@/lib/hydration";

type RestorePageDialogProps = {
  /** Whether a page or a file is restored, which names the dialog; a page by default. */
  item?: "page" | "file";
  /** Server Action that restores the page or file; it returns the errors to show, or redirects on success. */
  action: PageRestoreFormAction;
  /** The name of the page's folder, for the address shown below the name. */
  folderName: string;
  /** The tabs of the page's folder, in display order. */
  tabs: { id: string; name: string }[];
  /** The name the page had when it was deleted, which the name field starts with. */
  initialName: string;
  /** The address of the deleted page without the action, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog "Restore page" with the name of the page and a choice of its place inside its folder: directly in the folder
 * or one of its tabs. No place is preselected, because the place of a deleted page is forgotten; the address the page
 * will get is shown below the name once a place is chosen. The route renders it for `?action=restore`, so it is open
 * from the start; closing it leads to the deleted page. A deleted file is restored in the same dialog, "Restore file",
 * with its name and extension.
 */
export default function RestorePageDialog({
  item = "page",
  action,
  folderName,
  tabs,
  initialName,
  closeHref,
}: RestorePageDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // Controlled name and place keep the input when the action returns errors.
  const [name, setName] = useState(initialName);
  const [place, setPlace] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const placeRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  // The dialog is part of the server-rendered page. Input before hydration could be lost, so the name is read-only and
  // the places and "Save" are disabled until then.
  const hydrated = useHydrated();

  const nameError = state.fieldErrors?.name?.[0];
  const placeError = state.fieldErrors?.place?.[0];

  useFocusOnFirstError(state, [
    ["name", nameRef],
    ["place", placeRef],
  ]);
  // The radio buttons of the place are controlled.
  const submit = useSubmitInTransition(formAction);

  return (
    <ActionDialog
      title={item === "file" ? "Restore file" : "Restore page"}
      closeHref={closeHref}
      pending={pending}
      focusRef={nameRef}
    >
      <DialogForm id={formId} onSubmit={submit} message={state.message}>
        <PageNameAndPlaceFields
          item={item}
          folderName={folderName}
          tabs={tabs}
          name={name}
          onNameChange={setName}
          place={place}
          onPlaceChange={setPlace}
          nameError={nameError}
          nameRef={nameRef}
          placeError={placeError}
          placeRef={placeRef}
          locked={!hydrated}
        />
      </DialogForm>
      <DialogFormActions closeHref={closeHref} formId={formId} pending={pending} label="Save" pendingLabel="Saving…" />
    </ActionDialog>
  );
}
