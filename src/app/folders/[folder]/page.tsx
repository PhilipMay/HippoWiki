import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import { createTab, renameFolder } from "@/features/folders/actions";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import FolderContentsList from "@/features/folders/components/FolderContentsList";
import NameDialog from "@/features/folders/components/NameDialog";
import { getFolderByName, listTabs } from "@/features/folders/queries";
import { createPage } from "@/features/pages/actions";
import AllPagesList from "@/features/pages/components/AllPagesList";
import NewPageForm from "@/features/pages/components/NewPageForm";
import { listAllFolderPages, listFolderPages } from "@/features/pages/queries";
import { allPagesPath, deletedPagesPath, folderPath, parseAction, parseView, type SearchParams } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

/**
 * The actions of a folder address: `new` opens the editor for a new page, with the folder itself as the
 * preselected place, `rename` the "Rename folder" dialog and `new-tab` the "New tab" dialog.
 */
const ACTIONS = ["new", "rename", "new-tab"] as const;

/** The views of a folder address: `all` lists all pages of the folder, each with its tab. */
const VIEWS = ["all"] as const;

/**
 * The action and the view of the address, or `"invalid"` if either is not one of this address. A view has no actions,
 * so both together are invalid as well.
 */
function parseQuery(searchParams: SearchParams) {
  const action = parseAction(searchParams, ACTIONS);
  const view = parseView(searchParams, VIEWS);
  if (action === "invalid" || view === "invalid" || (action !== null && view !== null)) return "invalid";
  return { action, view };
}

export async function generateMetadata({ params, searchParams }: PageProps<"/folders/[folder]">): Promise<Metadata> {
  const folder = await getFolderByName((await params).folder);
  const query = parseQuery(await searchParams);
  if (!folder || query === "invalid") return { title: pageTitle() };
  if (query.action === "new") return { title: pageTitle("New page") };
  return { title: pageTitle(query.view === "all" ? `All pages – ${folder.name}` : folder.name) };
}

export default async function FolderPage({ params, searchParams }: PageProps<"/folders/[folder]">) {
  const folder = await getFolderByName((await params).folder);
  if (!folder) notFound();

  const query = parseQuery(await searchParams);
  if (query === "invalid") notFound();
  const { action, view } = query;

  if (action === "new") {
    return (
      <Stack spacing={3}>
        <Typography variant="h4" component="h1">
          New page
        </Typography>
        <NewPageForm
          action={createPage.bind(null, folder.id)}
          folderName={folder.name}
          tabs={await listTabs(folder.id)}
          tabName={null}
          initialTabId={null}
        />
      </Stack>
    );
  }

  const address = folderPath(folder.name);

  if (view === "all") {
    return (
      <Stack spacing={3}>
        <FolderBreadcrumbs folderName={folder.name} current="All pages" />
        <Typography variant="h4" component="h1">
          All pages
        </Typography>
        <AllPagesList pages={await listAllFolderPages(folder.id)} folderName={folder.name} />
      </Stack>
    );
  }

  const [pages, tabs] = await Promise.all([listFolderPages(folder.id), listTabs(folder.id)]);

  return (
    <Stack spacing={3}>
      {/* The buttons move below the heading and wrap on narrow screens instead of overflowing. */}
      <Stack
        direction="row"
        useFlexGap
        sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}
      >
        <Typography variant="h4" component="h1" sx={{ overflowWrap: "anywhere" }}>
          {folder.name}
        </Typography>
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 2 }}>
          <Button component={Link} href={folderPath(folder.name, "rename")} variant="outlined">
            Rename
          </Button>
          <Button component={Link} href={allPagesPath(folder.name)} variant="outlined">
            All pages
          </Button>
          <Button component={Link} href={deletedPagesPath(folder.name)} variant="outlined">
            Deleted pages
          </Button>
          <Button component={Link} href={folderPath(folder.name, "new-tab")} variant="outlined">
            New tab
          </Button>
          <Button component={Link} href={folderPath(folder.name, "new")} variant="contained">
            New page
          </Button>
        </Stack>
      </Stack>
      <FolderContentsList folderName={folder.name} pages={pages} tabs={tabs} />
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
