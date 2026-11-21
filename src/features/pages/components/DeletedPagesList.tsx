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
import type { DeletedPageSummary } from "@/features/pages/service";
import { deletedItemPath } from "@/lib/addresses";

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
      <EmptyState
        title="No deleted items"
        text="Pages you delete in this folder will be listed here, where you can restore them."
      />
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table aria-label="Deleted items">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Title</TableCell>
            <TableCell>Deleted</TableCell>
            <TableCell>Deleted by</TableCell>
            <TableCell>Via</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {pages.map((page) => (
            <TableRow key={page.id}>
              <TableCell sx={{ overflowWrap: "anywhere" }}>
                {/* A deleted page has no `.md` address, so its name is shown without the suffix. */}
                <MuiLink component={Link} href={deletedItemPath(folderName, page.id)}>
                  {page.name}
                </MuiLink>
              </TableCell>
              <TableCell sx={{ overflowWrap: "anywhere" }}>{page.title}</TableCell>
              <TableCell sx={{ whiteSpace: "nowrap" }}>
                <Time date={page.deletedAt} />
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
