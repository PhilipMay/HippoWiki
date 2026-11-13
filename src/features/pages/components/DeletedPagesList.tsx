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
import type { DeletedPageSummary } from "@/features/pages/service";
import { deletedPagePath } from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";

type DeletedPagesListProps = {
  /** The deleted pages of the folder, in display order. */
  pages: DeletedPageSummary[];
  folderName: string;
};

/**
 * The deleted pages of a folder: each with its name, which links to the deleted page, its title and its time of
 * deletion; or an empty state when the folder has no deleted pages. Where in the folder a page was is not known.
 */
export default function DeletedPagesList({ pages, folderName }: DeletedPagesListProps) {
  if (pages.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6" component="p" gutterBottom>
          No deleted pages
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Pages you delete in this folder will be listed here, where you can restore them.
        </Typography>
      </Paper>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table aria-label="Deleted pages">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Title</TableCell>
            <TableCell>Deleted</TableCell>
            <TableCell>Deleted by</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {pages.map((page) => (
            <TableRow key={page.id}>
              <TableCell sx={{ overflowWrap: "anywhere" }}>
                {/* A deleted page has no `.md` address, so its name is shown without the suffix. */}
                <MuiLink component={Link} href={deletedPagePath(folderName, page.id)}>
                  {page.name}
                </MuiLink>
              </TableCell>
              <TableCell sx={{ overflowWrap: "anywhere" }}>{page.title}</TableCell>
              <TableCell sx={{ whiteSpace: "nowrap" }}>
                <time dateTime={page.deletedAt.toISOString()}>{formatDateTime(page.deletedAt)}</time>
              </TableCell>
              <TableCell sx={{ overflowWrap: "anywhere" }}>{page.lastEditedBy.name}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
