import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import { ROLE_LABELS } from "@/features/folder-roles/roles";
import type { FolderSummary } from "@/features/folders/service";
import { folderPath } from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";

/**
 * The list of the folders the user has a role on, each linking to its folder and naming the user's role on it, or a
 * hint when the user has no role on any folder.
 */
export default function FolderList({ folders }: { folders: FolderSummary[] }) {
  if (folders.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6" component="p" gutterBottom>
          No folders yet
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Create a folder with “New folder”, or ask an Owner of a folder to give you a role on it.
        </Typography>
      </Paper>
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
                    Updated <time dateTime={folder.updatedAt.toISOString()}>{formatDateTime(folder.updatedAt)}</time> by{" "}
                    {folder.lastEditedBy.name}
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
