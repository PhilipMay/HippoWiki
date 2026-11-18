// The read tools of MCP and the answers of the protocol: initialize, the tool list of a Reader connection,
// list_folder and read_page.
import { KNOWN_USER } from "../prisma/known-users";
import { NO_STORAGE_STATE } from "./support/auth";
import { createFolder, createGrant, createPage, createTab, createUser, getTestDb } from "./support/database";
import { call, send, setUpProjects } from "./support/mcp";
import { ISSUER } from "./support/oauth";
import { expect, test } from "./support/test";

// An MCP client has no session cookie: it only has the access token of its grant.
test.use({ storageState: NO_STORAGE_STATE });

/**
 * The folder "projects", of which the known user is Owner, the path of its Reader address, and the access token of a
 * grant of the known user there: the address and the bearer token of `send()` and `call()` unless a test gives others.
 */
let projects: Awaited<ReturnType<typeof setUpProjects>>["projects"];
let address: string;
let secret: string;

test.beforeEach(async () => {
  ({ projects, address, secret } = await setUpProjects());
});

test("initialize answers as JSON with the instructions and without a session", async ({ request }) => {
  const response = await send(request, {
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } },
  });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/json");
  expect(response.headers()["mcp-session-id"]).toBeUndefined();
  const { result } = (await response.json()) as {
    result: { protocolVersion: string; serverInfo: { name: string }; instructions: string; capabilities: object };
  };
  expect(result.protocolVersion).toBe("2025-06-18");
  expect(result.serverInfo.name).toBe("hippowiki");
  // A Reader connection to "projects" is told that it reads that folder and cannot change it.
  expect(result.instructions).toContain('the folder "projects" with the role Reader');
  expect(result.instructions).toContain("It reads the folder and cannot change it.");
  expect(result.capabilities).toHaveProperty("tools");
});

test("a request of the current protocol is answered as JSON as well", async ({ request }) => {
  const response = await request.post(address, {
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${secret}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/list",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "1" },
        },
      },
    },
  });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/json");
  const { result } = (await response.json()) as { result: { tools: { name: string }[] } };
  expect(result.tools.map((tool) => tool.name)).toEqual(["list_folder", "read_page"]);
});

test("a Reader connection offers only the two read tools, list_folder and read_page", async ({ request }) => {
  const response = await send(request, { method: "tools/list" });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/json");
  const { result } = (await response.json()) as {
    result: { tools: { name: string; description: string; annotations: { readOnlyHint: boolean } }[] };
  };
  expect(result.tools.map((tool) => tool.name)).toEqual(["list_folder", "read_page"]);
  // Only tools of the content: none for accounts, which are managed only in the browser by an admin.
  for (const tool of result.tools) expect(`${tool.name} ${tool.description}`).not.toMatch(/\b(users?|accounts?)\b/i);
  for (const tool of result.tools) {
    expect(tool.description).not.toBe("");
    expect(tool.annotations.readOnlyHint).toBe(true);
  }
});

test("there is no tool that lists folders", async ({ request }) => {
  await createFolder({ name: "notes" });

  const response = await send(request, { method: "tools/call", params: { name: "list_folders", arguments: {} } });

  expect(await response.text()).not.toContain("notes");
});

test("list_folder lists the tabs and pages of the folder of the connection, pages placed directly in it first, no deleted page and nothing of another folder", async ({
  request,
}) => {
  const bob = await createUser({ name: "bob" });
  const carol = await createUser({ name: "carol" });
  const guides = await createTab({
    folder: projects,
    name: "guides",
    updatedAt: new Date("2026-03-02T09:00:00.000Z"),
    editor: carol,
    via: "mcp",
  });
  await createPage({
    tab: guides,
    name: "install",
    title: "Install",
    updatedAt: new Date("2026-03-03T09:00:00.000Z"),
    editor: bob,
    via: "mcp",
  });
  await createPage({
    folder: projects,
    name: "overview",
    title: "Overview",
    updatedAt: new Date("2026-03-04T09:00:00.000Z"),
    editor: carol,
  });
  await createPage({ folder: projects, name: "removed", title: "Removed", deletedAt: new Date() });
  const notes = await createFolder({ name: "notes" });
  await createTab({ folder: notes, name: "drafts" });
  await createPage({ folder: notes, name: "elsewhere" });

  const result = await call(request, "list_folder");
  // A folder argument is no argument of the tool: the folder is the one of the connection.
  const named = await call(request, "list_folder", { folder: "notes" });

  expect(result.isError).toBeUndefined();
  expect(result.structuredContent).toEqual({
    folder: { name: "projects", address: `${ISSUER}/folders/projects` },
    tabs: [
      {
        name: "guides",
        address: `${ISSUER}/folders/projects/guides`,
        lastChanged: "2026-03-02T09:00:00.000Z",
        lastEditedBy: "carol",
        lastEditedVia: "mcp",
      },
    ],
    pages: [
      {
        name: "overview",
        title: "Overview",
        tab: null,
        address: `${ISSUER}/folders/projects/overview.md`,
        lastChanged: "2026-03-04T09:00:00.000Z",
        lastEditedBy: "carol",
        lastEditedVia: "web",
      },
      {
        name: "install",
        title: "Install",
        tab: "guides",
        address: `${ISSUER}/folders/projects/guides/install.md`,
        lastChanged: "2026-03-03T09:00:00.000Z",
        lastEditedBy: "bob",
        lastEditedVia: "mcp",
      },
    ],
  });
  expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(result.structuredContent);
  expect(JSON.stringify(named)).not.toMatch(/notes|drafts|elsewhere/);
});

test("a grant cannot read a folder on which its user has no role", async ({ request }) => {
  const bob = await createUser({ name: "bob" });
  const hidden = await createFolder({ name: "hidden", roles: [{ user: bob, role: "owner" }] });
  await createPage({ folder: hidden, name: "secret", content: "# Secret\n\nOnly for bob." });
  const { accessToken } = await createGrant({ owner: KNOWN_USER, folder: hidden });

  for (const message of [
    { method: "tools/list" },
    { method: "tools/call", params: { name: "list_folder", arguments: {} } },
    { method: "tools/call", params: { name: "read_page", arguments: { page: "secret" } } },
  ]) {
    const response = await send(request, message, accessToken, `/mcp/${hidden.id}/reader`);

    expect(response.status()).toBe(403);
    expect(await response.text()).not.toContain("Secret");
  }
});

test("read_page reads a page placed directly in the folder and a page in a tab, with its version", async ({
  request,
}) => {
  const editor = await getTestDb().user.findUniqueOrThrow({ where: { id: KNOWN_USER.id } });
  const guides = await createTab({ folder: projects, name: "guides" });
  await createPage({
    folder: projects,
    name: "overview",
    content: "# Overview\n\nWelcome to the **projects**.",
    updatedAt: new Date("2026-03-04T09:00:00.000Z"),
    version: 3,
    editor,
  });
  await createPage({ tab: guides, name: "install", content: "# Install\n\n1. Download\n2. Run" });

  const direct = await call(request, "read_page", { page: "overview" });
  const inTab = await call(request, "read_page", { tab: "guides", page: "install" });

  expect(direct.isError).toBeUndefined();
  expect(direct.structuredContent).toEqual({
    name: "overview",
    title: "Overview",
    folder: "projects",
    tab: null,
    content: "# Overview\n\nWelcome to the **projects**.",
    address: `${ISSUER}/folders/projects/overview.md`,
    lastChanged: "2026-03-04T09:00:00.000Z",
    lastEditedBy: KNOWN_USER.name,
    lastEditedVia: "web",
    version: 3,
  });
  expect(inTab.structuredContent).toMatchObject({
    name: "install",
    title: "Install",
    tab: "guides",
    content: "# Install\n\n1. Download\n2. Run",
    address: `${ISSUER}/folders/projects/guides/install.md`,
    version: 1,
  });
});

test("read_page does not find a deleted page, a page of another tab, a page of another folder or a malformed name", async ({
  request,
}) => {
  const guides = await createTab({ folder: projects, name: "guides" });
  await createPage({ folder: projects, name: "removed", content: "# Removed\n\nSecret text", deletedAt: new Date() });
  await createPage({ tab: guides, name: "install", content: "# Install\n\nSecret text" });
  await createPage({ folder: await createFolder({ name: "notes" }), name: "other", content: "# Other\n\nSecret text" });

  for (const args of [
    { page: "removed" },
    // The page is in the tab, not directly in the folder.
    { page: "install" },
    { tab: "nowhere", page: "install" },
    { folder: "notes", page: "other" },
    { page: "other" },
    { page: "Install.md" },
  ]) {
    const result = await call(request, "read_page", args);

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Secret text");
  }
});
