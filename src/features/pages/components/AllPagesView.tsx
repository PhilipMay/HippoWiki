import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { notFound } from "next/navigation";

import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import AllPagesList from "@/features/pages/components/AllPagesList";
import { listAllFolderPages } from "@/features/pages/queries";
import SearchField from "@/features/search/components/SearchField";

/** The folder view "All pages": every page of the folder, each with its tab. */
export default async function AllPagesView({ folder }: { folder: { id: string; name: string } }) {
  const pages = (await listAllFolderPages(folder.id)) ?? notFound();

  return (
    <Stack spacing={3}>
      <SearchField folderName={folder.name} />
      <FolderBreadcrumbs folderName={folder.name} current="All pages" />
      <Typography variant="h4" component="h1">
        All pages
      </Typography>
      <AllPagesList pages={pages} folderName={folder.name} />
    </Stack>
  );
}
