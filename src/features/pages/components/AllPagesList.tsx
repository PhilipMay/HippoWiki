import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";

import EmptyState from "@/components/EmptyState";
import Link from "@/components/Link";
import Time from "@/components/Time";
import type { PageWithTabSummary } from "@/features/pages/service";
import { pageLabel, pagePath } from "@/lib/addresses";

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
      <EmptyState
        title="No pages yet"
        text="This folder has no pages, neither placed directly in it nor in its tabs."
      />
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
            <TableCell>Updated by</TableCell>
            <TableCell>Via</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {pages.map((page) => (
            <TableRow key={page.id}>
              <TableCell sx={{ overflowWrap: "anywhere" }}>
                <MuiLink component={Link} href={pagePath(folderName, page.tab?.name ?? null, page.name)}>
                  {pageLabel(page.name)}
                </MuiLink>
              </TableCell>
              {/* A page placed directly in the folder has no tab. */}
              <TableCell sx={{ overflowWrap: "anywhere" }}>{page.tab?.name ?? "–"}</TableCell>
              <TableCell sx={{ overflowWrap: "anywhere" }}>{page.title}</TableCell>
              <TableCell sx={{ whiteSpace: "nowrap" }}>
                <Time date={page.updatedAt} />
              </TableCell>
              <TableCell sx={{ overflowWrap: "anywhere" }}>{page.lastEditedBy.name}</TableCell>
              <TableCell>{page.lastEditedBy.via}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
