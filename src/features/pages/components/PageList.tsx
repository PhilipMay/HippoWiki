import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import type { PageSummary } from "@/features/pages/queries";
import { formatDateTime } from "@/lib/format";

/** The list of pages, each linking to its page view, or an empty state when there are none. */
export default function PageList({ pages }: { pages: PageSummary[] }) {
  if (pages.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6" component="p" gutterBottom>
          No pages yet
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Pages you create will be listed here. Start with “New page”.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined">
      <List disablePadding aria-label="Pages">
        {pages.map((page, index) => (
          <ListItem key={page.id} disablePadding divider={index < pages.length - 1}>
            <ListItemButton component={Link} href={`/pages/${page.id}`}>
              <ListItemText
                primary={page.title}
                secondary={
                  <>
                    Updated <time dateTime={page.updatedAt.toISOString()}>{formatDateTime(page.updatedAt)}</time>
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
