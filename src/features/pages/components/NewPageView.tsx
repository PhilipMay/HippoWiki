import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { notFound } from "next/navigation";

import { listTabs } from "@/features/folders/queries";
import { getUploadSettings, listAllFolderFiles } from "@/features/files/queries";
import { createPage } from "@/features/pages/actions";
import NewPageForm from "@/features/pages/components/NewPageForm";
import { buildEditorPageList } from "@/features/pages/editor-page-list";
import { listAllFolderPages } from "@/features/pages/queries";

type NewPageViewProps = {
  folder: { id: string; name: string };
  /** The tab the editor was opened for, or `null` for the folder itself: the place the "Save page" dialog preselects. */
  tab: { id: string; name: string } | null;
  /** The name the "Save page" dialog proposes instead of the one derived from the title, or `null` for none. */
  presetName: string | null;
};

/**
 * The editor for a new page, opened with `?action=new` at a folder or a tab address, and with `name` from a link to a
 * page that does not exist yet.
 */
export default async function NewPageView({ folder, tab, presetName }: NewPageViewProps) {
  const [tabs, pages, files, uploads] = await Promise.all([
    listTabs(folder.id),
    listAllFolderPages(folder.id),
    listAllFolderFiles(folder.id),
    getUploadSettings(),
  ]);
  if (!tabs || !pages || !files) notFound();

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        New page
      </Typography>
      <NewPageForm
        action={createPage.bind(null, folder.id)}
        folderName={folder.name}
        tabs={tabs}
        tab={tab && { id: tab.id, name: tab.name }}
        presetName={presetName}
        // Only a Writer, Manager or Owner opens the editor of a new page, and each of them may upload files.
        pageList={buildEditorPageList(folder.name, pages, tabs, files, uploads.on)}
      />
    </Stack>
  );
}
