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
import type { ReactNode } from "react";

import CopyField from "@/components/CopyField";
import HeadingWithActions from "@/components/HeadingWithActions";
import Time from "@/components/Time";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import type { FileWithPlace } from "@/features/files/service";
import { FILE_TYPES, isImageType } from "@/features/files/types";
import SearchField from "@/features/search/components/SearchField";
import { editorWithChannel } from "@/features/users/records";
import { fileContentPath } from "@/lib/addresses";
import { formatBytes } from "@/lib/format";

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

/** Where the file lives, as a sentence. */
function placeOf(file: FileWithPlace): string {
  return file.tab
    ? `In the tab ${file.tab.name} of the folder ${file.folder.name}`
    : `Directly in the folder ${file.folder.name}`;
}

/**
 * The details page of a file: its place, a preview of an image, its type, size, width and height, the number of its
 * versions and its last change, "Open" and "Download", the link to copy, and its versions, newest first, each with a
 * link that opens it.
 */
export default function FileDetailsView({ file }: { file: FileWithPlace }) {
  const folder = file.folder.name;
  const tab = file.tab?.name ?? null;
  const [current] = file.versions;
  const image = isImageType(file.type);
  const address = fileContentPath(folder, tab, file.name);

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
      <SearchField folderName={folder} />
      <FolderBreadcrumbs folderName={folder} tabName={tab} current={file.name} />
      <HeadingWithActions title={file.name}>
        <Button component="a" href={address} target="_blank" rel="noopener noreferrer" variant="outlined">
          Open
        </Button>
        <Button component="a" href={fileContentPath(folder, tab, file.name, { download: true })} variant="outlined">
          Download
        </Button>
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
              {file.versions.map((version) => (
                <TableRow key={version.number}>
                  <TableCell>
                    <MuiLink
                      href={fileContentPath(folder, tab, file.name, { version: version.number })}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {`Version ${version.number}`}
                    </MuiLink>
                    {version.revertedTo !== null && ` (reverted to version ${version.revertedTo})`}
                  </TableCell>
                  <TableCell>
                    <Time date={version.createdAt} />
                  </TableCell>
                  <TableCell>{version.uploadedBy.name}</TableCell>
                  <TableCell>{version.uploadedBy.via}</TableCell>
                  <TableCell>{formatBytes(version.size)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Stack>
    </Stack>
  );
}
