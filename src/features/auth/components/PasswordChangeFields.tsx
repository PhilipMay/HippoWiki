"use client";

import TextField from "@mui/material/TextField";
import { useRef, useState, type RefObject } from "react";

import { type PasswordChangeFormState } from "@/features/auth/forms";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/features/users/limits";
import { useFocusOnFirstError } from "@/lib/form-hooks";
import { useHydrated } from "@/lib/hydration";

type PasswordChangeFieldsProps = {
  /** The state of the form from its Server Action: the errors of the last submission. */
  state: PasswordChangeFormState;
  /** The field of the current password, for the dialog that focuses it once it has entered. */
  currentRef?: RefObject<HTMLInputElement | null>;
  /** Whether the current password is focused when the page loads; a dialog focuses it itself. */
  autoFocus?: boolean;
};

/**
 * The fields of every password change, the forced one and the own one: the current password, the new one and its
 * repetition, with their help texts, the focus on the first field with an error, and the emptying of all three after
 * a refused current password. Written once, so that the two forms cannot drift apart.
 */
export default function PasswordChangeFields({ state, currentRef, autoFocus = false }: PasswordChangeFieldsProps) {
  // Controlled fields keep what was entered when the action returns errors, so that only the field with the error has
  // to be typed again; React resets uncontrolled fields after a submission.
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  // A refused current password (wrong, or during a wait) empties all three, so that it is not submitted again by
  // mistake. Adjusted while rendering the new state, once per state, as React advises instead of an effect.
  const [shownState, setShownState] = useState(state);
  if (state !== shownState) {
    setShownState(state);
    if (state.passwordRefused) {
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
    }
  }
  // Input before hydration could be lost, so the fields are read-only until then.
  const hydrated = useHydrated();

  const ownCurrentRef = useRef<HTMLInputElement>(null);
  const currentFieldRef = currentRef ?? ownCurrentRef;
  const newRef = useRef<HTMLInputElement>(null);
  const repeatRef = useRef<HTMLInputElement>(null);

  const currentError = state.fieldErrors?.currentPassword?.[0];
  const newError = state.fieldErrors?.newPassword?.[0];
  const repeatError = state.fieldErrors?.repeatPassword?.[0];

  useFocusOnFirstError(state, [
    ["currentPassword", currentFieldRef],
    ["newPassword", newRef],
    ["repeatPassword", repeatRef],
  ]);

  return (
    <>
      <TextField
        name="currentPassword"
        label="Current password"
        type="password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        autoFocus={autoFocus}
        required
        fullWidth
        inputRef={currentFieldRef}
        error={!!currentError}
        helperText={currentError}
        autoComplete="current-password"
        slotProps={{ htmlInput: { readOnly: !hydrated } }}
      />
      <TextField
        name="newPassword"
        label="New password"
        type="password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        required
        fullWidth
        inputRef={newRef}
        error={!!newError}
        helperText={
          newError ??
          `${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters, not built from your user name or the name of ` +
            "the wiki, and not a common password"
        }
        autoComplete="new-password"
        slotProps={{ htmlInput: { readOnly: !hydrated } }}
      />
      <TextField
        name="repeatPassword"
        label="Repeat new password"
        type="password"
        value={repeatPassword}
        onChange={(event) => setRepeatPassword(event.target.value)}
        required
        fullWidth
        inputRef={repeatRef}
        error={!!repeatError}
        helperText={repeatError}
        autoComplete="new-password"
        slotProps={{ htmlInput: { readOnly: !hydrated } }}
      />
    </>
  );
}
