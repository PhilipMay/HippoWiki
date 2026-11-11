import { connection } from "next/server";
import { cache } from "react";

import { getDb } from "@/lib/db";
import { parseName } from "@/lib/names";

// Every query starts with `connection()`: without a request-time API, Next.js would prerender the calling route at
// build time and serve a stale snapshot of the database.

/** The pages placed directly in the folder, without their content, by name. */
export async function listFolderPages(folderId: string) {
  await connection();
  return getDb().page.findMany({
    where: { folderId },
    select: { id: true, name: true, title: true, updatedAt: true },
    orderBy: { name: "asc" },
  });
}

export type PageSummary = Awaited<ReturnType<typeof listFolderPages>>[number];

/**
 * The page with the given name placed directly in the folder with the given name, together with its folder, or `null`
 * if a name is malformed or no such page exists. Cached per request, so that `generateMetadata` and the page component
 * share one query.
 */
export const getPage = cache(async (folderName: string, pageName: string) => {
  await connection();
  const folder = parseName(folderName);
  const name = parseName(pageName);
  if (!folder || !name) return null;
  return getDb().page.findFirst({
    where: { name, folder: { name: folder } },
    include: { folder: { select: { id: true, name: true } } },
  });
});
