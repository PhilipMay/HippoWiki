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
import { folderAddressOf, mayDoFolderAction } from "@/features/folders/folder-query";
import { getFolderByName, listTabs } from "@/features/folders/queries";
import { changeRole, giveRole } from "@/features/folder-roles/actions";
import FolderRoleList from "@/features/folder-roles/components/FolderRoleList";
import GiveRoleDialog from "@/features/folder-roles/components/GiveRoleDialog";
import { listFolderRoles, listRoleCandidates } from "@/features/folder-roles/queries";
import { mayDo, MCP_ROLE_ABILITIES, ROLE_LABELS } from "@/features/folder-roles/roles";
import McpAddress from "@/features/mcp/components/McpAddress";
import { listMcpAddresses } from "@/features/mcp/queries";
import { createPage } from "@/features/pages/actions";
import AllPagesList from "@/features/pages/components/AllPagesList";
import NewPageForm from "@/features/pages/components/NewPageForm";
import { listAllFolderPages, listFolderPages } from "@/features/pages/queries";
import { allPagesPath, deletedPagesPath, folderMcpPath, folderPath, folderRolesPath } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/folders/[folder]">;

/**
 * What the address shows: the folder with its action or view and the browser title, or `null` for the not-found page
 * (see `folderAddressOf()`). The title and the page both use it. `mcpAddresses` is `null` without a public URL, when
 * there is no MCP server: no view and no button.
 */
async function resolve({ params, searchParams }: Props) {
  const folder = await getFolderByName((await params).folder);
  if (!folder) return null;
  const mcpAddresses = listMcpAddresses(folder, folder.role);
  const address = folderAddressOf(folder, await searchParams, mcpAddresses !== null);
  return address && { folder, mcpAddresses, ...address };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return { title: pageTitle((await resolve(props))?.title) };
}

export default async function FolderPage(props: Props) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  const user = await requireUser();

  // An action that the role does not include answers like an unknown one, before the content is read.
  const resolved = (await resolve(props)) ?? notFound();
  const { folder, mcpAddresses, action, view } = resolved;
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
        {mayDoFolderAction(role, "give-role") && (
          <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
            <Button component={Link} href={folderPath(folder.name, "give-role")} variant="contained">
              Give role
            </Button>
          </Stack>
        )}
        <FolderRoleList
          roles={(await listFolderRoles(folder.id)) ?? notFound()}
          manage={
            mayDoFolderAction(role, "give-role")
              ? { action: changeRole.bind(null, folder.id), ownId: user.id }
              : undefined
          }
        />
      </Stack>
    );
  }

  if (view === "mcp" && mcpAddresses) {
    return (
      <Stack spacing={3}>
        <FolderBreadcrumbs folderName={folder.name} current="AI apps" />
        <Typography variant="h4" component="h1">
          AI apps
        </Typography>
        <Typography>
          Copy an address into an AI app to connect it to this folder through MCP. The app asks you to approve the
          connection. It works only on this folder and never with more than your own role on it.
        </Typography>
        {mcpAddresses.map(({ role: mcpRole, address: mcpAddress }) => (
          <Stack key={mcpRole} component="section" spacing={1} aria-labelledby={`mcp-${mcpRole}`}>
            <Typography id={`mcp-${mcpRole}`} variant="h6" component="h2">
              {ROLE_LABELS[mcpRole]}
            </Typography>
            <Typography color="text.secondary">{MCP_ROLE_ABILITIES[mcpRole]}</Typography>
            <McpAddress address={mcpAddress} label={`${ROLE_LABELS[mcpRole]} address`} />
          </Stack>
        ))}
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
          {mayDoFolderAction(role, "rename") && (
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
          {mcpAddresses && (
            <Button component={Link} href={folderMcpPath(folder.name)} variant="outlined">
              AI apps
            </Button>
          )}
          {mayDo(role, "deletedPages") && (
            <Button component={Link} href={deletedPagesPath(folder.name)} variant="outlined">
              Deleted pages
            </Button>
          )}
          {mayDoFolderAction(role, "new-tab") && (
            <Button component={Link} href={folderPath(folder.name, "new-tab")} variant="outlined">
              New tab
            </Button>
          )}
          {mayDoFolderAction(role, "new") && (
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
          currentName={folder.name}
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
