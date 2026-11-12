import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";

import type { UserSummary } from "@/features/users/service";
import { formatDateTime } from "@/lib/format";

/**
 * The list of all users, by name: each with the time it was created and a mark while the user still has to change the
 * first password. There is always at least the admin, so the list has no empty state.
 */
export default function UserList({ users }: { users: UserSummary[] }) {
  return (
    <Paper variant="outlined">
      <List disablePadding aria-label="Users">
        {users.map((user, index) => (
          <ListItem
            key={user.id}
            divider={index < users.length - 1}
            secondaryAction={
              user.mustChangePassword && <Chip label="Password change pending" size="small" variant="outlined" />
            }
          >
            <ListItemText
              primary={user.name}
              secondary={
                <>
                  Created <time dateTime={user.createdAt.toISOString()}>{formatDateTime(user.createdAt)}</time>
                </>
              }
            />
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
