import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import type { PageWithTabSummary } from "@/features/pages/queries";
import { pagePath } from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";

type AllPagesListProps = {
  /** All pages of the folder, in display order. */
  pages: PageWithTabSummary[];
  folderName: string;
};

/**
 * All pages of a folder at once: each with its name, which links to the page, its tab if it has one, its title and
 * its last update; or an empty state when the folder has no pages at all.
 */
export default function AllPagesList({ pages, folderName }: AllPagesListProps) {
  if (pages.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6" component="p" gutterBottom>
          No pages yet
        </Typography>
        <Typography variant="body2" color="text.secondary">
          This folder has no pages, neither placed directly in it nor in its tabs.
        </Typography>
      </Paper>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table aria-label="All pages">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Tab</TableCell>
            <TableCell>Title</TableCell>
            <TableCell>Last update</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {pages.map((page) => (
            <TableRow key={page.id}>
              <TableCell sx={{ overflowWrap: "anywhere" }}>
                <MuiLink component={Link} href={pagePath(folderName, page.tab?.name ?? null, page.name)}>
                  {page.name}.md
                </MuiLink>
              </TableCell>
              {/* A page placed directly in the folder has no tab. */}
              <TableCell sx={{ overflowWrap: "anywhere" }}>{page.tab?.name ?? "–"}</TableCell>
              <TableCell sx={{ overflowWrap: "anywhere" }}>{page.title}</TableCell>
              <TableCell sx={{ whiteSpace: "nowrap" }}>
                <time dateTime={page.updatedAt.toISOString()}>{formatDateTime(page.updatedAt)}</time>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
