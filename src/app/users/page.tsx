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

/** The user list. Only the admin sees it; for every other user the address is not found, with and without an action. */
export default async function UsersPage({ searchParams }: PageProps<"/users">) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  await requireUser();

  // `null` for everyone but the admin: the service decides who may see the list.
  const users = await listUsers();
  if (!users) notFound();

  const query = await searchParams;
  const action = parseAction(query, ACTIONS);
  // The user list has no views.
  if (action === "invalid" || parseView(query) !== null) notFound();

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h4" component="h1">
          Users
        </Typography>
        <Button component={Link} href={usersPath("create")} variant="contained">
          New user
        </Button>
      </Stack>
      <UserList users={users} />
      {action === "create" && <CreateUserDialog action={createUser} closeHref={usersPath()} />}
    </Stack>
  );
}
