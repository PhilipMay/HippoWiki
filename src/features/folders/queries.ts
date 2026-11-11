import { connection } from "next/server";
import { cache } from "react";

import { getDb } from "@/lib/db";
import { parseName } from "@/lib/names";

// Every query starts with `connection()`: without a request-time API, Next.js would prerender the calling route at
// build time and serve a stale snapshot of the database.

/** All folders, by name. */
export async function listFolders() {
  await connection();
  return getDb().folder.findMany({
    select: { id: true, name: true, updatedAt: true },
    orderBy: { name: "asc" },
  });
}

export type FolderSummary = Awaited<ReturnType<typeof listFolders>>[number];

/**
 * The folder with the given name, or `null` if the name is malformed or no such folder exists. Cached per request, so
 * that `generateMetadata` and the page component share one query.
 */
export const getFolderByName = cache(async (name: string) => {
  await connection();
  const folderName = parseName(name);
  if (!folderName) return null;
  return getDb().folder.findUnique({ where: { name: folderName } });
});
