import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import { listTabs } from "@/features/folders/queries";
import { deletePage, moveOrRenamePage, updatePageContent } from "@/features/pages/actions";
import DeletePageDialog from "@/features/pages/components/DeletePageDialog";
import MarkdownContent from "@/features/pages/components/MarkdownContent";
import MoveOrRenamePageDialog from "@/features/pages/components/MoveOrRenamePageDialog";
import PageForm from "@/features/pages/components/PageForm";
import type { PageWithPlace } from "@/features/pages/service";
import { editorWithChannel } from "@/features/users/records";
import { mayDoPageAction, type PageAction } from "@/features/pages/page-query";
import { pagePath, pageHistoryPath, type PageNotice } from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";

/**
 * The message of the notice `changed`: who changed the page last, how and when, as the page view shows them. The editor or
 * dialog shows it after a change was refused, because the page was changed after it was opened.
 */
export function changedMessage(page: PageWithPlace): string {
  return `This page was changed by ${editorWithChannel(page.lastEditedBy)} at ${formatDateTime(page.updatedAt)} after you opened it.`;
}

type PageViewProps = {
  page: PageWithPlace;
  /** The action of the address, already checked. */
  action: PageAction | null;
  /** The notice of the address, already checked; only with an action. */
  notice: PageNotice | null;
};

/**
 * What a page address shows, for pages placed directly in a folder and for pages in a tab: the rendered page with its
 * breadcrumb, with the "Move or rename page" dialog on top for `move-or-rename` and the "Delete page" dialog for
 * `delete`, or the edit form for `edit`.
 */
export default async function PageView({ page, action, notice }: PageViewProps) {
  const folderName = page.folder.name;
  const tabName = page.tab?.name ?? null;
  const address = pagePath(folderName, tabName, page.name);
  const message = notice === "changed" ? changedMessage(page) : undefined;
  // A new key after a refused change starts the editor or dialog anew with the page as stored, instead of keeping the
  // input of the user: the version changes with every change of the page, the notice when no version was submitted.
  const formKey = `${page.version}-${notice ?? ""}`;

  if (action === "edit") {
    return (
      <Stack spacing={3}>
        <Typography variant="h4" component="h1">
          Edit page
        </Typography>
        <PageForm
          key={formKey}
          action={updatePageContent.bind(null, page.id)}
          initialContent={page.content}
          version={page.version}
          changedMessage={message}
          cancelHref={address}
        />
      </Stack>
    );
  }

  // Only the "Move or rename page" dialog needs the tabs of the folder.
  const tabs = action === "move-or-rename" ? ((await listTabs(page.folder.id)) ?? notFound()) : [];

  return (
    <Stack spacing={2}>
      <FolderBreadcrumbs folderName={folderName} tabName={tabName} current={`${page.name}.md`} />
      <Paper component="article" variant="outlined" sx={{ p: { xs: 2, sm: 4 } }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Last updated <time dateTime={page.updatedAt.toISOString()}>{formatDateTime(page.updatedAt)}</time> by{" "}
            {editorWithChannel(page.lastEditedBy)}
          </Typography>
          {/* Only what the role includes is offered; a Reader gets only "History". The buttons wrap on narrow screens. */}
          <Stack direction="row" useFlexGap sx={{ pt: 1, flexWrap: "wrap", gap: 2 }}>
            {mayDoPageAction(page.role, "edit") && (
              <Button component={Link} href={pagePath(folderName, tabName, page.name, "edit")} variant="outlined">
                Edit
              </Button>
            )}
            {mayDoPageAction(page.role, "move-or-rename") && (
              <Button
                component={Link}
                href={pagePath(folderName, tabName, page.name, "move-or-rename")}
                variant="outlined"
              >
                Move or rename
              </Button>
            )}
            {mayDoPageAction(page.role, "delete") && (
              <Button component={Link} href={pagePath(folderName, tabName, page.name, "delete")} variant="outlined">
                Delete
              </Button>
            )}
            <Button component={Link} href={pageHistoryPath(folderName, tabName, page.name)} variant="outlined">
              History
            </Button>
          </Stack>
        </Stack>
        <Divider sx={{ mb: 3 }} />
        <MarkdownContent>{page.content}</MarkdownContent>
      </Paper>
      {action === "move-or-rename" && (
        <MoveOrRenamePageDialog
          key={formKey}
          action={moveOrRenamePage.bind(null, page.id)}
          folderName={folderName}
          tabs={tabs}
          currentTabId={page.tab?.id ?? null}
          initialName={page.name}
          version={page.version}
          changedMessage={message}
          closeHref={address}
        />
      )}
      {action === "delete" && (
        <DeletePageDialog
          key={formKey}
          action={deletePage.bind(null, page.id)}
          pageLabel={`${page.name}.md`}
          version={page.version}
          changedMessage={message}
          closeHref={address}
        />
      )}
    </Stack>
  );
}
