import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";

import { ROLE_LABELS } from "@/features/folder-roles/roles";
import type { FolderRoleEntry } from "@/features/folder-roles/service";

/**
 * Who has which role on a folder, in the order the service returns them: Owners first, then Managers, Writers and
 * Readers. Whoever looks at it has a role on the folder, so the list is never empty.
 */
export default function FolderRoleList({ roles }: { roles: FolderRoleEntry[] }) {
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
