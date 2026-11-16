// The reads and writes of folders and tabs. The service knows nothing about Next.js, forms or addresses, so that the
// GUI (through `queries.ts` and `actions.ts`) and any other caller can use it, also outside a request. It trusts no
// caller: ids, names and input are parsed here again.
//
// Every function takes the acting user as its first argument, together with the channel of the call. An admin sees and
// changes no content: for an admin every read returns `null` and every write `not-allowed`, before anything else is
// checked and without asking the database. In the browser a user sees only the folders with a role of the user on
// them: for any other folder every read returns `null` and every write `not-allowed`, as if it did not exist, and a
// write needs the lowest role of its function (`FUNCTION_ROLES` in `roles.ts`), checked after the admin and before
// anything else but the actor. Through MCP a user reads only the folder of the connection, with the lower of the
// user's role and the role of the connection; every other folder reads like one that does not exist. A write stores
// the actor as the last editor of the folder or tab, in the same write that changes `updatedAt`.

import { z } from "zod";

import { mayDo, type FolderFunction, type Role } from "@/features/folder-roles/roles";
import {
  folderRoleOf,
  mayReadFolder,
  readableFolderWhere,
  readerOf,
  roleOf,
  roleOnFolderOfTab,
  roleSelection,
  type BrowserActor,
  type ContentActor,
} from "@/features/folder-roles/service";
import { folderInputSchema, parseFolderId, parseTabId, tabInputSchema } from "@/features/folders/schema";
import { LAST_EDITOR_SELECT, withLastEditor, type LastEditor } from "@/features/users/records";
import { parseUserId } from "@/features/users/schema";
import type { Actor } from "@/features/users/service";
import { isAdmin } from "@/features/users/user-type";
import { getDb } from "@/lib/db";
import { FOLDER_NAME, isForeignKeyViolation, isUniqueViolation, LAST_EDITOR, TAB_NAME } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { parseName, type NameFieldErrors } from "@/lib/names";
import type { Result } from "@/lib/result";

/**
 * What the list of folders shows of a folder: when and by whom it was last changed, and the role of the actor on it;
 * for a read of MCP the lower of the user's role and the role of the connection.
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

/** A folder with the role of the actor on it, so that a route can decide what to offer. */
export type FolderWithRole = Folder & { role: Role | null };

/** What the list of tabs shows of a tab: when and by whom it was last changed. */
export type TabSummary = { id: string; name: string; updatedAt: Date; lastEditedBy: LastEditor };

/** A tab together with its folder and the role of the actor on the folder, as a tab address shows it. */
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
 * The result of a write by an admin, who changes no content, or by a user whose role on the folder does not allow it;
 * it is logged with the id of the actor and, for a role, the id of the folder or tab and the role, if any.
 */
function notAllowed(
  actor: Actor,
  message: string,
  target: Record<string, string> = {},
): { ok: false; error: NotAllowed } {
  logger.warn({ actorId: actor.id, ...target }, message);
  return { ok: false, error: { code: "not-allowed" } };
}

/**
 * The result of a write whose function the role of the actor does not include, or `null` if it does. Without a role
 * the folder does not exist for the actor; with a lower role the function is not offered.
 */
function refusedByRole(
  actor: Actor,
  what: string,
  role: Role | null,
  fn: FolderFunction,
  target: { folderId: string } | { tabId: string },
): { ok: false; error: NotAllowed } | null {
  if (mayDo(role, fn)) return null;
  if (role === null) return notAllowed(actor, `${what}: the actor has no role on the folder`, target);
  return notAllowed(actor, `${what}: the role of the actor does not allow it`, { ...target, role });
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
 * The folders the actor sees, by name, each with the role of the actor on it: the folders with a role of the actor,
 * through MCP only the folder of the connection. `null` for an admin.
 */
export async function listFolders(actor: ContentActor): Promise<FolderSummary[] | null> {
  if (isAdmin(actor)) return null;
  const reader = readerOf(actor);
  const readable = readableFolderWhere(actor);
  if (!reader || !readable) return [];
  const folders = await getDb().folder.findMany({
    where: readable,
    select: { ...SUMMARY_SELECT, roles: roleSelection(reader) },
    orderBy: { name: "asc" },
  });
  return folders.map(({ roles, ...folder }) => ({
    ...withLastEditor(folder),
    role: roleOf({ id: folder.id, roles }, actor),
  }));
}

/**
 * The folder with the given id, with the role of the actor on it, or `null` for an admin, if the id is malformed, no
 * such folder exists or the actor has no role on it; through MCP every folder but the one of the connection reads as
 * missing.
 */
export async function getFolderById(actor: ContentActor, id: string): Promise<FolderWithRole | null> {
  const reader = readerOf(actor);
  const readable = readableFolderWhere(actor);
  const folderId = parseFolderId(id);
  if (!reader || !readable || !folderId) return null;
  const folder = await getDb().folder.findFirst({
    where: { AND: [{ id: folderId }, readable] },
    select: { id: true, name: true, roles: roleSelection(reader) },
  });
  if (!folder) return null;
  return { id: folder.id, name: folder.name, role: roleOf(folder, actor) };
}

/**
 * The folder with the given name, with the role of the actor on it, or `null` for an admin, if the name is malformed,
 * no such folder exists or the actor has no role on it; through MCP every folder but the one of the connection reads
 * as missing.
 */
export async function getFolderByName(actor: ContentActor, name: string): Promise<FolderWithRole | null> {
  const reader = readerOf(actor);
  if (!reader) return null;
  const folderName = parseName(name);
  if (!folderName) return null;
  const folder = await getDb().folder.findFirst({
    where: { name: folderName, ...readableFolderWhere(actor) },
    select: { id: true, name: true, roles: roleSelection(reader) },
  });
  if (!folder) return null;
  return { id: folder.id, name: folder.name, role: roleOf(folder, actor) };
}

/**
 * The tabs of the folder, by name; none for a malformed folder id, and `null` for an admin and for a folder without a
 * role of the actor, through MCP for every folder but the one of the connection.
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
 * the folder, or `null` for an admin, if a name is malformed, no such tab exists or the actor has no role on the
 * folder; through MCP every folder but the one of the connection reads as missing.
 */
export async function getTab(actor: ContentActor, folderName: string, tabName: string): Promise<TabWithFolder | null> {
  const reader = readerOf(actor);
  if (!reader) return null;
  const folder = parseName(folderName);
  const name = parseName(tabName);
  if (!folder || !name) return null;
  const tab = await getDb().tab.findFirst({
    where: { name, folder: { name: folder, ...readableFolderWhere(actor) } },
    select: { id: true, name: true, folder: { select: { id: true, name: true, roles: roleSelection(reader) } } },
  });
  if (!tab) return null;
  const { id, name: storedName, folder: stored } = tab;
  return { id, name: storedName, folder: { id: stored.id, name: stored.name }, role: roleOf(stored, actor) };
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

  // Only an Owner renames the folder, because a rename changes every address in it.
  const refused = refusedByRole(actor, "folder not renamed", await folderRoleOf(actor, folderId), "renameFolder", {
    folderId,
  });
  if (refused) return refused;

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

  const refused = refusedByRole(actor, "tab not created", await folderRoleOf(actor, parsedFolderId), "editTab", {
    folderId: parsedFolderId,
  });
  if (refused) return refused;

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
  const refused = refusedByRole(actor, "tab not renamed", await roleOnFolderOfTab(actor, tabId), "editTab", { tabId });
  if (refused) return refused;

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
