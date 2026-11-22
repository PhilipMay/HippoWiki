// The reads of pages for Server Components: thin adapters on top of the service.

import { connection } from "next/server";
import { cache } from "react";

import { requireUser } from "@/features/auth/session";
import { inBrowser } from "@/features/folder-roles/actors";
import * as historyService from "@/features/pages/history-service";
import * as linksService from "@/features/pages/links-service";
import * as pageService from "@/features/pages/service";

// Every query starts with `connection()`: without a request-time API, Next.js would prerender the calling route at
// build time and serve a stale snapshot of the database. Then it calls `requireUser()`, which redirects to the login
// page without a logged-in user: nothing is read without a login, whoever calls the query. That user is the actor of
// the service, with the channel `browser`, and the service decides what the user may see: an admin sees no content,
// and a user sees only the folders with a role on them, so every other read returns `null`, and the routes show the
// not-found page.

/** The pages placed directly in the folder, without their content, by name; deleted pages are left out. */
export async function listFolderPages(folderId: string): Promise<pageService.PageSummary[] | null> {
  await connection();
  const user = await requireUser();
  return pageService.listFolderPages(inBrowser(user), folderId);
}

/** The pages of the tab, without their content, by name; deleted pages are left out. */
export async function listTabPages(tabId: string): Promise<pageService.PageSummary[] | null> {
  await connection();
  const user = await requireUser();
  return pageService.listTabPages(inBrowser(user), tabId);
}

/**
 * All pages of the folder, without their content, each with its tab: by name and then by tab, pages placed directly
 * in the folder first. Deleted pages are left out.
 */
export async function listAllFolderPages(folderId: string): Promise<pageService.PageWithTabSummary[] | null> {
  await connection();
  const user = await requireUser();
  return pageService.listAllFolderPages(inBrowser(user), folderId);
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
    const user = await requireUser();
    return pageService.getPage(inBrowser(user), folderName, tabName, pageName);
  },
);

/**
 * What the wiki links of the content lead to in the folder as it is now: the titles of the pages and the current
 * versions of the files they name, and the tabs that exist.
 */
export async function resolveWikiLinks(
  folderId: string,
  content: string,
): Promise<pageService.WikiLinkResolution | null> {
  await connection();
  const user = await requireUser();
  return pageService.resolveWikiLinks(inBrowser(user), folderId, content);
}

/** The pages of the folder that show or link the file, sorted by title; deleted pages are left out. */
export async function listPagesLinkingToFile(fileId: string): Promise<linksService.LinkingPage[] | null> {
  await connection();
  const user = await requireUser();
  return linksService.listPagesLinkingToFile(inBrowser(user), fileId);
}

/** The other pages of the folder that link to the page, sorted by title; deleted pages are left out. */
export async function listLinkingPages(pageId: string): Promise<linksService.LinkingPage[] | null> {
  await connection();
  const user = await requireUser();
  return linksService.listLinkingPages(inBrowser(user), pageId);
}

/** How many pages, the page itself included, hold a wiki link to the page and would be updated by its move. */
export async function countPagesLinkingTo(pageId: string): Promise<number | null> {
  await connection();
  const user = await requireUser();
  return linksService.countPagesLinkingTo(inBrowser(user), pageId);
}

/** How many pages hold a wiki link into the tab and would be updated by its rename. */
export async function countPagesLinkingIntoTab(tabId: string): Promise<number | null> {
  await connection();
  const user = await requireUser();
  return linksService.countPagesLinkingIntoTab(inBrowser(user), tabId);
}

/** The deleted pages of the folder with id, name, title and time of deletion, without their content, newest first. */
export async function listDeletedPages(folderId: string): Promise<pageService.DeletedPageSummary[] | null> {
  await connection();
  const user = await requireUser();
  return pageService.listDeletedPages(inBrowser(user), folderId);
}

/**
 * The revisions of the page with the given id, newest first, without their content: at most 100, those before the
 * revision `before` if it is given, and the number of the newest revision. `null` without the role for the history or
 * if there is no such page.
 */
export async function listPageRevisions(
  pageId: string,
  options: { before: number | null },
): Promise<historyService.PageRevisions | null> {
  await connection();
  const user = await requireUser();
  return historyService.listPageRevisions(inBrowser(user), pageId, options);
}

/**
 * The revision with the given number of the page with the given id, with its content, the number of the newest
 * revision and whether its content is the content of the page now. `null` without the role for the history, or if the
 * page or the revision does not exist.
 */
export async function getPageRevision(pageId: string, number: number): Promise<historyService.RevisionDetail | null> {
  await connection();
  const user = await requireUser();
  return historyService.getPageRevision(inBrowser(user), pageId, number);
}

/**
 * The two revisions with the given numbers of the page with the given id, with their content, ordered older to newer
 * whatever the order of the numbers, and the number of the newest revision. `null` without the role for the history,
 * or if the page or one of the revisions does not exist.
 */
export async function getRevisionComparison(
  pageId: string,
  a: number,
  b: number,
): Promise<historyService.RevisionComparison | null> {
  await connection();
  const user = await requireUser();
  return historyService.getRevisionComparison(inBrowser(user), pageId, a, b);
}

/**
 * The deleted page with the given id in the folder with the given name, together with its folder. `null` if the name
 * or the id is malformed, the page belongs to another folder or is not deleted. Cached per request, so that
 * `generateMetadata` and the page component share one query.
 */
export const getDeletedPage = cache(async (folderName: string, id: string): Promise<pageService.DeletedPage | null> => {
  await connection();
  const user = await requireUser();
  return pageService.getDeletedPage(inBrowser(user), folderName, id);
});
