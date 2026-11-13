"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useActionState, useEffect, useRef, useState } from "react";

import { type PasswordChangeFormAction } from "@/features/auth/forms";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/features/users/schema";
import { NEXT_PARAM } from "@/lib/addresses";
import { useHydrated } from "@/lib/hydration";

type ChangePasswordFormProps = {
  /** Server Action that changes the password; it returns the errors to show, or redirects on success. */
  action: PasswordChangeFormAction;
  /** The address to go to after the change, already checked by the page; the action checks it again. */
  next: string;
};

/** The form of the forced password change: the current password, the new one and its repetition. */
export default function ChangePasswordForm({ action, next }: ChangePasswordFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // Controlled fields keep what was entered when the action returns errors, so that only the field with the error has
  // to be typed again; React resets uncontrolled fields after a submission.
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  // Input before hydration could be lost, so the fields are read-only and the button is disabled until then.
  const hydrated = useHydrated();

  const currentRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const repeatRef = useRef<HTMLInputElement>(null);

  const currentError = state.fieldErrors?.currentPassword?.[0];
  const newError = state.fieldErrors?.newPassword?.[0];
  const repeatError = state.fieldErrors?.repeatPassword?.[0];

  // Field errors come back from the Server Action, so the focus moves once the new state arrives: to the first field
  // with an error. Message-only states leave the focus where it is.
  useEffect(() => {
    if (state.fieldErrors?.currentPassword) currentRef.current?.focus();
    else if (state.fieldErrors?.newPassword) newRef.current?.focus();
    else if (state.fieldErrors?.repeatPassword) repeatRef.current?.focus();
  }, [state]);

  return (
    // `noValidate`: the server validates, and its errors are shown at the field instead of browser bubbles.
    <Stack component="form" action={formAction} noValidate spacing={3}>
      {state.message && <Alert severity="error">{state.message}</Alert>}
      <input type="hidden" name={NEXT_PARAM} value={next} />
      <TextField
        name="currentPassword"
        label="Current password"
        type="password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        autoFocus
        required
        fullWidth
        inputRef={currentRef}
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
          newError ?? `${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters, not the same as your user name`
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
      <Stack direction="row" spacing={2}>
        <Button type="submit" variant="contained" disabled={pending || !hydrated}>
          {pending ? "Saving…" : "Change password"}
        </Button>
      </Stack>
    </Stack>
  );
}
