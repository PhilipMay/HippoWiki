// The reads and writes of pages. The service knows nothing about Next.js, forms or addresses, so that the GUI (through
// `queries.ts` and `actions.ts`) and any other caller can use it, also outside a request. It trusts no caller: ids,
// names and input are parsed here again.
//
// Every function takes the acting user as its first argument, together with the channel of the call. An admin sees and
// changes no content: for an admin every read returns `null` and every write `not-allowed`, before anything else is
// checked and without asking the database. In the browser a user sees only the folders with a role of the user on
// them: for the pages and deleted pages of any other folder every read returns `null` and every write `not-allowed`,
// before anything that could tell whether a page exists. The deleted pages and every write need the lowest role of
// their function (`FUNCTION_ROLES` in `roles.ts`). Through MCP a user works only on the folder of the connection, with
// the lower of the user's role and the role of the connection; every other folder reads like one without a role. A
// write stores the actor as the last editor of the page and counts its version up, in the same write that changes `updatedAt`; a new
// page starts with version 1. The folder and the tab of the page keep their `updatedAt` and last editor.

import { z } from "zod";

import { mayDo, type FolderFunction, type Role } from "@/features/folder-roles/roles";
import {
  folderRoleOf,
  mayReadFolder,
  mayReadTab,
  readableFolderWhere,
  readerOf,
  roleOf,
  roleOnFolderOfPage,
  roleSelection,
  type BrowserActor,
  type ContentActor,
} from "@/features/folder-roles/service";
import { parseFolderId, parseTabId } from "@/features/folders/schema";
import {
  newPageInputSchema,
  pageContentInputSchema,
  pageNameInputSchema,
  parsePageId,
  parsePageVersion,
  type PageFieldErrors,
} from "@/features/pages/schema";
import { LAST_EDITOR_SELECT, withLastEditor, type LastEditor } from "@/features/users/records";
import { parseUserId } from "@/features/users/schema";
import type { Actor } from "@/features/users/service";
import { isAdmin } from "@/features/users/user-type";
import { getDb } from "@/lib/db";
import { isForeignKeyViolation, isUniqueViolation, LAST_EDITOR, PAGE_NAME } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { parseName, type NameFieldErrors } from "@/lib/names";
import type { Result } from "@/lib/result";

/** What the lists show of a page: no content, and when and by whom it was last changed. */
export type PageSummary = { id: string; name: string; title: string; updatedAt: Date; lastEditedBy: LastEditor };

/** What the list of all pages of a folder shows of a page: its summary and its tab, if it has one. */
export type PageWithTabSummary = PageSummary & { tab: { name: string } | null };

/**
 * A page with its folder and its tab, as the page view shows it, and the role of the actor on the folder, so that the
 * view can decide what to offer.
 */
export type PageWithPlace = {
  id: string;
  name: string;
  title: string;
  content: string;
  updatedAt: Date;
  lastEditedBy: LastEditor;
  /** The state of the page: 1 when it is created, counted up by every write. */
  version: number;
  folder: { id: string; name: string };
  tab: { id: string; name: string } | null;
  role: Role | null;
};

/**
 * What the list of deleted pages shows of a page: no content, and when and by whom it was deleted. Nothing writes to a
 * deleted page, so its last editor is the user who deleted it.
 */
export type DeletedPageSummary = {
  id: string;
  name: string;
  title: string;
  deletedAt: Date;
  lastEditedBy: LastEditor;
};

/**
 * A deleted page with its folder, as the deleted page view shows it. A deleted page has no tab; its last editor is the
 * user who deleted it.
 */
export type DeletedPage = {
  id: string;
  name: string;
  title: string;
  content: string;
  deletedAt: Date;
  lastEditedBy: LastEditor;
  folder: { id: string; name: string };
};

/**
 * A page as stored by a write, with the names of its folder and tab, what its address is built from, and its version
 * after the write.
 */
export type StoredPage = {
  id: string;
  name: string;
  version: number;
  folder: { name: string };
  tab: { name: string } | null;
};

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
/**
 * The page was changed after the version the write is based on, or the write stated no valid version; `page` is the
 * page as stored now, so that the caller can show it at its current address.
 */
type PageChanged = { code: "page-changed"; page: StoredPage };
/** An unexpected database error, or an actor that is malformed or does not exist; it has been logged. */
type Failed = { code: "failed" };
/** The actor is an admin, who changes no content, or has no role on the folder; it has been logged. */
type NotAllowed = { code: "not-allowed" };

export type CreatePageError =
  NotAllowed | FolderNotFound | TabNotFound | InvalidInput<PageFieldErrors> | NameTaken | Failed;
export type UpdatePageContentError = NotAllowed | PageNotFound | PageChanged | InvalidInput<PageFieldErrors> | Failed;
export type MoveOrRenamePageError =
  NotAllowed | PageNotFound | PageChanged | TabNotFound | InvalidInput<NameFieldErrors> | NameTaken | Failed;
export type DeletePageError = NotAllowed | PageNotFound | PageChanged | Failed;
export type RestorePageError =
  NotAllowed | PageNotFound | TabNotFound | InvalidInput<NameFieldErrors> | NameTaken | Failed;

const SUMMARY_SELECT = { id: true, name: true, title: true, updatedAt: true, ...LAST_EDITOR_SELECT } as const;

const STORED_PAGE_SELECT = {
  id: true,
  name: true,
  version: true,
  folder: { select: { name: true } },
  tab: { select: { name: true } },
} as const;

/**
 * The pages placed directly in the folder, without their content, by name; deleted pages are left out. `null` for an
 * admin.
 */
export async function listFolderPages(actor: ContentActor, folderId: string): Promise<PageSummary[] | null> {
  if (!(await mayReadFolder(actor, folderId))) return null;
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return [];
  const pages = await getDb().page.findMany({
    where: { folderId: parsedFolderId, tabId: null, deletedAt: null },
    select: SUMMARY_SELECT,
    orderBy: { name: "asc" },
  });
  return pages.map(withLastEditor);
}

/** The pages of the tab, without their content, by name; deleted pages are left out. `null` for an admin. */
export async function listTabPages(actor: ContentActor, tabId: string): Promise<PageSummary[] | null> {
  if (!(await mayReadTab(actor, tabId))) return null;
  const parsedTabId = parseTabId(tabId);
  if (!parsedTabId) return [];
  const pages = await getDb().page.findMany({
    where: { tabId: parsedTabId, deletedAt: null },
    select: SUMMARY_SELECT,
    orderBy: { name: "asc" },
  });
  return pages.map(withLastEditor);
}

/**
 * All pages of the folder, without their content, each with its tab: by name and then by tab, pages placed directly
 * in the folder first. Deleted pages are left out. `null` for an admin.
 */
export async function listAllFolderPages(actor: ContentActor, folderId: string): Promise<PageWithTabSummary[] | null> {
  if (!(await mayReadFolder(actor, folderId))) return null;
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return [];
  const pages = await getDb().page.findMany({
    where: { folderId: parsedFolderId, deletedAt: null },
    select: { ...SUMMARY_SELECT, tab: { select: { name: true } } },
    orderBy: [{ name: "asc" }, { tab: { name: "asc" } }],
  });
  return directPagesFirst(pages.map(withLastEditor));
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
 * folder, together with its folder and tab. `null` for an admin, if a name is malformed or no such page exists there;
 * a deleted page has no address, so it is never found.
 */
export async function getPage(
  actor: ContentActor,
  folderName: string,
  tabName: string | null,
  pageName: string,
): Promise<PageWithPlace | null> {
  const reader = readerOf(actor);
  const readable = readableFolderWhere(actor);
  if (!reader || !readable) return null;
  const folder = parseName(folderName);
  const tab = tabName === null ? null : parseName(tabName);
  const name = parseName(pageName);
  if (!folder || !name || (tabName !== null && !tab)) return null;
  const page = await getDb().page.findFirst({
    where: {
      name,
      folder: { name: folder, ...readable },
      deletedAt: null,
      ...(tab === null ? { tabId: null } : { tab: { name: tab } }),
    },
    select: {
      id: true,
      name: true,
      title: true,
      content: true,
      updatedAt: true,
      ...LAST_EDITOR_SELECT,
      version: true,
      folder: { select: { id: true, name: true, roles: roleSelection(reader) } },
      tab: { select: { id: true, name: true } },
    },
  });
  if (!page) return null;
  const { folder: stored, ...rest } = page;
  return withLastEditor({ ...rest, folder: { id: stored.id, name: stored.name }, role: roleOf(stored, actor) });
}

/**
 * The page with its time of deletion as a `Date`, or `null` if it is not deleted. The reads of deleted pages only
 * read pages with `deletedAt` set; this tells the type system so.
 */
function asDeleted<Entry extends { deletedAt: Date | null }>(page: Entry): (Entry & { deletedAt: Date }) | null {
  const { deletedAt } = page;
  return deletedAt ? { ...page, deletedAt } : null;
}

/**
 * The deleted pages of the folder with id, name, title and time of deletion, without their content, newest first.
 * `null` for an admin and, in the browser, for an actor whose role on the folder is not Manager or Owner.
 */
export async function listDeletedPages(actor: ContentActor, folderId: string): Promise<DeletedPageSummary[] | null> {
  if (!(await mayReadFolder(actor, folderId, "deletedPages"))) return null;
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return [];
  const pages = await getDb().page.findMany({
    where: { folderId: parsedFolderId, deletedAt: { not: null } },
    select: { id: true, name: true, title: true, deletedAt: true, ...LAST_EDITOR_SELECT },
    // The id keeps pages deleted at the same moment in a stable order.
    orderBy: [{ deletedAt: "desc" }, { id: "asc" }],
  });
  return pages.flatMap((page) => asDeleted(withLastEditor(page)) ?? []);
}

/**
 * The deleted page with the given id in the folder with the given name, together with its folder. `null` for an
 * admin, if the name or the id is malformed, the page belongs to another folder or is not deleted, and, in the
 * browser, if the actor's role on the folder is not Manager or Owner.
 */
export async function getDeletedPage(actor: ContentActor, folderName: string, id: string): Promise<DeletedPage | null> {
  const readable = readableFolderWhere(actor, "deletedPages");
  if (!readable) return null;
  const folder = parseName(folderName);
  const pageId = parsePageId(id);
  if (!folder || !pageId) return null;
  const page = await getDb().page.findFirst({
    where: { id: pageId, folder: { name: folder, ...readable }, deletedAt: { not: null } },
    select: {
      id: true,
      name: true,
      title: true,
      content: true,
      deletedAt: true,
      ...LAST_EDITOR_SELECT,
      folder: { select: { id: true, name: true } },
    },
  });
  return page && asDeleted(withLastEditor(page));
}

function invalidInput<Input>(error: z.ZodError<Input>): {
  ok: false;
  error: InvalidInput<z.core.$ZodFlattenedError<Input>["fieldErrors"]>;
} {
  return { ok: false, error: { code: "invalid-input", fieldErrors: z.flattenError(error).fieldErrors } };
}

/**
 * The result of a write by an admin, who changes no content, or by a user whose role on the folder does not allow it;
 * it is logged with the id of the actor and, for a role, the id of the folder or page and the role, if any.
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
  target: { folderId: string } | { pageId: string },
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
 * Where a write comes from, for its log line: the channel and, for MCP, the grant of the connection. The page itself
 * does not show it; its last editor is the user in both channels.
 */
function channelOf(actor: ContentActor): { channel: "browser" } | { channel: "mcp"; grantId: string } {
  return actor.channel === "mcp" ? { channel: "mcp", grantId: actor.connection.grantId } : { channel: "browser" };
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
 * The result of a write of a page that matched no row, or that was not made because it stated no valid version:
 * `page-not-found` if the page does not exist or is deleted, otherwise `page-changed` with the page as stored, because
 * the write is based on an older state of the page. Both are logged as `<what> not found` and `<what> changed`.
 */
async function refusedWrite(
  pageId: string,
  version: unknown,
  what: string,
): Promise<{ ok: false; error: PageNotFound | PageChanged }> {
  const page = await findStoredPage(pageId);
  if (!page) {
    logger.warn({ pageId }, `${what} not found`);
    return { ok: false, error: { code: "page-not-found" } };
  }
  logger.warn({ pageId, version }, `${what} changed after the version the write is based on`);
  return { ok: false, error: { code: "page-changed", page } };
}

/**
 * Creates a page with the given name and content, with the title derived from the content, and returns it as stored.
 * The page is placed in the tab with the id `tabId` or, with `null`, directly in the folder with the given id; the tab
 * must be one of that folder. The actor is the page's last editor, in the browser and through MCP.
 */
export async function createPage(
  actor: ContentActor,
  folderId: string,
  input: { name: string; content: string; tabId: string | null },
): Promise<Result<StoredPage, CreatePageError>> {
  if (isAdmin(actor)) return notAllowed(actor, "page not created: the actor is an admin");
  const lastEditedById = editorIdOf(actor);
  if (!lastEditedById) return { ok: false, error: { code: "failed" } };

  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return { ok: false, error: { code: "folder-not-found" } };

  const refused = refusedByRole(actor, "page not created", await folderRoleOf(actor, parsedFolderId), "editPage", {
    folderId: parsedFolderId,
  });
  if (refused) return refused;

  const tabId = parsePlace(input.tabId);
  if (tabId === undefined) return { ok: false, error: { code: "tab-not-found" } };

  const parsed = newPageInputSchema.safeParse({ name: input.name, content: input.content });
  if (!parsed.success) return invalidInput(parsed.error);

  let page: StoredPage;
  try {
    page = await getDb().page.create({
      data: { ...parsed.data, tabId, folderId: parsedFolderId, lastEditedById },
      select: STORED_PAGE_SELECT,
    });
  } catch (err) {
    // Before the folder and tab keys: a missing actor must not be reported as a missing folder or tab.
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
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

  logger.info({ pageId: page.id, ...channelOf(actor) }, "page created");
  return { ok: true, value: page };
}

/**
 * Stores the given content of the page with the given id, with the title derived from it, and returns the page as
 * stored, with the actor as its last editor. Name and place are not touched. A deleted page counts as missing. The
 * write is based on the given version of the page: if the page has another one, or no valid version is given, nothing
 * is stored and the result is `page-changed`. It is a write of the browser or of MCP.
 */
export async function updatePageContent(
  actor: ContentActor,
  id: string,
  input: { content: string; version: number | null },
): Promise<Result<StoredPage, UpdatePageContentError>> {
  if (isAdmin(actor)) return notAllowed(actor, "page not saved: the actor is an admin");
  const lastEditedById = editorIdOf(actor);
  if (!lastEditedById) return { ok: false, error: { code: "failed" } };

  const pageId = parsePageId(id);
  if (!pageId) return { ok: false, error: { code: "page-not-found" } };

  // A page that does not exist has no role either, so that nothing tells whether a page of this id exists.
  const role = await roleOnFolderOfPage(actor, pageId);
  const refused = refusedByRole(actor, "page not saved", role, "editPage", { pageId });
  if (refused) return refused;

  const parsed = pageContentInputSchema.safeParse({ content: input.content });
  if (!parsed.success) return invalidInput(parsed.error);
  const version = parsePageVersion(input.version);

  let page: StoredPage | null;
  try {
    if (version === null) return await refusedWrite(pageId, input.version, "page to update");
    // `updateMany` reports a missing page as a count of 0 instead of throwing; it sets `updatedAt` as well. A deleted
    // page, and one with another version than the given one, match no row.
    const { count } = await getDb().page.updateMany({
      where: { id: pageId, deletedAt: null, version },
      data: { ...parsed.data, lastEditedById, version: { increment: 1 } },
    });
    if (count === 0) return await refusedWrite(pageId, version, "page to update");
    page = await findStoredPage(pageId);
  } catch (err) {
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
    logger.error({ err, pageId }, "failed to update page");
    return { ok: false, error: { code: "failed" } };
  }
  if (page === null) {
    logger.warn({ pageId }, "page to update not found");
    return { ok: false, error: { code: "page-not-found" } };
  }

  logger.info({ pageId, ...channelOf(actor) }, "page updated");
  return { ok: true, value: page };
}

/**
 * Stores the given name and place of the page with the given id in one update, with the actor as its last editor, and
 * returns the page as stored. The
 * page is placed in the tab with the id `tabId` of its folder or, with `null`, directly in the folder. The content is
 * neither validated nor touched, so the content limit never blocks a move. A tab of another folder is refused by the
 * composite foreign key and counts as missing, like a deleted page. The write is based on the given version of the
 * page: if the page has another one, or no valid version is given, nothing is stored and the result is
 * `page-changed`, also when the name is taken at the target. It is a write of the browser or of MCP.
 */
export async function moveOrRenamePage(
  actor: ContentActor,
  id: string,
  input: { name: string; tabId: string | null; version: number | null },
): Promise<Result<StoredPage, MoveOrRenamePageError>> {
  if (isAdmin(actor)) return notAllowed(actor, "page not moved or renamed: the actor is an admin");
  const lastEditedById = editorIdOf(actor);
  if (!lastEditedById) return { ok: false, error: { code: "failed" } };

  const pageId = parsePageId(id);
  if (!pageId) return { ok: false, error: { code: "page-not-found" } };

  // A page that does not exist has no role either, so that nothing tells whether a page of this id exists.
  const role = await roleOnFolderOfPage(actor, pageId);
  const refused = refusedByRole(actor, "page not moved or renamed", role, "moveOrRenamePage", { pageId });
  if (refused) return refused;

  const tabId = parsePlace(input.tabId);
  if (tabId === undefined) return { ok: false, error: { code: "tab-not-found" } };

  const parsed = pageNameInputSchema.safeParse({ name: input.name });
  if (!parsed.success) return invalidInput(parsed.error);
  const { name } = parsed.data;
  const version = parsePageVersion(input.version);

  let page: StoredPage | null;
  try {
    if (version === null) return await refusedWrite(pageId, input.version, "page to move or rename");
    // A deleted page, and one with another version than the given one, match no row; then no name is checked either.
    const { count } = await getDb().page.updateMany({
      where: { id: pageId, deletedAt: null, version },
      data: { name, tabId, lastEditedById, version: { increment: 1 } },
    });
    if (count === 0) return await refusedWrite(pageId, version, "page to move or rename");
    page = await findStoredPage(pageId);
  } catch (err) {
    // Before the tab key: a missing actor must not be reported as a missing tab.
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
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

  logger.info({ pageId, tabId, ...channelOf(actor) }, "page moved or renamed");
  return { ok: true, value: page };
}

/**
 * Deletes the page with the given id and returns the place it was in. The page keeps its row and its folder, so it
 * can be restored; it gets the time of deletion and loses its tab, because its place inside the folder is forgotten.
 * The actor becomes its last editor: for a deleted page, the user who deleted it. A page that is already deleted
 * counts as missing. The delete is based on the given version of the page: if the page has another one, or no valid
 * version is given, nothing is deleted and the result is `page-changed`.
 */
export async function deletePage(
  actor: BrowserActor,
  id: string,
  input: { version: number | null },
): Promise<Result<PagePlace, DeletePageError>> {
  if (isAdmin(actor)) return notAllowed(actor, "page not deleted: the actor is an admin");
  const lastEditedById = editorIdOf(actor);
  if (!lastEditedById) return { ok: false, error: { code: "failed" } };

  const pageId = parsePageId(id);
  if (!pageId) return { ok: false, error: { code: "page-not-found" } };

  // A page that does not exist has no role either, so that nothing tells whether a page of this id exists.
  const role = await roleOnFolderOfPage(actor, pageId);
  const refused = refusedByRole(actor, "page not deleted", role, "deletePage", { pageId });
  if (refused) return refused;
  const version = parsePageVersion(input.version);

  let place: PagePlace;
  try {
    if (version === null) return await refusedWrite(pageId, input.version, "page to delete");
    // One transaction, so that the place read is the one the page had when it was deleted.
    const deleted = await getDb().$transaction(async (tx) => {
      // A deleted page, and one with another version than the given one, match neither the read nor the update.
      const where = { id: pageId, deletedAt: null, version };
      const page = await tx.page.findFirst({
        where,
        select: { folder: { select: { name: true } }, tab: { select: { name: true } } },
      });
      if (!page) return null;
      // `updateMany` reports a page changed or deleted in the meantime as a count of 0; it sets `updatedAt` as well.
      const { count } = await tx.page.updateMany({
        where,
        data: { deletedAt: new Date(), tabId: null, lastEditedById, version: { increment: 1 } },
      });
      return count === 0 ? null : page;
    });
    if (deleted === null) return await refusedWrite(pageId, version, "page to delete");
    place = deleted;
  } catch (err) {
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
    logger.error({ err, pageId }, "failed to delete page");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ pageId, ...channelOf(actor) }, "page deleted");
  return { ok: true, value: place };
}

/**
 * Restores the deleted page with the given id into its folder, under the given name, at the given place, and returns
 * it as stored, with the actor as its last editor: in the tab with the id `tabId` of its folder or, with `null`,
 * directly in the folder. The content is
 * neither validated nor touched. A page that is not deleted counts as missing; a tab of another folder is refused by
 * the composite foreign key and counts as missing as well. A name that is taken at the place gives `name-taken`, as
 * for a new page: a deleted page never holds a name, so the name may have been given away since the page was deleted.
 */
export async function restorePage(
  actor: BrowserActor,
  id: string,
  input: { name: string; tabId: string | null },
): Promise<Result<StoredPage, RestorePageError>> {
  if (isAdmin(actor)) return notAllowed(actor, "page not restored: the actor is an admin");
  const lastEditedById = editorIdOf(actor);
  if (!lastEditedById) return { ok: false, error: { code: "failed" } };

  const pageId = parsePageId(id);
  if (!pageId) return { ok: false, error: { code: "page-not-found" } };

  // A page that does not exist has no role either, so that nothing tells whether a page of this id exists.
  const role = await roleOnFolderOfPage(actor, pageId);
  const refused = refusedByRole(actor, "page not restored", role, "deletedPages", { pageId });
  if (refused) return refused;

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
      data: { deletedAt: null, name, tabId, lastEditedById, version: { increment: 1 } },
    });
    page = count === 0 ? null : await findStoredPage(pageId);
  } catch (err) {
    // Before the tab key: a missing actor must not be reported as a missing tab.
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
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

  logger.info({ pageId, tabId, ...channelOf(actor) }, "page restored");
  return { ok: true, value: page };
}
