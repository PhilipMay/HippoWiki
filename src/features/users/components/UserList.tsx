import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";

import Time from "@/components/Time";
import type { UserListEntry, UserSummary } from "@/features/users/service";
import { USER_TYPE_LABELS } from "@/features/users/user-type";

/**
 * The list of all users, by name: each with its type and the time it was created. Entries that carry the pending
 * password change, which only an admin gets, show a mark while the user still has to change the first password. There
 * is always at least one account, the one looking at the list, so the list has no empty state.
 */
export default function UserList({ users }: { users: UserListEntry[] | UserSummary[] }) {
  return (
    <Paper variant="outlined">
      <List disablePadding aria-label="Users">
        {users.map((user, index) => (
          <ListItem
            key={user.id}
            divider={index < users.length - 1}
            secondaryAction={
              "mustChangePassword" in user &&
              user.mustChangePassword && <Chip label="Password change pending" size="small" variant="outlined" />
            }
          >
            <ListItemText
              primary={user.name}
              secondary={
                <>
                  {USER_TYPE_LABELS[user.type]} · Created <Time date={user.createdAt} />
                </>
              }
            />
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
