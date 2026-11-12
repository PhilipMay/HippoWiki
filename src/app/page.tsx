import { redirect } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { foldersPath } from "@/lib/addresses";

/** The home page is the list of folders. */
export default async function Home() {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  await requireUser();

  redirect(foldersPath());
}
