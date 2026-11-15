import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { listAllFolderRoles } from "@/features/folder-roles/queries";
import { ROLE_LABELS } from "@/features/folder-roles/roles";
import { parseAction, parseView } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle("Folder roles"),
};

/**
 * The overview of an admin: every folder by name with who has which role on it, and nothing else of the content. It
 * only shows the roles: it has no actions, no views and no controls. For a user it does not exist.
 */
export default async function FolderRolesPage({ searchParams }: PageProps<"/folder-roles">) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  await requireUser();

  // `null` for a user: the overview would show folders without a role of the user.
  const folders = (await listAllFolderRoles()) ?? notFound();

  const query = await searchParams;
  if (parseAction(query, []) !== null || parseView(query) !== null) notFound();

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        Folder roles
      </Typography>
      {folders.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography variant="h6" component="p">
            No folders yet
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined">
          <Table aria-label="Folder roles">
            <TableHead>
              <TableRow>
                <TableCell>Folder</TableCell>
                <TableCell>Roles</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {folders.map((folder) => (
                <TableRow key={folder.id}>
                  <TableCell component="th" scope="row" sx={{ overflowWrap: "anywhere" }}>
                    {folder.name}
                  </TableCell>
                  <TableCell>
                    {folder.roles.length === 0
                      ? "Nobody"
                      : folder.roles.map(({ user, role }) => `${user.name} (${ROLE_LABELS[role]})`).join(", ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
