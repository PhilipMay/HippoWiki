// The reads and writes of folders and tabs. The service knows nothing about Next.js, forms or addresses, so that the
// GUI (through `queries.ts` and `actions.ts`) and any other caller can use it, also outside a request. It trusts no
// caller: ids, names and input are parsed here again.

import { z } from "zod";

import { folderInputSchema, parseFolderId, parseTabId, tabInputSchema } from "@/features/folders/schema";
import { getDb } from "@/lib/db";
import { FOLDER_NAME, isForeignKeyViolation, isUniqueViolation, TAB_NAME } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { parseName, type NameFieldErrors } from "@/lib/names";
import type { Result } from "@/lib/result";

/** What the list of folders shows of a folder. */
export type FolderSummary = { id: string; name: string; updatedAt: Date };

/** A folder: its id and its name, which is all an address or a write needs. */
export type Folder = { id: string; name: string };

/** What the list of tabs shows of a tab. */
export type TabSummary = { id: string; name: string; updatedAt: Date };

/** A tab together with its folder, as a tab address shows it. */
export type TabWithFolder = { id: string; name: string; folder: { id: string; name: string } };

/** A tab as stored by a write, with the name of its folder: what its address is built from. */
export type StoredTab = { id: string; name: string; folder: { name: string } };

/** The input of a write is invalid; `fieldErrors` holds the messages of the schema per field. */
type InvalidName = { code: "invalid-input"; fieldErrors: NameFieldErrors };
/** Another item already uses the name where it must be unique. */
type NameTaken = { code: "name-taken" };
type FolderNotFound = { code: "folder-not-found" };
type TabNotFound = { code: "tab-not-found" };
/** An unexpected database error; it has been logged. */
type Failed = { code: "failed" };

export type CreateFolderError = InvalidName | NameTaken | Failed;
export type RenameFolderError = FolderNotFound | InvalidName | NameTaken | Failed;
export type CreateTabError = FolderNotFound | InvalidName | NameTaken | Failed;
export type RenameTabError = TabNotFound | InvalidName | NameTaken | Failed;

const SUMMARY_SELECT = { id: true, name: true, updatedAt: true } as const;
const STORED_TAB_SELECT = { id: true, name: true, folder: { select: { name: true } } } as const;

function invalidName(error: z.ZodError<{ name: string }>): { ok: false; error: InvalidName } {
  return { ok: false, error: { code: "invalid-input", fieldErrors: z.flattenError(error).fieldErrors } };
}

/** All folders, by name. */
export async function listFolders(): Promise<FolderSummary[]> {
  return getDb().folder.findMany({ select: SUMMARY_SELECT, orderBy: { name: "asc" } });
}

/** The folder with the given name, or `null` if the name is malformed or no such folder exists. */
export async function getFolderByName(name: string): Promise<Folder | null> {
  const folderName = parseName(name);
  if (!folderName) return null;
  return getDb().folder.findUnique({ where: { name: folderName }, select: { id: true, name: true } });
}

/** The tabs of the folder, by name; none for a malformed folder id. */
export async function listTabs(folderId: string): Promise<TabSummary[]> {
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return [];
  return getDb().tab.findMany({
    where: { folderId: parsedFolderId },
    select: SUMMARY_SELECT,
    orderBy: { name: "asc" },
  });
}

/**
 * The tab with the given name in the folder with the given name, together with its folder, or `null` if a name is
 * malformed or no such tab exists.
 */
export async function getTab(folderName: string, tabName: string): Promise<TabWithFolder | null> {
  const folder = parseName(folderName);
  const name = parseName(tabName);
  if (!folder || !name) return null;
  return getDb().tab.findFirst({
    where: { name, folder: { name: folder } },
    select: { id: true, name: true, folder: { select: { id: true, name: true } } },
  });
}

/** Creates a folder with the given name and returns it as stored. */
export async function createFolder(input: { name: string }): Promise<Result<Folder, CreateFolderError>> {
  const parsed = folderInputSchema.safeParse(input);
  if (!parsed.success) return invalidName(parsed.error);

  let folder: Folder;
  try {
    folder = await getDb().folder.create({ data: parsed.data, select: { id: true, name: true } });
  } catch (err) {
    if (isUniqueViolation(err, FOLDER_NAME)) {
      logger.warn({ name: parsed.data.name }, "name of new folder already in use");
      return { ok: false, error: { code: "name-taken" } };
    }
    logger.error({ err }, "failed to create folder");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ folderId: folder.id }, "folder created");
  return { ok: true, value: folder };
}

/** Renames the folder with the given id and returns it as stored. */
export async function renameFolder(id: string, input: { name: string }): Promise<Result<Folder, RenameFolderError>> {
  const folderId = parseFolderId(id);
  if (!folderId) return { ok: false, error: { code: "folder-not-found" } };

  const parsed = folderInputSchema.safeParse(input);
  if (!parsed.success) return invalidName(parsed.error);

  let count: number;
  try {
    // `updateMany` reports a missing folder as a count of 0 instead of throwing; it sets `updatedAt` as well.
    ({ count } = await getDb().folder.updateMany({ where: { id: folderId }, data: parsed.data }));
  } catch (err) {
    if (isUniqueViolation(err, FOLDER_NAME)) {
      logger.warn({ folderId, name: parsed.data.name }, "name of renamed folder already in use");
      return { ok: false, error: { code: "name-taken" } };
    }
    logger.error({ err, folderId }, "failed to rename folder");
    return { ok: false, error: { code: "failed" } };
  }
  if (count === 0) {
    logger.warn({ folderId }, "folder to rename not found");
    return { ok: false, error: { code: "folder-not-found" } };
  }

  logger.info({ folderId }, "folder renamed");
  // The validated name is the stored one: the update wrote exactly this value.
  return { ok: true, value: { id: folderId, name: parsed.data.name } };
}

/** Creates a tab with the given name in the folder with the given id and returns it as stored. */
export async function createTab(folderId: string, input: { name: string }): Promise<Result<StoredTab, CreateTabError>> {
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return { ok: false, error: { code: "folder-not-found" } };

  const parsed = tabInputSchema.safeParse(input);
  if (!parsed.success) return invalidName(parsed.error);

  let tab: StoredTab;
  try {
    tab = await getDb().tab.create({
      data: { ...parsed.data, folderId: parsedFolderId },
      select: STORED_TAB_SELECT,
    });
  } catch (err) {
    if (isUniqueViolation(err, TAB_NAME)) {
      logger.warn({ folderId: parsedFolderId, name: parsed.data.name }, "name of new tab already in use");
      return { ok: false, error: { code: "name-taken" } };
    }
    if (isForeignKeyViolation(err)) {
      logger.warn({ folderId: parsedFolderId }, "folder of new tab not found");
      return { ok: false, error: { code: "folder-not-found" } };
    }
    logger.error({ err, folderId: parsedFolderId }, "failed to create tab");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ tabId: tab.id }, "tab created");
  return { ok: true, value: tab };
}

/** Renames the tab with the given id and returns it as stored. */
export async function renameTab(id: string, input: { name: string }): Promise<Result<StoredTab, RenameTabError>> {
  const tabId = parseTabId(id);
  if (!tabId) return { ok: false, error: { code: "tab-not-found" } };

  const parsed = tabInputSchema.safeParse(input);
  if (!parsed.success) return invalidName(parsed.error);

  let tab: StoredTab | null;
  try {
    const db = getDb();
    // `updateMany` reports a missing tab as a count of 0 instead of throwing; it sets `updatedAt` as well.
    const { count } = await db.tab.updateMany({ where: { id: tabId }, data: parsed.data });
    // The tab is read back, so that a caller gets the stored names, never submitted values.
    tab = count === 0 ? null : await db.tab.findUnique({ where: { id: tabId }, select: STORED_TAB_SELECT });
  } catch (err) {
    if (isUniqueViolation(err, TAB_NAME)) {
      logger.warn({ tabId, name: parsed.data.name }, "name of renamed tab already in use");
      return { ok: false, error: { code: "name-taken" } };
    }
    logger.error({ err, tabId }, "failed to rename tab");
    return { ok: false, error: { code: "failed" } };
  }
  if (tab === null) {
    logger.warn({ tabId }, "tab to rename not found");
    return { ok: false, error: { code: "tab-not-found" } };
  }

  logger.info({ tabId }, "tab renamed");
  return { ok: true, value: tab };
}
