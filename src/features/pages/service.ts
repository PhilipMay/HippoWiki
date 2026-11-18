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
// write stores the actor as the last editor of the page, with the channel of the write (`openContentWrite()` in `actors.ts`), and counts
// its version up, in the same write that changes `updatedAt`; a new page starts with version 1. The folder and the tab
// of the page keep their `updatedAt`, last editor and channel.
//
// A content save whose content is the same as the stored content of the page is no write: after the same checks as
// every content save it stores nothing, so the page keeps its last editor, channel, `updatedAt` and version.
//
// Every content change records a revision of the page in the same write (`PageRevision`): creating a page records
// revision 1, a content save that changes the content records the next one, and a revert, a content save of the
// browser, records one that names the revision it went back to. Moving, renaming, deleting and restoring a page record
// none. The history is read by `history-service.ts`, only for the actor of the browser.

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
  mayReadTab,
  readableFolderWhere,
  readerOf,
  roleOf,
  roleOnFolderOfPage,
  roleSelection,
} from "@/features/folder-roles/service";
import { parseFolderId, parseTabId } from "@/features/folders/schema";
import {
  newPageInputSchema,
  pageContentInputSchema,
  pageNameInputSchema,
  parsePageId,
  parsePageVersion,
  isRevisionNumber,
  type PageFieldErrors,
} from "@/features/pages/schema";
import { deriveName } from "@/features/pages/derive";
import { NEXT_VERSION, softDeleteData } from "@/features/pages/writes";
import { LAST_EDITOR_SELECT, withLastEditor, type LastEditor } from "@/features/users/records";
import type { ChangeChannel, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import {
  isForeignKeyViolation,
  isUniqueViolation,
  LAST_EDITOR,
  PAGE_NAME,
  PAGE_REVISION_NUMBER,
} from "@/lib/db-errors";
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
  /**
   * The state of the page: 1 when it is created, counted up by every write that changes it; a save or a move without a
   * change keeps it (see `optimistic-locking.md`).
   */
  version: number;
  folder: { id: string; name: string };
  tab: { id: string; name: string } | null;
  role: Role | null;
};

/**
 * What the list of deleted pages shows of a page: no content, and when and by whom it was deleted. Nothing writes to a
 * deleted page, so its last editor is the user who deleted it, with the channel of the delete.
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
 * user who deleted it, with the channel of the delete.
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
 * A page as stored by a write, with the names of its folder and tab, what its address is built from, its title and its
 * version after the write.
 */
export type StoredPage = {
  id: string;
  name: string;
  title: string;
  version: number;
  folder: { name: string };
  tab: { name: string } | null;
};

/** The place a page was in when it was deleted: its folder and its tab, if it had one. */
export type PagePlace = { folder: { name: string }; tab: { name: string } | null };

/** The page does not exist or is not in the state the write needs: deleted for a restore, not deleted otherwise. */
type PageNotFound = { code: "page-not-found" };
/**
 * The page was changed after the version the write is based on, or the write stated no valid version; `page` is the
 * page as stored now, so that the caller can show it at its current address.
 */
type PageChanged = { code: "page-changed"; page: StoredPage };
/**
 * The revision to revert to does not exist, its number is malformed, or its content is the content of the page now,
 * so that a revert to it would change nothing.
 */
type RevisionNotFound = { code: "revision-not-found" };

/** Another page already uses the name of the new page at the place: the given one, or the one derived from its title. */
type NewPageNameTaken = NameTaken & { name: string };
/** No name was given, and the title of the content suggests none, e.g. a title in a non-Latin script. */
type NoSuggestedName = { code: "no-suggested-name" };

export type CreatePageError =
  | NotAllowed
  | FolderNotFound
  | TabNotFound
  | InvalidInput<PageFieldErrors>
  | NoSuggestedName
  | NewPageNameTaken
  | Failed;
export type UpdatePageContentError = NotAllowed | PageNotFound | PageChanged | InvalidInput<PageFieldErrors> | Failed;
export type MoveOrRenamePageError =
  NotAllowed | PageNotFound | PageChanged | TabNotFound | InvalidInput<NameFieldErrors> | NameTaken | Failed;
export type DeletePageError = NotAllowed | PageNotFound | PageChanged | Failed;
export type RevertPageError =
  NotAllowed | PageNotFound | RevisionNotFound | PageChanged | InvalidInput<PageFieldErrors> | Failed;
export type RestorePageError =
  NotAllowed | PageNotFound | TabNotFound | InvalidInput<NameFieldErrors> | NameTaken | Failed;

const SUMMARY_SELECT = { id: true, name: true, title: true, updatedAt: true, ...LAST_EDITOR_SELECT } as const;

const STORED_PAGE_SELECT = {
  id: true,
  name: true,
  title: true,
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

/**
 * The pages of the tab, without their content, by name; deleted pages are left out. `null` for an admin and for a tab
 * of a folder without a role of the actor.
 */
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
 * in the folder first. Deleted pages are left out. `null` for an admin and for a folder without a role of the actor.
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
  return directPageFirstPerName(pages.map(withLastEditor));
}

/**
 * Among pages of the same name, moves the page without a tab to the front. The database sorts a missing tab after all
 * tab names; the pages are otherwise left in the order given, by name and then by tab, the order of the list "All
 * pages" of the browser. The tool `list_folder` sorts by tab and then by name instead (`sortByTabThenName()` in
 * `src/features/mcp/tools.ts`).
 */
export function directPageFirstPerName<Entry extends { name: string; tab: unknown }>(pages: Entry[]): Entry[] {
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
 * The validated input of a new page: the name, the title derived from the content, and the content. With a name, the
 * name and the content are validated together, so that both report their errors. Without one, the content is
 * validated and the name derived from its title, as the browser suggests it (`deriveName()`); a title that suggests no
 * valid name gives `no-suggested-name`. Either way the content is parsed once.
 */
async function newPageInput(input: {
  name?: string;
  content: string;
}): Promise<Result<{ name: string; title: string; content: string }, InvalidInput<PageFieldErrors> | NoSuggestedName>> {
  if (input.name !== undefined) {
    const parsed = newPageInputSchema.safeParse({ name: input.name, content: input.content });
    return parsed.success ? { ok: true, value: parsed.data } : invalidInput(parsed.error);
  }
  const parsed = pageContentInputSchema.safeParse({ content: input.content });
  if (!parsed.success) return invalidInput(parsed.error);
  const name = parseName(deriveName(parsed.data.title));
  if (!name) return { ok: false, error: { code: "no-suggested-name" } };
  return { ok: true, value: { name, ...parsed.data } };
}

/**
 * Creates a page with the given name and content, with the title derived from the content, and returns it as stored.
 * Without a name, the page gets the name derived from its title, after all other checks but the name; a title that
 * suggests no name gives `no-suggested-name` and stores nothing. The page is placed in the tab with the id `tabId` or,
 * with `null`, directly in the folder with the given id; the tab must be one of that folder. The actor is the page's
 * last editor, in the browser and through MCP. Revision 1 of the page, with its title and content, the actor and the
 * channel, is stored in the same write.
 */
export async function createPage(
  actor: ContentActor,
  folderId: string,
  input: { name?: string; content: string; tabId: string | null },
): Promise<Result<StoredPage, CreatePageError>> {
  const opened = openContentWrite(actor, "page not created");
  if (opened.refused) return opened.refused;
  const { lastEditedById, lastEditedVia } = opened.editor;

  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return { ok: false, error: { code: "folder-not-found" } };

  const role = await lookUp(
    () => folderRoleOf(actor, parsedFolderId),
    { folderId: parsedFolderId },
    "failed to create page",
  );
  if (!role.ok) return role;
  const refused = refusedByRole(actor, "page not created", role.value, "editPage", { folderId: parsedFolderId });
  if (refused) return refused;

  const tabId = parsePlace(input.tabId);
  if (tabId === undefined) return { ok: false, error: { code: "tab-not-found" } };

  const parsed = await newPageInput(input);
  if (!parsed.ok) return parsed;
  const { name, title, content } = parsed.value;

  let page: StoredPage;
  try {
    page = await getDb().page.create({
      data: {
        name,
        title,
        content,
        tabId,
        folderId: parsedFolderId,
        lastEditedById,
        lastEditedVia,
        revisions: {
          create: {
            number: 1,
            title,
            content,
            userId: lastEditedById,
            via: lastEditedVia,
          },
        },
      },
      select: STORED_PAGE_SELECT,
    });
  } catch (err) {
    // Before the folder and tab keys: a missing actor must not be reported as a missing folder or tab.
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
    if (isUniqueViolation(err, PAGE_NAME)) {
      logger.warn({ folderId: parsedFolderId, tabId, name }, "name of new page already in use");
      return { ok: false, error: { code: "name-taken", name } };
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

/** What a content change stores in the page, and with it in the revision it records. */
type ContentChange = { title: string; content: string; lastEditedById: string; lastEditedVia: ChangeChannel };

/**
 * What the store of a write of a page did: stored the change; found the page with the given version and the change
 * already in it, and stored nothing (with the page as it is stored); or matched no page, which the caller tells apart
 * with `refusedWrite()`.
 */
type PageWrite = { kind: "stored" } | { kind: "unchanged"; page: StoredPage } | { kind: "refused" };

/**
 * The condition of a write that is based on the given version of the page: the page with the id, not deleted, with
 * that version. The write counts the version up in the same statement (`NEXT_VERSION`), so that of two writes based on
 * the same version only the first matches a row.
 */
function atVersion(pageId: string, version: number): { id: string; deletedAt: null; version: number } {
  return { id: pageId, deletedAt: null, version };
}

/**
 * Stores the content change in the page with the given id, if it is not deleted and has the given version, counts its
 * version up and records the revision, all in one transaction: the revision has the next number, the title and the
 * content, the actor and the channel, and `revertedTo`, the number of the revision a revert went back to. A change
 * that is no revert is stored only when its content differs from the stored content of the page; with the same
 * content it stores nothing and records no revision, so the page keeps its last editor, time and version
 * (`unchanged`). A revert is always stored. `refused` when no row matched, and when another write took the number of
 * the revision first, which then changed the page.
 */
async function storeContentChange(
  pageId: string,
  version: number,
  change: ContentChange,
  revertedTo: number | null,
): Promise<PageWrite> {
  try {
    return await getDb().$transaction(async (tx): Promise<PageWrite> => {
      const current = atVersion(pageId, version);
      // `updateMany` reports a missing page as a count of 0 instead of throwing; it sets `updatedAt` as well. A deleted
      // page, one with another version than the given one, and for a content save one with the same content, match no
      // row.
      const { count } = await tx.page.updateMany({
        where: revertedTo === null ? { ...current, content: { not: change.content } } : current,
        data: { ...change, ...NEXT_VERSION },
      });
      if (count === 0) {
        if (revertedTo !== null) return { kind: "refused" };
        // The page as it is now, in the same transaction: a save of the same content to the version it is based on
        // changes nothing; anything else is refused.
        const page = await tx.page.findFirst({
          where: { ...current, content: change.content },
          select: STORED_PAGE_SELECT,
        });
        return page ? { kind: "unchanged", page } : { kind: "refused" };
      }
      // The update locks the row of the page until the transaction ends, so no other write of the page reads the newest
      // revision before this one is stored, and two writes never take the same number.
      const newest = await tx.pageRevision.findFirst({
        where: { pageId },
        orderBy: { number: "desc" },
        select: { number: true },
      });
      await tx.pageRevision.create({
        data: {
          pageId,
          number: (newest?.number ?? 0) + 1,
          title: change.title,
          content: change.content,
          userId: change.lastEditedById,
          via: change.lastEditedVia,
          revertedTo,
        },
      });
      return { kind: "stored" };
    });
  } catch (err) {
    if (isUniqueViolation(err, PAGE_REVISION_NUMBER)) {
      // The row lock of the update orders the numbers, so only a write outside this rule can have taken the number.
      logger.warn(
        { err, pageId, version },
        "revision number of the content change already taken: the change is refused",
      );
      return { kind: "refused" };
    }
    throw err;
  }
}

/**
 * Stores the given content of the page with the given id, with the title derived from it, and returns the page as
 * stored, with the actor as its last editor. Name and place are not touched. A deleted page counts as missing. The
 * checks come in the order role, content with the limits in force, version: the write is based on the given version of
 * the page, and if the page has another one, or no valid version is given, nothing is stored and the result is
 * `page-changed`. It records a revision in the same write. Content that is the same as the stored content, once its
 * line endings are made uniform, passes the same checks and then stores nothing: the page is returned as stored, with
 * its last editor, time and version, and the save is logged apart from a stored one (`storeContentChange()`). It is a
 * write of the browser or of MCP.
 */
export async function updatePageContent(
  actor: ContentActor,
  id: string,
  input: { content: string; version: number | null },
): Promise<Result<StoredPage, UpdatePageContentError>> {
  const opened = openContentWrite(actor, "page not saved");
  if (opened.refused) return opened.refused;
  const { lastEditedById, lastEditedVia } = opened.editor;

  const pageId = parsePageId(id);
  if (!pageId) return { ok: false, error: { code: "page-not-found" } };

  // A page that does not exist has no role either, so that nothing tells whether a page of this id exists.
  const role = await lookUp(() => roleOnFolderOfPage(actor, pageId), { pageId }, "failed to update page");
  if (!role.ok) return role;
  const refused = refusedByRole(actor, "page not saved", role.value, "editPage", { pageId });
  if (refused) return refused;

  // Also content that is the same as the stored content is checked against the limits in force.
  const parsed = pageContentInputSchema.safeParse({ content: input.content });
  if (!parsed.success) return invalidInput(parsed.error);

  const saved = await saveContentChange(
    actor,
    pageId,
    input.version,
    { ...parsed.data, lastEditedById, lastEditedVia },
    {
      revertedTo: null,
      what: "page to update",
      failure: "failed to update page",
    },
  );
  if (!saved.ok) return saved;
  const { kind, page } = saved.value;
  if (kind === "stored") logger.info({ pageId, ...channelOf(actor) }, "page updated");
  else logger.info({ pageId, ...channelOf(actor) }, "page not changed: content is the same");
  return { ok: true, value: page };
}

/**
 * Stores a content change of the page with the given id with `storeContentChange()`, based on the given version, and
 * returns the page as stored and whether the change was stored: the end of every content save, so that a save in the
 * editor and a revert are stored and refused alike. A save of the same content stores nothing and returns the page as
 * it is, with the kind `unchanged`. No valid version, or another one than the page has, stores nothing and gives
 * `page-changed`; a missing or deleted page gives `page-not-found`, logged as `<what> not found`. An unexpected error
 * gives `failed`, logged with `failure`. The caller logs the outcome.
 */
async function saveContentChange(
  actor: ContentActor,
  pageId: string,
  givenVersion: number | null,
  change: ContentChange,
  { revertedTo, what, failure }: { revertedTo: number | null; what: string; failure: string },
): Promise<Result<{ kind: "stored" | "unchanged"; page: StoredPage }, PageNotFound | PageChanged | Failed>> {
  const version = parsePageVersion(givenVersion);
  let page: StoredPage | null;
  try {
    if (version === null) return await refusedWrite(pageId, givenVersion, what);
    const stored = await storeContentChange(pageId, version, change, revertedTo);
    if (stored.kind === "refused") return await refusedWrite(pageId, version, what);
    if (stored.kind === "unchanged") return { ok: true, value: { kind: "unchanged", page: stored.page } };
    page = await findStoredPage(pageId);
  } catch (err) {
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
    logger.error({ err, pageId }, failure);
    return { ok: false, error: { code: "failed" } };
  }
  if (page === null) {
    logger.warn({ pageId }, `${what} not found`);
    return { ok: false, error: { code: "page-not-found" } };
  }
  return { ok: true, value: { kind: "stored", page } };
}

/**
 * Sets the page with the given id back to its revision with the given number: stores the content of the revision, with
 * the title derived from it, and records a new revision with that content, the actor, the channel `web` and the number
 * it went back to, in one write, and returns the page as stored. It is a content save like one in the editor: it needs
 * the function `editPage`, checks the content of the revision with the limits in force (`invalid-input`), and is based
 * on the given version of the page (`page-changed`). A revision that does not exist, a malformed number and a revision
 * whose content is the content of the page now give `revision-not-found`: a revert always changes the content. A
 * deleted page counts as missing. Only the browser reverts.
 */
export async function revertPage(
  actor: BrowserActor,
  id: string,
  input: { revision: number; version: number | null },
): Promise<Result<StoredPage, RevertPageError>> {
  const opened = openContentWrite(actor, "page not reverted");
  if (opened.refused) return opened.refused;
  const { lastEditedById, lastEditedVia } = opened.editor;

  const pageId = parsePageId(id);
  if (!pageId) return { ok: false, error: { code: "page-not-found" } };

  // A page that does not exist has no role either, so that nothing tells whether a page of this id exists.
  const role = await lookUp(() => roleOnFolderOfPage(actor, pageId), { pageId }, "failed to revert page");
  if (!role.ok) return role;
  const refused = refusedByRole(actor, "page not reverted", role.value, "editPage", { pageId });
  if (refused) return refused;

  const { revision } = input;
  if (!isRevisionNumber(revision)) return { ok: false, error: { code: "revision-not-found" } };

  let page: { content: string; revisions: { content: string }[] } | null;
  try {
    page = await getDb().page.findFirst({
      where: { id: pageId, deletedAt: null },
      select: { content: true, revisions: { where: { number: revision }, select: { content: true } } },
    });
  } catch (err) {
    logger.error({ err, pageId }, "failed to revert page");
    return { ok: false, error: { code: "failed" } };
  }
  if (page === null) {
    logger.warn({ pageId }, "page to revert not found");
    return { ok: false, error: { code: "page-not-found" } };
  }
  const target = page.revisions[0];
  if (!target || target.content === page.content) {
    logger.warn({ pageId, revision }, "revision to revert to not found or the content of the page");
    return { ok: false, error: { code: "revision-not-found" } };
  }

  // The limits in force now, which may be stricter than those of the time of the revision.
  const parsed = pageContentInputSchema.safeParse({ content: target.content });
  if (!parsed.success) return invalidInput(parsed.error);

  const saved = await saveContentChange(
    actor,
    pageId,
    input.version,
    { ...parsed.data, lastEditedById, lastEditedVia },
    {
      revertedTo: revision,
      what: "page to revert",
      failure: "failed to revert page",
    },
  );
  if (!saved.ok) return saved;
  logger.info({ pageId, revision, ...channelOf(actor) }, "page reverted");
  return { ok: true, value: saved.value.page };
}

/**
 * Stores the name and the place of a move or rename in the page with the given id, if it is not deleted and has the
 * given version, and counts its version up. A deleted page, one with another version than the given one, and one that
 * has this name and place already, match no row; then no name is checked either. The comparison is part of the write,
 * so that it holds for the name and place stored at that moment. A page with the given version and this name and place
 * stores nothing (`unchanged`); anything else that matched no row is `refused`.
 */
async function storeMoveOrRename(
  pageId: string,
  version: number,
  change: { name: string; tabId: string | null; lastEditedById: string; lastEditedVia: ChangeChannel },
): Promise<PageWrite> {
  const { name, tabId } = change;
  const current = atVersion(pageId, version);
  // `not` never matches a column that is `null`, so a page directly in the folder is matched apart.
  const differs: Prisma.PageWhereInput[] = [
    { name: { not: name } },
    ...(tabId === null ? [{ tabId: { not: null } }] : [{ tabId: null }, { tabId: { not: tabId } }]),
  ];
  const { count } = await getDb().page.updateMany({
    where: { ...current, OR: differs },
    data: { ...change, ...NEXT_VERSION },
  });
  if (count > 0) return { kind: "stored" };
  const unchanged = await getDb().page.findFirst({ where: { ...current, name, tabId }, select: STORED_PAGE_SELECT });
  return unchanged ? { kind: "unchanged", page: unchanged } : { kind: "refused" };
}

/**
 * Stores the given name and place of the page with the given id in one update, with the actor as its last editor, and
 * returns the page as stored. The
 * page is placed in the tab with the id `tabId` of its folder or, with `null`, directly in the folder. The content is
 * neither validated nor touched, so the content limit never blocks a move. A tab of another folder is refused by the
 * composite foreign key and counts as missing, like a deleted page. The write is based on the given version of the
 * page: if the page has another one, or no valid version is given, nothing is stored and the result is
 * `page-changed`, also when the name is taken at the target. A move to the name, once validated and trimmed, and the
 * place the page has stored passes the same checks and then stores nothing: the page is returned as stored, with its
 * last editor, time and version, and the move is logged apart from a stored one. It is a write of the browser or of
 * MCP.
 */
export async function moveOrRenamePage(
  actor: ContentActor,
  id: string,
  input: { name: string; tabId: string | null; version: number | null },
): Promise<Result<StoredPage, MoveOrRenamePageError>> {
  const opened = openContentWrite(actor, "page not moved or renamed");
  if (opened.refused) return opened.refused;
  const { lastEditedById, lastEditedVia } = opened.editor;

  const pageId = parsePageId(id);
  if (!pageId) return { ok: false, error: { code: "page-not-found" } };

  // A page that does not exist has no role either, so that nothing tells whether a page of this id exists.
  const role = await lookUp(() => roleOnFolderOfPage(actor, pageId), { pageId }, "failed to move or rename page");
  if (!role.ok) return role;
  const refused = refusedByRole(actor, "page not moved or renamed", role.value, "moveOrRenamePage", { pageId });
  if (refused) return refused;

  const tabId = parsePlace(input.tabId);
  if (tabId === undefined) return { ok: false, error: { code: "tab-not-found" } };

  const parsed = pageNameInputSchema.safeParse({ name: input.name });
  if (!parsed.success) return invalidInput(parsed.error);
  const { name } = parsed.data;
  const version = parsePageVersion(input.version);

  let written: PageWrite;
  let page: StoredPage | null;
  try {
    if (version === null) return await refusedWrite(pageId, input.version, "page to move or rename");
    written = await storeMoveOrRename(pageId, version, { name, tabId, lastEditedById, lastEditedVia });
    if (written.kind === "refused") return await refusedWrite(pageId, version, "page to move or rename");
    page = written.kind === "unchanged" ? written.page : await findStoredPage(pageId);
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

  if (written.kind === "unchanged") {
    logger.info({ pageId, ...channelOf(actor) }, "page not changed: name and place are the same");
  } else {
    logger.info({ pageId, tabId, ...channelOf(actor) }, "page moved or renamed");
  }
  return { ok: true, value: page };
}

/**
 * Deletes the page with the given id and returns the place it was in. The page keeps its row and its folder, so it
 * can be restored; it gets the time of deletion and loses its tab, because its place inside the folder is forgotten.
 * The actor becomes its last editor: for a deleted page, the user who deleted it. A page that is already deleted
 * counts as missing. The delete is based on the given version of the page: if the page has another one, or no valid
 * version is given, nothing is deleted and the result is `page-changed`. It is a write of the browser or of MCP.
 */
export async function deletePage(
  actor: ContentActor,
  id: string,
  input: { version: number | null },
): Promise<Result<PagePlace, DeletePageError>> {
  const opened = openContentWrite(actor, "page not deleted");
  if (opened.refused) return opened.refused;

  const pageId = parsePageId(id);
  if (!pageId) return { ok: false, error: { code: "page-not-found" } };

  // A page that does not exist has no role either, so that nothing tells whether a page of this id exists.
  const role = await lookUp(() => roleOnFolderOfPage(actor, pageId), { pageId }, "failed to delete page");
  if (!role.ok) return role;
  const refused = refusedByRole(actor, "page not deleted", role.value, "deletePage", { pageId });
  if (refused) return refused;
  const version = parsePageVersion(input.version);

  let place: PagePlace;
  try {
    if (version === null) return await refusedWrite(pageId, input.version, "page to delete");
    // The read of the place and the update in one transaction, which sets no isolation level: it is the version in the
    // condition of the update that makes the place read the one the page had when it was deleted, because a move
    // between the two counts the version up and then the update matches no row. A tab renamed in between counts no
    // version of a page up, so the name of the tab returned can be the one it had at the read.
    const deleted = await getDb().$transaction(async (tx) => {
      // A deleted page, and one with another version than the given one, match neither the read nor the update.
      const where = atVersion(pageId, version);
      const page = await tx.page.findFirst({
        where,
        select: { folder: { select: { name: true } }, tab: { select: { name: true } } },
      });
      if (!page) return null;
      // `updateMany` reports a page changed or deleted in the meantime as a count of 0; it sets `updatedAt` as well.
      const { count } = await tx.page.updateMany({
        where,
        data: softDeleteData(opened.editor),
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
  const opened = openContentWrite(actor, "page not restored");
  if (opened.refused) return opened.refused;
  const { lastEditedById, lastEditedVia } = opened.editor;

  const pageId = parsePageId(id);
  if (!pageId) return { ok: false, error: { code: "page-not-found" } };

  // A page that does not exist has no role either, so that nothing tells whether a page of this id exists.
  const role = await lookUp(() => roleOnFolderOfPage(actor, pageId), { pageId }, "failed to restore page");
  if (!role.ok) return role;
  const refused = refusedByRole(actor, "page not restored", role.value, "deletedPages", { pageId });
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
      data: { deletedAt: null, name, tabId, lastEditedById, lastEditedVia, ...NEXT_VERSION },
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
