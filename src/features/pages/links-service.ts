// The index of the wiki links of pages (`PageLink`): what a write of the content of a page stores of its links, the
// pages that link to a page, and the derivation of the links of the pages stored before the index or by an older
// version of it. The rows of a page are stored in the same transaction as its content, deleted pages included, so that
// a restore needs nothing; the reads leave deleted pages out.

import type { ContentActor } from "@/features/folder-roles/actors";
import { readableFolderWhere } from "@/features/folder-roles/service";
import { parseTabId } from "@/features/folders/schema";
import { parseFileId } from "@/features/files/schema";
import { titleFromContent } from "@/features/pages/derive";
import { parsePageId } from "@/features/pages/schema";
import { LINK_INDEX_VERSION, linkRowsOf, rewriteWikiLinks, type TargetChange } from "@/features/pages/wiki-links";
import { NEXT_VERSION } from "@/features/pages/writes";
import { pageText } from "@/features/search/text";
import type { ChangeChannel, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Failed, Result } from "@/lib/result";

/**
 * A page that links to another page or to a file: what "Linked from", "Shown or linked from" and `read_page` show of
 * it.
 */
export type LinkingPage = { id: string; name: string; title: string; tab: { name: string } | null };

/** The columns of a page that a write of its links stores with it: the version of the derivation. */
export const LINK_INDEX_DATA = { linkIndexVersion: LINK_INDEX_VERSION } as const;

/**
 * The options of a transaction that takes the lock of the links of a folder: a content write may wait for a rename that
 * updates many pages, and a rename for the saves that run, longer than the 5 s that Prisma gives a transaction by
 * default.
 */
export const LINKS_TRANSACTION = { maxWait: 10_000, timeout: 60_000 } as const;

/**
 * Takes the lock of the links of the folder until the end of the transaction: shared for a write of the content of a
 * page, which adds and removes links, and exclusive for a move or rename of a page and a rename of a tab, which update
 * the links to them. So an update of links waits for the content saves of the folder that are running, sees every
 * link stored before it, and no save adds a link to the old name and place while it runs. It is an advisory lock of
 * PostgreSQL on a number derived from the id of the folder; two folders that share the number only wait for each
 * other.
 */
export async function lockFolderLinks(
  tx: Prisma.TransactionClient,
  folderId: string,
  mode: "shared" | "exclusive",
): Promise<void> {
  if (mode === "shared") {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${folderId}::text, 0))`;
  } else {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${folderId}::text, 0))`;
  }
}

/**
 * Replaces the rows of the index of links of the page with those of its content, in the transaction of the write of the
 * content. The write of the page stores `LINK_INDEX_DATA` with it.
 */
export async function storeLinks(
  tx: Prisma.TransactionClient,
  pageId: string,
  folderId: string,
  content: string,
): Promise<void> {
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

/**
 * The pages of the folder that are not deleted and show or link the file with the given id, with `![[…]]` or `[[…]]`,
 * sorted by title and then by name, each once. `null` for an admin, for a file of a folder without a role of the
 * actor, and for a malformed id and a file that does not exist or is deleted.
 */
export async function listPagesLinkingToFile(actor: ContentActor, fileId: string): Promise<LinkingPage[] | null> {
  const readable = readableFolderWhere(actor);
  if (!readable) return null;
  const id = parseFileId(fileId);
  if (!id) return null;
  const file = await getDb().file.findFirst({
    where: { id, deletedAt: null, folder: readable },
    select: { folderId: true, name: true, tab: { select: { name: true } } },
  });
  if (!file) return null;
  const links = await getDb().pageLink.findMany({
    where: { folderId: file.folderId, tabName: file.tab?.name ?? null, pageName: file.name, page: { deletedAt: null } },
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
          await storeLinks(tx, page.id, page.folderId, page.content);
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

/** Where the targets that an update of links changes are in the index: a name and place, or every name of a tab. */
export type LinkPlace = { tabName: string | null; pageName?: string };

/** Who updates the links: the user and the channel of the move or rename, stored with every updated page. */
type LinkEditor = { lastEditedById: string; lastEditedVia: ChangeChannel };

/**
 * Updates the wiki links that the change names in every page of the folder that is not deleted and holds one, from the
 * index, inside the transaction of the move or rename, which holds the exclusive lock of the folder (`lockFolderLinks`).
 * Each updated page gets its new content, the title and the search text derived from it (its language stays, because
 * targets are no prose), its links, the next version and the editor as its last editor, and a revision by the editor,
 * marked as a link update. The content limits are not checked: a page may grow past them. Deleted pages are neither
 * read nor changed. Returns the updated pages, sorted by title and then by name.
 */
export async function updateLinks(
  tx: Prisma.TransactionClient,
  folderId: string,
  place: LinkPlace,
  change: TargetChange,
  editor: LinkEditor,
): Promise<LinkingPage[]> {
  const rows = await tx.pageLink.findMany({
    where: { folderId, ...place, page: { deletedAt: null } },
    select: { pageId: true },
    distinct: ["pageId"],
  });
  if (rows.length === 0) return [];
  // The rows of the pages are locked in the order of their ids, so that a delete of one of them waits, and a page that a
  // delete got to first is left out.
  const pages = await tx.$queryRaw<{ id: string; title: string; content: string }[]>`
    SELECT id, title, content FROM "Page"
    WHERE id = ANY(${rows.map((row) => row.pageId)}::uuid[]) AND "deletedAt" IS NULL
    ORDER BY id
    FOR UPDATE`;
  const updated: LinkingPage[] = [];
  for (const page of pages) {
    const content = rewriteWikiLinks(page.content, change);
    if (content === page.content) continue;
    const title = titleFromContent(content) ?? page.title;
    const stored = await tx.page.update({
      where: { id: page.id },
      data: {
        content,
        title,
        searchText: pageText(content).searchText,
        ...LINK_INDEX_DATA,
        ...editor,
        ...NEXT_VERSION,
      },
      select: { id: true, name: true, title: true, tab: { select: { name: true } } },
    });
    await storeLinks(tx, page.id, folderId, content);
    // The row of the page is locked, so no other write takes the number of the revision.
    const newest = await tx.pageRevision.findFirst({
      where: { pageId: page.id },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    await tx.pageRevision.create({
      data: {
        pageId: page.id,
        number: (newest?.number ?? 0) + 1,
        title,
        content,
        userId: editor.lastEditedById,
        via: editor.lastEditedVia,
        linksUpdated: true,
      },
    });
    updated.push(stored);
  }
  return updated.sort((a, b) => a.title.localeCompare(b.title) || a.name.localeCompare(b.name));
}

/**
 * How many pages of the folder that are not deleted hold a wiki link to the name and place of the page with the given
 * id, the page itself included: the pages that a move or rename of it updates, as they are now. `null` for an admin,
 * for a page of a folder without a role of the actor, and for a malformed id and a page that does not exist or is
 * deleted.
 */
export async function countPagesLinkingTo(actor: ContentActor, pageId: string): Promise<number | null> {
  const readable = readableFolderWhere(actor);
  if (!readable) return null;
  const id = parsePageId(pageId);
  if (!id) return null;
  const page = await getDb().page.findFirst({
    where: { id, deletedAt: null, folder: readable },
    select: { folderId: true, name: true, tab: { select: { name: true } } },
  });
  if (!page) return null;
  // A page has at most one row per target, so the rows of one target count its pages.
  return getDb().pageLink.count({
    where: { folderId: page.folderId, tabName: page.tab?.name ?? null, pageName: page.name, page: { deletedAt: null } },
  });
}

/**
 * How many pages of the folder that are not deleted hold a wiki link to a page of the tab with the given id, whatever
 * its name: the pages that a rename of the tab updates, as they are now. `null` for an admin, for a tab of a folder
 * without a role of the actor, and for a malformed id and a tab that does not exist.
 */
export async function countPagesLinkingIntoTab(actor: ContentActor, tabId: string): Promise<number | null> {
  const readable = readableFolderWhere(actor);
  if (!readable) return null;
  const id = parseTabId(tabId);
  if (!id) return null;
  const tab = await getDb().tab.findFirst({ where: { id, folder: readable }, select: { folderId: true, name: true } });
  if (!tab) return null;
  const pages = await getDb().pageLink.findMany({
    where: { folderId: tab.folderId, tabName: tab.name, page: { deletedAt: null } },
    select: { pageId: true },
    distinct: ["pageId"],
  });
  return pages.length;
}
