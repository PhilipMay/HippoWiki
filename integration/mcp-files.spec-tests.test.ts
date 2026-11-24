// Tests of the MCP tools move_or_rename_file and delete_file written from the spec alone (spec/mcp.md, "Tools", and
// the specs it points to), against the real services, the MCP server and the test
// database. What src/features/mcp/tools.test.ts, integration/file-service.test.ts and e2e/mcp-files.spec.ts already
// check is not checked again here.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it } from "vitest";

import { inMcp, type McpActor } from "@/features/folder-roles/actors";
import { getLinkedFileContent } from "@/features/files/link-service";
import type { StoreState } from "@/features/files/store";
import { createWikiServer } from "@/features/mcp/server";
import type { Folder, User } from "@/generated/prisma/client";

import {
  createFile,
  createFolder,
  createGrant,
  createPage,
  createTab,
  createUser,
  getTestDb,
  signFileLinkToken,
} from "../e2e/support/database";
import { createBob, mcpActorOf } from "./helpers";

const PUBLIC_URL = "https://wiki.example.com";

/** The result of a tool call. */
type ToolResult = { content: { type: string; text: string }[]; structuredContent?: unknown; isError?: boolean };

/** A JSON-RPC answer of the server. */
type Answer = { result?: Record<string, unknown>; error?: { code: number; message: string } };

let alice: User;
let bob: User;
let handbook: Folder;

beforeEach(async () => {
  alice = await createUser({ name: "alice", mustChangePassword: false });
  bob = await createBob();
  handbook = await createFolder({
    name: "handbook",
    editor: alice,
    roles: [
      { user: alice, role: "owner" },
      { user: bob, role: "manager" },
    ],
  });
});

/** The actor of a connection of the given role to "handbook", of alice unless another user is given. */
function connection(role: McpActor["connection"]["role"], user: User = alice): McpActor {
  return mcpActorOf(user, handbook, role);
}

/** Sends one message to a new server with the tools of the connection of the actor to "handbook". */
async function send(actor: McpActor, message: Record<string, unknown>): Promise<Answer> {
  const server = createWikiServer({ publicUrl: PUBLIC_URL, actor, folder: { id: handbook.id, name: handbook.name } });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(
    new Request(`${PUBLIC_URL}/mcp/${handbook.id}/${actor.connection.role}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...message }),
    }),
  );
  await server.close();
  return (await response.json()) as Answer;
}

/** Calls a tool and returns its result, a tool error included; fails the test on a protocol error. */
async function callTool(actor: McpActor, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const answer = await send(actor, { method: "tools/call", params: { name, arguments: args } });
  expect(answer.result, `${name}: ${JSON.stringify(answer.error)}`).toBeDefined();
  return answer.result as ToolResult;
}

/** The structured result of a call that worked; fails the test on a tool error. */
function resultOf(result: ToolResult): Record<string, unknown> {
  expect(result.isError, result.content[0]?.text).toBeFalsy();
  return result.structuredContent as Record<string, unknown>;
}

/** The message of a tool error; fails the test if the call worked. */
function errorOf(result: ToolResult): string {
  expect(result.isError, JSON.stringify(result.structuredContent)).toBe(true);
  return result.content[0]?.text ?? "";
}

/** Every file of every folder as stored, with every column, to compare before and after. */
function storedFiles() {
  return getTestDb().file.findMany({ orderBy: { id: "asc" } });
}

/** Every page of every folder as stored, with every column, to compare before and after. */
function storedPages() {
  return getTestDb().page.findMany({ orderBy: { id: "asc" } });
}

/** Uses a store whose files directory is not set, as a server with the files off, until the end of `run`. */
async function withFilesOff<T>(run: () => Promise<T>): Promise<T> {
  const global = globalThis as { hippowikiFileStore?: Promise<StoreState> };
  const before = global.hippowikiFileStore;
  global.hippowikiFileStore = Promise.resolve({ on: false, reason: "not-set", dir: null });
  try {
    return await run();
  } finally {
    global.hippowikiFileStore = before;
  }
}

/** Runs `run` while a trigger refuses every write of the given kind on the table, and drops the trigger afterwards. */
async function whileRefused<T>(table: string, writes: string, run: () => Promise<T>): Promise<T> {
  const db = getTestDb();
  await db.$executeRawUnsafe(`
    CREATE FUNCTION refuse_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'write refused by the test'; END $$`);
  await db.$executeRawUnsafe(
    `CREATE TRIGGER refuse_write BEFORE ${writes} ON "${table}" FOR EACH ROW EXECUTE FUNCTION refuse_write()`,
  );
  try {
    return await run();
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER refuse_write ON "${table}"`);
    await db.$executeRawUnsafe(`DROP FUNCTION refuse_write()`);
  }
}

describe("move_or_rename_file", () => {
  // mcp.md, "Tools", `move_or_rename_file`: the new name keeps the extension of the file's type, for every type
  // and not only for a PNG.
  it("refuses a JPEG renamed to .jpeg and a PDF renamed to .png with an error that names the extension of its type, and changes nothing", async () => {
    const photo = await createFile({ folder: handbook, name: "photo.jpg", editor: alice });
    const manual = await createFile({ folder: handbook, name: "manual.pdf", editor: alice });
    const before = await storedFiles();

    const jpeg = errorOf(
      await callTool(connection("writer"), "move_or_rename_file", {
        file: "photo.jpg",
        lockVersion: photo.lockVersion,
        newTab: null,
        newName: "photo.jpeg",
      }),
    );
    const pdf = errorOf(
      await callTool(connection("writer"), "move_or_rename_file", {
        file: "manual.pdf",
        lockVersion: manual.lockVersion,
        newTab: null,
        newName: "manual.png",
      }),
    );

    expect(jpeg).toContain(".jpg");
    expect(pdf).toContain(".pdf");
    expect(await storedFiles()).toEqual(before);
  });

  // optimistic-locking.md, "Callers other than the browser": a move based on another lock version than the file's is refused, a
  // higher one and none as well as an older one; optimistic-locking.md, "Files": "based on another lock version, or on
  // none".
  it("refuses a move based on a lock version higher than the file's, or on none, and the file keeps its name and place", async () => {
    const file = await createFile({ folder: handbook, name: "setup.png", editor: alice });
    const before = await storedFiles();

    for (const lockVersion of [file.lockVersion + 1, undefined]) {
      const result = await callTool(connection("writer"), "move_or_rename_file", {
        file: "setup.png",
        lockVersion,
        newTab: null,
        newName: "network.png",
      });
      // The error says to read the file again and base the move on its current lock version.
      expect(errorOf(result), String(lockVersion)).toContain("lockVersion");
    }

    expect(await storedFiles()).toEqual(before);
  });

  // mcp.md, "Tools", `move_or_rename_file`, and wiki-links.md, "Updates on a move or rename": a move out of a tab
  // directly into the folder changes every link and embed of the file in the pages of the folder, keeps the labels,
  // counts up the version of each changed page, and changes neither deleted pages nor the pages of another folder.
  it("changes the links and embeds of a file moved out of a tab in the pages of its folder only, keeps their labels and counts up their versions", async () => {
    const guides = await createTab({ folder: handbook, name: "guides", editor: alice });
    const file = await createFile({ tab: guides, name: "setup.png", editor: alice });
    const install = await createPage({
      tab: guides,
      name: "install",
      content: "# Install\n\n![[guides/setup.png]]\n\nSee [[guides/setup.png|the setup]].",
      editor: alice,
    });
    const gone = await createPage({
      folder: handbook,
      name: "gone",
      content: "# Gone\n\n![[guides/setup.png]]",
      editor: alice,
      deletedAt: new Date(),
    });
    const other = await createFolder({ name: "notes", editor: alice, roles: [{ user: alice, role: "owner" }] });
    await createTab({ folder: other, name: "guides", editor: alice });
    const elsewhere = await createPage({
      folder: other,
      name: "elsewhere",
      content: "# Elsewhere\n\n![[guides/setup.png]]",
      editor: alice,
    });
    const untouched = [await getTestDb().page.findUniqueOrThrow({ where: { id: gone.id } }), elsewhere];

    const moved = resultOf(
      await callTool(connection("writer"), "move_or_rename_file", {
        tab: "guides",
        file: "setup.png",
        lockVersion: file.lockVersion,
        newTab: null,
        newName: "setup-v2.png",
      }),
    );

    expect(moved.updatedPages).toEqual([{ name: "install", tab: "guides", title: "Install" }]);
    const stored = await getTestDb().page.findUniqueOrThrow({ where: { id: install.id } });
    expect(stored.content).toBe("# Install\n\n![[setup-v2.png]]\n\nSee [[setup-v2.png|the setup]].");
    expect(stored.version).toBe(install.version + 1);
    for (const page of untouched) {
      expect(await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } }), page.name).toEqual(page);
    }
  });

  // mcp.md, "Tools", `move_or_rename_file`: a move to the current name and place changes nothing, so the file
  // keeps its last editor, its channel and the time of its last change as well.
  it("changes not even the last editor and the last change of a file moved to its current name and place", async () => {
    const guides = await createTab({ folder: handbook, name: "guides", editor: alice });
    const file = await createFile({
      tab: guides,
      name: "setup.png",
      editor: alice,
      updatedAt: new Date("2026-01-01T10:00:00Z"),
    });
    const before = await storedFiles();

    const moved = resultOf(
      await callTool(connection("writer", bob), "move_or_rename_file", {
        tab: "guides",
        file: "setup.png",
        lockVersion: file.lockVersion,
        newTab: "guides",
        newName: "setup.png",
      }),
    );

    expect(moved).toMatchObject({ lockVersion: file.lockVersion, updatedPages: [] });
    expect(await storedFiles()).toEqual(before);
  });

  // mcp.md, "Tools", `move_or_rename_file`: the result gives the file as stored, the links of a PDF included,
  // which has no embed link; read_file gives the same afterwards.
  it("returns a moved PDF as read_file gives it afterwards, with its wiki link, no embed link and a lock version one higher", async () => {
    await createTab({ folder: handbook, name: "guides", editor: alice });
    const file = await createFile({ folder: handbook, name: "manual.pdf", editor: alice });

    const moved = resultOf(
      await callTool(connection("writer"), "move_or_rename_file", {
        file: "manual.pdf",
        lockVersion: file.lockVersion,
        newTab: "guides",
        newName: "network-manual.pdf",
      }),
    );
    const read = resultOf(
      await callTool(connection("reader"), "read_file", { tab: "guides", file: "network-manual.pdf" }),
    );

    expect(moved).toMatchObject({
      name: "network-manual.pdf",
      tab: "guides",
      type: "pdf",
      address: `${PUBLIC_URL}/files/handbook/guides/network-manual.pdf`,
      detailsAddress: `${PUBLIC_URL}/folders/handbook/guides/network-manual.pdf`,
      wikiLink: "[[guides/network-manual.pdf]]",
      embedLink: null,
      lockVersion: file.lockVersion + 1,
    });
    for (const field of ["name", "tab", "type", "address", "detailsAddress", "wikiLink", "embedLink", "lockVersion"]) {
      expect(moved[field], field).toEqual(read[field]);
    }
  });
});

describe("delete_file", () => {
  // page-deletion.md, "Deleting a file": the name of a deleted file is free at once, also for a move through
  // MCP into its place.
  it("frees the name of the deleted file at once, so that another file can be moved to it", async () => {
    const guides = await createTab({ folder: handbook, name: "guides", editor: alice });
    const old = await createFile({ tab: guides, name: "diagram.png", editor: alice });
    const newer = await createFile({ tab: guides, name: "diagram-v2.png", editor: alice });

    resultOf(
      await callTool(connection("manager"), "delete_file", {
        tab: "guides",
        file: "diagram.png",
        lockVersion: old.lockVersion,
      }),
    );
    const moved = resultOf(
      await callTool(connection("manager"), "move_or_rename_file", {
        tab: "guides",
        file: "diagram-v2.png",
        lockVersion: newer.lockVersion,
        newTab: "guides",
        newName: "diagram.png",
      }),
    );

    expect(moved).toMatchObject({ name: "diagram.png", tab: "guides", wikiLink: "[[guides/diagram.png]]" });
  });

  // mcp.md, "Tools", `delete_file`: the pages that showed or linked the file are listed so that the
  // agent can change them; the delete itself changes none of them, they show the file as missing.
  it("changes no page that showed or linked the deleted file: each keeps its content and its version", async () => {
    const file = await createFile({ folder: handbook, name: "setup.png", editor: alice });
    await createPage({
      folder: handbook,
      name: "setup",
      content: "# Setup\n\n![[setup.png]] and [[setup.png|the image]]",
      editor: alice,
    });
    const before = await storedPages();

    const deleted = resultOf(
      await callTool(connection("manager"), "delete_file", { file: "setup.png", lockVersion: file.lockVersion }),
    );

    expect(deleted.shownOrLinkedFrom).toEqual([{ name: "setup", tab: null, title: "Setup" }]);
    expect(await storedPages()).toEqual(before);
  });
});

describe("both tools", () => {
  // mcp.md, "Tools", `move_or_rename_file` and `delete_file`: the file is found by its tab, if it is in one, and its
  // current name, as read_file finds it; mcp.md, "What holds for all of them": a name with spaces around it gets the
  // not-found error, and no tool reaches another folder.
  it("find a file only by its own tab and its exact name in the folder of the connection, and answer every other with an error that names list_folder", async () => {
    const guides = await createTab({ folder: handbook, name: "guides", editor: alice });
    await createTab({ folder: handbook, name: "drafts", editor: alice });
    const file = await createFile({ tab: guides, name: "setup.png", editor: alice });
    await createPage({ folder: handbook, name: "overview", content: "# Overview", editor: alice });
    const other = await createFolder({ name: "notes", editor: alice, roles: [{ user: alice, role: "owner" }] });
    await createFile({ folder: other, name: "manual.pdf", editor: alice });
    const before = await storedFiles();
    const misses: Record<string, unknown>[] = [
      { file: "setup.png" },
      { tab: "drafts", file: "setup.png" },
      { tab: "guides", file: " setup.png " },
      { tab: "guides", file: "setup" },
      { file: "overview" },
      { file: "manual.pdf" },
    ];

    for (const miss of misses) {
      const where = JSON.stringify(miss);
      const move = { lockVersion: file.lockVersion, newTab: null, newName: "network.png", ...miss };
      expect(errorOf(await callTool(connection("manager"), "move_or_rename_file", move)), where).toContain(
        "list_folder",
      );
      const remove = { lockVersion: file.lockVersion, ...miss };
      expect(errorOf(await callTool(connection("manager"), "delete_file", remove)), where).toContain("list_folder");
    }

    expect(await storedFiles()).toEqual(before);
  });

  // optimistic-locking.md, "Files": the check of the lock
  // version is part of the write, so of changes at the same time based on the same lock version exactly one wins.
  it("let exactly one of two moves and a delete at the same time, based on the same lock version, win", async () => {
    for (let round = 0; round < 5; round++) {
      const name = `setup-${round}.png`;
      const file = await createFile({ folder: handbook, name, editor: alice });

      const results = await Promise.all([
        callTool(connection("manager"), "move_or_rename_file", {
          file: name,
          lockVersion: file.lockVersion,
          newTab: null,
          newName: `first-${round}.png`,
        }),
        callTool(connection("manager"), "move_or_rename_file", {
          file: name,
          lockVersion: file.lockVersion,
          newTab: null,
          newName: `second-${round}.png`,
        }),
        callTool(connection("manager"), "delete_file", { file: name, lockVersion: file.lockVersion }),
      ]);

      expect(
        results.filter((result) => !result.isError),
        `round ${round}`,
      ).toHaveLength(1);
      const stored = await getTestDb().file.findUniqueOrThrow({ where: { id: file.id } });
      expect(stored.lockVersion, `round ${round}`).toBe(file.lockVersion + 1);
    }
  });

  // mcp.md, "Decisions": both tools work while the files are off, through the MCP server and
  // not only in the service.
  it("move and delete a file through the MCP server while the files are off", async () => {
    const file = await createFile({ folder: handbook, name: "setup.png", editor: alice });

    await withFilesOff(async () => {
      const moved = resultOf(
        await callTool(connection("manager"), "move_or_rename_file", {
          file: "setup.png",
          lockVersion: file.lockVersion,
          newTab: null,
          newName: "network.png",
        }),
      );
      resultOf(
        await callTool(connection("manager"), "delete_file", {
          file: "network.png",
          lockVersion: moved.lockVersion,
        }),
      );
    });

    expect(await getTestDb().file.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
      name: "network.png",
      deletedAt: expect.any(Date),
    });
  });

  // mcp.md, "What holds for all of them": a role lowered between the request and the change is a tool error
  // and changes nothing: a Writer connection of a user who is now a Reader cannot move, a Manager connection of a user
  // who is now a Writer cannot delete.
  it("change nothing when the user's role was lowered after the connection's tools were listed, and answer with a tool error", async () => {
    const file = await createFile({ folder: handbook, name: "setup.png", editor: alice });
    const before = await storedFiles();
    const lowerBobTo = (role: "reader" | "writer") =>
      getTestDb().folderRole.updateMany({ where: { folderId: handbook.id, userId: bob.id }, data: { role } });
    const writer = connection("writer", bob);
    const manager = connection("manager", bob);

    await lowerBobTo("reader");
    const move = errorOf(
      await callTool(writer, "move_or_rename_file", {
        file: "setup.png",
        lockVersion: file.lockVersion,
        newTab: null,
        newName: "network.png",
      }),
    );
    await lowerBobTo("writer");
    const remove = errorOf(
      await callTool(manager, "delete_file", { file: "setup.png", lockVersion: file.lockVersion }),
    );

    // Refused for the role, not as a file that is not found.
    for (const message of [move, remove]) {
      expect(message).toMatch(/role/iu);
      expect(message).not.toContain("list_folder");
    }
    expect(await storedFiles()).toEqual(before);
  });

  // mcp.md, "What holds for all of them" and "Tools", `move_or_rename_file`: a failure of the database changes nothing and is a tool
  // error with a general message; mcp.md, "What holds for all of them": the error itself is not passed on. The move
  // and the update of the links are one change, so a page that cannot be updated keeps the file where it was.
  it("change nothing on a failure of the database, the file and the pages of a move included, and answer with a general tool error", async () => {
    const file = await createFile({ folder: handbook, name: "setup.png", editor: alice });
    await createPage({ folder: handbook, name: "setup", content: "# Setup\n\n![[setup.png]]", editor: alice });
    const files = await storedFiles();
    const pages = await storedPages();

    const move = await whileRefused("PageRevision", "INSERT", () =>
      callTool(connection("manager"), "move_or_rename_file", {
        file: "setup.png",
        lockVersion: file.lockVersion,
        newTab: null,
        newName: "network.png",
      }),
    );
    const remove = await whileRefused("File", "UPDATE OR DELETE", () =>
      callTool(connection("manager"), "delete_file", { file: "setup.png", lockVersion: file.lockVersion }),
    );

    for (const message of [errorOf(move), errorOf(remove)]) {
      expect(message).not.toContain("refused by the test");
    }
    expect(await storedFiles()).toEqual(files);
    expect(await storedPages()).toEqual(pages);
  });

  // mcp.md, "What holds for all of them": neither tool takes a folder, and no tool reaches another folder.
  it("take no folder argument, and a folder given all the same reaches no other folder", async () => {
    const tools = (await send(connection("manager"), { method: "tools/list" })).result?.tools as {
      name: string;
      inputSchema: { properties?: Record<string, unknown> };
    }[];
    for (const name of ["move_or_rename_file", "delete_file"]) {
      const tool = tools.find((listed) => listed.name === name);
      expect(tool, name).toBeDefined();
      expect(Object.keys(tool?.inputSchema.properties ?? {}), name).not.toContain("folder");
    }
    const other = await createFolder({ name: "notes", editor: alice, roles: [{ user: alice, role: "owner" }] });
    const elsewhere = await createFile({ folder: other, name: "setup.png", editor: alice });
    const otherBefore = await getTestDb().file.findUniqueOrThrow({ where: { id: elsewhere.id } });

    // Whether the server ignores the argument or refuses it, the file of the other folder stays as it is.
    await send(connection("manager"), {
      method: "tools/call",
      params: {
        name: "move_or_rename_file",
        arguments: {
          folder: "notes",
          file: "setup.png",
          lockVersion: elsewhere.lockVersion,
          newTab: null,
          newName: "network.png",
        },
      },
    });
    await send(connection("manager"), {
      method: "tools/call",
      params: {
        name: "delete_file",
        arguments: { folder: "notes", file: "setup.png", lockVersion: elsewhere.lockVersion },
      },
    });

    expect(await getTestDb().file.findUniqueOrThrow({ where: { id: elsewhere.id } })).toEqual(otherBefore);
  });

  // mcp.md, "Prompt injection": both results start with the note, in
  // the text as well as in the structured data, and the text holds the same data.
  it("start the text of their results with the note, and give the same data as text and as structured data", async () => {
    const file = await createFile({ folder: handbook, name: "setup.png", editor: alice });

    const moved = await callTool(connection("manager"), "move_or_rename_file", {
      file: "setup.png",
      lockVersion: file.lockVersion,
      newTab: null,
      newName: "network.png",
    });
    const deleted = await callTool(connection("manager"), "delete_file", {
      file: "network.png",
      lockVersion: resultOf(moved).lockVersion,
    });

    for (const result of [moved, deleted]) {
      const text = result.content[0]?.text ?? "";
      expect(Object.keys(JSON.parse(text) as object)[0]).toBe("note");
      expect(Object.keys(resultOf(result))[0]).toBe("note");
      expect(JSON.parse(text)).toEqual(result.structuredContent);
    }
  });

  // signed-file-links.md, "Downloading
  // with a link": a move, rename or delete through MCP ends a download link of the file, as one in the browser does.
  it("end a download link of the file that has not expired", async () => {
    const { grant } = await createGrant({ owner: alice, folder: handbook, role: "manager" });
    const actor = inMcp(
      { id: alice.id, name: alice.name, type: alice.type },
      { grantId: grant.id, folderId: handbook.id, role: "manager" },
    );
    const setup = await createFile({ folder: handbook, name: "setup.png", editor: alice });
    const diagram = await createFile({ folder: handbook, name: "diagram.png", editor: alice });
    const linkOf = async (file: typeof setup) => {
      const [version] = file.versions;
      if (!version) throw new Error("no version");
      return signFileLinkToken({ grant: grant.id, version: version.id });
    };
    /** Whether the link downloads the file at the address of its name, reading and closing its content. */
    const downloads = async (token: string, name: string) => {
      const linked = await getLinkedFileContent(token, "handbook", null, name);
      if (!linked) return false;
      await new Response(linked.content.blob.stream).arrayBuffer();
      return true;
    };
    const setupLink = await linkOf(setup);
    const diagramLink = await linkOf(diagram);
    expect(await downloads(setupLink, "setup.png")).toBe(true);
    expect(await downloads(diagramLink, "diagram.png")).toBe(true);

    resultOf(
      await callTool(actor, "move_or_rename_file", {
        file: "setup.png",
        lockVersion: setup.lockVersion,
        newTab: null,
        newName: "network.png",
      }),
    );
    resultOf(await callTool(actor, "delete_file", { file: "diagram.png", lockVersion: diagram.lockVersion }));

    expect(await downloads(setupLink, "setup.png")).toBe(false);
    expect(await downloads(diagramLink, "diagram.png")).toBe(false);
  });
});
