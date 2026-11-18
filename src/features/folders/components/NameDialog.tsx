"use client";

import TextField from "@mui/material/TextField";
import { useActionState, useId, useRef, useState } from "react";

import ActionDialog, { DialogForm, DialogFormActions } from "@/components/ActionDialog";
import { useFocusOnFirstError } from "@/lib/form-hooks";
import { useHydrated } from "@/lib/hydration";
import type { NameFormAction } from "@/features/folders/forms";
import { NAME_MAX_LENGTH } from "@/lib/name-limits";

type NameDialogProps = {
  /** Heading of the dialog, e.g. "New folder". */
  title: string;
  /** Server Action that stores the name; it returns the errors to show, or redirects on success. */
  action: NameFormAction;
  /**
   * The current name of the item when renaming: the field starts with it, and "Save" stays disabled while the name in
   * the field, without its surrounding spaces, is this name. Left out for a new item, whose field starts empty.
   */
  currentName?: string;
  /** The address without the action, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog that asks for the name of a folder or tab, used to create and to rename. The route renders it for an action
 * in the query string, so it is open from the start; closing it leads to the address without the action.
 */
export default function NameDialog({ title, action, currentName, closeHref }: NameDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // A controlled field keeps the entered name when the action returns errors; React resets only uncontrolled fields
  // after a submission.
  const [name, setName] = useState(currentName ?? "");
  const nameRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  // The dialog is part of the server-rendered page. Input before hydration could be lost, so the name is read-only
  // and "Save" is disabled until then.
  const hydrated = useHydrated();

  const nameError = state.fieldErrors?.name?.[0];
  // A rename to the current name would change nothing. The name is trimmed as the server's name schema trims it, so that
  // the button and the server agree; the comparison is with the name the dialog was opened with, while the server
  // compares with the name stored at the moment of the save.
  const unchanged = currentName !== undefined && name.trim() === currentName;

  useFocusOnFirstError(state, [["name", nameRef]]);

  return (
    // The name is the only field, so it is focused once the dialog has entered.
    <ActionDialog title={title} closeHref={closeHref} pending={pending} focusRef={nameRef}>
      <DialogForm id={formId} action={formAction} message={state.message}>
        <TextField
          name="name"
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          inputRef={nameRef}
          required
          fullWidth
          error={!!nameError}
          helperText={nameError ?? "Lowercase letters, digits and single hyphens, e.g. release-notes"}
          slotProps={{
            htmlInput: {
              maxLength: NAME_MAX_LENGTH,
              spellCheck: false,
              autoCapitalize: "none",
              readOnly: !hydrated,
            },
          }}
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
