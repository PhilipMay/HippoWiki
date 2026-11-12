import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import { listTabs } from "@/features/folders/queries";
import { restorePage } from "@/features/pages/actions";
import MarkdownContent from "@/features/pages/components/MarkdownContent";
import RestorePageDialog from "@/features/pages/components/RestorePageDialog";
import type { DeletedPage } from "@/features/pages/service";
import { deletedPagePath } from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";

/** The actions of the address of a deleted page: `restore` opens the "Restore page" dialog. */
export const DELETED_PAGE_ACTIONS = ["restore"] as const;

export type DeletedPageAction = (typeof DELETED_PAGE_ACTIONS)[number];

/** The browser title of a deleted page: it shows that the page is a deleted copy. */
export function deletedPageViewTitle(page: DeletedPage): string {
  return `Deleted: ${page.title}`;
}

type DeletedPageViewProps = {
  page: DeletedPage;
  /** The action of the address, already checked. */
  action: DeletedPageAction | null;
};

/**
 * What the address of a deleted page shows: the rendered page, read-only, with its breadcrumb through the folder's
 * deleted pages, its time of deletion and a "Restore" button; with the "Restore page" dialog on top for `restore`. A
 * deleted page has no `.md` address, so its name is shown without it.
 */
export default async function DeletedPageView({ page, action }: DeletedPageViewProps) {
  const folderName = page.folder.name;
  // Only the "Restore page" dialog needs the tabs of the folder.
  const tabs = action === "restore" ? await listTabs(page.folder.id) : [];

  return (
    <Stack spacing={2}>
      <FolderBreadcrumbs folderName={folderName} deletedPages current={page.name} />
      <Paper component="article" variant="outlined" sx={{ p: { xs: 2, sm: 4 } }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Deleted <time dateTime={page.deletedAt.toISOString()}>{formatDateTime(page.deletedAt)}</time>
          </Typography>
          <Stack direction="row" spacing={2} sx={{ pt: 1 }}>
            <Button component={Link} href={deletedPagePath(folderName, page.id, "restore")} variant="outlined">
              Restore
            </Button>
          </Stack>
        </Stack>
        <Divider sx={{ mb: 3 }} />
        <MarkdownContent>{page.content}</MarkdownContent>
      </Paper>
      {action === "restore" && (
        <RestorePageDialog
          action={restorePage.bind(null, page.id)}
          folderName={folderName}
          tabs={tabs}
          initialName={page.name}
          closeHref={deletedPagePath(folderName, page.id)}
        />
      )}
    </Stack>
  );
}
