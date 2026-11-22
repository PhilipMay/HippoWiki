import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import HeadingWithActions from "@/components/HeadingWithActions";
import Link from "@/components/Link";
import Time from "@/components/Time";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import { listTabs } from "@/features/folders/queries";
import { restoreFile } from "@/features/files/actions";
import type { DeletedFileAction } from "@/features/files/file-query";
import type { DeletedFile } from "@/features/files/service";
import { FILE_TYPES, isImageType } from "@/features/files/types";
import RestorePageDialog from "@/features/pages/components/RestorePageDialog";
import { editorWithChannel } from "@/features/users/records";
import { deletedItemPath } from "@/lib/addresses";
import { formatBytes } from "@/lib/format";

type DeletedFileViewProps = {
  file: DeletedFile;
  /** The action of the address, already checked. */
  action: DeletedFileAction | null;
};

/**
 * What the address of a deleted file shows: the file read-only, with its breadcrumb through the deleted items of its
 * folder, its type, size, width and height, the number of its versions, its time of deletion and its versions, none of
 * which opens, and "Restore" as its only action; with the "Restore file" dialog on top for `restore`. A deleted file
 * has no address that sends it, so it shows no preview.
 */
export default async function DeletedFileView({ file, action }: DeletedFileViewProps) {
  const folderName = file.folder.name;
  // Only the "Restore file" dialog needs the tabs of the folder.
  const tabs = action === "restore" ? ((await listTabs(file.folder.id)) ?? notFound()) : [];
  const [current] = file.versions;
  const address = deletedItemPath(folderName, file.id);

  const details: [string, ReactNode][] = [
    ["Type", FILE_TYPES[file.type].label],
    ["Size", formatBytes(current.size)],
    ...(isImageType(file.type) && current.width !== null && current.height !== null
      ? [["Width and height", `${current.width} × ${current.height} pixels`] as [string, string]]
      : []),
    ["Versions", String(file.versions.length)],
    [
      "Deleted",
      <>
        <Time date={file.deletedAt} /> by {editorWithChannel(file.lastEditedBy)}
      </>,
    ],
  ];

  return (
    <Stack spacing={3}>
      <FolderBreadcrumbs folderName={folderName} deletedItems current={file.name} />
      <HeadingWithActions title={file.name}>
        <Button component={Link} href={deletedItemPath(folderName, file.id, "restore")} variant="outlined">
          Restore
        </Button>
      </HeadingWithActions>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label="Details">
          <TableBody>
            {details.map(([label, value]) => (
              <TableRow key={label}>
                <TableCell component="th" scope="row" sx={{ width: "12rem" }}>
                  {label}
                </TableCell>
                <TableCell sx={{ overflowWrap: "anywhere" }}>{value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack component="section" spacing={1} aria-labelledby="versions-heading">
        <Typography id="versions-heading" variant="h6" component="h2">
          Versions
        </Typography>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="Versions">
            <TableHead>
              <TableRow>
                <TableCell>Version</TableCell>
                <TableCell>Uploaded</TableCell>
                <TableCell>By</TableCell>
                <TableCell>Via</TableCell>
                <TableCell>Size</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {file.versions.map((entry) => (
                <TableRow key={entry.number}>
                  <TableCell>
                    {`Version ${entry.number}`}
                    {entry.revertedTo !== null && ` (reverted to version ${entry.revertedTo})`}
                  </TableCell>
                  <TableCell>
                    <Time date={entry.createdAt} />
                  </TableCell>
                  <TableCell>{entry.uploadedBy.name}</TableCell>
                  <TableCell>{entry.uploadedBy.via}</TableCell>
                  <TableCell>{formatBytes(entry.size)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Stack>
      {action === "restore" && (
        <RestorePageDialog
          item="file"
          action={restoreFile.bind(null, file.id)}
          folderName={folderName}
          tabs={tabs}
          initialName={file.name}
          closeHref={address}
        />
      )}
    </Stack>
  );
}
