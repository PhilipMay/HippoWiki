import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import EmptyState from "@/components/EmptyState";
import Link from "@/components/Link";
import Time from "@/components/Time";
import { ROLE_LABELS } from "@/features/folder-roles/roles";
import type { FolderSummary } from "@/features/folders/service";
import { editorWithChannel } from "@/features/users/records";
import { folderPath } from "@/lib/addresses";

/**
 * The list of the folders the user has a role on, each linking to its folder and naming the user's role on it, or a
 * hint when the user has no role on any folder.
 */
export default function FolderList({ folders }: { folders: FolderSummary[] }) {
  if (folders.length === 0) {
    return (
      <EmptyState
        title="No folders yet"
        text="Create a folder with “New folder”, or ask an Owner of a folder to give you a role on it."
      />
    );
  }

  return (
    <Paper variant="outlined">
      <List disablePadding aria-label="Folders">
        {folders.map((folder, index) => (
          <ListItem key={folder.id} disablePadding divider={index < folders.length - 1}>
            <ListItemButton component={Link} href={folderPath(folder.name)}>
              <ListItemText
                primary={folder.name}
                secondary={
                  <>
                    Updated <Time date={folder.updatedAt} /> by {editorWithChannel(folder.lastEditedBy)}
                  </>
                }
              />
              {folder.role && (
                <Typography variant="body2" color="text.secondary" sx={{ ml: 2, flexShrink: 0 }}>
                  {ROLE_LABELS[folder.role]}
                </Typography>
              )}
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
