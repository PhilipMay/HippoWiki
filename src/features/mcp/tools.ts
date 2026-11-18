// The handlers of the MCP tools: what an AI app can do with the folder of its connection. They follow the rules of the
// browser, the version check of optimistic locking included, and call the services of the folders and pages with the
// actor of MCP, which carries the connection: the services give it only the folder of the connection, with the lower
// of the user's role and the role of the connection, as `queries.ts` does with the channel `web` for the GUI. Which
// tools a connection gets, and how a client sees them, is `server.ts`; their inputs and outputs are `tool-schemas.ts`.
// The tools know nothing about HTTP, tokens or Next.js: the adapter in `http.ts` finds out who is calling, and with
// which connection, before a tool runs. No import of `next` or `react`, so the tools load wherever the services load.

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { z } from "zod";

import { mayDo } from "@/features/folder-roles/roles";
import type { McpActor } from "@/features/folder-roles/actors";
import * as folderService from "@/features/folders/service";
import type {
  createPageInput,
  createTabInput,
  deletedPageOutput,
  deletedTabOutput,
  deletePageInput,
  deleteTabInput,
  listFolderOutput,
  moveOrRenamePageInput,
  readPageInput,
  readPageOutput,
  renameTabInput,
  replacePageContentInput,
  storedPageOutput,
  storedTabOutput,
} from "@/features/mcp/tool-schemas";
import { TITLE_HEADING_MISSING_MESSAGE } from "@/features/pages/schema";
import * as pageService from "@/features/pages/service";
import { deletedPagesPath, folderPath, pagePath, tabPath } from "@/lib/addresses";
import { logger } from "@/lib/logger";

/** What the tools need to know about the wiki they serve and the connection they serve it to. */
export type WikiToolsOptions = {
  /**
   * The public address of the wiki (`HIPPOWIKI_PUBLIC_URL`), without a trailing slash, as the adapter checked it: the
   * tools give out full URLs that a person can open. Without it there is no MCP server.
   */
  publicUrl: string;
  /** The actor of MCP: the user of the token of the request and the connection of its grant. */
  actor: McpActor;
  /** The folder of the connection, as the adapter read it for this request; its name is the current one. */
  folder: { id: string; name: string };
};

/** The result of a tool that worked: the data for the client, and the same as text for the model. */
function result(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

/**
 * The result of a tool that could not do what was asked, e.g. because a page does not exist. It is a tool error
 * and not a protocol error, so the model reads the message and can try again with other arguments.
 */
function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** The answer to a failed read or write that cannot be told apart from the outside. */
const READ_FAILED = "The wiki could not be read. Please try again later.";
const WRITE_FAILED = "The change could not be stored. Please try again later.";

/**
 * Runs a tool. An unexpected error, such as a database that cannot be reached, is logged and answered with a general
 * message: the SDK would otherwise pass the message of the error on to the client.
 */
async function run(
  tool: string,
  work: () => Promise<CallToolResult>,
  failed: string = READ_FAILED,
): Promise<CallToolResult> {
  try {
    return await work();
  } catch (err) {
    logger.error({ err, tool }, "mcp tool failed");
    return toolError(failed);
  }
}

/** The address of a path of the wiki: the full URL that a person can open. */
function addressOf({ publicUrl }: WikiToolsOptions, path: string): string {
  return `${publicUrl}${path}`;
}

/** The answer when the folder of the connection cannot be read with the actor any more, e.g. after a role change. */
function folderGone(): CallToolResult {
  return toolError("The folder of this connection cannot be read any more. The user's role on it may have changed.");
}

/** Where a page is, as a message names it: directly in the folder, or in a tab of it. */
function placeOf(folderName: string, tab: string | null): string {
  return tab === null ? `directly in the folder "${folderName}"` : `in the tab "${tab}" of the folder "${folderName}"`;
}

/** The tool error of a page that does not exist, also a deleted one, with where to find the pages. */
function pageNotFound(folderName: string, tab: string | null, page: string): CallToolResult {
  return toolError(
    `There is no page named "${page}" ${placeOf(folderName, tab)}. Use list_folder to see the pages of the folder ` +
      "and the tab each one is in.",
  );
}

/** Compares two names. Names are lowercase letters, digits and hyphens, so comparing the strings sorts them. */
function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The order of `list_folder`: the pages placed directly in the folder first, then the pages in tabs, by tab and then
 * by name. It is sorted here and not taken from the service, whose order is the one of the list "All pages" of the
 * browser: by name and then by tab (`directPageFirstPerName()` in the pages service).
 */
function sortByTabThenName<Page extends { name: string; tab: { name: string } | null }>(pages: Page[]): Page[] {
  return pages.toSorted((a, b) => {
    if (a.tab === null || b.tab === null) {
      if (a.tab !== b.tab) return a.tab === null ? -1 : 1;
    } else {
      const byTab = compareNames(a.tab.name, b.tab.name);
      if (byTab !== 0) return byTab;
    }
    return compareNames(a.name, b.name);
  });
}

/** The tool `list_folder`: the tabs and pages of the folder of the connection, the pages placed directly in it first. */
export async function listFolder(options: WikiToolsOptions): Promise<CallToolResult> {
  return run("list_folder", async () => {
    const { actor, folder } = options;
    const tabs = await folderService.listTabs(actor, folder.id);
    // The service leaves deleted pages out.
    const allPages = await pageService.listAllFolderPages(actor, folder.id);
    // `null` when the actor may no longer read the folder.
    if (!tabs || !allPages) return folderGone();
    const pages = sortByTabThenName(allPages);
    return result({
      folder: { name: folder.name, address: addressOf(options, folderPath(folder.name)) },
      tabs: tabs.map((tab) => ({
        name: tab.name,
        address: addressOf(options, tabPath(folder.name, tab.name)),
        lastChanged: tab.updatedAt.toISOString(),
        lastEditedBy: tab.lastEditedBy.name,
        lastEditedVia: tab.lastEditedBy.via,
      })),
      pages: pages.map((page) => ({
        name: page.name,
        title: page.title,
        tab: page.tab?.name ?? null,
        address: addressOf(options, pagePath(folder.name, page.tab?.name ?? null, page.name)),
        lastChanged: page.updatedAt.toISOString(),
        lastEditedBy: page.lastEditedBy.name,
        lastEditedVia: page.lastEditedBy.via,
      })),
    } satisfies z.infer<typeof listFolderOutput>);
  });
}

/**
 * The tool `read_page`: a page of the folder of the connection by its tab, if it is in one, and its name, with its
 * version. A deleted page is not found.
 */
export async function readPage(
  options: WikiToolsOptions,
  input: z.infer<typeof readPageInput>,
): Promise<CallToolResult> {
  return run("read_page", async () => {
    const tab = input.tab ?? null;
    const page = await pageService.getPage(options.actor, options.folder.name, tab, input.page);
    if (!page) return pageNotFound(options.folder.name, tab, input.page);
    return result({
      name: page.name,
      title: page.title,
      folder: page.folder.name,
      tab: page.tab?.name ?? null,
      content: page.content,
      address: addressOf(options, pagePath(page.folder.name, page.tab?.name ?? null, page.name)),
      lastChanged: page.updatedAt.toISOString(),
      lastEditedBy: page.lastEditedBy.name,
      lastEditedVia: page.lastEditedBy.via,
      version: page.version,
    } satisfies z.infer<typeof readPageOutput>);
  });
}

/** The answer when the role on the folder does not allow a change, e.g. because it was lowered meanwhile. */
const NOT_ALLOWED = "Your role on the folder does not allow this change, so nothing was changed.";

/**
 * The tool error of a tab that does not exist, also one deleted meanwhile: a connection that may create tabs learns
 * that it can create the tab, the other connections that tabs are created in the browser.
 */
function tabNotFound(options: WikiToolsOptions, tab: string): CallToolResult {
  const create = mayDo(options.actor.connection.role, "editTab")
    ? "or create the tab with create_tab"
    : "tabs are created in the browser";
  return toolError(
    `There is no tab named "${tab}" in the folder "${options.folder.name}", so nothing was changed. Use list_folder ` +
      `to see the tabs of the folder; ${create}.`,
  );
}

/**
 * The id of the tab with the given name in the folder of the connection, `null` for none, or the tool error for a tab
 * that does not exist.
 */
async function tabIdOf(
  options: WikiToolsOptions,
  tab: string | null | undefined,
): Promise<{ tabId: string | null; error?: never } | { error: CallToolResult }> {
  if (tab === null || tab === undefined) return { tabId: null };
  const found = await folderService.getTab(options.actor, options.folder.name, tab);
  return found ? { tabId: found.id } : { error: tabNotFound(options, tab) };
}

/** The tool error of input that the service refused, with what to do next. */
function invalidInput(fieldErrors: { name?: string[]; content?: string[] }): CallToolResult {
  const messages: string[] = [];
  if (fieldErrors.content?.length) {
    messages.push(
      fieldErrors.content.includes(TITLE_HEADING_MISSING_MESSAGE)
        ? "The content must start with a title heading, such as # Title. Add one and try again."
        : `The content is not valid: ${fieldErrors.content.join(" ")}`,
    );
  }
  if (fieldErrors.name?.length) {
    messages.push(
      `The name is not valid: ${fieldErrors.name.join(" ")} A name has lowercase letters, digits and single ` +
        "hyphens, such as release-notes.",
    );
  }
  return toolError(`${messages.join(" ")} Nothing was changed.`);
}

function nameTaken(folderName: string, tab: string | null, name: string): CallToolResult {
  return toolError(
    `A page named "${name}" already exists ${placeOf(folderName, tab)}, so nothing was changed. Choose another ` +
      "name, or use replace_page_content to change that page.",
  );
}

/**
 * The tool error of a change based on an older version than the stored one, or on no valid version: who changed the
 * page last, how and when, and that the page has to be read again.
 */
async function pageChanged(options: WikiToolsOptions, stored: pageService.StoredPage): Promise<CallToolResult> {
  const page = await pageService.getPage(options.actor, options.folder.name, stored.tab?.name ?? null, stored.name);
  const by = page
    ? ` by ${page.lastEditedBy.name} via ${page.lastEditedBy.via} at ${page.updatedAt.toISOString()}`
    : "";
  return toolError(
    `The page was changed${by}, after the version this change is based on, or the change states no valid version. ` +
      "Nothing was changed. Read the page again with read_page and base the change on its current content and " +
      "version.",
  );
}

/**
 * The page as stored by a write, as `create_page`, `replace_page_content` and `move_or_rename_page` return it, with its
 * title and its version: the new one after a change, the same one after a content save, or a move to the own name and
 * place, without a change, which stores nothing.
 */
function storedResult(options: WikiToolsOptions, stored: pageService.StoredPage): CallToolResult {
  const tab = stored.tab?.name ?? null;
  return result({
    name: stored.name,
    title: stored.title,
    tab,
    address: addressOf(options, pagePath(options.folder.name, tab, stored.name)),
    version: stored.version,
  } satisfies z.infer<typeof storedPageOutput>);
}

/**
 * The tool `create_page`: a new page with the given content in the folder of the connection or one of its tabs. Without
 * a name it gets the name the browser suggests for its title.
 */
export async function createPage(
  options: WikiToolsOptions,
  input: z.infer<typeof createPageInput>,
): Promise<CallToolResult> {
  return run(
    "create_page",
    async () => {
      const { folder } = options;
      const place = await tabIdOf(options, input.tab);
      if (place.error) return place.error;
      // Without a name, the service derives it from the title, after its own checks.
      const created = await pageService.createPage(options.actor, folder.id, {
        ...(input.name === undefined ? {} : { name: input.name }),
        content: input.content,
        tabId: place.tabId,
      });
      if (created.ok) return storedResult(options, created.value);
      switch (created.error.code) {
        case "not-allowed":
          return toolError(NOT_ALLOWED);
        case "folder-not-found":
          return folderGone();
        case "tab-not-found":
          return tabNotFound(options, input.tab ?? "");
        case "invalid-input":
          return invalidInput(created.error.fieldErrors);
        case "no-suggested-name":
          return toolError(
            "The title suggests no name for the page, so nothing was changed. Give a name of lowercase letters, " +
              "digits and single hyphens.",
          );
        case "name-taken":
          return nameTaken(folder.name, input.tab ?? null, created.error.name);
        case "failed":
          return toolError(WRITE_FAILED);
      }
    },
    WRITE_FAILED,
  );
}

/** The tool `replace_page_content`: the whole content of a page of the folder of the connection, based on a version. */
export async function replacePageContent(
  options: WikiToolsOptions,
  input: z.infer<typeof replacePageContentInput>,
): Promise<CallToolResult> {
  return run(
    "replace_page_content",
    async () => {
      const tab = input.tab ?? null;
      const page = await pageService.getPage(options.actor, options.folder.name, tab, input.page);
      if (!page) return pageNotFound(options.folder.name, tab, input.page);
      const saved = await pageService.updatePageContent(options.actor, page.id, {
        content: input.content,
        version: input.version ?? null,
      });
      if (saved.ok) return storedResult(options, saved.value);
      switch (saved.error.code) {
        case "not-allowed":
          return toolError(NOT_ALLOWED);
        case "page-not-found":
          return pageNotFound(options.folder.name, tab, input.page);
        case "page-changed":
          return pageChanged(options, saved.error.page);
        case "invalid-input":
          return invalidInput(saved.error.fieldErrors);
        case "failed":
          return toolError(WRITE_FAILED);
      }
    },
    WRITE_FAILED,
  );
}

/**
 * The tool `move_or_rename_page`: a page of the folder of the connection to another tab of it, or directly into it,
 * and with a new name, based on a version.
 */
export async function moveOrRenamePage(
  options: WikiToolsOptions,
  input: z.infer<typeof moveOrRenamePageInput>,
): Promise<CallToolResult> {
  return run(
    "move_or_rename_page",
    async () => {
      const tab = input.tab ?? null;
      const page = await pageService.getPage(options.actor, options.folder.name, tab, input.page);
      if (!page) return pageNotFound(options.folder.name, tab, input.page);
      const place = await tabIdOf(options, input.newTab);
      if (place.error) return place.error;
      const moved = await pageService.moveOrRenamePage(options.actor, page.id, {
        name: input.newName,
        tabId: place.tabId,
        version: input.version ?? null,
      });
      if (moved.ok) return storedResult(options, moved.value);
      switch (moved.error.code) {
        case "not-allowed":
          return toolError(NOT_ALLOWED);
        case "page-not-found":
          return pageNotFound(options.folder.name, tab, input.page);
        case "page-changed":
          return pageChanged(options, moved.error.page);
        case "tab-not-found":
          return tabNotFound(options, input.newTab ?? "");
        case "invalid-input":
          return invalidInput(moved.error.fieldErrors);
        case "name-taken":
          return nameTaken(options.folder.name, input.newTab, input.newName);
        case "failed":
          return toolError(WRITE_FAILED);
      }
    },
    WRITE_FAILED,
  );
}

/** What a delete tells the agent about restoring: only a person in the browser restores deleted pages. */
const RESTORE_PAGE =
  "The page can be restored by a Manager or Owner of the folder in the browser, under Deleted pages at the address " +
  "deletedPagesAddress. Deleted pages can be neither seen nor restored through this connection.";

/**
 * The tool `delete_page`: a page of the folder of the connection by its tab, if it is in one, and its name, based on a
 * version, deleted as in the browser: it goes to the deleted pages of the folder, from where a person can restore it.
 */
export async function deletePage(
  options: WikiToolsOptions,
  input: z.infer<typeof deletePageInput>,
): Promise<CallToolResult> {
  return run(
    "delete_page",
    async () => {
      const tab = input.tab ?? null;
      const page = await pageService.getPage(options.actor, options.folder.name, tab, input.page);
      if (!page) return pageNotFound(options.folder.name, tab, input.page);
      const deleted = await pageService.deletePage(options.actor, page.id, { version: input.version ?? null });
      if (deleted.ok) {
        return result({
          name: page.name,
          title: page.title,
          tab: deleted.value.tab?.name ?? null,
          deletedPagesAddress: addressOf(options, deletedPagesPath(deleted.value.folder.name)),
          restore: RESTORE_PAGE,
        } satisfies z.infer<typeof deletedPageOutput>);
      }
      switch (deleted.error.code) {
        case "not-allowed":
          return toolError(NOT_ALLOWED);
        case "page-not-found":
          return pageNotFound(options.folder.name, tab, input.page);
        case "page-changed":
          return pageChanged(options, deleted.error.page);
        case "failed":
          return toolError(WRITE_FAILED);
      }
    },
    WRITE_FAILED,
  );
}

/** The tool error of a tab name that another tab of the folder has. */
function tabNameTaken(options: WikiToolsOptions, name: string, next: string): CallToolResult {
  return toolError(
    `A tab named "${name}" already exists in the folder "${options.folder.name}", so nothing was changed. ${next}`,
  );
}

/** The tab as stored by a write, as `create_tab` and `rename_tab` return it, with its address. */
function storedTabResult(options: WikiToolsOptions, tab: folderService.StoredTab): CallToolResult {
  return result({
    name: tab.name,
    address: addressOf(options, tabPath(tab.folder.name, tab.name)),
  } satisfies z.infer<typeof storedTabOutput>);
}

/** The tool `create_tab`: a new, empty tab of the folder of the connection with the given name. */
export async function createTab(
  options: WikiToolsOptions,
  input: z.infer<typeof createTabInput>,
): Promise<CallToolResult> {
  return run(
    "create_tab",
    async () => {
      const created = await folderService.createTab(options.actor, options.folder.id, { name: input.name });
      if (created.ok) return storedTabResult(options, created.value);
      switch (created.error.code) {
        case "not-allowed":
          return toolError(NOT_ALLOWED);
        case "folder-not-found":
          return folderGone();
        case "invalid-input":
          return invalidInput(created.error.fieldErrors);
        case "name-taken":
          return tabNameTaken(options, input.name, "Choose another name, or put the pages into that tab.");
        case "failed":
          return toolError(WRITE_FAILED);
      }
    },
    WRITE_FAILED,
  );
}

/**
 * The tool `rename_tab`: a tab of the folder of the connection, by its current name, with a new name. As in the
 * browser, a rename is not checked against changes meanwhile; the addresses of the pages in the tab change with it.
 */
export async function renameTab(
  options: WikiToolsOptions,
  input: z.infer<typeof renameTabInput>,
): Promise<CallToolResult> {
  return run(
    "rename_tab",
    async () => {
      const tab = await folderService.getTab(options.actor, options.folder.name, input.tab);
      if (!tab) return tabNotFound(options, input.tab);
      const renamed = await folderService.renameTab(options.actor, tab.id, { name: input.newName });
      if (renamed.ok) return storedTabResult(options, renamed.value);
      switch (renamed.error.code) {
        case "not-allowed":
          return toolError(NOT_ALLOWED);
        case "tab-not-found":
          return tabNotFound(options, input.tab);
        case "invalid-input":
          return invalidInput(renamed.error.fieldErrors);
        case "name-taken":
          return tabNameTaken(options, input.newName, "Choose another name.");
        case "failed":
          return toolError(WRITE_FAILED);
      }
    },
    WRITE_FAILED,
  );
}

/** What `delete_tab` tells the agent about restoring: the tab is gone, its pages come back one by one in the browser. */
const RESTORE_TAB_PAGES =
  "The tab is deleted for good and cannot be restored. Its pages can be restored one by one by a Manager or Owner of " +
  "the folder in the browser, under Deleted pages at the address deletedPagesAddress. Deleted pages can be neither " +
  "seen nor restored through this connection.";

/**
 * The tool `delete_tab`: a tab of the folder of the connection, by its name, deleted for good together with all its
 * pages, as deleting it in the browser does, without a further confirmation: the description warns of it before the
 * call. The pages go to the deleted pages of the folder.
 */
export async function deleteTab(
  options: WikiToolsOptions,
  input: z.infer<typeof deleteTabInput>,
): Promise<CallToolResult> {
  return run(
    "delete_tab",
    async () => {
      const tab = await folderService.getTab(options.actor, options.folder.name, input.tab);
      if (!tab) return tabNotFound(options, input.tab);
      const deleted = await folderService.deleteTab(options.actor, options.folder.id, tab.id);
      if (deleted.ok) {
        return result({
          name: tab.name,
          pageCount: deleted.value.pageCount,
          pages: deleted.value.pages.map(({ name, title }) => ({ name, title })),
          deletedPagesAddress: addressOf(options, deletedPagesPath(deleted.value.folder.name)),
          restore: RESTORE_TAB_PAGES,
        } satisfies z.infer<typeof deletedTabOutput>);
      }
      switch (deleted.error.code) {
        case "not-allowed":
          return toolError(NOT_ALLOWED);
        case "tab-not-found":
          return tabNotFound(options, input.tab);
        case "failed":
          return toolError(WRITE_FAILED);
      }
    },
    WRITE_FAILED,
  );
}
