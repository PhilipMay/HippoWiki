import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import { renameFolder } from "@/features/folders/actions";
import NameDialog from "@/features/folders/components/NameDialog";
import { getFolderByName } from "@/features/folders/queries";
import { createPage } from "@/features/pages/actions";
import NewPageForm from "@/features/pages/components/NewPageForm";
import PageList from "@/features/pages/components/PageList";
import { listFolderPages } from "@/features/pages/queries";
import { folderPath, parseAction } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

/** The actions of a folder address: `new` opens the editor for a new page, `rename` the "Rename folder" dialog. */
const ACTIONS = ["new", "rename"] as const;

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
        <NewPageForm action={createPage.bind(null, folder.id)} folderName={folder.name} />
      </Stack>
    );
  }

  const pages = await listFolderPages(folder.id);

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
      <PageList pages={pages} folderName={folder.name} />
      {action === "rename" && (
        <NameDialog
          title="Rename folder"
          action={renameFolder.bind(null, folder.id)}
          initialName={folder.name}
          closeHref={folderPath(folder.name)}
        />
      )}
    </Stack>
  );
}
