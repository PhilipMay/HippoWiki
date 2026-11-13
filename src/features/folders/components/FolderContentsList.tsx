import FolderIcon from "@mui/icons-material/Folder";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import type { TabSummary } from "@/features/folders/service";
import PageListItem from "@/features/pages/components/PageListItem";
import type { PageSummary } from "@/features/pages/service";
import { tabPath } from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";

type FolderContentsListProps = {
  folderName: string;
  /** The pages placed directly in the folder, in display order. */
  pages: PageSummary[];
  /** The tabs of the folder, in display order. */
  tabs: TabSummary[];
};

/**
 * The contents of a folder in one list: first the pages placed directly in it, each with a document icon, then its
 * tabs, each with a folder icon, all linking to their addresses. An empty state when the folder has neither pages nor
 * tabs.
 */
export default function FolderContentsList({ folderName, pages, tabs }: FolderContentsListProps) {
  if (pages.length === 0 && tabs.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6" component="p" gutterBottom>
          This folder is empty
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Create a page with “New page” or a tab with “New tab”.
        </Typography>
      </Paper>
    );
  }

  const lastIndex = pages.length + tabs.length - 1;

  return (
    <Paper variant="outlined">
      <List disablePadding aria-label="Contents">
        {pages.map((page, index) => (
          <PageListItem key={page.id} page={page} folderName={folderName} tabName={null} divider={index < lastIndex} />
        ))}
        {tabs.map((tab, index) => (
          <ListItem key={tab.id} disablePadding divider={pages.length + index < lastIndex}>
            <ListItemButton component={Link} href={tabPath(folderName, tab.name)}>
              <ListItemIcon>
                {/* Decorative: the text names the tab. Material UI icons are hidden from assistive technology. */}
                <FolderIcon />
              </ListItemIcon>
              <ListItemText
                primary={tab.name}
                secondary={
                  <>
                    Updated <time dateTime={tab.updatedAt.toISOString()}>{formatDateTime(tab.updatedAt)}</time> by{" "}
                    {tab.lastEditedBy.name}
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
