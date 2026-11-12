"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useActionState, useEffect, useRef, useState } from "react";

import { type LoginFormAction } from "@/features/auth/forms";
import { useHydrated } from "@/lib/hydration";

type LoginFormProps = {
  /** Server Action that logs in; it returns the errors to show, or redirects on success. */
  action: LoginFormAction;
};

/** The login form: user name and password. After a failed login it keeps the name and empties the password. */
export default function LoginForm({ action }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // A controlled field keeps the entered name when the action returns errors. The password is uncontrolled: React
  // resets such a field after a submission, which empties it.
  const [name, setName] = useState("");
  // Input before hydration could be lost, so the fields are read-only and "Log in" is disabled until then.
  const hydrated = useHydrated();

  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const nameError = state.fieldErrors?.name?.[0];
  const passwordError = state.fieldErrors?.password?.[0];

  // Field errors come back from the Server Action, so the focus moves once the new state arrives: to the name if it
  // has an error, otherwise to the password. Message-only states leave the focus where it is.
  useEffect(() => {
    if (state.fieldErrors?.name) nameRef.current?.focus();
    else if (state.fieldErrors?.password) passwordRef.current?.focus();
  }, [state]);

  return (
    // `noValidate`: the server validates, and its errors are shown at the field instead of browser bubbles.
    <Stack component="form" action={formAction} noValidate spacing={3}>
      {state.message && <Alert severity="error">{state.message}</Alert>}
      <TextField
        name="name"
        label="User name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoFocus
        required
        fullWidth
        inputRef={nameRef}
        error={!!nameError}
        helperText={nameError}
        autoComplete="username"
        slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "none", readOnly: !hydrated } }}
      />
      <TextField
        name="password"
        label="Password"
        type="password"
        required
        fullWidth
        inputRef={passwordRef}
        error={!!passwordError}
        helperText={passwordError}
        autoComplete="current-password"
        slotProps={{ htmlInput: { readOnly: !hydrated } }}
      />
      <Stack direction="row" spacing={2}>
        <Button type="submit" variant="contained" disabled={pending || !hydrated}>
          {pending ? "Logging in…" : "Log in"}
        </Button>
      </Stack>
    </Stack>
  );
}
