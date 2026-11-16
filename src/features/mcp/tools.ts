// The tools of the MCP server: what an AI app can do with the folder of its connection. A Reader connection gets the
// read tools, a Writer connection also the write tools, which follow the rules of the browser, the version check of
// optimistic locking included. They call the services of the
// folders and pages with the actor of MCP, which carries the connection: the services give it only the folder of the
// connection, with the lower of the user's role and the role of the connection, as `queries.ts` does with the channel
// `browser` for the GUI. The tools know nothing about HTTP, tokens or Next.js: the adapter in `http.ts` finds out who
// is calling, and with which connection, before a tool runs. No import of `next` or `react`, so the tools load wherever
// the services load.

import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import { ROLE_LABELS, type McpRole } from "@/features/folder-roles/roles";
import type { McpActor } from "@/features/folder-roles/service";
import * as folderService from "@/features/folders/service";
import { deriveName } from "@/features/pages/derive";
import { pageContentInputSchema, TITLE_HEADING_MISSING_MESSAGE } from "@/features/pages/schema";
import * as pageService from "@/features/pages/service";
import { folderPath, pagePath, tabPath } from "@/lib/addresses";
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

function tabNotFound(folderName: string, tab: string): CallToolResult {
  return toolError(
    `There is no tab named "${tab}" in the folder "${folderName}", so nothing was changed. Use list_folder to see ` +
      "the tabs of the folder; tabs are created in the browser.",
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
  return found ? { tabId: found.id } : { error: tabNotFound(options.folder.name, tab) };
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
          return tabNotFound(folder.name, input.tab ?? "");
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
          return tabNotFound(options.folder.name, input.newTab ?? "");
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

/** What every read tool tells a client about itself: it only reads, and only the wiki. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

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

  // The write tools only for a Writer connection: a Reader connection does not even see them.
  if (options.actor.connection.role !== "writer") return server;

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

  return server;
}
