import FolderIcon from "@mui/icons-material/Folder";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";

import EmptyState from "@/components/EmptyState";
import Link from "@/components/Link";
import Time from "@/components/Time";
import type { TabSummary } from "@/features/folders/service";
import PageListItem from "@/features/pages/components/PageListItem";
import type { PageSummary } from "@/features/pages/service";
import { editorWithChannel } from "@/features/users/records";
import { tabPath } from "@/lib/addresses";

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
    return <EmptyState title="This folder is empty" text="Create a page with “New page” or a tab with “New tab”." />;
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
                    Updated <Time date={tab.updatedAt} /> by {editorWithChannel(tab.lastEditedBy)}
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
