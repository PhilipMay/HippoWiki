import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import { requireUser } from "@/features/auth/session";
import { createTab, renameFolder } from "@/features/folders/actions";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import FolderContentsList from "@/features/folders/components/FolderContentsList";
import NameDialog from "@/features/folders/components/NameDialog";
import { getFolderByName, listTabs } from "@/features/folders/queries";
import { giveRole } from "@/features/folder-roles/actions";
import FolderRoleList from "@/features/folder-roles/components/FolderRoleList";
import GiveRoleDialog from "@/features/folder-roles/components/GiveRoleDialog";
import { listFolderRoles, listRoleCandidates } from "@/features/folder-roles/queries";
import { mayDo, ROLE_LABELS, type FolderFunction } from "@/features/folder-roles/roles";
import { createPage } from "@/features/pages/actions";
import AllPagesList from "@/features/pages/components/AllPagesList";
import NewPageForm from "@/features/pages/components/NewPageForm";
import { listAllFolderPages, listFolderPages } from "@/features/pages/queries";
import {
  allPagesPath,
  deletedPagesPath,
  folderPath,
  folderRolesPath,
  parseAction,
  parseView,
  type SearchParams,
} from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

/**
 * The actions of a folder address: `new` opens the editor for a new page, with the folder itself as the
 * preselected place, `rename` the "Rename folder" dialog, `new-tab` the "New tab" dialog and `give-role` the "Give
 * role" dialog.
 */
const ACTIONS = ["new", "rename", "new-tab", "give-role"] as const;

/** The function of each action, whose lowest role the user needs; an action beyond the role does not exist. */
const ACTION_FUNCTIONS: Record<(typeof ACTIONS)[number], FolderFunction> = {
  new: "editPage",
  rename: "renameFolder",
  "new-tab": "editTab",
  "give-role": "manageRoles",
};

/**
 * The views of a folder address: `all` lists all pages of the folder, each with its tab, `roles` who has which role on
 * the folder. Every role may see both.
 */
const VIEWS = ["all", "roles"] as const;

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
  if (query.view === "all") return { title: pageTitle(`All pages – ${folder.name}`) };
  if (query.view === "roles") return { title: pageTitle(`Roles – ${folder.name}`) };
  return { title: pageTitle(folder.name) };
}

export default async function FolderPage({ params, searchParams }: PageProps<"/folders/[folder]">) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  await requireUser();

  const folder = await getFolderByName((await params).folder);
  if (!folder) notFound();

  const query = parseQuery(await searchParams);
  if (query === "invalid") notFound();
  const { action, view } = query;
  // An action that the role does not include answers like an unknown one, before the content is read.
  if (action !== null && !mayDo(folder.role, ACTION_FUNCTIONS[action])) notFound();
  const { role } = folder;

  if (action === "new") {
    return (
      <Stack spacing={3}>
        <Typography variant="h4" component="h1">
          New page
        </Typography>
        <NewPageForm
          action={createPage.bind(null, folder.id)}
          folderName={folder.name}
          tabs={(await listTabs(folder.id)) ?? notFound()}
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
        <AllPagesList pages={(await listAllFolderPages(folder.id)) ?? notFound()} folderName={folder.name} />
      </Stack>
    );
  }

  if (view === "roles") {
    return (
      <Stack spacing={3}>
        <FolderBreadcrumbs folderName={folder.name} current="Roles" />
        <Typography variant="h4" component="h1">
          Roles
        </Typography>
        {mayDo(role, "manageRoles") && (
          <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
            <Button component={Link} href={folderPath(folder.name, "give-role")} variant="contained">
              Give role
            </Button>
          </Stack>
        )}
        <FolderRoleList roles={(await listFolderRoles(folder.id)) ?? notFound()} />
      </Stack>
    );
  }

  const [pages, tabs] = await Promise.all([listFolderPages(folder.id), listTabs(folder.id)]);
  // `null` only for an admin, for whom the folder was not found already.
  if (!pages || !tabs) notFound();

  return (
    <Stack spacing={3}>
      {/* The buttons move below the heading and wrap on narrow screens instead of overflowing. */}
      <Stack
        direction="row"
        useFlexGap
        sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}
      >
        <Stack spacing={0.5} sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h1" sx={{ overflowWrap: "anywhere" }}>
            {folder.name}
          </Typography>
          {role && (
            <Typography variant="body2" color="text.secondary">
              Your role: {ROLE_LABELS[role]}
            </Typography>
          )}
        </Stack>
        {/* Only what the role includes is offered. */}
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 2 }}>
          {mayDo(role, "renameFolder") && (
            <Button component={Link} href={folderPath(folder.name, "rename")} variant="outlined">
              Rename
            </Button>
          )}
          <Button component={Link} href={allPagesPath(folder.name)} variant="outlined">
            All pages
          </Button>
          <Button component={Link} href={folderRolesPath(folder.name)} variant="outlined">
            Roles
          </Button>
          {mayDo(role, "deletedPages") && (
            <Button component={Link} href={deletedPagesPath(folder.name)} variant="outlined">
              Deleted pages
            </Button>
          )}
          {mayDo(role, "editTab") && (
            <Button component={Link} href={folderPath(folder.name, "new-tab")} variant="outlined">
              New tab
            </Button>
          )}
          {mayDo(role, "editPage") && (
            <Button component={Link} href={folderPath(folder.name, "new")} variant="contained">
              New page
            </Button>
          )}
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
      {action === "give-role" && (
        <GiveRoleDialog
          action={giveRole.bind(null, folder.id)}
          candidates={(await listRoleCandidates(folder.id)) ?? notFound()}
          closeHref={address}
        />
      )}
    </Stack>
  );
}
