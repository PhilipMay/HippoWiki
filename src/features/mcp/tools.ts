// The tools of the MCP server: what an AI assistant can do with the wiki. All of them only read. They call the services
// of the folders and pages, as `queries.ts` does for the GUI, and know nothing about HTTP, tokens or Next.js: the
// adapter in `http.ts` finds out who is calling before a tool runs. No import of `next` or `react`, so the tools load
// wherever the services load.

import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import * as folderService from "@/features/folders/service";
import * as pageService from "@/features/pages/service";
import { folderPath, pagePath, tabPath } from "@/lib/addresses";
import { logger } from "@/lib/logger";
import { nameSchema } from "@/lib/names";
import { siteName } from "@/lib/site";

/** What the tools need to know about the wiki they serve. */
export type WikiToolsOptions = {
  /**
   * The public address of the wiki (`HIPPOWIKI_PUBLIC_URL`), without a trailing slash. With it the tools give out
   * full URLs that a person can open; without it only the paths.
   */
  publicUrl: string | undefined;
};

/** How the server introduces itself to a client. */
const SERVER_INFO = { name: "hippowiki", title: siteName, version: "1.0.0" };

/** What `initialize` tells the model about the wiki, in one paragraph. */
export const SERVER_INSTRUCTIONS =
  `${siteName} is a wiki. Its content is organised in folders. A folder holds pages, either directly or grouped ` +
  "in tabs, which are optional sections of the folder. Every page is written in Markdown and has a name, which is " +
  "part of its address, and a title, which is its first heading. Folder, tab and page names are lowercase letters, " +
  "digits and single hyphens. Start with list_folders, then list_folder for the tabs and pages of one folder, then " +
  "read_page for the content of one page. The tools only read; nothing can be changed through them.";

/** A folder, tab or page name as a tool takes it. The description is all the model learns about the argument. */
function nameArgument(description: string) {
  return nameSchema.describe(description);
}

const listFolderInput = z.object({
  folder: nameArgument("The name of the folder, as list_folders returns it"),
});

const readPageInput = z.object({
  folder: nameArgument("The name of the folder the page is in"),
  // `null` is accepted next to a missing tab, because `list_folder` returns the tab of such a page as `null`. The
  // description comes last: one on the name alone would be lost when the argument may also be `null`.
  tab: nameSchema
    .nullable()
    .optional()
    .describe(
      "The name of the tab the page is in. Leave it out, or pass null, for a page placed directly in the folder.",
    ),
  page: nameArgument("The name of the page, without the .md at the end of its address"),
});

const folderOutput = z.object({
  name: z.string(),
  address: z.string().describe("Where a person opens the folder in a browser"),
  lastChanged: z.string().describe("When the folder itself was last changed, as an ISO 8601 time"),
});

const listFoldersOutput = z.object({ folders: z.array(folderOutput) });

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
});

/** The result of a tool that worked: the data for the client, and the same as text for the model. */
function result(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

/**
 * The result of a tool that could not do what was asked, e.g. because a folder does not exist. It is a tool error
 * and not a protocol error, so the model reads the message and can try again with other arguments.
 */
function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Runs a tool. An unexpected error, such as a database that cannot be reached, is logged and answered with a general
 * message: the SDK would otherwise pass the message of the error on to the client.
 */
async function run(tool: string, read: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await read();
  } catch (err) {
    logger.error({ err, tool }, "mcp tool failed");
    return toolError("The wiki could not be read. Please try again later.");
  }
}

/** The address of a path of the wiki: the full URL with a public address, otherwise the path. */
function addressOf({ publicUrl }: WikiToolsOptions, path: string): string {
  return `${publicUrl ?? ""}${path}`;
}

function folderNotFound(folder: string): CallToolResult {
  return toolError(`There is no folder named "${folder}". Use list_folders to see the folders that exist.`);
}

/** The tool `list_folders`: all folders, by name. */
export async function listFolders(options: WikiToolsOptions): Promise<CallToolResult> {
  return run("list_folders", async () => {
    const folders = await folderService.listFolders();
    return result({
      folders: folders.map((folder) => ({
        name: folder.name,
        address: addressOf(options, folderPath(folder.name)),
        lastChanged: folder.updatedAt.toISOString(),
      })),
    } satisfies z.infer<typeof listFoldersOutput>);
  });
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

/** The tool `list_folder`: the tabs and pages of a folder, the pages placed directly in the folder first. */
export async function listFolder(
  options: WikiToolsOptions,
  input: z.infer<typeof listFolderInput>,
): Promise<CallToolResult> {
  return run("list_folder", async () => {
    const folder = await folderService.getFolderByName(input.folder);
    if (!folder) return folderNotFound(input.folder);
    const tabs = await folderService.listTabs(folder.id);
    // The service leaves deleted pages out and returns the others by name.
    const pages = placedDirectlyFirst(await pageService.listAllFolderPages(folder.id));
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

/** The tool `read_page`: a page by its folder, its tab if it is in one, and its name. A deleted page is not found. */
export async function readPage(
  options: WikiToolsOptions,
  input: z.infer<typeof readPageInput>,
): Promise<CallToolResult> {
  return run("read_page", async () => {
    const tab = input.tab ?? null;
    // The folder first, so that a missing folder and a missing page get messages of their own.
    const folder = await folderService.getFolderByName(input.folder);
    if (!folder) return folderNotFound(input.folder);
    const page = await pageService.getPage(folder.name, tab, input.page);
    if (!page) {
      const place =
        tab === null ? `directly in the folder "${folder.name}"` : `in the tab "${tab}" of the folder "${folder.name}"`;
      return toolError(
        `There is no page named "${input.page}" ${place}. Use list_folder to see the pages of the folder and the tab ` +
          "each one is in.",
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
    } satisfies z.infer<typeof readPageOutput>);
  });
}

/** What every tool tells a client about itself: it only reads, and only the wiki. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/**
 * A new MCP server with the tools of the wiki. The SDK asks for one per request, so it holds nothing between
 * requests.
 */
export function createWikiServer(options: WikiToolsOptions): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool(
    "list_folders",
    {
      title: "List folders",
      description:
        "Lists all folders of the wiki with their names and addresses. Folders are the top level of the wiki; use " +
        "list_folder to see what a folder holds.",
      outputSchema: listFoldersOutput,
      annotations: READ_ONLY,
    },
    () => listFolders(options),
  );

  server.registerTool(
    "list_folder",
    {
      title: "List the tabs and pages of a folder",
      description:
        "Lists the tabs and the pages of one folder. Every page comes with its name, its title and the tab it is " +
        "in (null for a page placed directly in the folder); pass these to read_page to read it.",
      inputSchema: listFolderInput,
      outputSchema: listFolderOutput,
      annotations: READ_ONLY,
    },
    (input) => listFolder(options, input),
  );

  server.registerTool(
    "read_page",
    {
      title: "Read a page",
      description:
        "Reads one page of the wiki: its title, its Markdown content, its address, when it was last changed and by " +
        "whom. A page is named by its folder, its tab if it is in one, and its own name, as list_folder returns them.",
      inputSchema: readPageInput,
      outputSchema: readPageOutput,
      annotations: READ_ONLY,
    },
    (input) => readPage(options, input),
  );

  return server;
}
