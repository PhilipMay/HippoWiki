import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import UserList from "@/features/users/components/UserList";
import { listUsers } from "@/features/users/queries";
import { parseAction, parseView } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle("Users"),
};

/** The user list. Only the admin sees it; for every other user the address is not found. */
export default async function UsersPage({ searchParams }: PageProps<"/users">) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  await requireUser();

  // `null` for everyone but the admin: the service decides who may see the list.
  const users = await listUsers();
  if (!users) notFound();

  const query = await searchParams;
  // The user list has no actions and no views.
  if (parseAction(query, []) !== null || parseView(query) !== null) notFound();

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        Users
      </Typography>
      <UserList users={users} />
    </Stack>
  );
}
