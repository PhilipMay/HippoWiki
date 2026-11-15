import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import { requireUser } from "@/features/auth/session";
import { createUser } from "@/features/users/actions";
import CreateUserDialog from "@/features/users/components/CreateUserDialog";
import UserList from "@/features/users/components/UserList";
import { listUsers } from "@/features/users/queries";
import { parseAction, parseView, usersPath } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle("Users"),
};

/** The actions of the user list: `create` opens the "New user" dialog. */
const ACTIONS = ["create"] as const;

/**
 * The user list, for every account. Only an admin gets the button "New user", its dialog and whose password change is
 * pending; for a user the address of the dialog is not found.
 */
export default async function UsersPage({ searchParams }: PageProps<"/users">) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  await requireUser();

  // The service decides what the user sees: the list of an admin carries the pending password changes.
  const list = await listUsers();
  const forAdmin = list.kind === "admin";

  const query = await searchParams;
  const action = parseAction(query, ACTIONS);
  // The user list has no views, and only an admin creates users.
  if (action === "invalid" || parseView(query) !== null || (action === "create" && !forAdmin)) notFound();

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h4" component="h1">
          Users
        </Typography>
        {forAdmin && (
          <Button component={Link} href={usersPath("create")} variant="contained">
            New user
          </Button>
        )}
      </Stack>
      <UserList users={list.users} />
      {action === "create" && <CreateUserDialog action={createUser} closeHref={usersPath()} />}
    </Stack>
  );
}
