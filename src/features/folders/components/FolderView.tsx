import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { notFound } from "next/navigation";

import HeadingWithActions from "@/components/HeadingWithActions";
import Link from "@/components/Link";
import { createTab, renameFolder } from "@/features/folders/actions";
import FolderContentsList from "@/features/folders/components/FolderContentsList";
import NameDialog from "@/features/folders/components/NameDialog";
import { mayDoFolderAction, type FolderAction } from "@/features/folders/folder-query";
import { listTabs } from "@/features/folders/queries";
import { checkUploadName } from "@/features/files/actions";
import FileList from "@/features/files/components/FileList";
import UploadFileDialog from "@/features/files/components/UploadFileDialog";
import { listFolderFiles } from "@/features/files/queries";
import type { UploadSettings } from "@/features/files/service";
import { giveRole } from "@/features/folder-roles/actions";
import GiveRoleDialog from "@/features/folder-roles/components/GiveRoleDialog";
import { listRoleCandidates } from "@/features/folder-roles/queries";
import { mayDo, ROLE_LABELS, type Role } from "@/features/folder-roles/roles";
import { listFolderPages } from "@/features/pages/queries";
import SearchField from "@/features/search/components/SearchField";
import {
  allPagesPath,
  deletedItemsPath,
  folderMcpPath,
  folderPath,
  folderRolesPath,
  uploadFilePath,
} from "@/lib/addresses";

type FolderViewProps = {
  folder: { id: string; name: string; role: Role | null };
  /** The action of the address, already checked against the role; `new` has a view of its own. */
  action: Exclude<FolderAction, "new"> | null;
  /** Whether there is an MCP server, and with it the view "AI apps". */
  hasMcp: boolean;
  /** Whether files can be uploaded, and their size limit. */
  uploads: UploadSettings;
  /** The name of the file that the "Upload file" dialog proposes, from the address. */
  presetName: string | null;
};

/**
 * What a folder address shows without a view: the folder with its tabs and the pages placed directly in it, its files
 * below them, the buttons the role includes, and the dialog of the action on top.
 */
export default async function FolderView({ folder, action, hasMcp, uploads, presetName }: FolderViewProps) {
  const [pages, tabs, files] = await Promise.all([
    listFolderPages(folder.id),
    listTabs(folder.id),
    listFolderFiles(folder.id),
  ]);
  // `null` only for an admin, for whom the folder was not found already.
  if (!pages || !tabs || !files) notFound();
  const { role } = folder;
  const address = folderPath(folder.name);

  return (
    <Stack spacing={3}>
      {/* The search field is left out while a dialog is open, so that a search never discards what was entered. */}
      {action === null && <SearchField folderName={folder.name} />}
      {/* Only what the role includes is offered. */}
      <HeadingWithActions title={folder.name} subtitle={role && `Your role: ${ROLE_LABELS[role]}`}>
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
        {hasMcp && (
          <Button component={Link} href={folderMcpPath(folder.name)} variant="outlined">
            AI apps
          </Button>
        )}
        {/* The deleted items are an address of their own, with the role of its route. */}
        {mayDo(role, "deletedItems") && (
          <Button component={Link} href={deletedItemsPath(folder.name)} variant="outlined">
            Deleted items
          </Button>
        )}
        {uploads.on && mayDoFolderAction(role, "upload") && (
          <Button component={Link} href={uploadFilePath(folder.name, null)} variant="outlined">
            Upload file
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
      </HeadingWithActions>
      <FolderContentsList folderName={folder.name} pages={pages} tabs={tabs} />
      <FileList files={files} folderName={folder.name} />
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
      {action === "upload" && (
        <UploadFileDialog
          folderName={folder.name}
          tabName={null}
          presetName={presetName}
          sizeLimit={uploads.sizeLimit}
          checkName={checkUploadName.bind(null, folder.id, null)}
          closeHref={address}
        />
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
