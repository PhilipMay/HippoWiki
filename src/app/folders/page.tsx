import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import { createFolder } from "@/features/folders/actions";
import FolderList from "@/features/folders/components/FolderList";
import NameDialog from "@/features/folders/components/NameDialog";
import { listFolders } from "@/features/folders/queries";
import { foldersPath, parseAction } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle("Folders"),
};

/** The actions of the folder list: `new` opens the "New folder" dialog. */
const ACTIONS = ["new"] as const;

export default async function FoldersPage({ searchParams }: PageProps<"/folders">) {
  const action = parseAction(await searchParams, ACTIONS);
  if (action === "invalid") notFound();

  const folders = await listFolders();

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h4" component="h1">
          Folders
        </Typography>
        <Button component={Link} href={foldersPath("new")} variant="contained">
          New folder
        </Button>
      </Stack>
      <FolderList folders={folders} />
      {action === "new" && <NameDialog title="New folder" action={createFolder} closeHref={foldersPath()} />}
    </Stack>
  );
}
