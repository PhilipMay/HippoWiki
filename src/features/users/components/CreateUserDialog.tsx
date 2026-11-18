"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import ActionDialog, { DialogForm, DialogFormActions } from "@/components/ActionDialog";
import Link from "@/components/Link";
import { type CreateUserFormAction } from "@/features/users/forms";
import { USER_NAME_MAX_LENGTH, USER_NAME_MIN_LENGTH } from "@/features/users/limits";
import { USER_TYPE_LABELS, USER_TYPES, type UserType } from "@/features/users/user-type";
import { useFocusOnFirstError, useSubmitInTransition } from "@/lib/form-hooks";
import { useHydrated } from "@/lib/hydration";

type CreateUserDialogProps = {
  /** Server Action that creates the user; it returns the errors to show, or the user with its first password. */
  action: CreateUserFormAction;
  /** Where the dialog leads when it is closed: the user list. */
  closeHref: string;
};

/**
 * The "New user" dialog. First it asks for the user name and the type of the account, with "User" chosen and the note
 * that the type cannot be changed later. After the creation it shows, in place of the form, the name, the type and the
 * generated first password with a copy button. The password is shown only this once: it lives in the state of
 * this dialog and nowhere else in the browser.
 */
export default function CreateUserDialog({ action, closeHref }: CreateUserDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const [name, setName] = useState("");
  // Most accounts are users; an admin is chosen on purpose.
  const [type, setType] = useState<UserType>("user");
  /** Whether the password was copied: not yet, done, or the browser refused. */
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const typeLabelId = useId();
  const typeNoteId = useId();
  const typeErrorId = useId();
  const hydrated = useHydrated();

  const created = state.created;
  const nameError = state.fieldErrors?.name?.[0];
  const typeError = state.fieldErrors?.type?.[0];
  const typeRef = useRef<HTMLInputElement>(null);

  useFocusOnFirstError(state, [
    ["name", nameRef],
    ["type", typeRef],
  ]);
  // The password of a created user is selected, ready to be copied by hand as well.
  useEffect(() => {
    if (state.created) passwordRef.current?.select();
  }, [state]);
  // The radio buttons of the type are controlled.
  const submit = useSubmitInTransition(formAction);

  const copyPassword = async (password: string) => {
    try {
      await navigator.clipboard.writeText(password);
      setCopy("copied");
    } catch {
      // E.g. the browser does not allow scripts to write to the clipboard; the password can still be copied by hand.
      setCopy("failed");
    }
  };

  return (
    <ActionDialog
      title={created ? "User created" : "New user"}
      closeHref={closeHref}
      pending={pending}
      // Once the password is shown, the dialog closes only through its link: a click next to it or the Escape key
      // must not throw away a password that cannot be shown again.
      closable={!created}
      focusRef={nameRef}
    >
      {created ? (
        <>
          <DialogContent>
            <Stack spacing={3} sx={{ pt: 1 }}>
              <Typography>
                The {created.type} <strong>{created.name}</strong> was created. Pass the first password on to the user,
                who has to change it at the first login.
              </Typography>
              <TextField
                label="First password"
                value={created.password}
                fullWidth
                inputRef={passwordRef}
                slotProps={{
                  htmlInput: { readOnly: true, spellCheck: false },
                  input: { sx: { fontFamily: "monospace" } },
                }}
              />
              <Alert severity="warning">
                The password is shown only this once. It cannot be shown again after you leave this dialog.
              </Alert>
              {copy === "failed" && (
                <Alert severity="error">The password could not be copied. Select it and copy it yourself.</Alert>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            {/* `void`: the handler does not wait for the clipboard; `copyPassword` reports its outcome in the state. */}
            <Button onClick={() => void copyPassword(created.password)}>
              {copy === "copied" ? "Copied" : "Copy password"}
            </Button>
            <Button component={Link} href={closeHref} variant="contained">
              Back to the user list
            </Button>
          </DialogActions>
        </>
      ) : (
        <>
          <DialogForm id={formId} onSubmit={submit} message={state.message}>
            <TextField
              name="name"
              label="User name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              inputRef={nameRef}
              required
              fullWidth
              error={!!nameError}
              helperText={
                nameError ??
                `${USER_NAME_MIN_LENGTH} to ${USER_NAME_MAX_LENGTH} characters: lowercase letters, digits and single hyphens, e.g. jane-doe. The first password is generated.`
              }
              slotProps={{
                htmlInput: {
                  maxLength: USER_NAME_MAX_LENGTH,
                  spellCheck: false,
                  autoCapitalize: "none",
                  autoComplete: "off",
                  readOnly: !hydrated,
                },
              }}
            />
            <FormControl disabled={!hydrated} error={!!typeError}>
              <FormLabel id={typeLabelId}>Type</FormLabel>
              <RadioGroup
                name="type"
                value={type}
                onChange={(event) => setType(event.target.value as UserType)}
                aria-labelledby={typeLabelId}
                aria-describedby={typeError ? `${typeErrorId} ${typeNoteId}` : typeNoteId}
              >
                {USER_TYPES.map((value, index) => (
                  <FormControlLabel
                    key={value}
                    value={value}
                    control={<Radio slotProps={{ input: index === 0 ? { ref: typeRef } : {} }} />}
                    label={USER_TYPE_LABELS[value]}
                  />
                ))}
              </RadioGroup>
              {typeError && <FormHelperText id={typeErrorId}>{typeError}</FormHelperText>}
              <FormHelperText id={typeNoteId}>
                A user works with the folders and pages; an admin manages the accounts and sees no content. The type
                cannot be changed later.
              </FormHelperText>
            </FormControl>
          </DialogForm>
          <DialogFormActions
            closeHref={closeHref}
            formId={formId}
            pending={pending}
            label="Create"
            pendingLabel="Creating…"
          />
        </>
      )}
    </ActionDialog>
  );
}
