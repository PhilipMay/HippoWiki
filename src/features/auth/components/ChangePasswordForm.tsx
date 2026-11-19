"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useActionState } from "react";

import PasswordChangeFields from "@/features/auth/components/PasswordChangeFields";
import { type PasswordChangeFormAction } from "@/features/auth/forms";
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
  // The button is disabled until hydration, like the fields are read-only.
  const hydrated = useHydrated();

  return (
    // `noValidate`: the server validates, and its errors are shown at the field instead of browser bubbles.
    <Stack component="form" action={formAction} noValidate spacing={3}>
      {state.message && <Alert severity="error">{state.message}</Alert>}
      <input type="hidden" name={NEXT_PARAM} value={next} />
      <PasswordChangeFields state={state} autoFocus />
      <Stack direction="row" spacing={2}>
        <Button type="submit" variant="contained" disabled={pending || !hydrated}>
          {pending ? "Saving…" : "Change password"}
        </Button>
      </Stack>
    </Stack>
  );
}
