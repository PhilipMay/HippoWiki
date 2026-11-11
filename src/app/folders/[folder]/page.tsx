import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import { createTab, renameFolder } from "@/features/folders/actions";
import FolderNav from "@/features/folders/components/FolderNav";
import NameDialog from "@/features/folders/components/NameDialog";
import { getFolderByName, listTabs } from "@/features/folders/queries";
import { createPage } from "@/features/pages/actions";
import NewPageForm from "@/features/pages/components/NewPageForm";
import PageList from "@/features/pages/components/PageList";
import { listFolderPages } from "@/features/pages/queries";
import { folderPath, parseAction } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

/**
 * The actions of a folder address: `new` opens the editor for a new page placed directly in the folder, `rename` the
 * "Rename folder" dialog and `new-tab` the "New tab" dialog.
 */
const ACTIONS = ["new", "rename", "new-tab"] as const;

export async function generateMetadata({ params, searchParams }: PageProps<"/folders/[folder]">): Promise<Metadata> {
  const folder = await getFolderByName((await params).folder);
  if (!folder) return { title: pageTitle() };
  const action = parseAction(await searchParams, ACTIONS);
  return { title: pageTitle(action === "new" ? "New page" : folder.name) };
}

export default async function FolderPage({ params, searchParams }: PageProps<"/folders/[folder]">) {
  const folder = await getFolderByName((await params).folder);
  if (!folder) notFound();

  const action = parseAction(await searchParams, ACTIONS);
  if (action === "invalid") notFound();

  if (action === "new") {
    return (
      <Stack spacing={3}>
        <Typography variant="h4" component="h1">
          New page
        </Typography>
        <NewPageForm action={createPage.bind(null, folder.id, null)} folderName={folder.name} tabName={null} />
      </Stack>
    );
  }

  const [tabs, pages] = await Promise.all([listTabs(folder.id), listFolderPages(folder.id)]);
  const address = folderPath(folder.name);

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h4" component="h1" sx={{ overflowWrap: "anywhere" }}>
          {folder.name}
        </Typography>
        <Stack direction="row" spacing={2} sx={{ flexShrink: 0 }}>
          <Button component={Link} href={folderPath(folder.name, "rename")} variant="outlined">
            Rename
          </Button>
          <Button component={Link} href={folderPath(folder.name, "new")} variant="contained">
            New page
          </Button>
        </Stack>
      </Stack>
      <FolderNav folderName={folder.name} tabs={tabs} current="folder" />
      <PageList pages={pages} folderName={folder.name} />
      {action === "rename" && (
        <NameDialog
          title="Rename folder"
          action={renameFolder.bind(null, folder.id)}
          initialName={folder.name}
          closeHref={address}
        />
      )}
      {action === "new-tab" && (
        <NameDialog title="New tab" action={createTab.bind(null, folder.id)} closeHref={address} />
      )}
    </Stack>
  );
}
