// The reads and writes of pages. The service knows nothing about Next.js, forms or addresses, so that the GUI (through
// `queries.ts` and `actions.ts`) and any other caller can use it, also outside a request. It trusts no caller: ids,
// names and input are parsed here again.

import { parseFolderId, parseTabId } from "@/features/folders/schema";
import { parsePageId } from "@/features/pages/schema";
import { getDb } from "@/lib/db";
import { parseName } from "@/lib/names";

/** What the lists show of a page: no content. */
export type PageSummary = { id: string; name: string; title: string; updatedAt: Date };

/** What the list of all pages of a folder shows of a page: its summary and its tab, if it has one. */
export type PageWithTabSummary = PageSummary & { tab: { name: string } | null };

/** A page with its folder and its tab, as the page view shows it. */
export type PageWithPlace = {
  id: string;
  name: string;
  title: string;
  content: string;
  updatedAt: Date;
  folder: { id: string; name: string };
  tab: { id: string; name: string } | null;
};

/** What the list of deleted pages shows of a page: no content. */
export type DeletedPageSummary = { id: string; name: string; title: string; deletedAt: Date };

/** A deleted page with its folder, as the deleted page view shows it. A deleted page has no tab. */
export type DeletedPage = {
  id: string;
  name: string;
  title: string;
  content: string;
  deletedAt: Date;
  folder: { id: string; name: string };
};

const SUMMARY_SELECT = { id: true, name: true, title: true, updatedAt: true } as const;

/** The pages placed directly in the folder, without their content, by name; deleted pages are left out. */
export async function listFolderPages(folderId: string): Promise<PageSummary[]> {
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return [];
  return getDb().page.findMany({
    where: { folderId: parsedFolderId, tabId: null, deletedAt: null },
    select: SUMMARY_SELECT,
    orderBy: { name: "asc" },
  });
}

/** The pages of the tab, without their content, by name; deleted pages are left out. */
export async function listTabPages(tabId: string): Promise<PageSummary[]> {
  const parsedTabId = parseTabId(tabId);
  if (!parsedTabId) return [];
  return getDb().page.findMany({
    where: { tabId: parsedTabId, deletedAt: null },
    select: SUMMARY_SELECT,
    orderBy: { name: "asc" },
  });
}

/**
 * All pages of the folder, without their content, each with its tab: by name and then by tab, pages placed directly
 * in the folder first. Deleted pages are left out.
 */
export async function listAllFolderPages(folderId: string): Promise<PageWithTabSummary[]> {
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return [];
  const pages = await getDb().page.findMany({
    where: { folderId: parsedFolderId, deletedAt: null },
    select: { ...SUMMARY_SELECT, tab: { select: { name: true } } },
    orderBy: [{ name: "asc" }, { tab: { name: "asc" } }],
  });
  return directPagesFirst(pages);
}

/**
 * Among pages of the same name, moves the page without a tab to the front. The database sorts a missing tab after all
 * tab names; the pages are otherwise left in the order given, by name and then by tab.
 */
export function directPagesFirst<Entry extends { name: string; tab: unknown }>(pages: Entry[]): Entry[] {
  const ordered: Entry[] = [];
  for (const page of pages) {
    let position = ordered.length;
    if (page.tab === null) {
      while (position > 0 && ordered[position - 1]?.name === page.name) position--;
    }
    ordered.splice(position, 0, page);
  }
  return ordered;
}

/**
 * The page with the given name in the given tab of the folder or, with `tabName` `null`, placed directly in the
 * folder, together with its folder and tab. `null` if a name is malformed or no such page exists there; a deleted page
 * has no address, so it is never found.
 */
export async function getPage(
  folderName: string,
  tabName: string | null,
  pageName: string,
): Promise<PageWithPlace | null> {
  const folder = parseName(folderName);
  const tab = tabName === null ? null : parseName(tabName);
  const name = parseName(pageName);
  if (!folder || !name || (tabName !== null && !tab)) return null;
  return getDb().page.findFirst({
    where: {
      name,
      folder: { name: folder },
      deletedAt: null,
      ...(tab === null ? { tabId: null } : { tab: { name: tab } }),
    },
    select: {
      id: true,
      name: true,
      title: true,
      content: true,
      updatedAt: true,
      folder: { select: { id: true, name: true } },
      tab: { select: { id: true, name: true } },
    },
  });
}

/**
 * The page with its time of deletion as a `Date`, or `null` if it is not deleted. The reads of deleted pages only
 * read pages with `deletedAt` set; this tells the type system so.
 */
function asDeleted<Entry extends { deletedAt: Date | null }>(page: Entry): (Entry & { deletedAt: Date }) | null {
  const { deletedAt } = page;
  return deletedAt ? { ...page, deletedAt } : null;
}

/** The deleted pages of the folder with id, name, title and time of deletion, without their content, newest first. */
export async function listDeletedPages(folderId: string): Promise<DeletedPageSummary[]> {
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return [];
  const pages = await getDb().page.findMany({
    where: { folderId: parsedFolderId, deletedAt: { not: null } },
    select: { id: true, name: true, title: true, deletedAt: true },
    // The id keeps pages deleted at the same moment in a stable order.
    orderBy: [{ deletedAt: "desc" }, { id: "asc" }],
  });
  return pages.flatMap((page) => asDeleted(page) ?? []);
}

/**
 * The deleted page with the given id in the folder with the given name, together with its folder. `null` if the name
 * or the id is malformed, the page belongs to another folder or is not deleted.
 */
export async function getDeletedPage(folderName: string, id: string): Promise<DeletedPage | null> {
  const folder = parseName(folderName);
  const pageId = parsePageId(id);
  if (!folder || !pageId) return null;
  const page = await getDb().page.findFirst({
    where: { id: pageId, folder: { name: folder }, deletedAt: { not: null } },
    select: {
      id: true,
      name: true,
      title: true,
      content: true,
      deletedAt: true,
      folder: { select: { id: true, name: true } },
    },
  });
  return page && asDeleted(page);
}
