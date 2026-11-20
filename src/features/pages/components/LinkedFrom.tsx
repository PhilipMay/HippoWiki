import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useId } from "react";

import Link from "@/components/Link";
import type { LinkingPage } from "@/features/pages/links-service";
import { pagePath } from "@/lib/addresses";

type LinkedFromProps = {
  folderName: string;
  /** The other pages of the folder that link to the page, sorted by title. */
  pages: LinkingPage[];
};

/**
 * The section "Linked from" below the content of a page: the title of each page that links to it as a link to that
 * page, with its tab, or a line that no page links here.
 */
export default function LinkedFrom({ folderName, pages }: LinkedFromProps) {
  const headingId = useId();
  return (
    <Paper component="section" variant="outlined" aria-labelledby={headingId} sx={{ p: { xs: 2, sm: 4 } }}>
      <Typography id={headingId} variant="h6" component="h2">
        Linked from
      </Typography>
      {pages.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          No page links here.
        </Typography>
      ) : (
        <List dense disablePadding sx={{ mt: 1 }}>
          {pages.map((page) => (
            <ListItem key={page.id} disableGutters sx={{ gap: 1, flexWrap: "wrap" }}>
              <MuiLink component={Link} href={pagePath(folderName, page.tab?.name ?? null, page.name)}>
                {page.title}
              </MuiLink>
              {/* A space of the text, so that the tab is read apart from the title; the gap of the line only shows it. */}
              {page.tab && " "}
              {page.tab && (
                <Typography component="span" variant="body2" color="text.secondary">
                  in {page.tab.name}
                </Typography>
              )}
            </ListItem>
          ))}
        </List>
      )}
    </Paper>
  );
}
