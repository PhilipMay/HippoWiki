// The reads of folders and tabs for Server Components: thin adapters on top of the service.

import { connection } from "next/server";
import { cache } from "react";

import { requireUser } from "@/features/auth/session";
import { inBrowser } from "@/features/folder-roles/actors";
import * as folderService from "@/features/folders/service";

// Every query starts with `connection()`: without a request-time API, Next.js would prerender the calling route at
// build time and serve a stale snapshot of the database. Then it calls `requireUser()`, which redirects to the login
// page without a logged-in user: nothing is read without a login, whoever calls the query. That user is the actor of
// the service, with the channel `browser`, and the service decides what the user may see: an admin sees no content,
// and a user sees only the folders with a role on them, so every other read returns `null`, and the routes show the
// not-found page.

/** All folders the user sees, by name; `null` for an admin. */
export async function listFolders(): Promise<folderService.FolderSummary[] | null> {
  await connection();
  const user = await requireUser();
  return folderService.listFolders(inBrowser(user));
}

/**
 * The folder with the given name, or `null` if the name is malformed or no such folder exists. Cached per request, so
 * that `generateMetadata` and the page component share one query.
 */
export const getFolderByName = cache(async (name: string): Promise<folderService.FolderWithRole | null> => {
  await connection();
  const user = await requireUser();
  return folderService.getFolderByName(inBrowser(user), name);
});

/** The tabs of the folder, by name; `null` for an admin and for a folder without a role of the user. */
export async function listTabs(folderId: string): Promise<folderService.TabSummary[] | null> {
  await connection();
  const user = await requireUser();
  return folderService.listTabs(inBrowser(user), folderId);
}

/**
 * The tab with the given name in the folder with the given name, together with its folder, or `null` if a name is
 * malformed or no such tab exists. Cached per request, so that `generateMetadata` and the page component share one
 * query.
 */
export const getTab = cache(
  async (folderName: string, tabName: string): Promise<folderService.TabWithFolder | null> => {
    await connection();
    const user = await requireUser();
    return folderService.getTab(inBrowser(user), folderName, tabName);
  },
);
