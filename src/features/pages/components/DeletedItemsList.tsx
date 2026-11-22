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
import type { DeletedFileSummary } from "@/features/files/service";
import { FILE_TYPES } from "@/features/files/types";
import type { DeletedPageSummary } from "@/features/pages/service";
import type { LastEditor } from "@/features/users/records";
import { deletedItemPath } from "@/lib/addresses";

/** A deleted page or file as the list shows it: what it is, its name, its title or type, and its deletion. */
type DeletedItem = {
  id: string;
  kind: "Page" | "File";
  name: string;
  /** The title of a page, the type of a file. */
  description: string;
  deletedAt: Date;
  lastEditedBy: LastEditor;
};

/**
 * The deleted pages and files of a folder in one list, newest first; items deleted at the same moment, such as the
 * pages and files of a deleted tab, keep the order of their reads, pages before files.
 */
export function deletedItemsOf(pages: DeletedPageSummary[], files: DeletedFileSummary[]): DeletedItem[] {
  const items: DeletedItem[] = [
    ...pages.map((page) => ({ ...page, kind: "Page" as const, description: page.title })),
    ...files.map((file) => ({ ...file, kind: "File" as const, description: FILE_TYPES[file.type].label })),
  ];
  // A stable sort, so that items deleted at the same moment keep their order.
  return items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}

type DeletedItemsListProps = {
  /** The deleted pages and files of the folder, in display order (`deletedItemsOf()`). */
  items: DeletedItem[];
  folderName: string;
};

/**
 * The deleted items of a folder: each marked as a page or a file, with its name, which links to the deleted item, the
 * title of a page or the type of a file, and its time of deletion; or an empty state when the folder has none. Where
 * in the folder an item was is not known.
 */
export default function DeletedItemsList({ items, folderName }: DeletedItemsListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No deleted items"
        text="Pages and files you delete in this folder will be listed here, where you can restore them."
      />
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table aria-label="Deleted items">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Kind</TableCell>
            <TableCell>Title or type</TableCell>
            <TableCell>Deleted</TableCell>
            <TableCell>Deleted by</TableCell>
            <TableCell>Via</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell sx={{ overflowWrap: "anywhere" }}>
                {/* A deleted page has no `.md` address, so its name is shown without the suffix. */}
                <MuiLink component={Link} href={deletedItemPath(folderName, item.id)}>
                  {item.name}
                </MuiLink>
              </TableCell>
              <TableCell>{item.kind}</TableCell>
              <TableCell sx={{ overflowWrap: "anywhere" }}>{item.description}</TableCell>
              <TableCell sx={{ whiteSpace: "nowrap" }}>
                <Time date={item.deletedAt} />
              </TableCell>
              <TableCell sx={{ overflowWrap: "anywhere" }}>{item.lastEditedBy.name}</TableCell>
              <TableCell>{item.lastEditedBy.via}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
