// The reads of users for Server Components: thin adapters on top of the service.

import { connection } from "next/server";

import { requireUser } from "@/features/auth/session";
import * as userService from "@/features/users/service";

// Every query starts with `connection()`: without a request-time API, Next.js would prerender the calling route at
// build time and serve a stale snapshot of the database. Then it calls `requireUser()`, which redirects to the login
// page without a logged-in user, and passes that user to the service as the actor: the service decides what the user
// may see.

/** All users, by name, as the logged-in user sees them. */
export async function listUsers(): Promise<userService.UserList> {
  await connection();
  const user = await requireUser();
  return userService.listUsers(user);
}
