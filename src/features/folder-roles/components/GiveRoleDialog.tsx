"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type SubmitEvent } from "react";

import Link from "@/components/Link";
import type { GiveRoleFormAction } from "@/features/folder-roles/forms";
import { ROLE_LABELS, ROLES, type Role } from "@/features/folder-roles/roles";
import type { RoleCandidate } from "@/features/folder-roles/service";
import { focusOnEntered } from "@/lib/focus";
import { useHydrated } from "@/lib/hydration";

type GiveRoleDialogProps = {
  /** Server Action that gives the role; it returns the errors to show, or redirects to the folder on success. */
  action: GiveRoleFormAction;
  /** The users who can get a role: every user of the type user without a role on the folder. */
  candidates: RoleCandidate[];
  /** Where the dialog leads when it is closed: the folder. */
  closeHref: string;
};

/**
 * The "Give role" dialog of an Owner: a user, picked from the users who have no role on the folder yet, and a role,
 * Reader at first, so that more access is always chosen on purpose. With nobody left to pick, it says so and offers
 * only "Cancel".
 */
export default function GiveRoleDialog({ action, candidates, closeHref }: GiveRoleDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const [user, setUser] = useState("");
  const [role, setRole] = useState<Role>("reader");
  const userRef = useRef<HTMLSelectElement>(null);
  const roleRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const titleId = useId();
  const formId = useId();
  const roleLabelId = useId();
  const roleErrorId = useId();
  // The dialog is part of the server-rendered page; until hydration its fields are locked and "Save" is disabled.
  const hydrated = useHydrated();

  const userError = state.fieldErrors?.user?.[0];
  const roleError = state.fieldErrors?.role?.[0];

  useEffect(() => {
    if (state.fieldErrors?.user) userRef.current?.focus();
    else if (state.fieldErrors?.role) roleRef.current?.focus();
  }, [state]);

  // The form calls the action itself: React resets a form after its action, which would put the controlled radio
  // buttons and the select out of sync with their state.
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  const close = () => {
    if (!pending) router.push(closeHref);
  };

  const nobodyLeft = candidates.length === 0;

  return (
    <Dialog
      open
      onClose={close}
      fullWidth
      maxWidth="sm"
      aria-labelledby={titleId}
      // Without a portal the dialog is in the server-rendered HTML, like the rest of the page.
      disablePortal
      slotProps={{ transition: { onEntered: (node) => focusOnEntered(node, userRef.current) } }}
    >
      <DialogTitle id={titleId}>Give role</DialogTitle>
      <DialogContent>
        {nobodyLeft ? (
          <DialogContentText>
            Every user already has a role on this folder, so nobody is left to give one.
          </DialogContentText>
        ) : (
          <Box component="form" id={formId} onSubmit={submit} noValidate>
            <Stack spacing={3} sx={{ pt: 1 }}>
              {state.message && <Alert severity="error">{state.message}</Alert>}
              <TextField
                select
                name="user"
                label="User"
                value={user}
                onChange={(event) => setUser(event.target.value)}
                inputRef={userRef}
                required
                fullWidth
                disabled={!hydrated}
                error={!!userError}
                helperText={userError ?? "The users who have no role on this folder yet"}
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              >
                <option value="" disabled>
                  Choose a user
                </option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.name}>
                    {candidate.name}
                  </option>
                ))}
              </TextField>
              <FormControl disabled={!hydrated} error={!!roleError}>
                <FormLabel id={roleLabelId}>Role</FormLabel>
                <RadioGroup
                  name="role"
                  value={role}
                  onChange={(event) => setRole(event.target.value as Role)}
                  aria-labelledby={roleLabelId}
                  aria-describedby={roleError ? roleErrorId : undefined}
                >
                  {ROLES.map((value, index) => (
                    <FormControlLabel
                      key={value}
                      value={value}
                      control={<Radio slotProps={{ input: index === 0 ? { ref: roleRef } : {} }} />}
                      label={ROLE_LABELS[value]}
                    />
                  ))}
                </RadioGroup>
                {roleError && <FormHelperText id={roleErrorId}>{roleError}</FormHelperText>}
              </FormControl>
            </Stack>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button component={Link} href={closeHref} disabled={pending}>
          Cancel
        </Button>
        {!nobodyLeft && (
          // Outside the form element, so it is tied to the form by its id.
          <Button type="submit" form={formId} variant="contained" disabled={pending || !hydrated}>
            {pending ? "Saving…" : "Save"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
