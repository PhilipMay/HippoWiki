import { connection } from "next/server";
import { cache } from "react";

import { parsePageSlug } from "@/features/pages/schema";
import { getDb } from "@/lib/db";

// Every query starts with `connection()`: without a request-time API, Next.js would prerender the calling route at
// build time and serve a stale snapshot of the database.

/** All pages without their content, most recently updated first. */
export async function listPages() {
  await connection();
  return getDb().page.findMany({
    select: { id: true, slug: true, title: true, updatedAt: true },
    // The id makes the order deterministic for pages with the same update time.
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
}

export type PageSummary = Awaited<ReturnType<typeof listPages>>[number];

/**
 * The page with the given slug, or `null` if the slug is malformed or no such page exists. Cached per request, so that
 * `generateMetadata` and the page component share one query.
 */
export const getPageBySlug = cache(async (slug: string) => {
  await connection();
  const pageSlug = parsePageSlug(slug);
  if (!pageSlug) return null;
  return getDb().page.findUnique({ where: { slug: pageSlug } });
});
