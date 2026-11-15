"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { startTransition, useActionState, useId, useState } from "react";

import type { RoleChangeFormAction } from "@/features/folder-roles/forms";
import { ROLE_LABELS, ROLES, type Role } from "@/features/folder-roles/roles";
import type { FolderRoleEntry } from "@/features/folder-roles/service";
import { useHydrated } from "@/lib/hydration";

/** The controls of an Owner: the action that changes and removes roles, and the id of the Owner looking at the list. */
type Manage = { action: RoleChangeFormAction; ownId: string };

/** A change that waits for the confirmation of the Owner, because it concerns the own role. */
type PendingChange = { intent: "change"; role: Role } | { intent: "remove" };

/**
 * Who has which role on a folder, in the order the service returns them: Owners first, then Managers, Writers and
 * Readers. Whoever looks at it has a role on the folder, so the list is never empty. An Owner gets a role choice and
 * "Remove" per user: a change of another user's role takes effect at once, a change of the own role only after a
 * confirmation, because it can take the Owner's own access. The controls are locked until hydration.
 */
export default function FolderRoleList({ roles, manage }: { roles: FolderRoleEntry[]; manage?: Manage }) {
  return manage ? <ManagedRoleList roles={roles} manage={manage} /> : <RoleList roles={roles} />;
}

function RoleList({ roles }: { roles: FolderRoleEntry[] }) {
  return (
    <Paper variant="outlined">
      <List disablePadding aria-label="Roles">
        {roles.map(({ user, role }, index) => (
          <ListItem key={user.id} divider={index < roles.length - 1}>
            <ListItemText primary={user.name} secondary={ROLE_LABELS[role]} />
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}

function ManagedRoleList({ roles, manage }: { roles: FolderRoleEntry[]; manage: Manage }) {
  const [state, formAction, pending] = useActionState(manage.action, {});
  const [confirming, setConfirming] = useState<PendingChange | null>(null);
  const hydrated = useHydrated();
  const titleId = useId();
  const descriptionId = useId();

  const submit = (user: string, change: PendingChange) => {
    const formData = new FormData();
    formData.set("user", user);
    formData.set("intent", change.intent);
    if (change.intent === "change") formData.set("role", change.role);
    startTransition(() => formAction(formData));
  };

  /** Submits a change of another user at once, and asks first for a change of the own role. */
  const request = (user: string, change: PendingChange) => {
    if (user === manage.ownId) setConfirming(change);
    else submit(user, change);
  };

  const confirm = () => {
    if (confirming) submit(manage.ownId, confirming);
    setConfirming(null);
  };

  const locked = pending || !hydrated;

  return (
    <Stack spacing={2}>
      {state.message && <Alert severity="error">{state.message}</Alert>}
      <Paper variant="outlined">
        <List disablePadding aria-label="Roles">
          {roles.map(({ user, role }, index) => (
            <ListItem key={user.id} divider={index < roles.length - 1} sx={{ gap: 2, flexWrap: "wrap" }}>
              <ListItemText primary={user.name} sx={{ minWidth: 120 }} />
              <TextField
                select
                size="small"
                label={`Role of ${user.name}`}
                // The role as stored: a change is shown once the list is read again after it.
                value={role}
                onChange={(event) => request(user.id, { intent: "change", role: event.target.value as Role })}
                disabled={locked}
                slotProps={{ select: { native: true } }}
              >
                {ROLES.map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </option>
                ))}
              </TextField>
              <Button
                onClick={() => request(user.id, { intent: "remove" })}
                disabled={locked}
                aria-label={`Remove the role of ${user.name}`}
              >
                Remove
              </Button>
            </ListItem>
          ))}
        </List>
      </Paper>
      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <DialogTitle id={titleId}>
          {confirming?.intent === "remove" ? "Remove your role" : "Change your role"}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id={descriptionId}>
            {confirming?.intent === "remove"
              ? "Remove your own role on this folder? You will no longer see the folder."
              : `Change your own role on this folder to ${confirming ? ROLE_LABELS[confirming.role] : ""}? ` +
                "Unless you stay Owner, you can no longer give, change or remove roles on it."}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)}>Cancel</Button>
          <Button onClick={confirm} variant="contained" color="error" disabled={locked}>
            {confirming?.intent === "remove" ? "Remove my role" : "Change my role"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
