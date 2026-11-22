// The reads and writes of folders and tabs. The service knows nothing about Next.js, forms or addresses, so that the
// GUI (through `queries.ts` and `actions.ts`) and any other caller can use it, also outside a request. It trusts no
// caller: ids, names and input are parsed here again.
//
// Every function takes the acting user as its first argument, together with the channel of the call. An admin sees and
// changes no content: for an admin every read returns `null` and every write `not-allowed`, before anything else is
// checked and without asking the database. In the browser a user sees only the folders with a role of the user on
// them: for any other folder every read returns `null` and every write `not-allowed`, as if it did not exist, and a
// write needs the lowest role of its function (`FUNCTION_ROLES` in `roles.ts`), checked after the admin and before
// anything else but the actor. Through MCP a user works only on the folder of the connection, with the lower of the
// user's role and the role of the connection; every other folder reads like one that does not exist, and a write there
// is `not-allowed`. Folders are created and renamed only in the browser; tabs are created, renamed and deleted in the
// browser and through MCP. A write stores the actor as the last editor of the folder or tab, together with the channel
// of the write (`openContentWrite()` in `actors.ts`), in the same write that changes `updatedAt`; deleting a tab stores the actor and
// the channel as the last editor of the pages it deletes with the tab. A rename to the name the folder or tab has stored
// changes nothing: it is no edit, so it keeps `updatedAt`, the last editor and the channel.

import type { Role } from "@/features/folder-roles/roles";
import {
  channelOf,
  lookUp,
  openContentWrite,
  refusedByRole,
  unknownActor,
  type BrowserActor,
  type ContentActor,
} from "@/features/folder-roles/actors";
import {
  folderRoleOf,
  mayReadFolder,
  readableFolderWhere,
  readerOf,
  roleOf,
  roleOnFolderOfTab,
  roleSelection,
} from "@/features/folder-roles/service";
import { folderInputSchema, parseFolderId, parseTabId, tabInputSchema } from "@/features/folders/schema";
import { softDeleteFileData } from "@/features/files/writes";
import { LINKS_TRANSACTION, lockFolderLinks, updateLinks, type LinkingPage } from "@/features/pages/links-service";
import { tabRenamed } from "@/features/pages/wiki-links";
import { softDeleteData } from "@/features/pages/writes";
import { LAST_EDITOR_SELECT, withLastEditor, type LastEditor } from "@/features/users/records";
import { isAdmin } from "@/features/users/user-type";
import { getDb } from "@/lib/db";
import { FOLDER_NAME, isForeignKeyViolation, isUniqueViolation, LAST_EDITOR, TAB_NAME } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { parseName, type NameFieldErrors } from "@/lib/names";
import {
  invalidInput,
  type Failed,
  type FolderNotFound,
  type InvalidInput,
  type NameTaken,
  type NotAllowed,
  type Result,
  type TabNotFound,
} from "@/lib/result";

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

/** A tab as stored by a rename, with the pages whose wiki links into it were updated. */
export type RenamedTab = StoredTab & { updatedPages: LinkingPage[] };

/** The name of a write is invalid; `fieldErrors` holds the messages of the schema. */
type InvalidName = InvalidInput<NameFieldErrors>;

export type CreateFolderError = NotAllowed | InvalidName | NameTaken | Failed;
export type RenameFolderError = NotAllowed | FolderNotFound | InvalidName | NameTaken | Failed;
export type CreateTabError = NotAllowed | FolderNotFound | InvalidName | NameTaken | Failed;
export type RenameTabError = NotAllowed | TabNotFound | InvalidName | NameTaken | Failed;
export type DeleteTabError = NotAllowed | TabNotFound | Failed;

/** A page deleted together with its tab: its name and its title. */
type PageDeletedWithTab = { name: string; title: string };

/**
 * What a tab deletion leaves: the folder of the tab as stored, the number of pages deleted with the tab, these pages
 * by name and the files deleted with it by name, exactly those the deletion changed.
 */
export type DeletedTab = { folder: Folder; pageCount: number; pages: PageDeletedWithTab[]; files: { name: string }[] };

const SUMMARY_SELECT = { id: true, name: true, updatedAt: true, ...LAST_EDITOR_SELECT } as const;
const STORED_TAB_SELECT = { id: true, name: true, folder: { select: { name: true } } } as const;

/** What the write of a rename did: stored the name, found the name already stored, or found no item. */
type Written<T> = { kind: "stored" } | { kind: "unchanged"; item: T } | { kind: "not-found" };

/**
 * Writes a rename to the validated name, unless the item has that name stored already. The comparison is part of the
 * write, so that it holds for the name stored at that moment: `update` is called with a condition on the name, and only
 * when it matched no row is the item read. An item renamed meanwhile to another name, between the update and the read,
 * is updated once more without the condition, so that the last save wins as for every rename.
 */
async function writeRename<T extends { name: string }>(
  name: string,
  update: (where: { name?: { not: string } }) => Promise<number>,
  read: () => Promise<T | null>,
): Promise<Written<T>> {
  if ((await update({ name: { not: name } })) > 0) return { kind: "stored" };
  const item = await read();
  if (!item) return { kind: "not-found" };
  if (item.name === name) return { kind: "unchanged", item };
  return (await update({})) > 0 ? { kind: "stored" } : { kind: "not-found" };
}

/**
 * The folders the actor sees, by name, each with the role of the actor on it: the folders with a role of the actor,
 * through MCP only the folder of the connection. `null` for an admin and, as for every read, for a malformed actor id.
 */
export async function listFolders(actor: ContentActor): Promise<FolderSummary[] | null> {
  if (isAdmin(actor)) return null;
  const reader = readerOf(actor);
  const readable = readableFolderWhere(actor);
  if (!reader || !readable) return null;
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
  const readable = readableFolderWhere(actor);
  if (!reader || !readable) return null;
  const folderName = parseName(name);
  if (!folderName) return null;
  const folder = await getDb().folder.findFirst({
    where: { name: folderName, ...readable },
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
  const readable = readableFolderWhere(actor);
  if (!reader || !readable) return null;
  const folder = parseName(folderName);
  const name = parseName(tabName);
  if (!folder || !name) return null;
  const tab = await getDb().tab.findFirst({
    where: { name, folder: { name: folder, ...readable } },
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
  const opened = openContentWrite(actor, "folder not created");
  if (opened.refused) return opened.refused;
  const { lastEditedById, lastEditedVia } = opened.editor;

  const parsed = folderInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  let folder: Folder;
  try {
    // The folder and the Owner role of its creator in one write, so that no folder is ever left without an Owner.
    folder = await getDb().folder.create({
      data: {
        ...parsed.data,
        lastEditedById,
        lastEditedVia,
        roles: { create: { userId: lastEditedById, role: "owner" } },
      },
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

  logger.info({ folderId: folder.id, ...channelOf(actor) }, "folder created");
  return { ok: true, value: folder };
}

/**
 * Renames the folder with the given id, with the actor as its last editor, and returns it as stored. A rename to the
 * name the folder has stored at that moment stores nothing and returns the folder as it is, after the same checks as
 * every rename.
 */
export async function renameFolder(
  actor: BrowserActor,
  id: string,
  input: { name: string },
): Promise<Result<Folder, RenameFolderError>> {
  const opened = openContentWrite(actor, "folder not renamed");
  if (opened.refused) return opened.refused;
  const { lastEditedById, lastEditedVia } = opened.editor;

  const folderId = parseFolderId(id);
  if (!folderId) return { ok: false, error: { code: "folder-not-found" } };

  // Only an Owner renames the folder, because a rename changes every address in it.
  const role = await lookUp(() => folderRoleOf(actor, folderId), { folderId }, "failed to rename folder");
  if (!role.ok) return role;
  const refused = refusedByRole(actor, "folder not renamed", role.value, "renameFolder", { folderId });
  if (refused) return refused;

  const parsed = folderInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { name } = parsed.data;

  let written: Written<Folder>;
  try {
    const db = getDb();
    written = await writeRename(
      name,
      // `updateMany` reports a missing folder as a count of 0 instead of throwing; it sets `updatedAt` as well.
      async (where) =>
        (
          await db.folder.updateMany({
            where: { id: folderId, ...where },
            data: { name, lastEditedById, lastEditedVia },
          })
        ).count,
      () => db.folder.findUnique({ where: { id: folderId }, select: { id: true, name: true } }),
    );
  } catch (err) {
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
    if (isUniqueViolation(err, FOLDER_NAME)) {
      logger.warn({ folderId, name }, "name of renamed folder already in use");
      return { ok: false, error: { code: "name-taken" } };
    }
    logger.error({ err, folderId }, "failed to rename folder");
    return { ok: false, error: { code: "failed" } };
  }
  switch (written.kind) {
    case "not-found":
      logger.warn({ folderId }, "folder to rename not found");
      return { ok: false, error: { code: "folder-not-found" } };
    case "unchanged":
      logger.info({ folderId, ...channelOf(actor) }, "folder not changed: name is the same");
      return { ok: true, value: written.item };
    case "stored":
      logger.info({ folderId, ...channelOf(actor) }, "folder renamed");
      // The validated name is the stored one: the update wrote exactly this value.
      return { ok: true, value: { id: folderId, name } };
  }
}

/**
 * Creates a tab with the given name in the folder with the given id, with the actor as its last editor, and returns it
 * as stored. The folder's `updatedAt` and last editor are not touched. It is a write of the browser or of MCP.
 */
export async function createTab(
  actor: ContentActor,
  folderId: string,
  input: { name: string },
): Promise<Result<StoredTab, CreateTabError>> {
  const opened = openContentWrite(actor, "tab not created");
  if (opened.refused) return opened.refused;
  const { lastEditedById, lastEditedVia } = opened.editor;

  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return { ok: false, error: { code: "folder-not-found" } };

  const role = await lookUp(
    () => folderRoleOf(actor, parsedFolderId),
    { folderId: parsedFolderId },
    "failed to create tab",
  );
  if (!role.ok) return role;
  const refused = refusedByRole(actor, "tab not created", role.value, "editTab", { folderId: parsedFolderId });
  if (refused) return refused;

  const parsed = tabInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  let tab: StoredTab;
  try {
    tab = await getDb().tab.create({
      data: { ...parsed.data, folderId: parsedFolderId, lastEditedById, lastEditedVia },
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

  logger.info({ tabId: tab.id, ...channelOf(actor) }, "tab created");
  return { ok: true, value: tab };
}

/**
 * Renames the tab with the given id, with the actor as its last editor, and returns it as stored. In the same write, in
 * one transaction that holds the exclusive lock of the links of the folder, it changes every wiki link into the tab,
 * whatever the page, in the pages of the folder that are not deleted to the new name, as a move of a page does
 * (`updateLinks()` of the links service), and returns those pages: a rename that is refused or fails changes no page. A
 * rename to the name the tab has stored at that moment stores nothing, updates no link and returns the tab as it is,
 * after the same checks as every rename. It is a write of the browser or of MCP.
 */
export async function renameTab(
  actor: ContentActor,
  id: string,
  input: { name: string },
): Promise<Result<RenamedTab, RenameTabError>> {
  const opened = openContentWrite(actor, "tab not renamed");
  if (opened.refused) return opened.refused;
  const { lastEditedById, lastEditedVia } = opened.editor;

  const tabId = parseTabId(id);
  if (!tabId) return { ok: false, error: { code: "tab-not-found" } };

  // A tab that does not exist has no role either, so that nothing tells whether a tab of this id exists.
  const role = await lookUp(() => roleOnFolderOfTab(actor, tabId), { tabId }, "failed to rename tab");
  if (!role.ok) return role;
  const refused = refusedByRole(actor, "tab not renamed", role.value, "editTab", { tabId });
  if (refused) return refused;

  const parsed = tabInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { name } = parsed.data;

  let written: Written<StoredTab>;
  let tab: StoredTab | null;
  let updatedPages: LinkingPage[] = [];
  try {
    ({ written, tab, updatedPages } = await getDb().$transaction(async (tx) => {
      // The folder of the tab, whose links the rename updates; a tab never changes its folder.
      const located = await tx.tab.findFirst({ where: { id: tabId }, select: { folderId: true } });
      if (!located) return { written: { kind: "not-found" } as const, tab: null, updatedPages: [] };
      await lockFolderLinks(tx, located.folderId, "exclusive");
      // The name before the rename, which the links name; under the lock no other rename changes it.
      const before = await tx.tab.findFirst({ where: { id: tabId }, select: { name: true } });
      const read = () => tx.tab.findUnique({ where: { id: tabId }, select: STORED_TAB_SELECT });
      const result = await writeRename(
        name,
        // `updateMany` reports a missing tab as a count of 0 instead of throwing; it sets `updatedAt` as well.
        async (where) =>
          (await tx.tab.updateMany({ where: { id: tabId, ...where }, data: { name, lastEditedById, lastEditedVia } }))
            .count,
        read,
      );
      if (result.kind !== "stored") {
        return { written: result, tab: result.kind === "unchanged" ? result.item : null, updatedPages: [] };
      }
      const updated = before
        ? await updateLinks(tx, located.folderId, { tabName: before.name }, tabRenamed(before.name, name), {
            lastEditedById,
            lastEditedVia,
          })
        : [];
      // A stored tab is read back, so that a caller gets the stored names, never submitted values.
      return { written: result, tab: await read(), updatedPages: updated };
    }, LINKS_TRANSACTION));
  } catch (err) {
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
    if (isUniqueViolation(err, TAB_NAME)) {
      logger.warn({ tabId, name }, "name of renamed tab already in use");
      return { ok: false, error: { code: "name-taken" } };
    }
    logger.error({ err, tabId }, "failed to rename tab");
    return { ok: false, error: { code: "failed" } };
  }
  if (tab === null) {
    logger.warn({ tabId }, "tab to rename not found");
    return { ok: false, error: { code: "tab-not-found" } };
  }

  if (written.kind === "unchanged") {
    logger.info({ tabId, ...channelOf(actor) }, "tab not changed: name is the same");
  } else {
    logger.info({ tabId, linkingPages: updatedPages.length, ...channelOf(actor) }, "tab renamed");
  }
  return { ok: true, value: { ...tab, updatedPages } };
}

/**
 * Deletes the tab with the given id in the folder with the given id for good, together with its pages and files, and
 * returns the folder as stored, the number of pages deleted with the tab, these pages by name and the files by name.
 * The pages and files that are in the tab at that moment are soft deleted with the data that `deletePage()` of the
 * pages service and `deleteFile()` of the files service store for one of them (`softDeleteData()`,
 * `softDeleteFileData()`), with the actor as their last editor and one time of deletion for all of them, but without
 * checking their versions: whatever is in the tab now goes with it. Either the tab and all its pages and files are
 * deleted, or nothing changes. The folder is not touched: its `updatedAt` and last editor stay
 * as they are. It is a write of the browser or of MCP.
 *
 * The role is read on the given folder, not on the folder of the tab, because a tab deleted meanwhile has no folder any
 * more: a Manager of the folder learns that the tab is gone, while a user without the role is refused as for any other
 * write. A tab of another folder counts as missing.
 */
export async function deleteTab(
  actor: ContentActor,
  folderId: string,
  id: string,
): Promise<Result<DeletedTab, DeleteTabError>> {
  const opened = openContentWrite(actor, "tab not deleted");
  if (opened.refused) return opened.refused;

  const parsedFolderId = parseFolderId(folderId);
  const tabId = parseTabId(id);
  if (!parsedFolderId || !tabId) return { ok: false, error: { code: "tab-not-found" } };

  const role = await lookUp(
    () => folderRoleOf(actor, parsedFolderId),
    { folderId: parsedFolderId, tabId },
    "failed to delete tab",
  );
  if (!role.ok) return role;
  const refused = refusedByRole(actor, "tab not deleted", role.value, "deleteTab", {
    folderId: parsedFolderId,
    tabId,
  });
  if (refused) return refused;

  let deleted: DeletedTab | null;
  try {
    deleted = await getDb().$transaction(async (tx) => {
      // The lock on the row of the tab makes a concurrent create, move or restore of a page into this tab wait until
      // the end of the transaction and then fail on the foreign key as a missing tab, so that no page slips into the
      // tab between the update of its pages and the delete of the tab. Only the tab is locked, not its folder.
      const rows = await tx.$queryRaw<{ folderName: string }[]>`
        SELECT f."name" AS "folderName"
        FROM "Tab" t JOIN "Folder" f ON f."id" = t."folderId"
        WHERE t."id" = ${tabId}::uuid AND t."folderId" = ${parsedFolderId}::uuid
        FOR UPDATE OF t`;
      const tab = rows[0];
      if (!tab) return null;
      // A page in a tab is never deleted, so these are exactly the pages of the tab; it sets `updatedAt` as well. The
      // pages come back from the same write, so that the list holds exactly the pages that went with the tab.
      const deletedAt = new Date();
      const pages = await tx.page.updateManyAndReturn({
        where: { tabId },
        data: softDeleteData(opened.editor, deletedAt),
        select: { name: true, title: true },
      });
      // A deleted file has no tab either, so these are exactly the files of the tab; the lock on the row of the tab
      // keeps an upload into it waiting until the tab is gone, and then fails on the foreign key.
      const files = await tx.file.updateManyAndReturn({
        where: { tabId },
        data: softDeleteFileData(opened.editor, deletedAt),
        select: { name: true },
      });
      await tx.tab.delete({ where: { id: tabId } });
      // Names are lowercase letters, digits, hyphens and a dot, so comparing the strings sorts them.
      const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      pages.sort(byName);
      files.sort(byName);
      return { folder: { id: parsedFolderId, name: tab.folderName }, pageCount: pages.length, pages, files };
    });
  } catch (err) {
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
    logger.error({ err, tabId }, "failed to delete tab");
    return { ok: false, error: { code: "failed" } };
  }
  if (deleted === null) {
    logger.warn({ folderId: parsedFolderId, tabId }, "tab to delete not found");
    return { ok: false, error: { code: "tab-not-found" } };
  }

  logger.info(
    {
      actorId: actor.id,
      folderId: parsedFolderId,
      tabId,
      pageCount: deleted.pageCount,
      fileCount: deleted.files.length,
      ...channelOf(actor),
    },
    "tab deleted",
  );
  return { ok: true, value: deleted };
}
