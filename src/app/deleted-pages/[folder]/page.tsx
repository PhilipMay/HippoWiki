import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import { getFolderByName } from "@/features/folders/queries";
import DeletedPagesList from "@/features/pages/components/DeletedPagesList";
import { listDeletedPages } from "@/features/pages/queries";
import { parseAction, parseView, type SearchParams } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/deleted-pages/[folder]">;

/** The list of deleted pages has neither actions nor views. */
function hasQuery(searchParams: SearchParams): boolean {
  return parseAction(searchParams, []) !== null || parseView(searchParams) !== null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const folder = await getFolderByName((await params).folder);
  if (!folder || hasQuery(await searchParams)) return { title: pageTitle() };
  return { title: pageTitle(`Deleted pages – ${folder.name}`) };
}

/** The deleted pages of a folder, newest first. */
export default async function DeletedPagesPage({ params, searchParams }: Props) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  await requireUser();

  const folder = await getFolderByName((await params).folder);
  if (!folder || hasQuery(await searchParams)) notFound();

  return (
    <Stack spacing={3}>
      <FolderBreadcrumbs folderName={folder.name} current="Deleted pages" />
      <Typography variant="h4" component="h1">
        Deleted pages
      </Typography>
      <DeletedPagesList pages={await listDeletedPages(folder.id)} folderName={folder.name} />
    </Stack>
  );
}
