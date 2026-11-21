import ImageIcon from "@mui/icons-material/Image";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import Time from "@/components/Time";
import type { FileSummary } from "@/features/files/service";
import { FILE_TYPES, isImageType } from "@/features/files/types";
import { editorWithChannel } from "@/features/users/records";
import { filePath } from "@/lib/addresses";
import { formatBytes } from "@/lib/format";

type FileListProps = {
  /** The files to list, in display order. */
  files: FileSummary[];
  /** Name of the folder the files live in, for their addresses. */
  folderName: string;
  /** Name of the tab the files live in, or `null` for files placed directly in the folder. */
  tabName?: string | null;
};

/**
 * The section "Files" of a folder or a tab, below its pages: each file with its name, type, size and last change,
 * leading to its details page. Without files there is no section, so that a folder without files looks as before.
 */
export default function FileList({ files, folderName, tabName = null }: FileListProps) {
  if (files.length === 0) return null;

  return (
    <Stack component="section" spacing={1} aria-labelledby="files-heading">
      <Typography id="files-heading" variant="h6" component="h2">
        Files
      </Typography>
      <Paper variant="outlined">
        <List disablePadding aria-label="Files">
          {files.map((file, index) => (
            <ListItem key={file.id} disablePadding divider={index < files.length - 1}>
              <ListItemButton component={Link} href={filePath(folderName, tabName, file.name)}>
                <ListItemIcon>
                  {/* Decorative: the text names the file and its type. */}
                  {isImageType(file.type) ? <ImageIcon /> : <PictureAsPdfIcon />}
                </ListItemIcon>
                <ListItemText
                  primary={file.name}
                  secondary={
                    <>
                      {FILE_TYPES[file.type].label} · {formatBytes(file.size)} · Updated <Time date={file.updatedAt} />{" "}
                      by {editorWithChannel(file.lastEditedBy)}
                    </>
                  }
                  slotProps={{ primary: { sx: { overflowWrap: "anywhere" } } }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Paper>
    </Stack>
  );
}
