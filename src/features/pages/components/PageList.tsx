import List from "@mui/material/List";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import PageListItem from "@/features/pages/components/PageListItem";
import type { PageSummary } from "@/features/pages/queries";

type PageListProps = {
  /** The pages to list, in display order. */
  pages: PageSummary[];
  /** Name of the folder the pages live in, for their addresses. */
  folderName: string;
  /** Name of the tab the pages live in, or `null` for pages placed directly in the folder. */
  tabName?: string | null;
};

/**
 * The pages placed directly in a folder or the pages of a tab, each with its title, its name and its last update and
 * linking to its page, or an empty state when there are none.
 */
export default function PageList({ pages, folderName, tabName = null }: PageListProps) {
  if (pages.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6" component="p" gutterBottom>
          No pages yet
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Pages you create here will be listed. Start with “New page”.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined">
      <List disablePadding aria-label="Pages">
        {pages.map((page, index) => (
          <PageListItem
            key={page.id}
            page={page}
            folderName={folderName}
            tabName={tabName}
            divider={index < pages.length - 1}
          />
        ))}
      </List>
    </Paper>
  );
}
