import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import Time from "@/components/Time";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import { mayDoFolderAction } from "@/features/folders/folder-query";
import { getUploadSettings, listAllFolderFiles } from "@/features/files/queries";
import { listTabs } from "@/features/folders/queries";
import { deletePage, moveOrRenamePage, updatePageContent } from "@/features/pages/actions";
import DeletePageDialog from "@/features/pages/components/DeletePageDialog";
import MarkdownContent from "@/features/pages/components/MarkdownContent";
import MoveOrRenamePageDialog from "@/features/pages/components/MoveOrRenamePageDialog";
import LinkedFrom from "@/features/pages/components/LinkedFrom";
import PageForm from "@/features/pages/components/PageForm";
import { buildEditorPageList } from "@/features/pages/editor-page-list";
import { countPagesLinkingTo, listAllFolderPages, listLinkingPages, resolveWikiLinks } from "@/features/pages/queries";
import type { PageWithPlace } from "@/features/pages/service";
import { editorWithChannel } from "@/features/users/records";
import { changedPageForm } from "@/features/pages/changed-page";
import { mayDoPageAction, type PageAction } from "@/features/pages/page-query";
import SearchField from "@/features/search/components/SearchField";
import { pageHistoryPath, pageLabel, pagePath, type PageNotice } from "@/lib/addresses";

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
  const { key: formKey, changedMessage: message } = changedPageForm(page, notice);

  if (action === "edit") {
    // The pages, files and tabs of the folder as of opening the editor, which its live preview resolves wiki links
    // against.
    const [pages, tabs, files, uploads] = await Promise.all([
      listAllFolderPages(page.folder.id),
      listTabs(page.folder.id),
      listAllFolderFiles(page.folder.id),
      getUploadSettings(),
    ]);
    if (!pages || !tabs || !files) notFound();
    const mayUpload = uploads.on && mayDoFolderAction(page.role, "upload");
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
          pageList={buildEditorPageList(folderName, pages, tabs, files, mayUpload)}
        />
      </Stack>
    );
  }

  // Only the "Move or rename page" dialog needs the tabs of the folder.
  const tabs = action === "move-or-rename" ? ((await listTabs(page.folder.id)) ?? notFound()) : [];
  // The pages whose links the move or rename will update, as the folder holds them when the dialog is rendered.
  const linkingCount = action === "move-or-rename" ? ((await countPagesLinkingTo(page.id)) ?? notFound()) : 0;
  const resolution = (await resolveWikiLinks(page.folder.id, page.content)) ?? notFound();
  const linkingPages = (await listLinkingPages(page.id)) ?? notFound();
  const uploads = await getUploadSettings();
  const links = {
    folderName,
    mayCreatePages: mayDoFolderAction(page.role, "new"),
    mayUploadFiles: uploads.on && mayDoFolderAction(page.role, "upload"),
    resolution,
  };

  return (
    <Stack spacing={2}>
      {/* The search field is left out while a dialog is open, so that a search never discards what was entered. */}
      {action === null && <SearchField folderName={folderName} />}
      <FolderBreadcrumbs folderName={folderName} tabName={tabName} current={pageLabel(page.name)} />
      <Paper component="article" variant="outlined" sx={{ p: { xs: 2, sm: 4 } }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Last updated <Time date={page.updatedAt} /> by {editorWithChannel(page.lastEditedBy)}
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
        <MarkdownContent links={links}>{page.content}</MarkdownContent>
      </Paper>
      <LinkedFrom folderName={folderName} pages={linkingPages} />
      {action === "move-or-rename" && (
        <MoveOrRenamePageDialog
          key={formKey}
          action={moveOrRenamePage.bind(null, page.id)}
          folderName={folderName}
          tabs={tabs}
          currentTabId={page.tab?.id ?? null}
          initialName={page.name}
          linkingPages={linkingCount}
          version={page.version}
          changedMessage={message}
          closeHref={address}
        />
      )}
      {action === "delete" && (
        <DeletePageDialog
          key={formKey}
          action={deletePage.bind(null, page.id)}
          pageLabel={pageLabel(page.name)}
          version={page.version}
          changedMessage={message}
          closeHref={address}
        />
      )}
    </Stack>
  );
}
