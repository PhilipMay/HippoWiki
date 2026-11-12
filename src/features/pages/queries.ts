// The reads of pages for Server Components: thin adapters on top of the service.

import { connection } from "next/server";
import { cache } from "react";

import { requireUser } from "@/features/auth/session";
import * as pageService from "@/features/pages/service";

// Every query starts with `connection()`: without a request-time API, Next.js would prerender the calling route at
// build time and serve a stale snapshot of the database. Then it calls `requireUser()`, which redirects to the login
// page without a logged-in user: nothing is read without a login, whoever calls the query.

/** The pages placed directly in the folder, without their content, by name; deleted pages are left out. */
export async function listFolderPages(folderId: string): Promise<pageService.PageSummary[]> {
  await connection();
  await requireUser();
  return pageService.listFolderPages(folderId);
}

/** The pages of the tab, without their content, by name; deleted pages are left out. */
export async function listTabPages(tabId: string): Promise<pageService.PageSummary[]> {
  await connection();
  await requireUser();
  return pageService.listTabPages(tabId);
}

/**
 * All pages of the folder, without their content, each with its tab: by name and then by tab, pages placed directly
 * in the folder first. Deleted pages are left out.
 */
export async function listAllFolderPages(folderId: string): Promise<pageService.PageWithTabSummary[]> {
  await connection();
  await requireUser();
  return pageService.listAllFolderPages(folderId);
}

/**
 * The page with the given name in the given tab of the folder or, with `tabName` `null`, placed directly in the
 * folder, together with its folder and tab. `null` if a name is malformed or no such page exists there; a deleted page
 * has no address, so it is never found. Cached per request, so that `generateMetadata` and the page component share
 * one query.
 */
export const getPage = cache(
  async (folderName: string, tabName: string | null, pageName: string): Promise<pageService.PageWithPlace | null> => {
    await connection();
    await requireUser();
    return pageService.getPage(folderName, tabName, pageName);
  },
);

/** The deleted pages of the folder with id, name, title and time of deletion, without their content, newest first. */
export async function listDeletedPages(folderId: string): Promise<pageService.DeletedPageSummary[]> {
  await connection();
  await requireUser();
  return pageService.listDeletedPages(folderId);
}

/**
 * The deleted page with the given id in the folder with the given name, together with its folder. `null` if the name
 * or the id is malformed, the page belongs to another folder or is not deleted. Cached per request, so that
 * `generateMetadata` and the page component share one query.
 */
export const getDeletedPage = cache(async (folderName: string, id: string): Promise<pageService.DeletedPage | null> => {
  await connection();
  await requireUser();
  return pageService.getDeletedPage(folderName, id);
});
