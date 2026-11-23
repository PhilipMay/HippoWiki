// Tests of the MCP tools written from the requirements of the hint on the addresses and the wiki links of pages and
// files alone (`spec/mcp-wiki-links-requirements.md`), against the real services and the test database: every tool of a
// Manager connection is called, every address in its results is looked up in its output schema, and the links the
// tools return are put into pages to show that they link what they name.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it } from "vitest";

import type { McpActor } from "@/features/folder-roles/actors";
import { createWikiServer } from "@/features/mcp/server";
import type { Folder, User } from "@/generated/prisma/client";

import { createFile, createFolder, createPage, createTab, createUser } from "../e2e/support/database";
import { mcpActorOf, owners } from "./helpers";

const PUBLIC_URL = "https://wiki.example.com";

/** The hint of R1, word for word. */
const HINT =
  "Addresses are for people: each opens only in a browser after logging in to the wiki, so an AI app cannot fetch it " +
  "with its access token. To point to a page or file in a page, use its wiki link.";

/** A JSON Schema as `tools/list` gives it, with only what the tests read. */
type Schema = {
  description?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
};

/** The result of a tool call. */
type ToolResult = { content: { type: string; text: string }[]; structuredContent?: unknown; isError?: boolean };

/** A JSON-RPC answer of the server. */
type Answer = { result?: Record<string, unknown>; error?: { code: number; message: string } };

let user: User;
let handbook: Folder;
let actor: McpActor;

beforeEach(async () => {
  user = await createUser({ name: "alice" });
  handbook = await createFolder({ name: "handbook", editor: user, roles: owners(user) });
  actor = mcpActorOf(user, handbook, "manager");
});

/** Sends one message to a new server with the tools of the Manager connection to "handbook", and returns the answer. */
async function send(message: Record<string, unknown>): Promise<Answer> {
  const server = createWikiServer({ publicUrl: PUBLIC_URL, actor, folder: { id: handbook.id, name: handbook.name } });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(
    new Request(`${PUBLIC_URL}/mcp/${handbook.id}/manager`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...message }),
    }),
  );
  await server.close();
  return (await response.json()) as Answer;
}

/** Calls a tool and returns its structured result; fails the test if the call did not work. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const answer = await send({ method: "tools/call", params: { name, arguments: args } });
  const result = answer.result as ToolResult | undefined;
  expect(result, `${name}: ${JSON.stringify(answer.error)}`).toBeDefined();
  expect(result?.isError, `${name}: ${result?.content[0]?.text}`).toBeFalsy();
  return result?.structuredContent as Record<string, unknown>;
}

/** The output schema of every tool of the connection, by the name of the tool. */
async function outputSchemas(): Promise<Map<string, Schema>> {
  const answer = await send({ method: "tools/list" });
  const tools = answer.result?.tools as { name: string; outputSchema?: Schema }[];
  return new Map(tools.map((tool) => [tool.name, tool.outputSchema ?? {}]));
}

/**
 * Sets up "handbook" with a page and an image in the tab "guides", a page and a PDF placed directly in the folder, and
 * calls every tool of a Manager connection once or more, each with the data it needs. Returns the results by tool.
 */
async function callEveryTool(): Promise<[string, Record<string, unknown>][]> {
  const guides = await createTab({ folder: handbook, name: "guides", editor: user });
  await createPage({ tab: guides, name: "setup", content: "# Install The Server\n\nSee [[overview]].", editor: user });
  await createPage({
    folder: handbook,
    name: "overview",
    content: "# Overview\n\nSee [[guides/setup]].",
    editor: user,
  });
  await createFile({ tab: guides, name: "diagram.png", editor: user });
  await createFile({ folder: handbook, name: "manual.pdf", editor: user });

  const results: [string, Record<string, unknown>][] = [];
  const record = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await call(name, args);
    results.push([name, result]);
    return result;
  };

  await record("list_folder");
  await record("read_page", { tab: "guides", page: "setup" });
  await record("read_page", { page: "overview" });
  await record("read_file", { tab: "guides", file: "diagram.png" });
  await record("read_file", { file: "manual.pdf" });
  await record("search_pages", { query: "install" });
  await record("search_pages", { query: "overview" });
  await record("search_pages", { query: "diagram" });
  await record("search_pages", { query: "manual" });
  const created = await record("create_page", { tab: "guides", name: "notes", content: "# Notes" });
  const replaced = await record("replace_page_content", {
    tab: "guides",
    page: "notes",
    version: created.version,
    content: "# Notes\n\nFirst draft.",
  });
  const edited = await record("edit_page_content", {
    tab: "guides",
    page: "notes",
    version: replaced.version,
    edits: [{ oldText: "First", newText: "Second" }],
  });
  const moved = await record("move_or_rename_page", {
    tab: "guides",
    page: "notes",
    version: edited.version,
    newTab: null,
    newName: "notes-moved",
  });
  await record("delete_page", { page: "notes-moved", version: moved.version });
  await record("create_tab", { name: "drafts" });
  await record("rename_tab", { tab: "drafts", newName: "archive" });
  await record("delete_tab", { tab: "archive" });
  return results;
}

/** A field of a result: the path to it (names of fields, `[]` for an item of a list), the object that holds it, the value. */
type Field = { path: string[]; holder: Record<string, unknown>; value: unknown };

/** Every field of the value and of the objects and lists in it. */
function fieldsOf(value: unknown, path: string[] = []): Field[] {
  if (Array.isArray(value)) return value.flatMap((item) => fieldsOf(item, [...path, "[]"]));
  if (value === null || typeof value !== "object") return [];
  const holder = value as Record<string, unknown>;
  return Object.entries(holder).flatMap(([name, field]) => [
    { path: [...path, name], holder, value: field },
    ...fieldsOf(field, [...path, name]),
  ]);
}

/** The schema of the field at the path, through lists and the branches of a nullable or alternative schema. */
function schemaAt(schema: Schema | undefined, path: string[]): Schema | undefined {
  if (!schema) return undefined;
  const [step, ...rest] = path;
  if (step === undefined) return schema;
  const branches = [schema, ...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
  for (const branch of branches) {
    const next = step === "[]" ? branch.items : branch.properties?.[step];
    const found = next && schemaAt(next, rest);
    if (found) return found;
  }
  return undefined;
}

/** Whether the value is the full URL of an address of the wiki. */
function isAddress(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(`${PUBLIC_URL}/`) && !/\s/.test(value);
}

/** The place of an item from its address under `/folders/handbook/`: the part after the folder, or null. */
function placeIn(address: string): string | null {
  const prefix = `${PUBLIC_URL}/folders/handbook/`;
  return address.startsWith(prefix) ? address.slice(prefix.length) : null;
}

/** The address of a page: a place under the folder that ends in `.md` (see "Addresses" in content-structure.md). */
function pagePlace(address: string): string | null {
  const place = placeIn(address);
  return place?.endsWith(".md") ? place.slice(0, -".md".length) : null;
}

/** The address of the details page of a file: a place under the folder with the extension of a type of file. */
function filePlace(address: string): string | null {
  const place = placeIn(address);
  return place !== null && /\.(png|jpg|gif|webp|pdf)$/.test(place) ? place : null;
}

describe("the hint on the addresses", () => {
  // mcp-wiki-links-requirements.md, R1: every address that a tool returns says in the description of its field, after
  // what it says of its item, that it is for people, with the text of the acceptance word for word.
  it("ends the description of the field of every address that any tool returns with the hint, after what it says of its item", async () => {
    const schemas = await outputSchemas();
    const results = await callEveryTool();
    expect(new Set(results.map(([tool]) => tool))).toEqual(new Set(schemas.keys()));

    const seen = new Set<string>();
    for (const [tool, result] of results) {
      for (const { path, value } of fieldsOf(result)) {
        if (!isAddress(value)) continue;
        seen.add(value);
        const description = schemaAt(schemas.get(tool), path)?.description ?? "";
        const where = `${tool}: ${path.join(".")}`;
        expect(description.endsWith(HINT), where).toBe(true);
        // What it already says of its item comes first.
        expect(description.slice(0, -HINT.length).trim().length, where).toBeGreaterThan(0);
      }
    }
    // The addresses of the folder, a tab, a page, a file, the details page of a file and the deleted items were among
    // them (see "Addresses" in content-structure.md).
    expect([...seen]).toEqual(
      expect.arrayContaining([
        `${PUBLIC_URL}/folders/handbook`,
        `${PUBLIC_URL}/folders/handbook/guides`,
        `${PUBLIC_URL}/folders/handbook/guides/setup.md`,
        `${PUBLIC_URL}/folders/handbook/overview.md`,
        `${PUBLIC_URL}/folders/handbook/guides/diagram.png`,
        `${PUBLIC_URL}/files/handbook/guides/diagram.png`,
        `${PUBLIC_URL}/deleted-items/handbook`,
      ]),
    );
  });

  // mcp-wiki-links-requirements.md, R1: the addresses of tabs, the folder and the deleted items get the hint and no
  // link field, because a page cannot link them.
  it("gives no link field to an item whose only address is that of the folder, a tab or the deleted items", async () => {
    const results = await callEveryTool();

    let checked = 0;
    for (const [tool, result] of results) {
      const holders = new Set<Record<string, unknown>>([result]);
      for (const { holder } of fieldsOf(result)) holders.add(holder);
      for (const holder of holders) {
        const addresses = Object.values(holder).filter(isAddress);
        if (addresses.length === 0) continue;
        if (addresses.some((address) => pagePlace(address) !== null || filePlace(address) !== null)) continue;
        if (addresses.some((address) => address.startsWith(`${PUBLIC_URL}/files/`))) continue;
        checked += 1;
        expect(holder, `${tool}: ${addresses.join(", ")}`).not.toHaveProperty("wikiLink");
        expect(holder, `${tool}: ${addresses.join(", ")}`).not.toHaveProperty("embedLink");
      }
    }
    // The folder and the tab of list_folder, create_tab, rename_tab, delete_page and delete_tab at least.
    expect(checked).toBeGreaterThanOrEqual(6);
  });
});

describe("the wiki link of a page", () => {
  // mcp-wiki-links-requirements.md, R3: every result that returns the address of a page also returns its wiki link,
  // [[name]] or [[tab/name]], without a label, and no embedLink.
  it("is returned next to every address of a page that any tool returns, as [[name]] or [[tab/name]] of that address, without an embed link", async () => {
    const results = await callEveryTool();

    let checked = 0;
    for (const [tool, result] of results) {
      const holders = new Set<Record<string, unknown>>([result]);
      for (const { holder } of fieldsOf(result)) holders.add(holder);
      for (const holder of holders) {
        for (const address of Object.values(holder).filter(isAddress)) {
          const place = pagePlace(address);
          if (place === null) continue;
          checked += 1;
          expect(holder, `${tool}: ${address}`).toHaveProperty("wikiLink", `[[${place}]]`);
          expect(holder, `${tool}: ${address}`).not.toHaveProperty("embedLink");
        }
      }
    }
    // list_folder (3), read_page (2), search_pages (2), create_page, replace_page_content, edit_page_content and
    // move_or_rename_page at least.
    expect(checked).toBeGreaterThanOrEqual(11);
  });

  // mcp-wiki-links-requirements.md, R3: the link names the page as stored, after a move or rename its new tab and name;
  // a rename of its tab is such a change as well.
  it("names the page as stored in every read tool after its tab is renamed and after it is moved out of the tab", async () => {
    const guides = await createTab({ folder: handbook, name: "guides", editor: user });
    await createPage({ tab: guides, name: "setup", content: "# Install The Server", editor: user });

    const linksOfSetup = async () => {
      const listed = (await call("list_folder")).pages as Record<string, unknown>[];
      const searched = (await call("search_pages", { query: "install" })).results as Record<string, unknown>[];
      return [...listed, ...searched].filter((page) => page.name === "setup").map((page) => page.wikiLink);
    };

    await call("rename_tab", { tab: "guides", newName: "manuals" });
    expect(await linksOfSetup()).toEqual(["[[manuals/setup]]", "[[manuals/setup]]"]);
    const read = await call("read_page", { tab: "manuals", page: "setup" });
    expect(read.wikiLink).toBe("[[manuals/setup]]");

    const moved = await call("move_or_rename_page", {
      tab: "manuals",
      page: "setup",
      version: read.version,
      newTab: null,
      newName: "setup",
    });
    expect(moved.wikiLink).toBe("[[setup]]");
    expect(await linksOfSetup()).toEqual(["[[setup]]", "[[setup]]"]);
    expect((await call("read_page", { page: "setup" })).wikiLink).toBe("[[setup]]");
  });

  // mcp-wiki-links-requirements.md, "Scenarios": an AI app creates a page and then links it from an overview page with
  // the wiki link that create_page returned. R3: the field holds the wiki link that a page uses for the page.
  it.each([
    ["in a tab", "guides"],
    ["placed directly in the folder", null],
  ])("returned by create_page for a page %s, links that page from another page", async (_case, tab) => {
    await createTab({ folder: handbook, name: "guides", editor: user });
    await createTab({ folder: handbook, name: "other", editor: user });

    const created = await call("create_page", { tab, name: "server-setup", content: "# How We Set Up Servers" });
    const link = created.wikiLink as string;
    await call("create_page", { tab: "other", name: "overview", content: `# Overview\n\nSee ${link}.` });

    const read = await call("read_page", { tab, page: "server-setup" });
    expect(read.linkedFrom).toEqual([expect.objectContaining({ name: "overview", tab: "other" })]);
  });
});

describe("the links of a file", () => {
  // mcp-wiki-links-requirements.md, R4: every result that returns the address of a file also returns its wiki link,
  // [[name.ext]] or [[tab/name.ext]], without a label.
  it("returns the wiki link next to every address of the details page of a file that any tool returns, as [[name.ext]] or [[tab/name.ext]]", async () => {
    const results = await callEveryTool();

    let checked = 0;
    for (const [tool, result] of results) {
      const holders = new Set<Record<string, unknown>>([result]);
      for (const { holder } of fieldsOf(result)) holders.add(holder);
      for (const holder of holders) {
        for (const address of Object.values(holder).filter(isAddress)) {
          const place = filePlace(address);
          if (place === null) continue;
          checked += 1;
          expect(holder, `${tool}: ${address}`).toHaveProperty("wikiLink", `[[${place}]]`);
        }
      }
    }
    // list_folder (2), read_file (2) and search_pages (2) at least.
    expect(checked).toBeGreaterThanOrEqual(6);
  });

  // mcp-wiki-links-requirements.md, R5: the same results return the embed link of an image, ![[name.ext]] or
  // ![[tab/name.ext]], and null for a PDF, so that every file has the same fields.
  it("returns the embed link of an image and null for a PDF next to every address of the details page of a file that any tool returns", async () => {
    const results = await callEveryTool();

    let images = 0;
    let pdfs = 0;
    for (const [tool, result] of results) {
      const holders = new Set<Record<string, unknown>>([result]);
      for (const { holder } of fieldsOf(result)) holders.add(holder);
      for (const holder of holders) {
        for (const address of Object.values(holder).filter(isAddress)) {
          const place = filePlace(address);
          if (place === null) continue;
          if (place.endsWith(".pdf")) {
            pdfs += 1;
            expect(holder, `${tool}: ${address}`).toHaveProperty("embedLink", null);
          } else {
            images += 1;
            expect(holder, `${tool}: ${address}`).toHaveProperty("embedLink", `![[${place}]]`);
          }
        }
      }
    }
    expect(images).toBeGreaterThanOrEqual(3);
    expect(pdfs).toBeGreaterThanOrEqual(3);
  });

  // mcp-wiki-links-requirements.md, "Scenarios": the AI app finds an image with list_folder and puts its embed link
  // into the content of a new page, and finds a PDF with search_pages. R4, R5: the fields hold the texts that a page
  // uses for the file.
  it("from list_folder and search_pages, put into a page, show or link the file from that page", async () => {
    const diagrams = await createTab({ folder: handbook, name: "diagrams", editor: user });
    await createTab({ folder: handbook, name: "servers", editor: user });
    await createFile({ tab: diagrams, name: "network.png", editor: user });
    await createFile({ folder: handbook, name: "manual.pdf", editor: user });

    const files = (await call("list_folder")).files as Record<string, unknown>[];
    const embed = files.find((file) => file.name === "network.png")?.embedLink as string;
    const searched = (await call("search_pages", { query: "manual" })).files as Record<string, unknown>[];
    const manual = searched.find((file) => file.name === "manual.pdf")?.wikiLink as string;
    await call("create_page", {
      tab: "servers",
      name: "server-setup",
      content: `# Server Setup\n\n${embed}\n\nRead ${manual}.`,
    });

    const shown = await call("read_file", { tab: "diagrams", file: "network.png" });
    expect(shown.shownOrLinkedFrom).toEqual([expect.objectContaining({ name: "server-setup", tab: "servers" })]);
    const linked = await call("read_file", { file: "manual.pdf" });
    expect(linked.shownOrLinkedFrom).toEqual([expect.objectContaining({ name: "server-setup", tab: "servers" })]);
  });
});

describe("the lists without an address", () => {
  // mcp-wiki-links-requirements.md, "Scope": no link fields in linkedFrom of read_page, shownOrLinkedFrom of
  // read_file, updatedPages of move_or_rename_page and rename_tab, and the pages and files of delete_tab.
  it("keep their items without wikiLink and embedLink", async () => {
    const guides = await createTab({ folder: handbook, name: "guides", editor: user });
    await createTab({ folder: handbook, name: "drafts", editor: user });
    await createPage({ tab: guides, name: "setup", content: "# Setup", editor: user });
    await createPage({ folder: handbook, name: "overview", content: "# Overview\n\n[[guides/setup]]", editor: user });
    await createPage({
      tab: guides,
      name: "faq",
      content: "# FAQ\n\n![[guides/diagram.png]] [[overview]]",
      editor: user,
    });
    await createFile({ tab: guides, name: "diagram.png", editor: user });

    const lists: [string, unknown][] = [];
    lists.push(["read_page linkedFrom", (await call("read_page", { tab: "guides", page: "setup" })).linkedFrom]);
    lists.push([
      "read_file shownOrLinkedFrom",
      (await call("read_file", { tab: "guides", file: "diagram.png" })).shownOrLinkedFrom,
    ]);
    const overview = await call("read_page", { page: "overview" });
    lists.push([
      "move_or_rename_page updatedPages",
      (
        await call("move_or_rename_page", {
          page: "overview",
          version: overview.version,
          newTab: null,
          newName: "start",
        })
      ).updatedPages,
    ]);
    lists.push([
      "rename_tab updatedPages",
      (await call("rename_tab", { tab: "guides", newName: "docs" })).updatedPages,
    ]);
    const deleted = await call("delete_tab", { tab: "docs" });
    lists.push(["delete_tab pages", deleted.pages], ["delete_tab files", deleted.files]);

    for (const [where, list] of lists) {
      expect(Array.isArray(list) && list.length > 0, where).toBe(true);
      for (const item of list as Record<string, unknown>[]) {
        expect(item, where).not.toHaveProperty("wikiLink");
        expect(item, where).not.toHaveProperty("embedLink");
      }
    }
  });
});
