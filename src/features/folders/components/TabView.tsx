import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { notFound } from "next/navigation";

import HeadingWithActions from "@/components/HeadingWithActions";
import Link from "@/components/Link";
import { deleteTab, renameTab } from "@/features/folders/actions";
import DeleteTabDialog from "@/features/folders/components/DeleteTabDialog";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import NameDialog from "@/features/folders/components/NameDialog";
import { mayDoTabAction, type TabAction } from "@/features/folders/folder-query";
import { checkUploadName } from "@/features/files/actions";
import FileList from "@/features/files/components/FileList";
import UploadFileDialog from "@/features/files/components/UploadFileDialog";
import { listTabFiles } from "@/features/files/queries";
import type { UploadSettings } from "@/features/files/service";
import type { TabWithFolder } from "@/features/folders/service";
import PageList from "@/features/pages/components/PageList";
import { countPagesLinkingIntoTab, listTabPages } from "@/features/pages/queries";
import SearchField from "@/features/search/components/SearchField";
import { folderPath, tabPath, uploadFilePath } from "@/lib/addresses";

type TabViewProps = {
  tab: TabWithFolder;
  /** The action of the address, already checked against the role; `new` has a view of its own. */
  action: Exclude<TabAction, "new"> | null;
  /** Whether files can be uploaded, and their size limit. */
  uploads: UploadSettings;
  /** The name of the file that the "Upload file" dialog proposes, from the address. */
  presetName: string | null;
};

/**
 * What a tab address shows: the pages of the tab, its files below them, the buttons the role includes, and the dialog
 * of the action on top.
 */
export default async function TabView({ tab, action, uploads, presetName }: TabViewProps) {
  const [pages, files] = await Promise.all([listTabPages(tab.id), listTabFiles(tab.id)]);
  if (!pages || !files) notFound();
  // The pages whose links a rename will update, as the folder holds them when the dialog is rendered.
  const linking = action === "rename" ? ((await countPagesLinkingIntoTab(tab.id)) ?? notFound()) : 0;
  const { folder, role } = tab;
  const address = tabPath(folder.name, tab.name);

  return (
    <Stack spacing={3}>
      {/* The search field is left out while a dialog is open, so that a search never discards what was entered. */}
      {action === null && <SearchField folderName={folder.name} />}
      <FolderBreadcrumbs folderName={folder.name} current={tab.name} />
      {/* Only what the role includes is offered. */}
      <HeadingWithActions title={tab.name}>
        {mayDoTabAction(role, "rename") && (
          <Button component={Link} href={tabPath(folder.name, tab.name, "rename")} variant="outlined">
            Rename
          </Button>
        )}
        {mayDoTabAction(role, "delete") && (
          <Button component={Link} href={tabPath(folder.name, tab.name, "delete")} variant="outlined">
            Delete
          </Button>
        )}
        {uploads.on && mayDoTabAction(role, "upload") && (
          <Button component={Link} href={uploadFilePath(folder.name, tab.name)} variant="outlined">
            Upload file
          </Button>
        )}
        {mayDoTabAction(role, "new") && (
          <Button component={Link} href={tabPath(folder.name, tab.name, "new")} variant="contained">
            New page
          </Button>
        )}
      </HeadingWithActions>
      <PageList pages={pages} folderName={folder.name} tabName={tab.name} />
      <FileList files={files} folderName={folder.name} tabName={tab.name} />
      {action === "rename" && (
        <NameDialog
          title="Rename tab"
          action={renameTab.bind(null, tab.id)}
          currentName={tab.name}
          closeHref={address}
          note={
            linking === 0
              ? "No page links into this tab."
              : `Links in ${linking} ${linking === 1 ? "page" : "pages"} will be updated.`
          }
        />
      )}
      {action === "upload" && (
        <UploadFileDialog
          folderName={folder.name}
          tabName={tab.name}
          presetName={presetName}
          sizeLimit={uploads.sizeLimit}
          checkName={checkUploadName.bind(null, folder.id, tab.id)}
          closeHref={address}
        />
      )}
      {action === "delete" && (
        <DeleteTabDialog
          action={deleteTab.bind(null, folder.id, tab.id)}
          tabName={tab.name}
          pageCount={pages.length}
          closeHref={address}
          folderHref={folderPath(folder.name)}
        />
      )}
    </Stack>
  );
}
