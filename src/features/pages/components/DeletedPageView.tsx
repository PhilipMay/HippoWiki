import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import MarkdownContent from "@/features/pages/components/MarkdownContent";
import type { DeletedPage } from "@/features/pages/queries";
import { formatDateTime } from "@/lib/format";

/** The browser title of a deleted page: it shows that the page is a deleted copy. */
export function deletedPageViewTitle(page: DeletedPage): string {
  return `Deleted: ${page.title}`;
}

type DeletedPageViewProps = {
  page: DeletedPage;
};

/**
 * What the address of a deleted page shows: the rendered page, read-only, with its breadcrumb through the folder's
 * deleted pages and its time of deletion. A deleted page has no `.md` address, so its name is shown without it.
 */
export default function DeletedPageView({ page }: DeletedPageViewProps) {
  return (
    <Stack spacing={2}>
      <FolderBreadcrumbs folderName={page.folder.name} deletedPages current={page.name} />
      <Paper component="article" variant="outlined" sx={{ p: { xs: 2, sm: 4 } }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Deleted <time dateTime={page.deletedAt.toISOString()}>{formatDateTime(page.deletedAt)}</time>
          </Typography>
        </Stack>
        <Divider sx={{ mb: 3 }} />
        <MarkdownContent>{page.content}</MarkdownContent>
      </Paper>
    </Stack>
  );
}
