// The reads and writes of pages. The service knows nothing about Next.js, forms or addresses, so that the GUI (through
// `queries.ts` and `actions.ts`) and any other caller can use it, also outside a request. It trusts no caller: ids,
// names and input are parsed here again.

import { z } from "zod";

import { parseFolderId, parseTabId } from "@/features/folders/schema";
import {
  newPageInputSchema,
  pageContentInputSchema,
  pageNameInputSchema,
  parsePageId,
  type PageFieldErrors,
} from "@/features/pages/schema";
import { getDb } from "@/lib/db";
import { isForeignKeyViolation, isUniqueViolation, PAGE_NAME } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { parseName, type NameFieldErrors } from "@/lib/names";
import type { Result } from "@/lib/result";

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

/** A page as stored by a write, with the names of its folder and tab: what its address is built from. */
export type StoredPage = { id: string; name: string; folder: { name: string }; tab: { name: string } | null };

/** The place a page was in when it was deleted: its folder and its tab, if it had one. */
export type PagePlace = { folder: { name: string }; tab: { name: string } | null };

/** The input of a write is invalid; `fieldErrors` holds the messages of the schema per field. */
type InvalidInput<FieldErrors> = { code: "invalid-input"; fieldErrors: FieldErrors };
/** Another page already uses the name at the place. */
type NameTaken = { code: "name-taken" };
type FolderNotFound = { code: "folder-not-found" };
/** The tab does not exist, is no tab of the page's folder or its id is malformed. */
type TabNotFound = { code: "tab-not-found" };
/** The page does not exist or is not in the state the write needs: deleted for a restore, not deleted otherwise. */
type PageNotFound = { code: "page-not-found" };
/** An unexpected database error; it has been logged. */
type Failed = { code: "failed" };

export type CreatePageError = FolderNotFound | TabNotFound | InvalidInput<PageFieldErrors> | NameTaken | Failed;
export type UpdatePageContentError = PageNotFound | InvalidInput<PageFieldErrors> | Failed;
export type MoveOrRenamePageError = PageNotFound | TabNotFound | InvalidInput<NameFieldErrors> | NameTaken | Failed;
export type DeletePageError = PageNotFound | Failed;
export type RestorePageError = PageNotFound | TabNotFound | InvalidInput<NameFieldErrors> | NameTaken | Failed;

const SUMMARY_SELECT = { id: true, name: true, title: true, updatedAt: true } as const;

const STORED_PAGE_SELECT = {
  id: true,
  name: true,
  folder: { select: { name: true } },
  tab: { select: { name: true } },
} as const;

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

function invalidInput<Input>(error: z.ZodError<Input>): {
  ok: false;
  error: InvalidInput<z.core.$ZodFlattenedError<Input>["fieldErrors"]>;
} {
  return { ok: false, error: { code: "invalid-input", fieldErrors: z.flattenError(error).fieldErrors } };
}

/**
 * The tab of a place: the id of a tab, `null` for the folder itself, or `undefined` if the id is malformed, so that
 * it never reaches the database.
 */
function parsePlace(tabId: string | null): string | null | undefined {
  if (tabId === null) return null;
  return parseTabId(tabId) ?? undefined;
}

/**
 * The page with the given id as stored, or `null` if it does not exist or is deleted. Writes return the stored page,
 * so that a caller never builds an address from submitted values.
 */
async function findStoredPage(pageId: string): Promise<StoredPage | null> {
  return getDb().page.findUnique({ where: { id: pageId, deletedAt: null }, select: STORED_PAGE_SELECT });
}

/**
 * Creates a page with the given name and content, with the title derived from the content, and returns it as stored.
 * The page is placed in the tab with the id `tabId` or, with `null`, directly in the folder with the given id; the tab
 * must be one of that folder.
 */
export async function createPage(
  folderId: string,
  input: { name: string; content: string; tabId: string | null },
): Promise<Result<StoredPage, CreatePageError>> {
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return { ok: false, error: { code: "folder-not-found" } };

  const tabId = parsePlace(input.tabId);
  if (tabId === undefined) return { ok: false, error: { code: "tab-not-found" } };

  const parsed = newPageInputSchema.safeParse({ name: input.name, content: input.content });
  if (!parsed.success) return invalidInput(parsed.error);

  let page: StoredPage;
  try {
    page = await getDb().page.create({
      data: { ...parsed.data, tabId, folderId: parsedFolderId },
      select: STORED_PAGE_SELECT,
    });
  } catch (err) {
    if (isUniqueViolation(err, PAGE_NAME)) {
      logger.warn({ folderId: parsedFolderId, tabId, name: parsed.data.name }, "name of new page already in use");
      return { ok: false, error: { code: "name-taken" } };
    }
    if (isForeignKeyViolation(err)) {
      // A missing folder, a missing tab or a tab of another folder: the composite foreign key refuses all of them.
      logger.warn({ folderId: parsedFolderId, tabId }, "folder or tab of new page not found");
      return { ok: false, error: { code: tabId ? "tab-not-found" : "folder-not-found" } };
    }
    logger.error({ err, folderId: parsedFolderId, tabId }, "failed to create page");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ pageId: page.id }, "page created");
  return { ok: true, value: page };
}

/**
 * Stores the given content of the page with the given id, with the title derived from it, and returns the page as
 * stored. Name and place are not touched. A deleted page counts as missing.
 */
export async function updatePageContent(
  id: string,
  input: { content: string },
): Promise<Result<StoredPage, UpdatePageContentError>> {
  const pageId = parsePageId(id);
  if (!pageId) return { ok: false, error: { code: "page-not-found" } };

  const parsed = pageContentInputSchema.safeParse({ content: input.content });
  if (!parsed.success) return invalidInput(parsed.error);

  let page: StoredPage | null;
  try {
    // `updateMany` reports a missing page as a count of 0 instead of throwing; it sets `updatedAt` as well. A deleted
    // page counts as missing.
    const { count } = await getDb().page.updateMany({ where: { id: pageId, deletedAt: null }, data: parsed.data });
    page = count === 0 ? null : await findStoredPage(pageId);
  } catch (err) {
    logger.error({ err, pageId }, "failed to update page");
    return { ok: false, error: { code: "failed" } };
  }
  if (page === null) {
    logger.warn({ pageId }, "page to update not found");
    return { ok: false, error: { code: "page-not-found" } };
  }

  logger.info({ pageId }, "page updated");
  return { ok: true, value: page };
}

/**
 * Stores the given name and place of the page with the given id in one update and returns the page as stored. The
 * page is placed in the tab with the id `tabId` of its folder or, with `null`, directly in the folder. The content is
 * neither validated nor touched, so the content limit never blocks a move. A tab of another folder is refused by the
 * composite foreign key and counts as missing, like a deleted page.
 */
export async function moveOrRenamePage(
  id: string,
  input: { name: string; tabId: string | null },
): Promise<Result<StoredPage, MoveOrRenamePageError>> {
  const pageId = parsePageId(id);
  if (!pageId) return { ok: false, error: { code: "page-not-found" } };

  const tabId = parsePlace(input.tabId);
  if (tabId === undefined) return { ok: false, error: { code: "tab-not-found" } };

  const parsed = pageNameInputSchema.safeParse({ name: input.name });
  if (!parsed.success) return invalidInput(parsed.error);
  const { name } = parsed.data;

  let page: StoredPage | null;
  try {
    const { count } = await getDb().page.updateMany({
      where: { id: pageId, deletedAt: null },
      data: { name, tabId },
    });
    page = count === 0 ? null : await findStoredPage(pageId);
  } catch (err) {
    if (isUniqueViolation(err, PAGE_NAME)) {
      logger.warn({ pageId, tabId, name }, "name of moved or renamed page already in use at the target");
      return { ok: false, error: { code: "name-taken" } };
    }
    if (isForeignKeyViolation(err)) {
      logger.warn({ pageId, tabId }, "target tab of moved or renamed page not found in the page's folder");
      return { ok: false, error: { code: "tab-not-found" } };
    }
    logger.error({ err, pageId, tabId }, "failed to move or rename page");
    return { ok: false, error: { code: "failed" } };
  }
  if (page === null) {
    logger.warn({ pageId }, "page to move or rename not found");
    return { ok: false, error: { code: "page-not-found" } };
  }

  logger.info({ pageId, tabId }, "page moved or renamed");
  return { ok: true, value: page };
}

/**
 * Deletes the page with the given id and returns the place it was in. The page keeps its row and its folder, so it
 * can be restored; it gets the time of deletion and loses its tab, because its place inside the folder is forgotten.
 * A page that is already deleted counts as missing.
 */
export async function deletePage(id: string): Promise<Result<PagePlace, DeletePageError>> {
  const pageId = parsePageId(id);
  if (!pageId) return { ok: false, error: { code: "page-not-found" } };

  let place: PagePlace | null;
  try {
    // One transaction, so that the place read is the one the page had when it was deleted.
    place = await getDb().$transaction(async (tx) => {
      const page = await tx.page.findFirst({
        where: { id: pageId, deletedAt: null },
        select: { folder: { select: { name: true } }, tab: { select: { name: true } } },
      });
      if (!page) return null;
      // `updateMany` reports a page deleted in the meantime as a count of 0; it sets `updatedAt` as well.
      const { count } = await tx.page.updateMany({
        where: { id: pageId, deletedAt: null },
        data: { deletedAt: new Date(), tabId: null },
      });
      return count === 0 ? null : page;
    });
  } catch (err) {
    logger.error({ err, pageId }, "failed to delete page");
    return { ok: false, error: { code: "failed" } };
  }
  if (place === null) {
    logger.warn({ pageId }, "page to delete not found");
    return { ok: false, error: { code: "page-not-found" } };
  }

  logger.info({ pageId }, "page deleted");
  return { ok: true, value: place };
}

/**
 * Restores the deleted page with the given id into its folder, under the given name, at the given place, and returns
 * it as stored: in the tab with the id `tabId` of its folder or, with `null`, directly in the folder. The content is
 * neither validated nor touched. A page that is not deleted counts as missing; a tab of another folder is refused by
 * the composite foreign key and counts as missing as well.
 */
export async function restorePage(
  id: string,
  input: { name: string; tabId: string | null },
): Promise<Result<StoredPage, RestorePageError>> {
  const pageId = parsePageId(id);
  if (!pageId) return { ok: false, error: { code: "page-not-found" } };

  const tabId = parsePlace(input.tabId);
  if (tabId === undefined) return { ok: false, error: { code: "tab-not-found" } };

  const parsed = pageNameInputSchema.safeParse({ name: input.name });
  if (!parsed.success) return invalidInput(parsed.error);
  const { name } = parsed.data;

  let page: StoredPage | null;
  try {
    // Only a deleted page can be restored; `updateMany` reports any other as a count of 0. It sets `updatedAt` as well.
    const { count } = await getDb().page.updateMany({
      where: { id: pageId, deletedAt: { not: null } },
      data: { deletedAt: null, name, tabId },
    });
    page = count === 0 ? null : await findStoredPage(pageId);
  } catch (err) {
    if (isUniqueViolation(err, PAGE_NAME)) {
      logger.warn({ pageId, tabId, name }, "name of restored page already in use at the target");
      return { ok: false, error: { code: "name-taken" } };
    }
    if (isForeignKeyViolation(err)) {
      logger.warn({ pageId, tabId }, "target tab of restored page not found in the page's folder");
      return { ok: false, error: { code: "tab-not-found" } };
    }
    logger.error({ err, pageId, tabId }, "failed to restore page");
    return { ok: false, error: { code: "failed" } };
  }
  if (page === null) {
    logger.warn({ pageId }, "deleted page to restore not found");
    return { ok: false, error: { code: "page-not-found" } };
  }

  logger.info({ pageId, tabId }, "page restored");
  return { ok: true, value: page };
}
