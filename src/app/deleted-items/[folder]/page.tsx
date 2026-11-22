import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { mayDo } from "@/features/folder-roles/roles";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import { getFolderByName } from "@/features/folders/queries";
import { listDeletedFiles } from "@/features/files/queries";
import DeletedItemsList, { deletedItemsOf } from "@/features/pages/components/DeletedItemsList";
import { listDeletedPages } from "@/features/pages/queries";
import { hasSearchWords, parseAction, parseView, type SearchParams } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/deleted-items/[folder]">;

/** The list of deleted items has neither actions nor views, and deleted items are never searched. */
function hasQuery(searchParams: SearchParams): boolean {
  return parseAction(searchParams, []) !== null || parseView(searchParams) !== null || hasSearchWords(searchParams);
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const folder = await getFolderByName((await params).folder);
  if (!folder || !mayDo(folder.role, "deletedItems") || hasQuery(await searchParams)) return { title: pageTitle() };
  return { title: pageTitle(`Deleted items – ${folder.name}`) };
}

/** The deleted pages and files of a folder in one list, newest first. */
export default async function DeletedItemsPage({ params, searchParams }: Props) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  await requireUser();

  const folder = await getFolderByName((await params).folder);
  // Only a Manager or an Owner sees the deleted items; for any other role they do not exist.
  if (!folder || !mayDo(folder.role, "deletedItems") || hasQuery(await searchParams)) notFound();

  return (
    <Stack spacing={3}>
      <FolderBreadcrumbs folderName={folder.name} current="Deleted items" />
      <Typography variant="h4" component="h1">
        Deleted items
      </Typography>
      <DeletedItemsList
        items={deletedItemsOf(
          (await listDeletedPages(folder.id)) ?? notFound(),
          (await listDeletedFiles(folder.id)) ?? notFound(),
        )}
        folderName={folder.name}
      />
    </Stack>
  );
}
