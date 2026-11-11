import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import NameDialog from "@/features/folders/components/NameDialog";
import { listTabs } from "@/features/folders/queries";
import { movePage, renamePage, updatePageContent } from "@/features/pages/actions";
import MarkdownContent from "@/features/pages/components/MarkdownContent";
import MovePageDialog from "@/features/pages/components/MovePageDialog";
import PageForm from "@/features/pages/components/PageForm";
import type { PageWithPlace } from "@/features/pages/queries";
import { pagePath } from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";

/**
 * The actions of a page address: `edit` opens the edit form, `rename` the "Rename page" dialog and `move` the "Move
 * page" dialog.
 */
export const PAGE_ACTIONS = ["edit", "rename", "move"] as const;

export type PageAction = (typeof PAGE_ACTIONS)[number];

/** The browser title of a page address with the given action. */
export function pageViewTitle(page: PageWithPlace, action: PageAction | null | "invalid"): string {
  return action === "edit" ? `Edit ${page.title}` : page.title;
}

type PageViewProps = {
  page: PageWithPlace;
  /** The action of the address, already checked. */
  action: PageAction | null;
};

/**
 * What a page address shows, for pages placed directly in a folder and for pages in a tab: the rendered page with its
 * breadcrumb, with the "Rename page" or "Move page" dialog on top for `rename` and `move`, or the edit form for
 * `edit`.
 */
export default async function PageView({ page, action }: PageViewProps) {
  const folderName = page.folder.name;
  const tabName = page.tab?.name ?? null;
  const address = pagePath(folderName, tabName, page.name);

  if (action === "edit") {
    return (
      <Stack spacing={3}>
        <Typography variant="h4" component="h1">
          Edit page
        </Typography>
        <PageForm action={updatePageContent.bind(null, page.id)} initialContent={page.content} cancelHref={address} />
      </Stack>
    );
  }

  // Only the "Move page" dialog needs the tabs of the folder.
  const tabs = action === "move" ? await listTabs(page.folder.id) : [];

  return (
    <Stack spacing={2}>
      <FolderBreadcrumbs folderName={folderName} tabName={tabName} current={`${page.name}.md`} />
      <Paper component="article" variant="outlined" sx={{ p: { xs: 2, sm: 4 } }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Last updated <time dateTime={page.updatedAt.toISOString()}>{formatDateTime(page.updatedAt)}</time>
          </Typography>
          <Stack direction="row" spacing={2} sx={{ pt: 1 }}>
            <Button component={Link} href={pagePath(folderName, tabName, page.name, "edit")} variant="outlined">
              Edit
            </Button>
            <Button component={Link} href={pagePath(folderName, tabName, page.name, "rename")} variant="outlined">
              Rename
            </Button>
            <Button component={Link} href={pagePath(folderName, tabName, page.name, "move")} variant="outlined">
              Move
            </Button>
          </Stack>
        </Stack>
        <Divider sx={{ mb: 3 }} />
        <MarkdownContent>{page.content}</MarkdownContent>
      </Paper>
      {action === "rename" && (
        <NameDialog
          title="Rename page"
          action={renamePage.bind(null, page.id)}
          initialName={page.name}
          closeHref={address}
        />
      )}
      {action === "move" && (
        <MovePageDialog
          action={movePage.bind(null, page.id)}
          tabs={tabs}
          currentTabId={page.tab?.id ?? null}
          closeHref={address}
        />
      )}
    </Stack>
  );
}
