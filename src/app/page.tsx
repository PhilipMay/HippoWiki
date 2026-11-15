import { redirect } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { isAdmin } from "@/features/users/user-type";
import { foldersPath, usersPath } from "@/lib/addresses";

/** The home page is the list of folders for a user, and the user list for an admin, who sees no content. */
export default async function Home() {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  const user = await requireUser();

  redirect(isAdmin(user) ? usersPath() : foldersPath());
}
