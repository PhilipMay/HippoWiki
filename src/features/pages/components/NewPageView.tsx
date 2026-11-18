import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { notFound } from "next/navigation";

import { listTabs } from "@/features/folders/queries";
import { createPage } from "@/features/pages/actions";
import NewPageForm from "@/features/pages/components/NewPageForm";

type NewPageViewProps = {
  folder: { id: string; name: string };
  /** The tab the editor was opened for, or `null` for the folder itself: the place the "Save page" dialog preselects. */
  tab: { id: string; name: string } | null;
};

/** The editor for a new page, opened with `?action=new` at a folder or a tab address. */
export default async function NewPageView({ folder, tab }: NewPageViewProps) {
  const tabs = (await listTabs(folder.id)) ?? notFound();

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
      />
    </Stack>
  );
}
