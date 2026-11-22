import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
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

import CopyField from "@/components/CopyField";
import HeadingWithActions from "@/components/HeadingWithActions";
import Link from "@/components/Link";
import Time from "@/components/Time";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import { listTabs } from "@/features/folders/queries";
import { deleteFile, moveOrRenameFile, revertFile } from "@/features/files/actions";
import DeleteFileDialog from "@/features/files/components/DeleteFileDialog";
import MoveOrRenameFileDialog from "@/features/files/components/MoveOrRenameFileDialog";
import RevertFileDialog from "@/features/files/components/RevertFileDialog";
import UploadVersionDialog from "@/features/files/components/UploadVersionDialog";
import { mayDoFileAction, type FileAction } from "@/features/files/file-query";
import type { FileWithPlace, UploadSettings } from "@/features/files/service";
import { FILE_TYPES, isImageType, type FileType } from "@/features/files/types";
import { changedMessage } from "@/features/pages/changed-page";
import LinkedFrom from "@/features/pages/components/LinkedFrom";
import { listPagesLinkingToFile } from "@/features/pages/queries";
import SearchField from "@/features/search/components/SearchField";
import { editorWithChannel } from "@/features/users/records";
import { fileContentPath, filePath, fileRevertPath, type PageNotice } from "@/lib/addresses";
import { formatBytes, formatDateTime } from "@/lib/format";

/** The most width a preview of an image takes, as the text of a page does. */
const PREVIEW_MAX_WIDTH = "100%";

/**
 * The link to copy into a page: `![[…]]`, which shows an image, or `[[…]]`, which links a PDF, with the name and, for
 * a file in a tab, the tab before it, as the wiki links of the folder name it.
 */
function linkToCopy(file: FileWithPlace): string {
  const target = file.tab ? `${file.tab.name}/${file.name}` : file.name;
  return isImageType(file.type) ? `![[${target}]]` : `[[${target}]]`;
}

/** What the file field of "Upload new version" accepts: the extensions and the MIME type of the type of the file. */
function acceptOf(type: FileType): string {
  const { extension, mimeType } = FILE_TYPES[type];
  return type === "jpeg" ? `.jpg,.jpeg,${mimeType}` : `.${extension},${mimeType}`;
}

/** Where the file lives, as a sentence. */
function placeOf(file: FileWithPlace): string {
  return file.tab
    ? `In the tab ${file.tab.name} of the folder ${file.folder.name}`
    : `Directly in the folder ${file.folder.name}`;
}

type FileDetailsViewProps = {
  file: FileWithPlace;
  /** The action of the address, already checked against the role, with the version of a revert and the notice. */
  action: FileAction | null;
  version: number | null;
  notice: PageNotice | null;
  /** Whether files can be uploaded, and their size limit. */
  uploads: UploadSettings;
};

/**
 * The details page of a file: its place, a preview of an image, its type, size, width and height, the number of its
 * versions and its last change, "Open" and "Download", "Move or rename", "Delete" and "Upload new version" for
 * the roles that may, the link to copy,
 * the pages that show or link it, and its versions, newest first, each with a link that opens it and, but for the
 * current one, "Revert" for the roles that may; with the dialog of the action on top.
 */
export default async function FileDetailsView({ file, action, version, notice, uploads }: FileDetailsViewProps) {
  const linkingPages = (await listPagesLinkingToFile(file.id)) ?? notFound();
  // Only the "Move or rename file" dialog needs the tabs of the folder.
  const tabs = action === "move-or-rename" ? ((await listTabs(file.folder.id)) ?? notFound()) : [];
  const folder = file.folder.name;
  const tab = file.tab?.name ?? null;
  const [current] = file.versions;
  const image = isImageType(file.type);
  const address = fileContentPath(folder, tab, file.name);
  const detailsHref = filePath(folder, tab, file.name);
  const mayRevert = mayDoFileAction(file.role, "revert");
  const reverted = version === null ? undefined : file.versions.find(({ number }) => number === version);

  const details: [string, ReactNode][] = [
    ["Place", placeOf(file)],
    ["Type", FILE_TYPES[file.type].label],
    ["Size", formatBytes(current.size)],
    ...(image && current.width !== null && current.height !== null
      ? [["Width and height", `${current.width} × ${current.height} pixels`] as [string, string]]
      : []),
    ["Versions", String(file.versions.length)],
    [
      "Last change",
      <>
        <Time date={file.updatedAt} /> by {editorWithChannel(file.lastEditedBy)}
      </>,
    ],
  ];

  return (
    <Stack spacing={3}>
      {/* The search field is left out while a dialog is open, so that a search never discards what was entered. */}
      {action === null && <SearchField folderName={folder} />}
      <FolderBreadcrumbs folderName={folder} tabName={tab} current={file.name} />
      <HeadingWithActions title={file.name}>
        <Button component="a" href={address} target="_blank" rel="noopener noreferrer" variant="outlined">
          Open
        </Button>
        <Button component="a" href={fileContentPath(folder, tab, file.name, { download: true })} variant="outlined">
          Download
        </Button>
        {mayDoFileAction(file.role, "move-or-rename") && (
          <Button component={Link} href={filePath(folder, tab, file.name, "move-or-rename")} variant="outlined">
            Move or rename
          </Button>
        )}
        {mayDoFileAction(file.role, "delete") && (
          <Button component={Link} href={filePath(folder, tab, file.name, "delete")} variant="outlined">
            Delete
          </Button>
        )}
        {uploads.on && mayDoFileAction(file.role, "upload-version") && (
          <Button component={Link} href={filePath(folder, tab, file.name, "upload-version")} variant="contained">
            Upload new version
          </Button>
        )}
      </HeadingWithActions>

      {image && (
        <Box
          component="img"
          src={address}
          alt={file.name}
          width={current.width ?? undefined}
          height={current.height ?? undefined}
          sx={{ display: "block", maxWidth: PREVIEW_MAX_WIDTH, height: "auto", alignSelf: "flex-start" }}
        />
      )}

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

      <CopyField label="Link" value={linkToCopy(file)} />

      <LinkedFrom
        folderName={folder}
        pages={linkingPages}
        heading="Shown or linked from"
        emptyText="No page shows or links this file."
      />

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
                {mayRevert && <TableCell>Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {file.versions.map((entry) => (
                <TableRow key={entry.number}>
                  <TableCell>
                    <MuiLink
                      href={fileContentPath(folder, tab, file.name, { version: entry.number })}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {`Version ${entry.number}`}
                    </MuiLink>
                    {entry.revertedTo !== null && ` (reverted to version ${entry.revertedTo})`}
                  </TableCell>
                  <TableCell>
                    <Time date={entry.createdAt} />
                  </TableCell>
                  <TableCell>{entry.uploadedBy.name}</TableCell>
                  <TableCell>{entry.uploadedBy.via}</TableCell>
                  <TableCell>{formatBytes(entry.size)}</TableCell>
                  {mayRevert && (
                    <TableCell>
                      {/* A revert to the current version would change nothing, so it is not offered. */}
                      {entry.number !== current.number && (
                        <MuiLink
                          component={Link}
                          href={fileRevertPath(folder, tab, file.name, entry.number)}
                          aria-label={`Revert to version ${entry.number}`}
                        >
                          Revert
                        </MuiLink>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Stack>

      {action === "upload-version" && (
        <UploadVersionDialog
          folderName={folder}
          tabName={tab}
          fileName={file.name}
          typeLabel={FILE_TYPES[file.type].label}
          accept={acceptOf(file.type)}
          image={image}
          lockVersion={file.lockVersion}
          sizeLimit={uploads.sizeLimit}
          closeHref={detailsHref}
        />
      )}
      {action === "move-or-rename" && (
        <MoveOrRenameFileDialog
          // A new key after a refused move starts the dialog anew with the file as it is now.
          key={`${file.lockVersion}-${notice ?? ""}`}
          action={moveOrRenameFile.bind(null, file.id)}
          folderName={folder}
          tabs={tabs}
          currentTabId={file.tab?.id ?? null}
          initialName={file.name}
          linkingPages={linkingPages.length}
          lockVersion={file.lockVersion}
          changedMessage={notice === "changed" ? changedMessage(file, "file") : undefined}
          closeHref={detailsHref}
        />
      )}
      {action === "delete" && (
        <DeleteFileDialog
          key={`${file.lockVersion}-${notice ?? ""}`}
          action={deleteFile.bind(null, file.id)}
          fileName={file.name}
          linkingPages={linkingPages.length}
          lockVersion={file.lockVersion}
          changedMessage={notice === "changed" ? changedMessage(file, "file") : undefined}
          closeHref={detailsHref}
        />
      )}
      {action === "revert" && reverted && (
        <RevertFileDialog
          // A new key after a refused revert starts the dialog anew with the file as it is now.
          key={`${file.lockVersion}-${notice ?? ""}`}
          action={revertFile.bind(null, file.id, reverted.number)}
          versionLabel={`version ${reverted.number} of ${formatDateTime(reverted.createdAt)} by ${reverted.uploadedBy.name} via ${reverted.uploadedBy.via}`}
          lockVersion={file.lockVersion}
          changedMessage={notice === "changed" ? changedMessage(file, "file") : undefined}
          closeHref={detailsHref}
        />
      )}
    </Stack>
  );
}
