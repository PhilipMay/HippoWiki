import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import Time from "@/components/Time";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import { listTabs } from "@/features/folders/queries";
import { restorePage } from "@/features/pages/actions";
import MarkdownContent from "@/features/pages/components/MarkdownContent";
import RestorePageDialog from "@/features/pages/components/RestorePageDialog";
import { resolveWikiLinks } from "@/features/pages/queries";
import type { DeletedPageAction } from "@/features/pages/page-query";
import type { DeletedPage } from "@/features/pages/service";
import { editorWithChannel } from "@/features/users/records";
import { deletedPageHistoryPath, deletedPagePath } from "@/lib/addresses";

type DeletedPageViewProps = {
  page: DeletedPage;
  /** The action of the address, already checked. */
  action: DeletedPageAction | null;
};

/**
 * What the address of a deleted page shows: the rendered page, read-only, with its breadcrumb through the folder's
 * deleted pages, its time of deletion and the buttons "Restore" and "History"; with the "Restore page" dialog on top
 * for `restore`. A deleted page has no `.md` address, so its name is shown without it.
 */
export default async function DeletedPageView({ page, action }: DeletedPageViewProps) {
  const folderName = page.folder.name;
  // Only the "Restore page" dialog needs the tabs of the folder.
  const tabs = action === "restore" ? ((await listTabs(page.folder.id)) ?? notFound()) : [];
  const resolution = (await resolveWikiLinks(page.folder.id, page.content)) ?? notFound();
  // Only a Manager or Owner reads a deleted page, and both may create pages.
  const links = { folderName, mayCreatePages: true, resolution };

  return (
    <Stack spacing={2}>
      <FolderBreadcrumbs folderName={folderName} deletedPages current={page.name} />
      <Paper component="article" variant="outlined" sx={{ p: { xs: 2, sm: 4 } }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Deleted <Time date={page.deletedAt} /> by {editorWithChannel(page.lastEditedBy)}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ pt: 1 }}>
            <Button component={Link} href={deletedPagePath(folderName, page.id, "restore")} variant="outlined">
              Restore
            </Button>
            <Button component={Link} href={deletedPageHistoryPath(folderName, page.id)} variant="outlined">
              History
            </Button>
          </Stack>
        </Stack>
        <Divider sx={{ mb: 3 }} />
        <MarkdownContent links={links}>{page.content}</MarkdownContent>
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
