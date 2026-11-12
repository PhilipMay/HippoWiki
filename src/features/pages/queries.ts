import { connection } from "next/server";
import { cache } from "react";

import { getDb } from "@/lib/db";
import { parseName } from "@/lib/names";

// Every query starts with `connection()`: without a request-time API, Next.js would prerender the calling route at
// build time and serve a stale snapshot of the database.

/** What the lists show of a page: no content. */
const SUMMARY_SELECT = { id: true, name: true, title: true, updatedAt: true } as const;

/** The pages placed directly in the folder, without their content, by name; deleted pages are left out. */
export async function listFolderPages(folderId: string) {
  await connection();
  return getDb().page.findMany({
    where: { folderId, tabId: null, deletedAt: null },
    select: SUMMARY_SELECT,
    orderBy: { name: "asc" },
  });
}

/** The pages of the tab, without their content, by name; deleted pages are left out. */
export async function listTabPages(tabId: string) {
  await connection();
  return getDb().page.findMany({
    where: { tabId, deletedAt: null },
    select: SUMMARY_SELECT,
    orderBy: { name: "asc" },
  });
}

export type PageSummary = Awaited<ReturnType<typeof listFolderPages>>[number];

/**
 * All pages of the folder, without their content, each with its tab: by name and then by tab, pages placed directly
 * in the folder first. Deleted pages are left out.
 */
export async function listAllFolderPages(folderId: string) {
  await connection();
  const pages = await getDb().page.findMany({
    where: { folderId, deletedAt: null },
    select: { ...SUMMARY_SELECT, tab: { select: { name: true } } },
    orderBy: [{ name: "asc" }, { tab: { name: "asc" } }],
  });
  return directPagesFirst(pages);
}

export type PageWithTabSummary = Awaited<ReturnType<typeof listAllFolderPages>>[number];

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
 * has no address, so it is never found. Cached per request, so that `generateMetadata` and the page component share
 * one query.
 */
export const getPage = cache(async (folderName: string, tabName: string | null, pageName: string) => {
  await connection();
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
    include: { folder: { select: { id: true, name: true } }, tab: { select: { id: true, name: true } } },
  });
});

/** A page with its folder and its tab, as the page view shows it. */
export type PageWithPlace = NonNullable<Awaited<ReturnType<typeof getPage>>>;
