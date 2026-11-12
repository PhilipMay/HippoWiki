import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import type { FolderSummary } from "@/features/folders/service";
import { folderPath } from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";

/** The list of folders, each linking to its folder, or an empty state when there are none. */
export default function FolderList({ folders }: { folders: FolderSummary[] }) {
  if (folders.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6" component="p" gutterBottom>
          No folders yet
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Folders you create will be listed here. Start with “New folder”.
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
                    Updated <time dateTime={folder.updatedAt.toISOString()}>{formatDateTime(folder.updatedAt)}</time>
                  </>
                }
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
