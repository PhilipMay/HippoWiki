// The search service. It knows nothing about Next.js, forms or addresses, so that the GUI, MCP and the scripts of the
// container image can use it, also outside a request.
//
// The pages that exist when search is installed, and every page after an update that changes how the search text or
// the language of a page is derived, are derived again before the server serves (`indexOutdatedPages()`, run by
// `scripts/search-index.ts` at every start of the container image), so that every search is complete from the first
// request.

import { SEARCH_INDEX_VERSION, searchIndexData } from "@/features/search/index-data";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Failed, Result } from "@/lib/result";

/** How many pages are read and derived at a time, so that the content of every page is never in memory at once. */
const INDEX_BATCH_SIZE = 50;

/**
 * Derives the search text and the language of every page whose stored version of the derivation differs from
 * `SEARCH_INDEX_VERSION`, deleted pages included, so that a restore needs nothing more, and returns how many it
 * derived. It changes only the search columns: the time of the last change, the last editor and the version of a page
 * stay as they are, so a derived page counts as no edit. The trigger of the database then builds the vector and the
 * words of the folder. It does nothing when no page is left. Two runs at the same time do no harm: a page that the
 * other run, or a save of the server, derived in the meantime has the current version and is left as it is.
 */
export async function indexOutdatedPages(): Promise<Result<{ pages: number }, Failed>> {
  const start = performance.now();
  let pages = 0;
  try {
    // By id after the last page of the batch before, so that a page that could not be written is not read again.
    let after: string | undefined;
    for (;;) {
      const batch = await getDb().page.findMany({
        where: {
          searchIndexVersion: { not: SEARCH_INDEX_VERSION },
          ...(after === undefined ? {} : { id: { gt: after } }),
        },
        orderBy: { id: "asc" },
        take: INDEX_BATCH_SIZE,
        select: { id: true, content: true, updatedAt: true },
      });
      for (const page of batch) {
        const search = await searchIndexData(page.content);
        // `updatedAt` as stored, because Prisma would set it to now: deriving a page is no change of it.
        const { count } = await getDb().page.updateMany({
          where: { id: page.id, searchIndexVersion: { not: SEARCH_INDEX_VERSION } },
          data: { ...search, updatedAt: page.updatedAt },
        });
        pages += count;
      }
      after = batch.at(-1)?.id;
      if (batch.length < INDEX_BATCH_SIZE) break;
    }
  } catch (err) {
    logger.error({ err, pages }, "failed to derive the search index of the pages");
    return { ok: false, error: { code: "failed" } };
  }
  logger.info(
    { pages, durationMs: Math.round(performance.now() - start), version: SEARCH_INDEX_VERSION },
    pages === 0 ? "search index up to date, no page derived" : "search index of the pages derived",
  );
  return { ok: true, value: { pages } };
}
