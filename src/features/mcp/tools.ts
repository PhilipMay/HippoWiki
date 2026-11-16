// The tools of the MCP server: what an AI app can do with the folder of its connection. They call the services of the
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
  writer: "It reads the folder and may change its pages.",
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

/**
 * Runs a tool. An unexpected error, such as a database that cannot be reached, is logged and answered with a general
 * message: the SDK would otherwise pass the message of the error on to the client.
 */
async function run(tool: string, work: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await work();
  } catch (err) {
    logger.error({ err, tool }, "mcp tool failed");
    return toolError("The wiki could not be read. Please try again later.");
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

  return server;
}
