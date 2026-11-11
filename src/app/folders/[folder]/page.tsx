import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import { renameFolder } from "@/features/folders/actions";
import NameDialog from "@/features/folders/components/NameDialog";
import { getFolderByName } from "@/features/folders/queries";
import { folderPath, parseAction } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

/** The actions of a folder address: `rename` opens the "Rename folder" dialog. */
const ACTIONS = ["rename"] as const;

export async function generateMetadata({ params }: PageProps<"/folders/[folder]">): Promise<Metadata> {
  const folder = await getFolderByName((await params).folder);
  return { title: pageTitle(folder?.name) };
}

export default async function FolderPage({ params, searchParams }: PageProps<"/folders/[folder]">) {
  const folder = await getFolderByName((await params).folder);
  if (!folder) notFound();

  const action = parseAction(await searchParams, ACTIONS);
  if (action === "invalid") notFound();

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h4" component="h1" sx={{ overflowWrap: "anywhere" }}>
          {folder.name}
        </Typography>
        <Button component={Link} href={folderPath(folder.name, "rename")} variant="outlined">
          Rename
        </Button>
      </Stack>
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6" component="p" gutterBottom>
          This folder is empty
        </Typography>
        <Typography variant="body2" color="text.secondary">
          The content of this folder will be listed here.
        </Typography>
      </Paper>
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
