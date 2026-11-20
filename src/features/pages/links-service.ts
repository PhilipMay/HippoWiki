// The index of the wiki links of pages (`PageLink`): what a write of the content of a page stores of its links, the
// pages that link to a page, and the derivation of the links of the pages stored before the index or by an older
// version of it. The rows of a page are stored in the same transaction as its content, deleted pages included, so that
// a restore needs nothing; the reads leave deleted pages out.

import type { ContentActor } from "@/features/folder-roles/actors";
import { readableFolderWhere } from "@/features/folder-roles/service";
import { parsePageId } from "@/features/pages/schema";
import { LINK_INDEX_VERSION, linkRowsOf } from "@/features/pages/wiki-links";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Failed, Result } from "@/lib/result";

/** A page that links to another page: what "Linked from" and `read_page` show of it. */
export type LinkingPage = { id: string; name: string; title: string; tab: { name: string } | null };

/** The columns of a page that a write of its links stores with it: the version of the derivation. */
export const LINK_INDEX_DATA = { linkIndexVersion: LINK_INDEX_VERSION } as const;

/**
 * Replaces the rows of the index of links of the page with those of its content, in the transaction of the write of the
 * content. The write of the page stores `LINK_INDEX_DATA` with it.
 */
export async function storeLinks(tx: Prisma.TransactionClient, pageId: string, content: string): Promise<void> {
  const { folderId } = await tx.page.findUniqueOrThrow({ where: { id: pageId }, select: { folderId: true } });
  await tx.pageLink.deleteMany({ where: { pageId } });
  const rows = linkRowsOf(content, folderId);
  if (rows.length > 0) await tx.pageLink.createMany({ data: rows.map((row) => ({ ...row, pageId })) });
}

/**
 * The other pages of the folder that are not deleted and hold a wiki link to the name and place of the page with the
 * given id, sorted by title and then by name, each once. The page itself is left out. `null` for an admin, for a page
 * of a folder without a role of the actor, and for a malformed id and a page that does not exist or is deleted.
 */
export async function listLinkingPages(actor: ContentActor, pageId: string): Promise<LinkingPage[] | null> {
  const readable = readableFolderWhere(actor);
  if (!readable) return null;
  const id = parsePageId(pageId);
  if (!id) return null;
  const page = await getDb().page.findFirst({
    where: { id, deletedAt: null, folder: readable },
    select: { folderId: true, name: true, tab: { select: { name: true } } },
  });
  if (!page) return null;
  const links = await getDb().pageLink.findMany({
    where: {
      folderId: page.folderId,
      tabName: page.tab?.name ?? null,
      pageName: page.name,
      pageId: { not: id },
      page: { deletedAt: null },
    },
    select: { page: { select: { id: true, name: true, title: true, tab: { select: { name: true } } } } },
    orderBy: [{ page: { title: "asc" } }, { page: { name: "asc" } }],
  });
  return links.map((link) => link.page);
}

/** How many pages are read and derived at a time, so that the content of every page is never in memory at once. */
const INDEX_BATCH_SIZE = 50;

/**
 * Derives the links of every page whose stored version of the derivation differs from `LINK_INDEX_VERSION`, deleted
 * pages included, so that a restore needs nothing more, and returns how many it derived. It changes only the links and
 * their version: the time of the last change, the last editor and the version of a page stay as they are, so a derived
 * page counts as no edit. Two runs at the same time do no harm: the write of the version comes first in the
 * transaction of a page and takes its row, so a page that the other run, or a save of the server, derived in the
 * meantime has the current version and is left as it is.
 */
export async function indexOutdatedLinks(): Promise<Result<{ pages: number }, Failed>> {
  const start = performance.now();
  let pages = 0;
  try {
    // By id after the last page of the batch before, so that a page that was not derived is not read again.
    let after: string | undefined;
    for (;;) {
      const batch = await getDb().page.findMany({
        where: {
          linkIndexVersion: { not: LINK_INDEX_VERSION },
          ...(after === undefined ? {} : { id: { gt: after } }),
        },
        orderBy: { id: "asc" },
        take: INDEX_BATCH_SIZE,
        select: { id: true, folderId: true, content: true, updatedAt: true },
      });
      for (const page of batch) {
        const derived = await getDb().$transaction(async (tx) => {
          // `updatedAt` as stored, because Prisma would set it to now: deriving a page is no change of it. The content
          // is part of the condition, so that a page whose content a save changed since the read is left to that save.
          const { count } = await tx.page.updateMany({
            where: { id: page.id, content: page.content, linkIndexVersion: { not: LINK_INDEX_VERSION } },
            data: { ...LINK_INDEX_DATA, updatedAt: page.updatedAt },
          });
          if (count === 0) return 0;
          await tx.pageLink.deleteMany({ where: { pageId: page.id } });
          const rows = linkRowsOf(page.content, page.folderId);
          if (rows.length > 0) await tx.pageLink.createMany({ data: rows.map((row) => ({ ...row, pageId: page.id })) });
          return 1;
        });
        pages += derived;
      }
      after = batch.at(-1)?.id;
      if (batch.length < INDEX_BATCH_SIZE) break;
    }
  } catch (err) {
    logger.error({ err, pages }, "failed to derive the wiki links of the pages");
    return { ok: false, error: { code: "failed" } };
  }
  logger.info(
    { pages, durationMs: Math.round(performance.now() - start), version: LINK_INDEX_VERSION },
    pages === 0 ? "wiki links up to date, no page derived" : "wiki links of the pages derived",
  );
  return { ok: true, value: { pages } };
}
