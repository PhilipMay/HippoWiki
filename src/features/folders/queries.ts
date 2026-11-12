// The reads of folders and tabs for Server Components: thin adapters on top of the service.

import { connection } from "next/server";
import { cache } from "react";

import * as folderService from "@/features/folders/service";

// Every query starts with `connection()`: without a request-time API, Next.js would prerender the calling route at
// build time and serve a stale snapshot of the database.

/** All folders, by name. */
export async function listFolders(): Promise<folderService.FolderSummary[]> {
  await connection();
  return folderService.listFolders();
}

/**
 * The folder with the given name, or `null` if the name is malformed or no such folder exists. Cached per request, so
 * that `generateMetadata` and the page component share one query.
 */
export const getFolderByName = cache(async (name: string): Promise<folderService.Folder | null> => {
  await connection();
  return folderService.getFolderByName(name);
});

/** The tabs of the folder, by name. */
export async function listTabs(folderId: string): Promise<folderService.TabSummary[]> {
  await connection();
  return folderService.listTabs(folderId);
}

/**
 * The tab with the given name in the folder with the given name, together with its folder, or `null` if a name is
 * malformed or no such tab exists. Cached per request, so that `generateMetadata` and the page component share one
 * query.
 */
export const getTab = cache(
  async (folderName: string, tabName: string): Promise<folderService.TabWithFolder | null> => {
    await connection();
    return folderService.getTab(folderName, tabName);
  },
);
