// The reads of folder roles for Server Components: thin adapters on top of the service.

import { connection } from "next/server";

import { requireUser } from "@/features/auth/session";
import * as folderRoleService from "@/features/folder-roles/service";

// Every query starts with `connection()`: without a request-time API, Next.js would prerender the calling route at
// build time and serve a stale snapshot of the database. Then it calls `requireUser()`, which redirects to the login
// page without a logged-in user, and passes that user to the service as the actor: the service decides what the user
// may see, and returns `null` where the user sees nothing, so that the routes show the not-found page.

/**
 * Every user with a role on the folder and the role, Owners first, then Managers, Writers and Readers, each group by
 * user name; `null` for an admin and for a user without a role on the folder.
 */
export async function listFolderRoles(folderId: string): Promise<folderRoleService.FolderRoleEntry[] | null> {
  await connection();
  const user = await requireUser();
  return folderRoleService.listFolderRoles(user, folderId);
}

/** Every user of the type user without a role on the folder, by name; `null` for anyone but an Owner of the folder. */
export async function listRoleCandidates(folderId: string): Promise<folderRoleService.RoleCandidate[] | null> {
  await connection();
  const user = await requireUser();
  return folderRoleService.listRoleCandidates(user, folderId);
}

/** Every folder by name with its users and their roles; `null` for a user, for whom the overview does not exist. */
export async function listAllFolderRoles(): Promise<folderRoleService.FolderRolesOverview[] | null> {
  await connection();
  const user = await requireUser();
  return folderRoleService.listAllFolderRoles(user);
}
