// The reads and writes of folders and tabs. The service knows nothing about Next.js, forms or addresses, so that the
// GUI (through `queries.ts` and `actions.ts`) and any other caller can use it, also outside a request. It trusts no
// caller: ids, names and input are parsed here again.
//
// Every function takes the acting user as its first argument, together with the channel of the call. An admin sees and
// changes no content: for an admin every read returns `null` and every write `not-allowed`, before anything else is
// checked and without asking the database. In the browser a user sees only the folders with a role of the user on
// them: for any other folder every read returns `null` and every write `not-allowed`, as if it did not exist. Through
// MCP a user reads every folder, as before folder roles came. A write stores the actor as the last editor of the
// folder or tab, in the same write that changes `updatedAt`.

import { z } from "zod";

import type { Role } from "@/features/folder-roles/roles";
import {
  folderRoleOf,
  mayReadFolder,
  readerOf,
  roleOnFolderOfTab,
  type BrowserActor,
  type ContentActor,
} from "@/features/folder-roles/service";
import { folderInputSchema, parseFolderId, parseTabId, tabInputSchema } from "@/features/folders/schema";
import { LAST_EDITOR_SELECT, withLastEditor, type LastEditor } from "@/features/users/records";
import { parseUserId } from "@/features/users/schema";
import type { Actor } from "@/features/users/service";
import { isAdmin } from "@/features/users/user-type";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { FOLDER_NAME, isForeignKeyViolation, isUniqueViolation, LAST_EDITOR, TAB_NAME } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { parseName, type NameFieldErrors } from "@/lib/names";
import type { Result } from "@/lib/result";

/**
 * What the list of folders shows of a folder: when and by whom it was last changed, and the role of the actor on it;
 * the role is `null` for a read of MCP, which ignores roles.
 */
export type FolderSummary = {
  id: string;
  name: string;
  updatedAt: Date;
  lastEditedBy: LastEditor;
  role: Role | null;
};

/** A folder: its id and its name, which is all an address or a write needs. */
export type Folder = { id: string; name: string };

/** A folder with the role of the actor on it, so that a route can decide what to offer; `null` for a read of MCP. */
export type FolderWithRole = Folder & { role: Role | null };

/** What the list of tabs shows of a tab: when and by whom it was last changed. */
export type TabSummary = { id: string; name: string; updatedAt: Date; lastEditedBy: LastEditor };

/**
 * A tab together with its folder and the role of the actor on the folder, as a tab address shows it; the role is
 * `null` for a read of MCP.
 */
export type TabWithFolder = { id: string; name: string; folder: { id: string; name: string }; role: Role | null };

/** A tab as stored by a write, with the name of its folder: what its address is built from. */
export type StoredTab = { id: string; name: string; folder: { name: string } };

/** The input of a write is invalid; `fieldErrors` holds the messages of the schema per field. */
type InvalidName = { code: "invalid-input"; fieldErrors: NameFieldErrors };
/** Another item already uses the name where it must be unique. */
type NameTaken = { code: "name-taken" };
type FolderNotFound = { code: "folder-not-found" };
type TabNotFound = { code: "tab-not-found" };
/** An unexpected database error, or an actor that is malformed or does not exist; it has been logged. */
type Failed = { code: "failed" };
/** The actor is an admin, who changes no content, or has no role on the folder; it has been logged. */
type NotAllowed = { code: "not-allowed" };

export type CreateFolderError = NotAllowed | InvalidName | NameTaken | Failed;
export type RenameFolderError = NotAllowed | FolderNotFound | InvalidName | NameTaken | Failed;
export type CreateTabError = NotAllowed | FolderNotFound | InvalidName | NameTaken | Failed;
export type RenameTabError = NotAllowed | TabNotFound | InvalidName | NameTaken | Failed;

const SUMMARY_SELECT = { id: true, name: true, updatedAt: true, ...LAST_EDITOR_SELECT } as const;
const STORED_TAB_SELECT = { id: true, name: true, folder: { select: { name: true } } } as const;

function invalidName(error: z.ZodError<{ name: string }>): { ok: false; error: InvalidName } {
  return { ok: false, error: { code: "invalid-input", fieldErrors: z.flattenError(error).fieldErrors } };
}

/**
 * The result of a write by an admin, who changes no content, or by a user without a role on the folder; it is logged
 * with the id of the actor and, for a missing role, the id of the folder or tab.
 */
function notAllowed(
  actor: Actor,
  message: string,
  target: { folderId: string } | { tabId: string } | Record<string, never> = {},
): { ok: false; error: NotAllowed } {
  logger.warn({ actorId: actor.id, ...target }, message);
  return { ok: false, error: { code: "not-allowed" } };
}

const ROLE_SELECT = { role: true } as const;

/** The condition on a folder for a read, and the selection of the reader's role on it. */
type FolderAccess = {
  where: Prisma.FolderWhereInput;
  roles: { where?: Prisma.FolderRoleWhereInput; take?: number; select: typeof ROLE_SELECT };
};

/**
 * The condition on a folder for a read and the selection of the reader's role on it: for a read of the browser only
 * the folders with a role of the reader, with that role; for a read of MCP every folder, without a role.
 */
function folderAccess(reader: string | "any"): FolderAccess {
  if (reader === "any") return { where: {}, roles: { take: 0, select: ROLE_SELECT } };
  return { where: { roles: { some: { userId: reader } } }, roles: { where: { userId: reader }, select: ROLE_SELECT } };
}

/** The role of the reader from the selected roles of a folder, `null` for a read of MCP. */
function roleOf(folder: { roles: { role: Role }[] }): Role | null {
  return folder.roles[0]?.role ?? null;
}

/**
 * The id of the actor, to be stored as the last editor, or `null` if it is malformed, which is logged: the adapters
 * take the actor from a valid session, so only a broken caller passes a malformed id.
 */
function editorIdOf(actor: Actor): string | null {
  const id = parseUserId(actor.id);
  if (!id) logger.error({ actorId: actor.id }, "malformed actor id");
  return id;
}

/** The result of a write whose actor does not exist; it is logged, because only a broken caller can cause it. */
function unknownActor(err: unknown, actor: Actor): { ok: false; error: Failed } {
  logger.error({ err, actorId: actor.id }, "actor of write not found");
  return { ok: false, error: { code: "failed" } };
}

/**
 * The folders the actor sees, by name, each with the role of the actor on it: in the browser the folders with a role
 * of the actor, through MCP all folders. `null` for an admin.
 */
export async function listFolders(actor: ContentActor): Promise<FolderSummary[] | null> {
  if (isAdmin(actor)) return null;
  const reader = readerOf(actor);
  if (!reader) return [];
  const access = folderAccess(reader);
  const folders = await getDb().folder.findMany({
    where: access.where,
    select: { ...SUMMARY_SELECT, roles: access.roles },
    orderBy: { name: "asc" },
  });
  return folders.map(({ roles, ...folder }) => ({ ...withLastEditor(folder), role: roleOf({ roles }) }));
}

/**
 * The folder with the given name, with the role of the actor on it, or `null` for an admin, if the name is malformed,
 * no such folder exists or, in the browser, the actor has no role on it.
 */
export async function getFolderByName(actor: ContentActor, name: string): Promise<FolderWithRole | null> {
  const reader = readerOf(actor);
  if (!reader) return null;
  const folderName = parseName(name);
  if (!folderName) return null;
  const access = folderAccess(reader);
  const folder = await getDb().folder.findFirst({
    where: { name: folderName, ...access.where },
    select: { id: true, name: true, roles: access.roles },
  });
  if (!folder) return null;
  return { id: folder.id, name: folder.name, role: roleOf(folder) };
}

/**
 * The tabs of the folder, by name; none for a malformed folder id, and `null` for an admin and, in the browser, for a
 * folder without a role of the actor.
 */
export async function listTabs(actor: ContentActor, folderId: string): Promise<TabSummary[] | null> {
  if (!(await mayReadFolder(actor, folderId))) return null;
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return [];
  const tabs = await getDb().tab.findMany({
    where: { folderId: parsedFolderId },
    select: SUMMARY_SELECT,
    orderBy: { name: "asc" },
  });
  return tabs.map(withLastEditor);
}

/**
 * The tab with the given name in the folder with the given name, together with its folder and the role of the actor on
 * the folder, or `null` for an admin, if a name is malformed, no such tab exists or, in the browser, the actor has no
 * role on the folder.
 */
export async function getTab(actor: ContentActor, folderName: string, tabName: string): Promise<TabWithFolder | null> {
  const reader = readerOf(actor);
  if (!reader) return null;
  const folder = parseName(folderName);
  const name = parseName(tabName);
  if (!folder || !name) return null;
  const access = folderAccess(reader);
  const tab = await getDb().tab.findFirst({
    where: { name, folder: { name: folder, ...access.where } },
    select: { id: true, name: true, folder: { select: { id: true, name: true, roles: access.roles } } },
  });
  if (!tab) return null;
  const { id, name: storedName, folder: stored } = tab;
  return { id, name: storedName, folder: { id: stored.id, name: stored.name }, role: roleOf(stored) };
}

/**
 * Creates a folder with the given name, with the actor as its last editor and its Owner, and returns it as stored. The
 * folder and the role are stored together. An admin creates no folder, so that no admin ever owns one.
 */
export async function createFolder(
  actor: BrowserActor,
  input: { name: string },
): Promise<Result<Folder, CreateFolderError>> {
  if (isAdmin(actor)) return notAllowed(actor, "folder not created: the actor is an admin");
  const lastEditedById = editorIdOf(actor);
  if (!lastEditedById) return { ok: false, error: { code: "failed" } };

  const parsed = folderInputSchema.safeParse(input);
  if (!parsed.success) return invalidName(parsed.error);

  let folder: Folder;
  try {
    // The folder and the Owner role of its creator in one write, so that no folder is ever left without an Owner.
    folder = await getDb().folder.create({
      data: { ...parsed.data, lastEditedById, roles: { create: { userId: lastEditedById, role: "owner" } } },
      select: { id: true, name: true },
    });
  } catch (err) {
    // A missing actor fails on the last editor or on the user of the role, whichever the database checks first.
    if (isForeignKeyViolation(err)) return unknownActor(err, actor);
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

/** Renames the folder with the given id, with the actor as its last editor, and returns it as stored. */
export async function renameFolder(
  actor: BrowserActor,
  id: string,
  input: { name: string },
): Promise<Result<Folder, RenameFolderError>> {
  if (isAdmin(actor)) return notAllowed(actor, "folder not renamed: the actor is an admin");
  const lastEditedById = editorIdOf(actor);
  if (!lastEditedById) return { ok: false, error: { code: "failed" } };

  const folderId = parseFolderId(id);
  if (!folderId) return { ok: false, error: { code: "folder-not-found" } };

  if (!(await folderRoleOf(actor, folderId))) {
    return notAllowed(actor, "folder not renamed: the actor has no role on the folder", { folderId });
  }

  const parsed = folderInputSchema.safeParse(input);
  if (!parsed.success) return invalidName(parsed.error);

  let count: number;
  try {
    // `updateMany` reports a missing folder as a count of 0 instead of throwing; it sets `updatedAt` as well.
    ({ count } = await getDb().folder.updateMany({
      where: { id: folderId },
      data: { ...parsed.data, lastEditedById },
    }));
  } catch (err) {
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
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

/**
 * Creates a tab with the given name in the folder with the given id, with the actor as its last editor, and returns it
 * as stored. The folder's `updatedAt` and last editor are not touched.
 */
export async function createTab(
  actor: BrowserActor,
  folderId: string,
  input: { name: string },
): Promise<Result<StoredTab, CreateTabError>> {
  if (isAdmin(actor)) return notAllowed(actor, "tab not created: the actor is an admin");
  const lastEditedById = editorIdOf(actor);
  if (!lastEditedById) return { ok: false, error: { code: "failed" } };

  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return { ok: false, error: { code: "folder-not-found" } };

  if (!(await folderRoleOf(actor, parsedFolderId))) {
    return notAllowed(actor, "tab not created: the actor has no role on the folder", { folderId: parsedFolderId });
  }

  const parsed = tabInputSchema.safeParse(input);
  if (!parsed.success) return invalidName(parsed.error);

  let tab: StoredTab;
  try {
    tab = await getDb().tab.create({
      data: { ...parsed.data, folderId: parsedFolderId, lastEditedById },
      select: STORED_TAB_SELECT,
    });
  } catch (err) {
    // Before the folder key: a missing actor must not be reported as a missing folder.
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
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

/** Renames the tab with the given id, with the actor as its last editor, and returns it as stored. */
export async function renameTab(
  actor: BrowserActor,
  id: string,
  input: { name: string },
): Promise<Result<StoredTab, RenameTabError>> {
  if (isAdmin(actor)) return notAllowed(actor, "tab not renamed: the actor is an admin");
  const lastEditedById = editorIdOf(actor);
  if (!lastEditedById) return { ok: false, error: { code: "failed" } };

  const tabId = parseTabId(id);
  if (!tabId) return { ok: false, error: { code: "tab-not-found" } };

  // A tab that does not exist has no role either, so that nothing tells whether a tab of this id exists.
  if (!(await roleOnFolderOfTab(actor, tabId))) {
    return notAllowed(actor, "tab not renamed: the actor has no role on the folder of the tab", { tabId });
  }

  const parsed = tabInputSchema.safeParse(input);
  if (!parsed.success) return invalidName(parsed.error);

  let tab: StoredTab | null;
  try {
    const db = getDb();
    // `updateMany` reports a missing tab as a count of 0 instead of throwing; it sets `updatedAt` as well.
    const { count } = await db.tab.updateMany({ where: { id: tabId }, data: { ...parsed.data, lastEditedById } });
    // The tab is read back, so that a caller gets the stored names, never submitted values.
    tab = count === 0 ? null : await db.tab.findUnique({ where: { id: tabId }, select: STORED_TAB_SELECT });
  } catch (err) {
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
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
