import FolderIcon from "@mui/icons-material/Folder";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";

import Link from "@/components/Link";
import type { TabSummary } from "@/features/folders/queries";
import { tabPath } from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";

type TabListProps = {
  folderName: string;
  /** The tabs of the folder, in display order. */
  tabs: TabSummary[];
};

/**
 * The tabs of a folder as a list of folders, each with a folder icon and linking to its tab. It renders nothing for a
 * folder without tabs.
 */
export default function TabList({ folderName, tabs }: TabListProps) {
  if (tabs.length === 0) return null;

  return (
    <Paper variant="outlined">
      <List disablePadding aria-label="Tabs">
        {tabs.map((tab, index) => (
          <ListItem key={tab.id} disablePadding divider={index < tabs.length - 1}>
            <ListItemButton component={Link} href={tabPath(folderName, tab.name)}>
              <ListItemIcon>
                {/* Decorative: the text names the tab. Material UI icons are hidden from assistive technology. */}
                <FolderIcon />
              </ListItemIcon>
              <ListItemText
                primary={tab.name}
                secondary={
                  <>
                    Updated <time dateTime={tab.updatedAt.toISOString()}>{formatDateTime(tab.updatedAt)}</time>
                  </>
                }
                sx={{ overflowWrap: "anywhere" }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
