// The reads of the history of a page: its revisions, one revision and a comparison of two. A service of its own next to
// `service.ts`, because the history is a part of the pages that only reads: the writes that record revisions, reverting
// included, stay in the pages service. Like every service it knows nothing about Next.js, forms or addresses, and it
// trusts no caller: ids and numbers are parsed here again.
//
// Only the browser shows the history: every read takes the actor of the browser. A page that is not deleted needs a
// role on its folder, a deleted page the role that shows the deleted pages (`FUNCTION_ROLES` in `roles.ts`). An admin
// reads no history, without asking the database.

import type { BrowserActor } from "@/features/folder-roles/actors";
import { readableFolderWhere, readerOf } from "@/features/folder-roles/service";
import { REVISIONS_PER_PAGE } from "@/features/pages/limits";
import { isRevisionNumber, parsePageId } from "@/features/pages/schema";
import type { LastEditor } from "@/features/users/records";
import type { ChangeChannel, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

/**
 * A revision of a page as the history lists it, without its content: its number, the title of the page after the
 * change, when and by whom and how it was made, the number of the revision a revert went back to, or `null`, and
 * whether an update of its links after a move or rename recorded it.
 */
export type RevisionSummary = {
  number: number;
  title: string;
  createdAt: Date;
  madeBy: LastEditor;
  revertedTo: number | null;
  linksUpdated: boolean;
};

/** One page of the history of a page: its revisions newest first, and the number of its newest revision. */
export type PageRevisions = { newest: number; revisions: RevisionSummary[] };

/**
 * A revision of a page as its view shows it: the revision with its content, the number of the newest revision of the
 * page, and whether its content is the content of the page now.
 */
export type RevisionDetail = RevisionSummary & { content: string; newest: number; isCurrent: boolean };

/** A revision of a page with its content, as a comparison shows it. */
type RevisionWithContent = RevisionSummary & { content: string };

/** Two revisions of a page to compare, the older first, and the number of the newest revision of the page. */
export type RevisionComparison = { newest: number; older: RevisionWithContent; newer: RevisionWithContent };

const REVISION_SUMMARY_SELECT = {
  number: true,
  title: true,
  createdAt: true,
  user: { select: { username: true } },
  via: true,
  revertedTo: true,
  linksUpdated: true,
} as const;

/** The row of a revision with its user and channel as `LastEditor`, like the last editor of a page. */
function withMadeBy<Row extends { user: { username: string }; via: ChangeChannel }>({
  user,
  via,
  ...row
}: Row): Omit<Row, "user" | "via"> & { madeBy: LastEditor } {
  return { ...row, madeBy: { name: user.username, via } };
}

/**
 * The condition on the page with the given id whose history the actor of the browser may read: a page that is not
 * deleted in a folder with a role of the actor, or a deleted page in a folder whose deleted pages the role shows.
 * `null` for an actor who may read no content.
 */
function historyPageWhere(actor: BrowserActor, pageId: string): Prisma.PageWhereInput | null {
  const readable = readableFolderWhere(actor);
  const deletedReadable = readableFolderWhere(actor, "deletedItems");
  if (!readable || !deletedReadable) return null;
  return {
    id: pageId,
    OR: [
      { deletedAt: null, folder: readable },
      { deletedAt: { not: null }, folder: deletedReadable },
    ],
  };
}

/**
 * The page with the given id as its history needs it: the number of its newest revision, 0 for a page without
 * revisions, and its content now. `null` if the actor may not read its history or there is no such page.
 */
async function historyPageOf(actor: BrowserActor, pageId: string): Promise<{ newest: number; content: string } | null> {
  const where = historyPageWhere(actor, pageId);
  if (!where) return null;
  const page = await getDb().page.findFirst({
    where,
    select: { content: true, revisions: { orderBy: { number: "desc" }, take: 1, select: { number: true } } },
  });
  return page ? { newest: page.revisions[0]?.number ?? 0, content: page.content } : null;
}

/**
 * The revisions of the page with the given id, newest first, without their content: at most `REVISIONS_PER_PAGE`,
 * those before the revision `before` if it is given, and the number of the newest revision. Only the browser shows the
 * history: a page that is not deleted needs a role on its folder, a deleted page the role that shows the deleted
 * pages. `null` for an admin, without the role, for a malformed id or number, and if there is no such page.
 */
export async function listPageRevisions(
  actor: BrowserActor,
  id: string,
  { before }: { before: number | null },
): Promise<PageRevisions | null> {
  if (!readerOf(actor)) return null;
  const pageId = parsePageId(id);
  if (!pageId || (before !== null && !isRevisionNumber(before))) return null;
  const page = await historyPageOf(actor, pageId);
  if (page === null) return null;
  const revisions = await getDb().pageRevision.findMany({
    where: { pageId, ...(before === null ? {} : { number: { lt: before } }) },
    orderBy: { number: "desc" },
    take: REVISIONS_PER_PAGE,
    select: REVISION_SUMMARY_SELECT,
  });
  return { newest: page.newest, revisions: revisions.map(withMadeBy) };
}

/**
 * The two revisions with the given numbers of the page with the given id, with their content, ordered older to newer
 * whatever the order of the numbers, and the number of the newest revision. The same number twice gives the revision
 * twice. The same roles as for the history (`listPageRevisions()`) apply. `null` for an admin, without the role, for a
 * malformed id or number, and if the page or one of the revisions does not exist.
 */
export async function getRevisionComparison(
  actor: BrowserActor,
  id: string,
  a: number,
  b: number,
): Promise<RevisionComparison | null> {
  if (!readerOf(actor)) return null;
  const pageId = parsePageId(id);
  if (!pageId || !isRevisionNumber(a) || !isRevisionNumber(b)) return null;
  const page = await historyPageOf(actor, pageId);
  if (page === null) return null;
  const [olderNumber, newerNumber] = a <= b ? [a, b] : [b, a];
  const rows = await getDb().pageRevision.findMany({
    where: { pageId, number: { in: [olderNumber, newerNumber] } },
    select: { ...REVISION_SUMMARY_SELECT, content: true },
  });
  const older = rows.find(({ number }) => number === olderNumber);
  const newer = rows.find(({ number }) => number === newerNumber);
  if (!older || !newer) return null;
  return { newest: page.newest, older: withMadeBy(older), newer: withMadeBy(newer) };
}

/**
 * The revision with the given number of the page with the given id, with its content, the number of the newest
 * revision of the page, and whether its content is the content of the page now. The same roles as for the history
 * (`listPageRevisions()`) apply. `null` for an admin, without the role, for a malformed id or number, and if the page
 * or the revision does not exist.
 */
export async function getPageRevision(actor: BrowserActor, id: string, number: number): Promise<RevisionDetail | null> {
  if (!readerOf(actor)) return null;
  const pageId = parsePageId(id);
  if (!pageId || !isRevisionNumber(number)) return null;
  const page = await historyPageOf(actor, pageId);
  if (page === null) return null;
  const revision = await getDb().pageRevision.findUnique({
    where: { pageId_number: { pageId, number } },
    select: { ...REVISION_SUMMARY_SELECT, content: true },
  });
  if (!revision) return null;
  return { ...withMadeBy(revision), newest: page.newest, isCurrent: revision.content === page.content };
}
