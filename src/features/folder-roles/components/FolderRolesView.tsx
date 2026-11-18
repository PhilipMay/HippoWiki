import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import { mayDoFolderAction } from "@/features/folders/folder-query";
import { changeRole } from "@/features/folder-roles/actions";
import FolderRoleList from "@/features/folder-roles/components/FolderRoleList";
import { listFolderRoles } from "@/features/folder-roles/queries";
import type { Role } from "@/features/folder-roles/roles";
import { folderPath } from "@/lib/addresses";

type FolderRolesViewProps = {
  folder: { id: string; name: string; role: Role | null };
  /** The id of the logged-in user, whose own role the list marks. */
  userId: string;
};

/**
 * The folder view "Roles": who has which role on the folder. An Owner gets "Give role" and may change and remove the
 * roles in the list.
 */
export default async function FolderRolesView({ folder, userId }: FolderRolesViewProps) {
  const roles = (await listFolderRoles(folder.id)) ?? notFound();
  const manages = mayDoFolderAction(folder.role, "give-role");

  return (
    <Stack spacing={3}>
      <FolderBreadcrumbs folderName={folder.name} current="Roles" />
      <Typography variant="h4" component="h1">
        Roles
      </Typography>
      {manages && (
        <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
          <Button component={Link} href={folderPath(folder.name, "give-role")} variant="contained">
            Give role
          </Button>
        </Stack>
      )}
      <FolderRoleList
        roles={roles}
        manage={manages ? { action: changeRole.bind(null, folder.id), ownId: userId } : undefined}
      />
    </Stack>
  );
}
