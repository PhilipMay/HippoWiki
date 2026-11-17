// The tools of the MCP server: what an AI app can do with the folder of its connection. A Reader connection gets the
// read tools, a Writer and a Manager connection also the write tools of pages, and a Manager connection the tools that
// delete pages and create, rename and delete tabs. They follow the rules of the browser, the version check of
// optimistic locking included. They call the services of the
// folders and pages with the actor of MCP, which carries the connection: the services give it only the folder of the
// connection, with the lower of the user's role and the role of the connection, as `queries.ts` does with the channel
// `browser` for the GUI. The tools know nothing about HTTP, tokens or Next.js: the adapter in `http.ts` finds out who
// is calling, and with which connection, before a tool runs. No import of `next` or `react`, so the tools load wherever
// the services load.

import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import { includesRole, ROLE_LABELS, type McpRole } from "@/features/folder-roles/roles";
import type { McpActor } from "@/features/folder-roles/service";
import * as folderService from "@/features/folders/service";
import { deriveName } from "@/features/pages/derive";
import { pageContentInputSchema, TITLE_HEADING_MISSING_MESSAGE } from "@/features/pages/schema";
import * as pageService from "@/features/pages/service";
import { deletedPagesPath, folderPath, pagePath, tabPath } from "@/lib/addresses";
import { logger } from "@/lib/logger";
import { nameSchema } from "@/lib/names";
import { siteName } from "@/lib/site";

/** What the tools need to know about the wiki they serve and the connection they serve it to. */
export type WikiToolsOptions = {
  /**
   * The public address of the wiki (`HIPPOWIKI_PUBLIC_URL`), without a trailing slash. With it the tools give out
   * full URLs that a person can open; without it only the paths.
   */
  publicUrl: string | undefined;
  /** The actor of MCP: the user of the token of the request and the connection of its grant. */
  actor: McpActor;
  /** The folder of the connection, as the adapter read it for this request; its name is the current one. */
  folder: { id: string; name: string };
};

/** How the server introduces itself to a client. */
const SERVER_INFO = { name: "hippowiki", title: siteName, version: "1.0.0" };

/** What a connection of each role may do, as the instructions tell the model. */
const ROLE_ABILITIES: Readonly<Record<McpRole, string>> = {
  reader: "It reads the folder and cannot change it.",
  writer:
    "It reads the folder and changes its pages with create_page, replace_page_content and move_or_rename_page; it " +
    "creates no tabs. Every change of a page states the version that read_page gave for it, and a change based on " +
    "an older version is refused.",
  manager:
    "It reads the folder and changes its pages like a Writer connection, with create_page, replace_page_content and " +
    "move_or_rename_page, deletes pages with delete_page, and creates, renames and deletes tabs with create_tab, " +
    "rename_tab and delete_tab. Every change and every delete of a page states the version that read_page gave for " +
    "it, and one based on an older version is refused. Deleting a tab deletes all its pages with it. Deleted pages " +
    "can be neither seen nor restored through this connection: only a Manager or Owner of the folder restores them, " +
    "in the browser.",
};

/**
 * What `initialize` tells the model about the wiki and the connection, in one paragraph: the folder and the role of
 * the connection, what the role allows, how the folder is organised and which tool to start with.
 */
export function instructionsFor(folderName: string, role: McpRole): string {
  return (
    `${siteName} is a wiki. This connection works on the folder "${folderName}" with the role ${ROLE_LABELS[role]}. ` +
    `${ROLE_ABILITIES[role]} The folder holds pages, either directly or grouped in tabs, which are optional ` +
    "sections of the folder. Every page is written in Markdown and has a name, which is part of its address, and a " +
    "title, which is its first heading. Tab and page names are lowercase letters, digits and single hyphens. Start " +
    "with list_folder for the tabs and pages of the folder, then read_page for the content of one page."
  );
}

/** A tab or page name as a tool takes it. The description is all the model learns about the argument. */
function nameArgument(description: string) {
  return nameSchema.describe(description);
}

/** The page a write tool changes: its tab, if it is in one, and its name, as list_folder returns them. */
const pageArguments = {
  tab: nameSchema
    .nullable()
    .optional()
    .describe(
      "The name of the tab the page is in. Leave it out, or pass null, for a page placed directly in the folder.",
    ),
  page: nameArgument("The name of the page, without the .md at the end of its address"),
  version: z
    .number()
    .int()
    .optional()
    .describe("The version of the page that read_page gave; the change is refused if the page has changed since"),
};

const createPageInput = z.object({
  content: z
    .string()
    .describe("The whole Markdown content of the new page. It must start with a title heading: # Title"),
  tab: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The name of an existing tab to create the page in. Leave it out, or pass null, to place it directly in the folder.",
    ),
  name: z
    .string()
    .optional()
    .describe(
      "The name of the page in its address: lowercase letters, digits and single hyphens. Leave it out to derive " +
        "it from the title.",
    ),
});

const replacePageContentInput = z.object({
  ...pageArguments,
  content: z
    .string()
    .describe("The whole new Markdown content of the page. It must start with a title heading: # Title"),
});

const moveOrRenamePageInput = z.object({
  ...pageArguments,
  newTab: z
    .string()
    .nullable()
    .describe(
      "The name of an existing tab of the folder to move the page to, or null to place it directly in the folder",
    ),
  newName: z
    .string()
    .describe("The new name of the page: lowercase letters, digits and single hyphens. Pass the old name to keep it."),
});

const deletePageInput = z.object(pageArguments);

/** A new tab name as a tool takes it: checked by the service, so that a bad name is a tool error with the rule. */
function newTabNameArgument(description: string) {
  return z.string().describe(`${description}: lowercase letters, digits and single hyphens, such as meeting-notes`);
}

/** An existing tab as a tool takes it; a name that no tab has is a tool error that says how to find the tabs. */
const existingTabArgument = z.string().describe("The name of the tab, as list_folder returns it");

const createTabInput = z.object({ name: newTabNameArgument("The name of the new tab") });

const renameTabInput = z.object({ tab: existingTabArgument, newName: newTabNameArgument("The new name of the tab") });

const deleteTabInput = z.object({ tab: existingTabArgument });

/**
 * The tab a page is in, as a tool takes it. `null` is accepted next to a missing tab, because `list_folder` returns
 * the tab of such a page as `null`. The description comes last: one on the name alone would be lost when the argument
 * may also be `null`.
 */
const tabArgument = nameSchema
  .nullable()
  .optional()
  .describe(
    "The name of the tab the page is in. Leave it out, or pass null, for a page placed directly in the folder.",
  );

const readPageInput = z.object({
  tab: tabArgument,
  page: nameArgument("The name of the page, without the .md at the end of its address"),
});

const listFolderOutput = z.object({
  folder: z.object({ name: z.string(), address: z.string() }),
  tabs: z.array(
    z.object({
      name: z.string(),
      address: z.string(),
      lastChanged: z.string().describe("When the tab itself was last changed, as an ISO 8601 time"),
    }),
  ),
  pages: z
    .array(
      z.object({
        name: z.string(),
        title: z.string(),
        tab: z.string().nullable().describe("The tab the page is in, or null for a page placed directly in the folder"),
        address: z.string(),
        lastChanged: z.string().describe("When the page was last changed, as an ISO 8601 time"),
      }),
    )
    .describe("The pages placed directly in the folder first, then the pages in tabs"),
});

const readPageOutput = z.object({
  name: z.string(),
  title: z.string(),
  folder: z.string(),
  tab: z.string().nullable(),
  content: z.string().describe("The Markdown source of the page"),
  address: z.string().describe("Where a person opens the page in a browser"),
  lastChanged: z.string().describe("When the page was last changed, as an ISO 8601 time"),
  lastEditedBy: z.string().describe("The user name of who changed the page last"),
  version: z.number().int().describe("The version of the page, counted up by every change"),
});

const storedPageOutput = z.object({
  name: z.string(),
  title: z.string(),
  tab: z.string().nullable(),
  address: z.string().describe("Where a person opens the page in a browser"),
  version: z.number().int().describe("The version of the page after the change, for the next change"),
});

const deletedPageOutput = z.object({
  name: z.string(),
  title: z.string(),
  tab: z.string().nullable().describe("The tab the page was in, or null for a page placed directly in the folder"),
  deletedPagesAddress: z
    .string()
    .describe("Where a person sees the deleted pages of the folder in a browser, as a Manager or Owner restores them"),
  restore: z.string().describe("How the page can be restored"),
});

const storedTabOutput = z.object({
  name: z.string(),
  address: z.string().describe("Where a person opens the tab in a browser"),
});

const deletedTabOutput = z.object({
  name: z.string().describe("The name the deleted tab had"),
  pageCount: z.number().int().describe("How many pages were deleted with the tab"),
  pages: z
    .array(z.object({ name: z.string(), title: z.string() }))
    .describe("Every page deleted with the tab, by name, without a limit"),
  deletedPagesAddress: z
    .string()
    .describe("Where a person sees the deleted pages of the folder in a browser, as a Manager or Owner restores them"),
  restore: z.string().describe("How the pages can be restored"),
});

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

/** The address of a path of the wiki: the full URL with a public address, otherwise the path. */
function addressOf({ publicUrl }: WikiToolsOptions, path: string): string {
  return `${publicUrl ?? ""}${path}`;
}

/** The answer when the folder of the connection cannot be read with the actor any more, e.g. after a role change. */
function folderGone(): CallToolResult {
  return toolError("The folder of this connection cannot be read any more. The user's role on it may have changed.");
}

/** Where a page is, as a message names it: directly in the folder, or in a tab of it. */
function placeOf(folderName: string, tab: string | null): string {
  return tab === null ? `directly in the folder "${folderName}"` : `in the tab "${tab}" of the folder "${folderName}"`;
}

/**
 * The pages placed directly in the folder first, then the pages in tabs, tab by tab. Within each group the pages keep
 * the order they came in, which is by name.
 */
function placedDirectlyFirst<Page extends { tab: { name: string } | null }>(pages: Page[]): Page[] {
  const direct = pages.filter((page) => page.tab === null);
  const inTabs = pages.filter((page) => page.tab !== null);
  // Names are lowercase letters, digits and hyphens, so comparing the strings sorts them. The sort is stable.
  inTabs.sort((a, b) => {
    const [tabA, tabB] = [a.tab?.name ?? "", b.tab?.name ?? ""];
    return tabA < tabB ? -1 : tabA > tabB ? 1 : 0;
  });
  return [...direct, ...inTabs];
}

/** The tool `list_folder`: the tabs and pages of the folder of the connection, the pages placed directly in it first. */
export async function listFolder(options: WikiToolsOptions): Promise<CallToolResult> {
  return run("list_folder", async () => {
    const { actor, folder } = options;
    const tabs = await folderService.listTabs(actor, folder.id);
    // The service leaves deleted pages out and returns the others by name.
    const allPages = await pageService.listAllFolderPages(actor, folder.id);
    // `null` when the actor may no longer read the folder.
    if (!tabs || !allPages) return folderGone();
    const pages = placedDirectlyFirst(allPages);
    return result({
      folder: { name: folder.name, address: addressOf(options, folderPath(folder.name)) },
      tabs: tabs.map((tab) => ({
        name: tab.name,
        address: addressOf(options, tabPath(folder.name, tab.name)),
        lastChanged: tab.updatedAt.toISOString(),
      })),
      pages: pages.map((page) => ({
        name: page.name,
        title: page.title,
        tab: page.tab?.name ?? null,
        address: addressOf(options, pagePath(folder.name, page.tab?.name ?? null, page.name)),
        lastChanged: page.updatedAt.toISOString(),
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
    if (!page) {
      return toolError(
        `There is no page named "${input.page}" ${placeOf(options.folder.name, tab)}. Use list_folder to see the ` +
          "pages of the folder and the tab each one is in.",
      );
    }
    return result({
      name: page.name,
      title: page.title,
      folder: page.folder.name,
      tab: page.tab?.name ?? null,
      content: page.content,
      address: addressOf(options, pagePath(page.folder.name, page.tab?.name ?? null, page.name)),
      lastChanged: page.updatedAt.toISOString(),
      lastEditedBy: page.lastEditedBy.name,
      version: page.version,
    } satisfies z.infer<typeof readPageOutput>);
  });
}

/** The answer when the role on the folder does not allow a change, e.g. because it was lowered meanwhile. */
const NOT_ALLOWED = "Your role on the folder does not allow this change, so nothing was changed.";

function pageNotFound(folderName: string, tab: string | null, page: string): CallToolResult {
  return toolError(
    `There is no page named "${page}" ${placeOf(folderName, tab)}. Use list_folder to see the pages of the folder ` +
      "and the tab each one is in.",
  );
}

/** Whether the connection is one of a Manager, with the tools that delete pages and change tabs. */
function isManager({ actor }: WikiToolsOptions): boolean {
  return includesRole(actor.connection.role, "manager");
}

/**
 * The tool error of a tab that does not exist, also one deleted meanwhile: a Manager connection learns that it can
 * create the tab, the other connections that tabs are created in the browser.
 */
function tabNotFound(options: WikiToolsOptions, tab: string): CallToolResult {
  const create = isManager(options) ? "or create the tab with create_tab" : "tabs are created in the browser";
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
 * page last and when, and that the page has to be read again.
 */
async function pageChanged(options: WikiToolsOptions, stored: pageService.StoredPage): Promise<CallToolResult> {
  const page = await pageService.getPage(options.actor, options.folder.name, stored.tab?.name ?? null, stored.name);
  const by = page ? ` by ${page.lastEditedBy.name} at ${page.updatedAt.toISOString()}` : "";
  return toolError(
    `The page was changed${by}, after the version this change is based on, or the change states no valid version. ` +
      "Nothing was changed. Read the page again with read_page and base the change on its current content and " +
      "version.",
  );
}

/** The page as stored by a write, as every write tool returns it, with its title and its new version. */
async function storedResult(options: WikiToolsOptions, stored: pageService.StoredPage): Promise<CallToolResult> {
  const tab = stored.tab?.name ?? null;
  const page = await pageService.getPage(options.actor, options.folder.name, tab, stored.name);
  return result({
    name: stored.name,
    title: page?.title ?? "",
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
      let name = input.name;
      if (name === undefined) {
        // The content is checked as the service checks it before a name is derived from its title, so that content
        // over the length limit is never parsed here.
        const checked = pageContentInputSchema.safeParse({ content: input.content });
        if (!checked.success) return invalidInput(z.flattenError(checked.error).fieldErrors);
        name = deriveName(checked.data.title);
        if (name === "") {
          return toolError(
            "The title suggests no name for the page, so nothing was changed. Give a name of lowercase letters, " +
              "digits and single hyphens.",
          );
        }
      }
      const place = await tabIdOf(options, input.tab);
      if (place.error) return place.error;
      const created = await pageService.createPage(options.actor, folder.id, {
        name,
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
        case "name-taken":
          return nameTaken(folder.name, input.tab ?? null, name);
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

/** What every read tool tells a client about itself: it only reads, and only the wiki. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** What a tool tells a client that writes to the wiki and destroys nothing. */
const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

/** What a tool tells a client that deletes from the wiki. */
const WRITES_AND_DELETES = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

/**
 * A new MCP server with the tools of the wiki for the connection of the request. The SDK asks for one per request, so
 * it holds nothing between requests.
 */
export function createWikiServer(options: WikiToolsOptions): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: instructionsFor(options.folder.name, options.actor.connection.role),
  });

  server.registerTool(
    "list_folder",
    {
      title: "List the tabs and pages of the folder",
      description:
        "Lists the tabs and the pages of the folder of this connection. Every page comes with its name, its title " +
        "and the tab it is in (null for a page placed directly in the folder); pass these to read_page to read it.",
      outputSchema: listFolderOutput,
      annotations: READ_ONLY,
    },
    () => listFolder(options),
  );

  server.registerTool(
    "read_page",
    {
      title: "Read a page",
      description:
        "Reads one page of the folder of this connection: its title, its Markdown content, its address, when it was " +
        "last changed and by whom, and its version. A page is named by its tab if it is in one, and its own name, " +
        "as list_folder returns them.",
      inputSchema: readPageInput,
      outputSchema: readPageOutput,
      annotations: READ_ONLY,
    },
    (input) => readPage(options, input),
  );

  // The write tools for a connection whose role includes Writer: a Reader connection does not even see them.
  if (!includesRole(options.actor.connection.role, "writer")) return server;

  server.registerTool(
    "create_page",
    {
      title: "Create a page",
      description:
        "Creates a new page in the folder of this connection, directly in the folder or in one of its existing " +
        "tabs, with the given Markdown content, which must start with a title heading. Without a name the page gets " +
        "the name derived from its title. It creates no tabs. Returns the page with its address and version.",
      inputSchema: createPageInput,
      outputSchema: storedPageOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (input) => createPage(options, input),
  );

  server.registerTool(
    "replace_page_content",
    {
      title: "Replace the content of a page",
      description:
        "Replaces the whole content of a page of the folder of this connection with the given Markdown, which must " +
        "start with a title heading; the title of the page follows it. State the version that read_page gave: if " +
        "the page has changed since, nothing is changed. Returns the page with its new version.",
      inputSchema: replacePageContentInput,
      outputSchema: storedPageOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    (input) => replacePageContent(options, input),
  );

  server.registerTool(
    "move_or_rename_page",
    {
      title: "Move or rename a page",
      description:
        "Moves a page of the folder of this connection to another existing tab of the folder, or directly into the " +
        "folder, and gives it a new name, which changes its address. State the version that read_page gave: if the " +
        "page has changed since, nothing is changed. Returns the page with its new address and version.",
      inputSchema: moveOrRenamePageInput,
      outputSchema: storedPageOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (input) => moveOrRenamePage(options, input),
  );

  // The tools that delete pages and create, rename and delete tabs only for a Manager connection.
  if (!isManager(options)) return server;

  server.registerTool(
    "delete_page",
    {
      title: "Delete a page",
      description:
        "Deletes a page of the folder of this connection, as deleting it in the browser does: it goes to the deleted " +
        "pages of the folder, where a Manager or Owner can restore it in the browser; deleted pages cannot be seen " +
        "or restored through this connection. State the version that read_page gave: if the page has changed since, " +
        "nothing is deleted. Returns the deleted page and the address of the deleted pages of the folder.",
      inputSchema: deletePageInput,
      outputSchema: deletedPageOutput,
      annotations: WRITES_AND_DELETES,
    },
    (input) => deletePage(options, input),
  );

  server.registerTool(
    "create_tab",
    {
      title: "Create a tab",
      description:
        "Creates a new, empty tab in the folder of this connection. create_page and move_or_rename_page can put " +
        "pages into it at once. Returns the tab with its address.",
      inputSchema: createTabInput,
      outputSchema: storedTabOutput,
      annotations: WRITES,
    },
    (input) => createTab(options, input),
  );

  server.registerTool(
    "rename_tab",
    {
      title: "Rename a tab",
      description:
        "Gives a tab of the folder of this connection a new name, which changes its address and the addresses of " +
        "all pages in it. Returns the tab with its new address.",
      inputSchema: renameTabInput,
      outputSchema: storedTabOutput,
      annotations: WRITES,
    },
    (input) => renameTab(options, input),
  );

  server.registerTool(
    "delete_tab",
    {
      title: "Delete a tab with all its pages",
      description:
        "Deletes a tab of the folder of this connection together with every page in it, in one call and without a " +
        "further confirmation. The tab is deleted for good and cannot be restored. Its pages go to the deleted " +
        "pages of the folder and can only be restored one by one, by a Manager or Owner of the folder in the " +
        "browser. Use list_folder first to see which pages are in the tab. Returns the number of pages deleted with " +
        "the tab, the name and title of each, and the address of the deleted pages of the folder.",
      inputSchema: deleteTabInput,
      outputSchema: deletedTabOutput,
      annotations: WRITES_AND_DELETES,
    },
    (input) => deleteTab(options, input),
  );

  return server;
}
