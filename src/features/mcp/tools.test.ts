import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWikiServer, SERVER_INSTRUCTIONS } from "@/features/mcp/tools";

const mocks = vi.hoisted(() => ({
  listFolders: vi.fn(),
  getFolderByName: vi.fn(),
  listTabs: vi.fn(),
  listAllFolderPages: vi.fn(),
  getPage: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/features/folders/service", () => ({
  listFolders: mocks.listFolders,
  getFolderByName: mocks.getFolderByName,
  listTabs: mocks.listTabs,
}));
vi.mock("@/features/pages/service", () => ({
  listAllFolderPages: mocks.listAllFolderPages,
  getPage: mocks.getPage,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

const PUBLIC_URL = "https://wiki.example.com";
const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const CHANGED = new Date("2026-03-01T12:00:00.000Z");
const EDITOR = { name: "alice" };

/** A JSON-RPC answer of the server. */
type Answer = { result?: Record<string, unknown>; error?: { code: number; message: string } };

/** The public URL of the wiki that the tools of the test are built with. */
let publicUrl: string | undefined;

/** Sends one message to a new server with the tools, as a client of the older protocol does, and returns the answer. */
async function send(message: Record<string, unknown>): Promise<Answer> {
  const server = createWikiServer({ publicUrl });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(
    new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...message }),
    }),
  );
  await server.close();
  return (await response.json()) as Answer;
}

/** The result of a tool call. */
type ToolResult = { content: { type: string; text: string }[]; structuredContent?: unknown; isError?: boolean };

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const answer = await send({ method: "tools/call", params: { name, arguments: args } });
  if (!answer.result) return expect.fail(`no result: ${JSON.stringify(answer.error)}`);
  return answer.result as ToolResult;
}

/** The message of a tool error; fails the test if the call worked. */
function errorOf(result: ToolResult): string {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  expect(result.content).toHaveLength(1);
  return result.content[0]?.text ?? "";
}

beforeEach(() => {
  vi.resetAllMocks();
  publicUrl = PUBLIC_URL;
});

describe("the server", () => {
  it("says in its instructions how the wiki is organised", async () => {
    const answer = await send({
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });

    expect(answer.result).toMatchObject({
      serverInfo: { name: "hippowiki", title: "HippoWiki" },
      instructions: SERVER_INSTRUCTIONS,
    });
    for (const word of ["folders", "tabs", "pages", "Markdown", "list_folders", "list_folder", "read_page"]) {
      expect(SERVER_INSTRUCTIONS).toContain(word);
    }
  });

  it("offers the three read tools, each with a description, its arguments and the hint that it only reads", async () => {
    const answer = await send({ method: "tools/list" });

    const tools = answer.result?.tools as {
      name: string;
      description: string;
      inputSchema: { properties?: Record<string, { description?: string }>; required?: string[] };
      annotations: Record<string, boolean>;
    }[];
    expect(tools.map((tool) => tool.name)).toEqual(["list_folders", "list_folder", "read_page"]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      for (const argument of Object.values(tool.inputSchema.properties ?? {})) {
        expect(argument.description).toBeTruthy();
      }
    }
    expect(tools[0]?.inputSchema.properties ?? {}).toEqual({});
    expect(tools[1]?.inputSchema.required).toEqual(["folder"]);
    // The tab is optional: a page placed directly in a folder has none.
    expect(tools[2]?.inputSchema.required).toEqual(["folder", "page"]);
    expect(Object.keys(tools[2]?.inputSchema.properties ?? {})).toEqual(["folder", "tab", "page"]);
  });
});

describe("list_folders", () => {
  it("returns the folders with name, address and last change, as data and as text", async () => {
    mocks.listFolders.mockResolvedValue([
      { id: FOLDER_ID, name: "handbook", updatedAt: CHANGED, lastEditedBy: EDITOR },
      { id: "id-2", name: "notes", updatedAt: new Date("2026-04-02T08:30:00.000Z"), lastEditedBy: EDITOR },
    ]);

    const result = await callTool("list_folders");

    const folders = {
      folders: [
        {
          name: "handbook",
          address: "https://wiki.example.com/folders/handbook",
          lastChanged: "2026-03-01T12:00:00.000Z",
        },
        { name: "notes", address: "https://wiki.example.com/folders/notes", lastChanged: "2026-04-02T08:30:00.000Z" },
      ],
    };
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(folders);
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(folders);
  });

  it("gives the paths as addresses without a public URL", async () => {
    mocks.listFolders.mockResolvedValue([
      { id: FOLDER_ID, name: "handbook", updatedAt: CHANGED, lastEditedBy: EDITOR },
    ]);

    publicUrl = undefined;

    const result = await callTool("list_folders");

    expect(result.structuredContent).toMatchObject({ folders: [{ address: "/folders/handbook" }] });
  });

  it("returns an empty list for a wiki without folders", async () => {
    mocks.listFolders.mockResolvedValue([]);

    expect((await callTool("list_folders")).structuredContent).toEqual({ folders: [] });
  });

  it("answers a failing database with a tool error that does not pass on the error, and logs it", async () => {
    const err = new Error("connect ECONNREFUSED 10.0.0.5:5432");
    mocks.listFolders.mockRejectedValue(err);

    const message = errorOf(await callTool("list_folders"));

    expect(message).toBe("The wiki could not be read. Please try again later.");
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, tool: "list_folders" }, "mcp tool failed");
  });
});

describe("list_folder", () => {
  it("puts the pages placed directly in the folder first, then the pages in tabs, tab by tab", async () => {
    mocks.getFolderByName.mockResolvedValue({ id: FOLDER_ID, name: "handbook" });
    mocks.listTabs.mockResolvedValue([]);
    const page = (name: string, tab: string | null) => ({
      id: `${name}-${tab}`,
      name,
      title: name,
      updatedAt: CHANGED,
      lastEditedBy: EDITOR,
      tab: tab === null ? null : { name: tab },
    });
    // The service returns the pages by name.
    mocks.listAllFolderPages.mockResolvedValue([
      page("alpha", "notes"),
      page("beta", "guides"),
      page("gamma", null),
      page("delta", "guides"),
      page("omega", null),
      page("zeta", "notes"),
    ]);

    const result = await callTool("list_folder", { folder: "handbook" });

    const { pages } = result.structuredContent as { pages: { name: string; tab: string | null }[] };
    expect(pages.map(({ name, tab }) => [tab, name])).toEqual([
      [null, "gamma"],
      [null, "omega"],
      ["guides", "beta"],
      ["guides", "delta"],
      ["notes", "alpha"],
      ["notes", "zeta"],
    ]);
  });

  it("returns the tabs and the pages of the folder, each page with its tab", async () => {
    mocks.getFolderByName.mockResolvedValue({ id: FOLDER_ID, name: "handbook" });
    mocks.listTabs.mockResolvedValue([{ id: "tab-1", name: "guides", updatedAt: CHANGED, lastEditedBy: EDITOR }]);
    mocks.listAllFolderPages.mockResolvedValue([
      { id: "p1", name: "overview", title: "Overview", updatedAt: CHANGED, lastEditedBy: EDITOR, tab: null },
      { id: "p2", name: "setup", title: "Setup", updatedAt: CHANGED, lastEditedBy: EDITOR, tab: { name: "guides" } },
    ]);

    const result = await callTool("list_folder", { folder: "handbook" });

    expect(mocks.getFolderByName).toHaveBeenCalledExactlyOnceWith("handbook");
    expect(mocks.listTabs).toHaveBeenCalledExactlyOnceWith(FOLDER_ID);
    expect(mocks.listAllFolderPages).toHaveBeenCalledExactlyOnceWith(FOLDER_ID);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      folder: { name: "handbook", address: "https://wiki.example.com/folders/handbook" },
      tabs: [
        {
          name: "guides",
          address: "https://wiki.example.com/folders/handbook/guides",
          lastChanged: "2026-03-01T12:00:00.000Z",
        },
      ],
      pages: [
        {
          name: "overview",
          title: "Overview",
          tab: null,
          address: "https://wiki.example.com/folders/handbook/overview.md",
          lastChanged: "2026-03-01T12:00:00.000Z",
        },
        {
          name: "setup",
          title: "Setup",
          tab: "guides",
          address: "https://wiki.example.com/folders/handbook/guides/setup.md",
          lastChanged: "2026-03-01T12:00:00.000Z",
        },
      ],
    });
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(result.structuredContent);
  });

  it("answers a folder that does not exist with a tool error that says what to do, without reading further", async () => {
    mocks.getFolderByName.mockResolvedValue(null);

    const message = errorOf(await callTool("list_folder", { folder: "nowhere" }));

    expect(message).toBe('There is no folder named "nowhere". Use list_folders to see the folders that exist.');
    expect(mocks.listTabs).not.toHaveBeenCalled();
    expect(mocks.listAllFolderPages).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each([
    ["no folder", {}],
    ["an empty name", { folder: "" }],
    ["upper case", { folder: "Handbook" }],
    ["a path", { folder: "handbook/guides" }],
    ["two hyphens in a row", { folder: "hand--book" }],
    ["a number", { folder: 5 }],
    ["too many characters", { folder: "a".repeat(81) }],
  ])("answers %s with a tool error and does not reach the service", async (_case, args) => {
    const message = errorOf(await callTool("list_folder", args));

    expect(message).toContain("folder");
    expect(mocks.getFolderByName).not.toHaveBeenCalled();
  });
});

describe("read_page", () => {
  const PAGE = {
    id: "p1",
    name: "setup",
    title: "Setup",
    content: "# Setup\n\nInstall it.",
    updatedAt: CHANGED,
    lastEditedBy: EDITOR,
    folder: { id: FOLDER_ID, name: "handbook" },
    tab: { id: "tab-1", name: "guides" },
  };

  beforeEach(() => {
    mocks.getFolderByName.mockResolvedValue({ id: FOLDER_ID, name: "handbook" });
  });

  it("returns a page in a tab with title, content, address, last change and last editor", async () => {
    mocks.getPage.mockResolvedValue(PAGE);

    const result = await callTool("read_page", { folder: "handbook", tab: "guides", page: "setup" });

    expect(mocks.getPage).toHaveBeenCalledExactlyOnceWith("handbook", "guides", "setup");
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      name: "setup",
      title: "Setup",
      folder: "handbook",
      tab: "guides",
      content: "# Setup\n\nInstall it.",
      address: "https://wiki.example.com/folders/handbook/guides/setup.md",
      lastChanged: "2026-03-01T12:00:00.000Z",
      lastEditedBy: "alice",
    });
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(result.structuredContent);
  });

  it.each([
    ["no tab is given", { folder: "handbook", page: "overview" }],
    ["the tab is null, as list_folder returns it", { folder: "handbook", tab: null, page: "overview" }],
  ])("reads a page placed directly in the folder when %s", async (_case, args) => {
    mocks.getPage.mockResolvedValue({ ...PAGE, name: "overview", tab: null });

    const result = await callTool("read_page", args);

    expect(mocks.getPage).toHaveBeenCalledExactlyOnceWith("handbook", null, "overview");
    expect(result.structuredContent).toMatchObject({
      tab: null,
      address: "https://wiki.example.com/folders/handbook/overview.md",
    });
  });

  it("answers a folder that does not exist with a tool error, without asking for the page", async () => {
    mocks.getFolderByName.mockResolvedValue(null);

    const message = errorOf(await callTool("read_page", { folder: "nowhere", page: "setup" }));

    expect(message).toBe('There is no folder named "nowhere". Use list_folders to see the folders that exist.');
    expect(mocks.getPage).not.toHaveBeenCalled();
  });

  it("answers a page that does not exist, or is deleted, with a tool error that names its place", async () => {
    // The service leaves deleted pages out, so a deleted page is a missing one.
    mocks.getPage.mockResolvedValue(null);

    expect(errorOf(await callTool("read_page", { folder: "handbook", page: "gone" }))).toBe(
      'There is no page named "gone" directly in the folder "handbook". Use list_folder to see the pages of the ' +
        "folder and the tab each one is in.",
    );
    expect(errorOf(await callTool("read_page", { folder: "handbook", tab: "guides", page: "gone" }))).toBe(
      'There is no page named "gone" in the tab "guides" of the folder "handbook". Use list_folder to see the pages ' +
        "of the folder and the tab each one is in.",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each([
    ["no page", { folder: "handbook" }],
    ["no folder", { page: "setup" }],
    ["a page name with its .md", { folder: "handbook", page: "setup.md" }],
    ["a tab in upper case", { folder: "handbook", tab: "Guides", page: "setup" }],
    ["an empty tab", { folder: "handbook", tab: "", page: "setup" }],
    ["a page name with a path", { folder: "handbook", page: "../secret" }],
  ])("answers %s with a tool error and does not reach the service", async (_case, args) => {
    errorOf(await callTool("read_page", args));

    expect(mocks.getFolderByName).not.toHaveBeenCalled();
    expect(mocks.getPage).not.toHaveBeenCalled();
  });

  it("answers a failing database with a tool error that does not pass on the error, and logs it", async () => {
    const err = new Error("password authentication failed for user hippowiki");
    mocks.getPage.mockRejectedValue(err);

    const message = errorOf(await callTool("read_page", { folder: "handbook", page: "setup" }));

    expect(message).toBe("The wiki could not be read. Please try again later.");
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, tool: "read_page" }, "mcp tool failed");
  });
});

describe("an unknown tool", () => {
  it("is not found", async () => {
    const answer = await send({ method: "tools/call", params: { name: "delete_page", arguments: {} } });

    expect(JSON.stringify(answer)).toContain("delete_page");
    expect(mocks.listFolders).not.toHaveBeenCalled();
  });
});
