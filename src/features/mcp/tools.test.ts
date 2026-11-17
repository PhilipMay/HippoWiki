import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { McpActor } from "@/features/folder-roles/service";
import { createWikiServer, instructionsFor } from "@/features/mcp/tools";
import { CONTENT_MAX_DEPTH, CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import { analyseMarkdown } from "@/features/pages/markdown";
import { TITLE_HEADING_MISSING_MESSAGE as TITLE_MISSING } from "@/features/pages/schema";

const mocks = vi.hoisted(() => ({
  listTabs: vi.fn(),
  getTab: vi.fn(),
  listAllFolderPages: vi.fn(),
  getPage: vi.fn(),
  createPage: vi.fn(),
  updatePageContent: vi.fn(),
  moveOrRenamePage: vi.fn(),
  deletePage: vi.fn(),
  createTab: vi.fn(),
  renameTab: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/features/folders/service", () => ({
  listTabs: mocks.listTabs,
  getTab: mocks.getTab,
  createTab: mocks.createTab,
  renameTab: mocks.renameTab,
}));
vi.mock("@/features/pages/service", () => ({
  listAllFolderPages: mocks.listAllFolderPages,
  getPage: mocks.getPage,
  createPage: mocks.createPage,
  updatePageContent: mocks.updatePageContent,
  moveOrRenamePage: mocks.moveOrRenamePage,
  deletePage: mocks.deletePage,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));
// The real parse, watched, to see whether the content was parsed.
vi.mock("@/features/pages/markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/pages/markdown")>();
  return { ...actual, analyseMarkdown: vi.fn(actual.analyseMarkdown) };
});

const PUBLIC_URL = "https://wiki.example.com";
const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const FOLDER = { id: FOLDER_ID, name: "handbook" };
const CHANGED = new Date("2026-03-01T12:00:00.000Z");
const EDITOR = { name: "alice" };

/** The actor of MCP of a Reader connection to the folder "handbook". */
const READER: McpActor = {
  id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002",
  name: "alice",
  type: "user",
  channel: "mcp",
  connection: { grantId: "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01", folderId: FOLDER_ID, role: "reader" },
};
/** The same user with a Writer connection to the folder. */
const WRITER: McpActor = { ...READER, connection: { ...READER.connection, role: "writer" } };
/** The same user with a Manager connection to the folder. */
const MANAGER: McpActor = { ...READER, connection: { ...READER.connection, role: "manager" } };

/** A JSON-RPC answer of the server. */
type Answer = { result?: Record<string, unknown>; error?: { code: number; message: string } };

/** The public URL of the wiki and the actor that the tools of the test are built with. */
let publicUrl: string | undefined;
let actor: McpActor;

/** Sends one message to a new server with the tools, as a client of the older protocol does, and returns the answer. */
async function send(message: Record<string, unknown>): Promise<Answer> {
  const server = createWikiServer({ publicUrl, actor, folder: FOLDER });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(
    new Request(`http://localhost:3000/mcp/${FOLDER_ID}/reader`, {
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
  actor = READER;
});

describe("the instructions", () => {
  it("name the folder and the role of the connection, and tell a Reader that it cannot change the folder", async () => {
    const answer = await send({
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });

    expect(answer.result).toMatchObject({
      serverInfo: { name: "hippowiki", title: "HippoWiki" },
      instructions: instructionsFor("handbook", "reader"),
    });
    const instructions = instructionsFor("handbook", "reader");
    expect(instructions).toContain('the folder "handbook" with the role Reader');
    expect(instructions).toContain("It reads the folder and cannot change it.");
    for (const word of ["tabs", "pages", "Markdown", "list_folder", "read_page"]) {
      expect(instructions).toContain(word);
    }
    expect(instructions).not.toContain("list_folders");
  });

  it("name the role Writer for a Writer connection", async () => {
    actor = WRITER;

    const answer = await send({
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });

    expect(answer.result).toMatchObject({ instructions: instructionsFor("handbook", "writer") });
    expect(instructionsFor("handbook", "writer")).toContain('the folder "handbook" with the role Writer');
  });
});

describe("the read tools", () => {
  it("are list_folder without arguments and read_page with an optional tab and a page, each one only reading", async () => {
    const answer = await send({ method: "tools/list" });

    const tools = answer.result?.tools as {
      name: string;
      description: string;
      inputSchema: { properties?: Record<string, { description?: string }>; required?: string[] };
      annotations: Record<string, boolean>;
    }[];
    expect(tools.map((tool) => tool.name)).toEqual(["list_folder", "read_page"]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      for (const argument of Object.values(tool.inputSchema.properties ?? {})) {
        expect(argument.description).toBeTruthy();
      }
    }
    expect(tools[0]?.inputSchema.properties ?? {}).toEqual({});
    // The tab is optional: a page placed directly in a folder has none.
    expect(tools[1]?.inputSchema.required).toEqual(["page"]);
    expect(Object.keys(tools[1]?.inputSchema.properties ?? {})).toEqual(["tab", "page"]);
  });

  it("include no tool that lists folders", async () => {
    const answer = await send({ method: "tools/call", params: { name: "list_folders", arguments: {} } });

    expect(JSON.stringify(answer)).toContain("list_folders");
    expect(JSON.stringify(answer)).not.toContain('"structuredContent"');
  });
});

describe("list_folder", () => {
  it("puts the pages placed directly in the folder first, then the pages in tabs, tab by tab", async () => {
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

    const result = await callTool("list_folder");

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

  it("returns the tabs and the pages of the folder of the connection, each page with its tab", async () => {
    mocks.listTabs.mockResolvedValue([{ id: "tab-1", name: "guides", updatedAt: CHANGED, lastEditedBy: EDITOR }]);
    mocks.listAllFolderPages.mockResolvedValue([
      { id: "p1", name: "overview", title: "Overview", updatedAt: CHANGED, lastEditedBy: EDITOR, tab: null },
      { id: "p2", name: "setup", title: "Setup", updatedAt: CHANGED, lastEditedBy: EDITOR, tab: { name: "guides" } },
    ]);

    const result = await callTool("list_folder");

    expect(mocks.listTabs).toHaveBeenCalledExactlyOnceWith(READER, FOLDER_ID);
    expect(mocks.listAllFolderPages).toHaveBeenCalledExactlyOnceWith(READER, FOLDER_ID);
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

  it("gives the paths as addresses without a public URL", async () => {
    mocks.listTabs.mockResolvedValue([]);
    mocks.listAllFolderPages.mockResolvedValue([]);
    publicUrl = undefined;

    const result = await callTool("list_folder");

    expect(result.structuredContent).toMatchObject({ folder: { address: "/folders/handbook" } });
  });

  it.each([
    ["tabs", () => mocks.listTabs.mockResolvedValue(null)],
    ["pages", () => mocks.listAllFolderPages.mockResolvedValue(null)],
  ])(
    "answers a folder whose %s the service no longer reads for the actor with a tool error",
    async (_case, arrange) => {
      mocks.listTabs.mockResolvedValue([]);
      mocks.listAllFolderPages.mockResolvedValue([]);
      arrange();

      const message = errorOf(await callTool("list_folder"));

      expect(message).toBe(
        "The folder of this connection cannot be read any more. The user's role on it may have changed.",
      );
    },
  );

  it("answers a failing database with a tool error that does not pass on the error, and logs it", async () => {
    const err = new Error("connect ECONNREFUSED 10.0.0.5:5432");
    mocks.listTabs.mockRejectedValue(err);

    const message = errorOf(await callTool("list_folder"));

    expect(message).toBe("The wiki could not be read. Please try again later.");
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, tool: "list_folder" }, "mcp tool failed");
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
    version: 4,
    folder: { id: FOLDER_ID, name: "handbook" },
    tab: { id: "tab-1", name: "guides" },
    role: "reader",
  };

  it("returns a page in a tab with title, content, address, last change, last editor and version", async () => {
    mocks.getPage.mockResolvedValue(PAGE);

    const result = await callTool("read_page", { tab: "guides", page: "setup" });

    expect(mocks.getPage).toHaveBeenCalledExactlyOnceWith(READER, "handbook", "guides", "setup");
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
      version: 4,
    });
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(result.structuredContent);
  });

  it.each([
    ["no tab is given", { page: "overview" }],
    ["the tab is null, as list_folder returns it", { tab: null, page: "overview" }],
  ])("reads a page placed directly in the folder when %s", async (_case, args) => {
    mocks.getPage.mockResolvedValue({ ...PAGE, name: "overview", tab: null });

    const result = await callTool("read_page", args);

    expect(mocks.getPage).toHaveBeenCalledExactlyOnceWith(READER, "handbook", null, "overview");
    expect(result.structuredContent).toMatchObject({
      tab: null,
      address: "https://wiki.example.com/folders/handbook/overview.md",
    });
  });

  it("answers a page that does not exist, or is deleted, with a tool error that names its place and list_folder", async () => {
    // The service leaves deleted pages out, so a deleted page is a missing one.
    mocks.getPage.mockResolvedValue(null);

    expect(errorOf(await callTool("read_page", { page: "gone" }))).toBe(
      'There is no page named "gone" directly in the folder "handbook". Use list_folder to see the pages of the ' +
        "folder and the tab each one is in.",
    );
    expect(errorOf(await callTool("read_page", { tab: "guides", page: "gone" }))).toBe(
      'There is no page named "gone" in the tab "guides" of the folder "handbook". Use list_folder to see the pages ' +
        "of the folder and the tab each one is in.",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("ignores a folder argument: the folder is the one of the connection", async () => {
    mocks.getPage.mockResolvedValue(PAGE);

    await callTool("read_page", { folder: "secret", tab: "guides", page: "setup" });

    expect(mocks.getPage).toHaveBeenCalledExactlyOnceWith(READER, "handbook", "guides", "setup");
  });

  it.each([
    ["no page", {}],
    ["a page name with its .md", { page: "setup.md" }],
    ["a tab in upper case", { tab: "Guides", page: "setup" }],
    ["an empty tab", { tab: "", page: "setup" }],
    ["a page name with a path", { page: "../secret" }],
  ])("answers %s with a tool error and does not reach the service", async (_case, args) => {
    errorOf(await callTool("read_page", args));

    expect(mocks.getPage).not.toHaveBeenCalled();
  });

  it("answers a failing database with a tool error that does not pass on the error, and logs it", async () => {
    const err = new Error("password authentication failed for user hippowiki");
    mocks.getPage.mockRejectedValue(err);

    const message = errorOf(await callTool("read_page", { page: "setup" }));

    expect(message).toBe("The wiki could not be read. Please try again later.");
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, tool: "read_page" }, "mcp tool failed");
  });
});

describe("an unknown tool", () => {
  it("is not found", async () => {
    const answer = await send({ method: "tools/call", params: { name: "delete_page", arguments: {} } });

    expect(JSON.stringify(answer)).toContain("delete_page");
    expect(mocks.getPage).not.toHaveBeenCalled();
  });
});

describe("the write tools", () => {
  const STORED = { id: "p1", name: "setup", version: 5, folder: { name: "handbook" }, tab: null };
  const PAGE = {
    id: "p1",
    name: "setup",
    title: "Setup",
    content: "# Setup",
    updatedAt: CHANGED,
    lastEditedBy: { name: "bob" },
    version: 4,
    folder: { id: FOLDER_ID, name: "handbook" },
    tab: null,
    role: "writer",
  };
  const NOT_ALLOWED = "Your role on the folder does not allow this change, so nothing was changed.";

  beforeEach(() => {
    actor = WRITER;
    mocks.getPage.mockResolvedValue(PAGE);
    mocks.getTab.mockResolvedValue({ id: "tab-1", name: "guides", folder: FOLDER, role: "writer" });
  });

  it("are registered for a Writer connection, with their inputs and the hints of a tool that writes", async () => {
    const answer = await send({ method: "tools/list" });

    const tools = answer.result?.tools as {
      name: string;
      description: string;
      inputSchema: { properties?: Record<string, { description?: string }>; required?: string[] };
      annotations: Record<string, boolean>;
    }[];
    expect(tools.map((tool) => tool.name)).toEqual([
      "list_folder",
      "read_page",
      "create_page",
      "replace_page_content",
      "move_or_rename_page",
    ]);
    const [create, replace, move] = tools.slice(2);
    expect(Object.keys(create?.inputSchema.properties ?? {})).toEqual(["content", "tab", "name"]);
    expect(create?.inputSchema.required).toEqual(["content"]);
    expect(Object.keys(replace?.inputSchema.properties ?? {})).toEqual(["tab", "page", "version", "content"]);
    expect(replace?.inputSchema.required).toEqual(["page", "content"]);
    expect(Object.keys(move?.inputSchema.properties ?? {})).toEqual(["tab", "page", "version", "newTab", "newName"]);
    expect(move?.inputSchema.required).toEqual(["page", "newTab", "newName"]);
    for (const tool of tools.slice(2)) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: false });
      for (const argument of Object.values(tool.inputSchema.properties ?? {}))
        expect(argument.description).toBeTruthy();
    }
    expect(replace?.annotations.destructiveHint).toBe(true);
  });

  it("are registered for a Manager connection as well, after the read tools", async () => {
    actor = MANAGER;

    const answer = await send({ method: "tools/list" });

    expect((answer.result?.tools as { name: string }[]).map((tool) => tool.name).slice(0, 5)).toEqual([
      "list_folder",
      "read_page",
      "create_page",
      "replace_page_content",
      "move_or_rename_page",
    ]);
  });

  it("are not registered for a Reader connection, and a call of one reaches no service", async () => {
    actor = READER;

    const list = await send({ method: "tools/list" });
    const call = await send({
      method: "tools/call",
      params: { name: "create_page", arguments: { content: "# New" } },
    });

    expect((list.result?.tools as { name: string }[]).map((tool) => tool.name)).toEqual(["list_folder", "read_page"]);
    expect(JSON.stringify(call)).toContain("create_page");
    expect(mocks.createPage).not.toHaveBeenCalled();
  });

  it("tell a Writer connection in the instructions about the write tools and the version", () => {
    const instructions = instructionsFor("handbook", "writer");

    for (const word of ["create_page", "replace_page_content", "move_or_rename_page", "version"]) {
      expect(instructions).toContain(word);
    }
  });

  describe("create_page", () => {
    it("creates a page with the name derived from its title in the folder, and returns it as stored", async () => {
      mocks.createPage.mockResolvedValue({ ok: true, value: { ...STORED, name: "release-notes", version: 1 } });
      mocks.getPage.mockResolvedValue({ ...PAGE, name: "release-notes", title: "Release Notes" });

      const result = await callTool("create_page", { content: "# Release Notes\n\nText" });

      expect(mocks.createPage).toHaveBeenCalledExactlyOnceWith(WRITER, FOLDER_ID, {
        name: "release-notes",
        content: "# Release Notes\n\nText",
        tabId: null,
      });
      expect(result.structuredContent).toEqual({
        name: "release-notes",
        title: "Release Notes",
        tab: null,
        address: "https://wiki.example.com/folders/handbook/release-notes.md",
        version: 1,
      });
    });

    it("creates a page with a given name in a tab found by its name", async () => {
      mocks.createPage.mockResolvedValue({ ok: true, value: { ...STORED, tab: { name: "guides" }, version: 1 } });

      await callTool("create_page", { content: "# Setup", tab: "guides", name: "setup" });

      expect(mocks.getTab).toHaveBeenCalledExactlyOnceWith(WRITER, "handbook", "guides");
      expect(mocks.createPage).toHaveBeenCalledExactlyOnceWith(WRITER, FOLDER_ID, {
        name: "setup",
        content: "# Setup",
        tabId: "tab-1",
      });
    });

    it.each([
      ["content without a title heading", { content: "Just text" }, "must start with a title heading"],
      ["a title heading without a letter or digit", { content: "# ...!" }, "must start with a title heading"],
      ["a title in another script", { content: "# 日本語" }, "The title suggests no name"],
    ])("answers %s without a name with a tool error and creates nothing", async (_case, args, message) => {
      expect(errorOf(await callTool("create_page", args))).toContain(message);
      expect(mocks.createPage).not.toHaveBeenCalled();
    });

    it("answers content over the length limit without a name with the length error and never parses it", async () => {
      const content = `# Long\n\n${"a".repeat(CONTENT_MAX_LENGTH)}`;

      expect(errorOf(await callTool("create_page", { content }))).toContain(
        "The content is not valid: Content must be at most 100,000 characters",
      );
      expect(analyseMarkdown).not.toHaveBeenCalled();
      expect(mocks.createPage).not.toHaveBeenCalled();
    });

    it("answers content nested too deep without a name with the depth error and creates nothing", async () => {
      const content = `# Deep\n\n${"- ".repeat(CONTENT_MAX_DEPTH + 1)}a`;

      expect(errorOf(await callTool("create_page", { content }))).toContain(
        `The content is not valid: Lists and quotes must be nested at most ${CONTENT_MAX_DEPTH} levels deep`,
      );
      expect(analyseMarkdown).toHaveBeenCalledOnce();
      expect(mocks.createPage).not.toHaveBeenCalled();
    });

    it("answers a tab that does not exist with a tool error and creates nothing", async () => {
      mocks.getTab.mockResolvedValue(null);

      expect(errorOf(await callTool("create_page", { content: "# New", tab: "nowhere" }))).toBe(
        'There is no tab named "nowhere" in the folder "handbook", so nothing was changed. Use list_folder to see ' +
          "the tabs of the folder; tabs are created in the browser.",
      );
      expect(mocks.createPage).not.toHaveBeenCalled();
    });

    it.each([
      [{ code: "not-allowed" }, NOT_ALLOWED],
      [{ code: "name-taken" }, 'A page named "new" already exists directly in the folder "handbook"'],
      [{ code: "invalid-input", fieldErrors: { name: ["Name is not valid"] } }, "The name is not valid"],
      [{ code: "invalid-input", fieldErrors: { content: ["Content must be at most 10"] } }, "The content is not valid"],
      [{ code: "tab-not-found" }, "There is no tab named"],
      [{ code: "folder-not-found" }, "The folder of this connection cannot be read any more"],
      [{ code: "failed" }, "The change could not be stored. Please try again later."],
    ])("maps the error %j to a tool error", async (error, message) => {
      mocks.createPage.mockResolvedValue({ ok: false, error });

      expect(errorOf(await callTool("create_page", { content: "# New", name: "new" }))).toContain(message);
    });
  });

  describe("replace_page_content", () => {
    it("replaces the content of the page found by its tab and name, based on the given version", async () => {
      mocks.updatePageContent.mockResolvedValue({ ok: true, value: STORED });

      const result = await callTool("replace_page_content", { page: "setup", version: 4, content: "# Setup 2" });

      expect(mocks.getPage).toHaveBeenCalledWith(WRITER, "handbook", null, "setup");
      expect(mocks.updatePageContent).toHaveBeenCalledExactlyOnceWith(WRITER, "p1", {
        content: "# Setup 2",
        version: 4,
      });
      expect(result.structuredContent).toMatchObject({ name: "setup", version: 5 });
    });

    it("passes no version on as null, which the service refuses as changed", async () => {
      mocks.updatePageContent.mockResolvedValue({ ok: false, error: { code: "page-changed", page: STORED } });

      const message = errorOf(await callTool("replace_page_content", { page: "setup", content: "# Setup 2" }));

      expect(mocks.updatePageContent).toHaveBeenCalledWith(WRITER, "p1", { content: "# Setup 2", version: null });
      expect(message).toBe(
        "The page was changed by bob at 2026-03-01T12:00:00.000Z, after the version this change is based on, or the " +
          "change states no valid version. Nothing was changed. Read the page again with read_page and base the " +
          "change on its current content and version.",
      );
    });

    it("answers a page that does not exist with a tool error and changes nothing", async () => {
      mocks.getPage.mockResolvedValue(null);

      expect(errorOf(await callTool("replace_page_content", { page: "gone", version: 1, content: "# X" }))).toContain(
        'There is no page named "gone"',
      );
      expect(mocks.updatePageContent).not.toHaveBeenCalled();
    });

    it.each([
      [{ code: "not-allowed" }, NOT_ALLOWED],
      [{ code: "page-not-found" }, "There is no page named"],
      [{ code: "invalid-input", fieldErrors: { content: [TITLE_MISSING] } }, "must start with a title heading"],
      [{ code: "failed" }, "The change could not be stored."],
    ])("maps the error %j to a tool error", async (error, message) => {
      mocks.updatePageContent.mockResolvedValue({ ok: false, error });

      expect(errorOf(await callTool("replace_page_content", { page: "setup", version: 4, content: "x" }))).toContain(
        message,
      );
    });
  });

  describe("move_or_rename_page", () => {
    it("moves the page into a tab of the folder with a new name, based on the given version", async () => {
      mocks.moveOrRenamePage.mockResolvedValue({
        ok: true,
        value: { ...STORED, name: "install", tab: { name: "guides" } },
      });

      const result = await callTool("move_or_rename_page", {
        page: "setup",
        version: 4,
        newTab: "guides",
        newName: "install",
      });

      expect(mocks.moveOrRenamePage).toHaveBeenCalledExactlyOnceWith(WRITER, "p1", {
        name: "install",
        tabId: "tab-1",
        version: 4,
      });
      expect(result.structuredContent).toMatchObject({
        name: "install",
        tab: "guides",
        address: "https://wiki.example.com/folders/handbook/guides/install.md",
      });
    });

    it("moves the page directly into the folder for a new tab of null", async () => {
      mocks.moveOrRenamePage.mockResolvedValue({ ok: true, value: STORED });

      await callTool("move_or_rename_page", {
        tab: "guides",
        page: "setup",
        version: 4,
        newTab: null,
        newName: "setup",
      });

      expect(mocks.getTab).not.toHaveBeenCalled();
      expect(mocks.moveOrRenamePage).toHaveBeenCalledWith(WRITER, "p1", { name: "setup", tabId: null, version: 4 });
    });

    it("answers a target tab that does not exist with a tool error and changes nothing", async () => {
      mocks.getTab.mockResolvedValue(null);

      expect(
        errorOf(await callTool("move_or_rename_page", { page: "setup", version: 4, newTab: "x", newName: "setup" })),
      ).toContain('There is no tab named "x"');
      expect(mocks.moveOrRenamePage).not.toHaveBeenCalled();
    });

    it.each([
      [{ code: "not-allowed" }, NOT_ALLOWED],
      [{ code: "page-not-found" }, "There is no page named"],
      [{ code: "page-changed", page: STORED }, "The page was changed by bob"],
      [{ code: "tab-not-found" }, "There is no tab named"],
      [{ code: "name-taken" }, 'A page named "taken" already exists directly in the folder "handbook"'],
      [{ code: "invalid-input", fieldErrors: { name: ["Name is not valid"] } }, "The name is not valid"],
      [{ code: "failed" }, "The change could not be stored."],
    ])("maps the error %j to a tool error", async (error, message) => {
      mocks.moveOrRenamePage.mockResolvedValue({ ok: false, error });

      expect(
        errorOf(await callTool("move_or_rename_page", { page: "setup", version: 4, newTab: null, newName: "taken" })),
      ).toContain(message);
    });

    it("answers a failing database with a tool error that does not pass on the error, and logs it", async () => {
      const err = new Error("connection lost");
      mocks.moveOrRenamePage.mockRejectedValue(err);

      expect(
        errorOf(await callTool("move_or_rename_page", { page: "setup", version: 4, newTab: null, newName: "x" })),
      ).toBe("The change could not be stored. Please try again later.");
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, tool: "move_or_rename_page" }, "mcp tool failed");
    });
  });
});

describe("the tools of a Manager connection", () => {
  const PAGE = {
    id: "p1",
    name: "setup",
    title: "Setup",
    content: "# Setup",
    updatedAt: CHANGED,
    lastEditedBy: { name: "bob" },
    version: 4,
    folder: { id: FOLDER_ID, name: "handbook" },
    tab: { name: "guides" },
    role: "manager",
  };
  const TAB = { id: "tab-1", name: "guides", folder: FOLDER, role: "manager" };
  const NOT_ALLOWED = "Your role on the folder does not allow this change, so nothing was changed.";
  const MANAGER_TOOLS = ["delete_page", "create_tab", "rename_tab"];

  type ListedTool = {
    name: string;
    description: string;
    inputSchema: { properties?: Record<string, { description?: string }>; required?: string[] };
    outputSchema?: unknown;
    annotations: Record<string, boolean>;
  };

  async function listedTools(): Promise<ListedTool[]> {
    return (await send({ method: "tools/list" })).result?.tools as ListedTool[];
  }

  /** The calls of every service that a tool of a Manager connection writes with. */
  function expectNoManagerWrite(): void {
    expect(mocks.deletePage).not.toHaveBeenCalled();
    expect(mocks.createTab).not.toHaveBeenCalled();
    expect(mocks.renameTab).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    actor = MANAGER;
    mocks.getPage.mockResolvedValue(PAGE);
    mocks.getTab.mockResolvedValue(TAB);
  });

  it("are registered for a Manager connection after the write tools, with inputs, output schemas and hints", async () => {
    const tools = await listedTools();

    expect(tools.map((tool) => tool.name).slice(5, 8)).toEqual(MANAGER_TOOLS);
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    expect(Object.keys(byName.delete_page?.inputSchema.properties ?? {})).toEqual(["tab", "page", "version"]);
    expect(byName.delete_page?.inputSchema.required).toEqual(["page"]);
    expect(Object.keys(byName.create_tab?.inputSchema.properties ?? {})).toEqual(["name"]);
    expect(byName.create_tab?.inputSchema.required).toEqual(["name"]);
    expect(Object.keys(byName.rename_tab?.inputSchema.properties ?? {})).toEqual(["tab", "newName"]);
    expect(byName.rename_tab?.inputSchema.required).toEqual(["tab", "newName"]);
    for (const name of MANAGER_TOOLS) {
      const tool = byName[name];
      expect(tool?.description.length).toBeGreaterThan(40);
      expect(tool?.outputSchema).toBeTruthy();
      expect(tool?.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false, openWorldHint: false });
      for (const argument of Object.values(tool?.inputSchema.properties ?? {}))
        expect(argument.description).toBeTruthy();
    }
    expect(byName.delete_page?.annotations.destructiveHint).toBe(true);
    expect(byName.create_tab?.annotations.destructiveHint).toBe(false);
    expect(byName.rename_tab?.annotations.destructiveHint).toBe(false);
  });

  it.each([
    ["Writer", WRITER],
    ["Reader", READER],
  ])("are not registered for a %s connection, and a call of one reaches no service", async (_role, other) => {
    actor = other;

    expect((await listedTools()).map((tool) => tool.name)).not.toContain("delete_page");
    for (const [name, args] of [
      ["delete_page", { page: "setup", version: 4 }],
      ["create_tab", { name: "news" }],
      ["rename_tab", { tab: "guides", newName: "news" }],
    ] as const) {
      const answer = await send({ method: "tools/call", params: { name, arguments: args } });
      expect(JSON.stringify(answer)).toContain(name);
    }
    expectNoManagerWrite();
  });

  it("tell a Manager connection about a missing tab that it can create the tab, and other connections the browser", async () => {
    mocks.getTab.mockResolvedValue(null);

    const manager = errorOf(await callTool("create_page", { content: "# New", tab: "news" }));
    actor = WRITER;
    const writer = errorOf(await callTool("create_page", { content: "# New", tab: "news" }));

    expect(manager).toContain("create the tab with create_tab");
    expect(manager).not.toContain("browser");
    expect(writer).toContain("tabs are created in the browser");
    expect(writer).not.toContain("create_tab");
  });

  describe("delete_page", () => {
    const PLACE = { folder: { name: "handbook" }, tab: { name: "guides" } };

    it("deletes the page found by its tab and name, based on the given version, and says where to restore it", async () => {
      mocks.deletePage.mockResolvedValue({ ok: true, value: PLACE });

      const result = await callTool("delete_page", { tab: "guides", page: "setup", version: 4 });

      expect(mocks.getPage).toHaveBeenCalledWith(MANAGER, "handbook", "guides", "setup");
      expect(mocks.deletePage).toHaveBeenCalledExactlyOnceWith(MANAGER, "p1", { version: 4 });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        name: "setup",
        title: "Setup",
        tab: "guides",
        deletedPagesAddress: "https://wiki.example.com/deleted-pages/handbook",
        restore: expect.stringMatching(/restored by a Manager or Owner of the folder in the browser/),
      });
      expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(result.structuredContent);
    });

    it("gives the path of the deleted pages without a public URL", async () => {
      publicUrl = undefined;
      mocks.deletePage.mockResolvedValue({ ok: true, value: { folder: { name: "handbook" }, tab: null } });

      const result = await callTool("delete_page", { page: "setup", version: 4 });

      expect(result.structuredContent).toMatchObject({ tab: null, deletedPagesAddress: "/deleted-pages/handbook" });
    });

    it("passes no version on as null, which the service refuses as changed", async () => {
      mocks.deletePage.mockResolvedValue({ ok: false, error: { code: "page-changed", page: PAGE } });

      const message = errorOf(await callTool("delete_page", { tab: "guides", page: "setup" }));

      expect(mocks.deletePage).toHaveBeenCalledWith(MANAGER, "p1", { version: null });
      expect(message).toContain("The page was changed by bob at 2026-03-01T12:00:00.000Z");
      expect(message).toContain("read_page");
    });

    it("answers a page that does not exist, or is deleted, with a tool error and deletes nothing", async () => {
      mocks.getPage.mockResolvedValue(null);

      expect(errorOf(await callTool("delete_page", { page: "gone", version: 1 }))).toContain(
        'There is no page named "gone" directly in the folder "handbook"',
      );
      expect(mocks.deletePage).not.toHaveBeenCalled();
    });

    it.each([
      [{ code: "not-allowed" }, NOT_ALLOWED],
      [{ code: "page-not-found" }, 'There is no page named "setup"'],
      [{ code: "page-changed", page: { ...PAGE, tab: { name: "guides" } } }, "The page was changed by bob"],
      [{ code: "failed" }, "The change could not be stored."],
    ])("maps the error %j to a tool error", async (error, message) => {
      mocks.deletePage.mockResolvedValue({ ok: false, error });

      expect(errorOf(await callTool("delete_page", { tab: "guides", page: "setup", version: 4 }))).toContain(message);
    });

    it("answers a failing database with a tool error that does not pass on the error, and logs it", async () => {
      const err = new Error("connection lost");
      mocks.deletePage.mockRejectedValue(err);

      expect(errorOf(await callTool("delete_page", { page: "setup", version: 4 }))).toBe(
        "The change could not be stored. Please try again later.",
      );
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, tool: "delete_page" }, "mcp tool failed");
    });
  });

  describe("create_tab", () => {
    it("creates the tab in the folder of the connection and returns it with its address", async () => {
      mocks.createTab.mockResolvedValue({ ok: true, value: { id: "t2", name: "news", folder: { name: "handbook" } } });

      const result = await callTool("create_tab", { name: "news" });

      expect(mocks.createTab).toHaveBeenCalledExactlyOnceWith(MANAGER, FOLDER_ID, { name: "news" });
      expect(result.structuredContent).toEqual({
        name: "news",
        address: "https://wiki.example.com/folders/handbook/news",
      });
    });

    it("gives the path of the tab without a public URL", async () => {
      publicUrl = undefined;
      mocks.createTab.mockResolvedValue({ ok: true, value: { id: "t2", name: "news", folder: { name: "handbook" } } });

      expect((await callTool("create_tab", { name: "news" })).structuredContent).toMatchObject({
        address: "/folders/handbook/news",
      });
    });

    it.each([
      [{ code: "not-allowed" }, NOT_ALLOWED],
      [{ code: "folder-not-found" }, "The folder of this connection cannot be read any more."],
      [
        { code: "invalid-input", fieldErrors: { name: ["Name is not valid"] } },
        "The name is not valid: Name is not valid A name has lowercase letters, digits and single hyphens",
      ],
      [{ code: "name-taken" }, 'A tab named "News" already exists in the folder "handbook", so nothing was changed.'],
      [{ code: "failed" }, "The change could not be stored."],
    ])("maps the error %j to a tool error", async (error, message) => {
      mocks.createTab.mockResolvedValue({ ok: false, error });

      expect(errorOf(await callTool("create_tab", { name: "News" }))).toContain(message);
    });

    it("answers a failing database with a tool error that does not pass on the error, and logs it", async () => {
      const err = new Error("connection lost");
      mocks.createTab.mockRejectedValue(err);

      expect(errorOf(await callTool("create_tab", { name: "news" }))).toBe(
        "The change could not be stored. Please try again later.",
      );
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, tool: "create_tab" }, "mcp tool failed");
    });
  });

  describe("rename_tab", () => {
    it("renames the tab found by its name and returns it with its new address, without a version", async () => {
      mocks.renameTab.mockResolvedValue({
        ok: true,
        value: { id: "tab-1", name: "howtos", folder: { name: "handbook" } },
      });

      const result = await callTool("rename_tab", { tab: "guides", newName: "howtos" });

      expect(mocks.getTab).toHaveBeenCalledWith(MANAGER, "handbook", "guides");
      expect(mocks.renameTab).toHaveBeenCalledExactlyOnceWith(MANAGER, "tab-1", { name: "howtos" });
      expect(result.structuredContent).toEqual({
        name: "howtos",
        address: "https://wiki.example.com/folders/handbook/howtos",
      });
    });

    it("answers a tab that does not exist with a tool error and renames nothing", async () => {
      mocks.getTab.mockResolvedValue(null);

      expect(errorOf(await callTool("rename_tab", { tab: "gone", newName: "news" }))).toContain(
        'There is no tab named "gone" in the folder "handbook", so nothing was changed.',
      );
      expect(mocks.renameTab).not.toHaveBeenCalled();
    });

    it.each([
      [{ code: "not-allowed" }, NOT_ALLOWED],
      [{ code: "tab-not-found" }, 'There is no tab named "guides"'],
      [{ code: "invalid-input", fieldErrors: { name: ["Name is not valid"] } }, "The name is not valid"],
      [{ code: "name-taken" }, 'A tab named "news" already exists in the folder "handbook"'],
      [{ code: "failed" }, "The change could not be stored."],
    ])("maps the error %j to a tool error", async (error, message) => {
      mocks.renameTab.mockResolvedValue({ ok: false, error });

      expect(errorOf(await callTool("rename_tab", { tab: "guides", newName: "news" }))).toContain(message);
    });

    it("answers a failing database with a tool error that does not pass on the error, and logs it", async () => {
      const err = new Error("connection lost");
      mocks.renameTab.mockRejectedValue(err);

      expect(errorOf(await callTool("rename_tab", { tab: "guides", newName: "news" }))).toBe(
        "The change could not be stored. Please try again later.",
      );
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, tool: "rename_tab" }, "mcp tool failed");
    });
  });
});
