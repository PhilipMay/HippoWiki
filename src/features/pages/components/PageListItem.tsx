import DescriptionIcon from "@mui/icons-material/Description";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";

import Link from "@/components/Link";
import type { PageSummary } from "@/features/pages/service";
import { pagePath } from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";

type PageListItemProps = {
  page: PageSummary;
  /** Name of the folder the page lives in, for its address. */
  folderName: string;
  /** Name of the tab the page lives in, or `null` for a page placed directly in the folder. */
  tabName: string | null;
  /** Whether a divider separates the row from the next one. */
  divider: boolean;
};

/**
 * One row of a page list: a document icon, the page's title, its name and its last update, linking to the page.
 */
export default function PageListItem({ page, folderName, tabName, divider }: PageListItemProps) {
  return (
    <ListItem disablePadding divider={divider}>
      <ListItemButton component={Link} href={pagePath(folderName, tabName, page.name)}>
        <ListItemIcon>
          {/* Decorative: the text names the page. Material UI icons are hidden from assistive technology. */}
          <DescriptionIcon />
        </ListItemIcon>
        <ListItemText
          primary={page.title}
          secondary={
            <>
              {page.name}.md · Updated{" "}
              <time dateTime={page.updatedAt.toISOString()}>{formatDateTime(page.updatedAt)}</time> by{" "}
              {page.lastEditedBy.name}
            </>
          }
          slotProps={{ primary: { sx: { overflowWrap: "anywhere" } } }}
        />
      </ListItemButton>
    </ListItem>
  );
}
