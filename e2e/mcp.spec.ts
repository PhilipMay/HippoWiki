import type { APIRequestContext, APIResponse } from "@playwright/test";

import { KNOWN_ADMIN, KNOWN_USER } from "../prisma/known-users";
import { NO_STORAGE_STATE, USER_STORAGE_STATE } from "./support/auth";
import {
  createFolder,
  createFolderRole,
  createGrant,
  createPage,
  createTab,
  createUser,
  getTestDb,
  resetTestDatabase,
} from "./support/database";
import { expect, test } from "./support/test";

// An MCP client has no session cookie: it only has the access token of its grant.
test.use({ storageState: NO_STORAGE_STATE });

/** The public URL of the test server (`HIPPOWIKI_PUBLIC_URL` in `playwright.config.ts`): the addresses are full URLs. */
const PUBLIC_URL = "http://localhost:3100";

/**
 * The folder "projects", of which the known user is Owner, the path of its Reader address, and the access token of a
 * grant of the known user there: the address and the bearer token of every request unless a test gives others.
 */
let projects: Awaited<ReturnType<typeof createFolder>>;
let address: string;
let secret: string;

test.beforeEach(async () => {
  await resetTestDatabase();
  const editor = await getTestDb().user.findUniqueOrThrow({ where: { id: KNOWN_USER.id } });
  projects = await createFolder({ name: "projects", editor });
  address = `/mcp/${projects.id}/reader`;
  ({ accessToken: secret } = await createGrant({ owner: KNOWN_USER, folder: projects }));
});

/**
 * Sends a JSON-RPC message to an MCP address, by default the Reader address of "projects", with the given bearer
 * token, as a client of the protocol of 2025 does.
 */
function send(
  request: APIRequestContext,
  message: Record<string, unknown>,
  token: string | null = secret,
  to: string = address,
): Promise<APIResponse> {
  return request.post(to, {
    headers: {
      accept: "application/json, text/event-stream",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    data: { jsonrpc: "2.0", id: 1, ...message },
    maxRedirects: 0,
  });
}

/** The result of a tool call. */
type ToolResult = { content: { type: string; text: string }[]; structuredContent?: unknown; isError?: boolean };

/** Calls a tool, by default at the Reader address of "projects", and returns its result. */
async function callTool(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown> = {},
  token: string = secret,
  to: string = address,
) {
  const response = await send(request, { method: "tools/call", params: { name, arguments: args } }, token, to);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/json");
  return ((await response.json()) as { result: ToolResult }).result;
}

test("without a token /mcp answers 401 with a Bearer challenge and nothing of the wiki", async ({ request }) => {
  await createFolder({ name: "handbook" });

  const response = await send(request, { method: "tools/call", params: { name: "list_folder" } }, null);

  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toMatch(/^Bearer\b/);
  expect(await response.text()).not.toContain("handbook");
});

test("a former API token gets 401 with a Bearer challenge and nothing of the wiki", async ({ request }) => {
  await createFolder({ name: "handbook" });
  // The update deleted every API token; a tool that still sends one sends a value of the former shape.
  const former = `hw_${"A".repeat(43)}`;

  const response = await send(request, { method: "tools/call", params: { name: "list_folder" } }, former);

  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toMatch(/^Bearer\b/);
  expect(response.headers()["www-authenticate"]).toContain("resource_metadata=");
  expect(await response.text()).not.toContain("handbook");
});

for (const [what, token] of [
  ["an access token that the server does not know", `hwa_${"A".repeat(43)}`],
  ["a value that is no token", "not-a-token"],
] as const) {
  test(`with ${what} /mcp answers 401`, async ({ request }) => {
    const response = await send(request, { method: "tools/list" }, token);

    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(/^Bearer\b/);
  });
}

test("with an expired grant, an expired access token and that of a user with the first password a folder address answers 401", async ({
  request,
}) => {
  const folder = projects;
  const expired = await createGrant({ owner: KNOWN_USER, folder, expiresAt: new Date(Date.now() - 1000) });
  const expiredAccess = await createGrant({
    owner: KNOWN_USER,
    folder,
    accessTokenExpiresAt: new Date(Date.now() - 1000),
  });
  const newcomerUser = await createUser({ name: "newcomer" });
  await createFolderRole({ folder, user: newcomerUser, role: "reader" });
  const newcomer = await createGrant({ owner: newcomerUser, folder });

  for (const token of [expired.accessToken, expiredAccess.accessToken, newcomer.accessToken]) {
    const response = await send(request, { method: "tools/list" }, token);

    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(/^Bearer error="invalid_token"/);
  }
});

test("the access token of an admin gets 401 with invalid_token and reaches no tool", async ({ request }) => {
  await createFolder({ name: "handbook" });
  // Admins have no grants; one inserted directly stands for a grant that should not exist.
  const { accessToken: adminToken } = await createGrant({ owner: KNOWN_ADMIN, folder: projects });

  for (const message of [
    { method: "tools/list" },
    { method: "tools/call", params: { name: "list_folder", arguments: {} } },
  ]) {
    const response = await send(request, message, adminToken);

    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(/^Bearer error="invalid_token"/);
    expect(await response.text()).not.toContain("handbook");
  }
  expect((await getTestDb().oAuthGrant.findFirstOrThrow({ where: { userId: KNOWN_ADMIN.id } })).lastUsedAt).toBeNull();
});

test("a bearer token reaches no task of an admin: creating a user leads to the login page and creates nothing", async ({
  request,
}) => {
  for (const response of [
    await request.get("/users?action=create", { headers: { authorization: `Bearer ${secret}` }, maxRedirects: 0 }),
    await request.post("/users?action=create", {
      headers: { authorization: `Bearer ${secret}` },
      form: { name: "jane-doe", type: "admin" },
      maxRedirects: 0,
    }),
    await request.get("/users", { headers: { authorization: `Bearer ${secret}` }, maxRedirects: 0 }),
  ]) {
    // 307 for a read, 303 for a write (`src/proxy.ts`): the bearer token is no login.
    expect([303, 307]).toContain(response.status());
    expect(new URL(response.headers().location ?? "", PUBLIC_URL).pathname).toBe("/login");
  }
  expect(await getTestDb().user.findUnique({ where: { username: "jane-doe" } })).toBeNull();
  expect(await getTestDb().user.count()).toBe(2);
});

for (const method of ["get", "delete"] as const) {
  test(`${method.toUpperCase()} at a folder address answers 405, with and without a token`, async ({ request }) => {
    const headerSets: Record<string, string>[] = [{}, { authorization: `Bearer ${secret}` }];
    for (const headers of headerSets) {
      const response = await request[method](address, { headers, maxRedirects: 0 });

      expect(response.status()).toBe(405);
      expect(response.headers().allow).toBe("POST");
    }
  });
}

test("a request from a page of another site is refused with 403", async ({ request }) => {
  const response = await request.post(address, {
    headers: { authorization: `Bearer ${secret}`, origin: "https://evil.example" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });

  expect(response.status()).toBe(403);
});

test("/mcp answers 404, also with a valid token; a connected app works at its folder address", async ({ request }) => {
  const plain = await send(request, { method: "tools/list" }, secret, "/mcp");

  expect(plain.status()).toBe(404);
  expect((await send(request, { method: "tools/list" })).status()).toBe(200);
});

test("addresses that are no folder addresses answer 404; a folder address without a token answers 401, whether the folder exists or not", async ({
  request,
}) => {
  for (const to of [`/mcp/${projects.id}/owner`, `/mcp/${projects.id}/Manager`, "/mcp/abc/reader"]) {
    expect((await send(request, { method: "tools/list" }, secret, to)).status(), to).toBe(404);
  }

  const missing = await send(request, { method: "tools/list" }, null, `/mcp/${crypto.randomUUID()}/reader`);
  const existing = await send(request, { method: "tools/list" }, null);
  for (const response of [missing, existing]) {
    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(/^Bearer resource_metadata="[^"]+\/reader"$/);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  }
  const manager = await send(request, { method: "tools/list" }, null, `/mcp/${projects.id}/manager`);
  expect(manager.status()).toBe(401);
  expect(manager.headers()["www-authenticate"]).toMatch(/^Bearer resource_metadata="[^"]+\/manager"$/);
});

test("the access token of a connection to /mcp/<A>/reader is refused at /mcp/<A>/writer and at /mcp/<B>/reader", async ({
  request,
}) => {
  const notes = await createFolder({ name: "notes" });

  for (const to of [`/mcp/${projects.id}/writer`, `/mcp/${notes.id}/reader`]) {
    const response = await send(request, { method: "tools/list" }, secret, to);

    expect(response.status(), to).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(/^Bearer error="invalid_token"/);
  }
});

test("connections to /mcp/<A>/writer, /mcp/<A>/reader and /mcp/<B>/writer work side by side", async ({ request }) => {
  const notes = await createFolder({ name: "notes" });
  const { client, accessToken: aWriter } = await createGrant({ owner: KNOWN_USER, folder: projects, role: "writer" });
  const { accessToken: aReader } = await createGrant({ owner: KNOWN_USER, folder: projects, client });
  const { accessToken: bWriter } = await createGrant({ owner: KNOWN_USER, folder: notes, role: "writer", client });

  for (const [to, token] of [
    [`/mcp/${projects.id}/writer`, aWriter],
    [`/mcp/${projects.id}/reader`, aReader],
    [`/mcp/${notes.id}/writer`, bWriter],
  ] as const) {
    expect((await send(request, { method: "tools/list" }, token, to)).status(), to).toBe(200);
  }
});

test("after an Owner lowers a Writer to Reader the Writer connection answers 403 and runs no tool, the Reader connection works, and raising the role again restores it", async ({
  request,
}) => {
  const bob = await createUser({ name: "bob", mustChangePassword: false });
  await createFolderRole({ folder: projects, user: bob, role: "writer" });
  await createPage({ folder: projects, name: "plan", content: "# Plan\n\nSecret text" });
  const writer = await createGrant({ owner: bob, folder: projects, role: "writer" });
  const reader = await createGrant({ owner: bob, folder: projects, role: "reader" });
  const where = { folderId_userId: { folderId: projects.id, userId: bob.id } };
  const call = { method: "tools/call", params: { name: "list_folder", arguments: {} } };

  await getTestDb().folderRole.update({ where, data: { role: "reader" } });

  const refused = await send(request, call, writer.accessToken, `/mcp/${projects.id}/writer`);
  expect(refused.status()).toBe(403);
  expect(refused.headers()["www-authenticate"]).toBeUndefined();
  const body = await refused.text();
  expect(body).not.toContain("insufficient_scope");
  expect(body).not.toContain("projects");
  expect(JSON.parse(body)).toEqual({
    error: "role_too_low",
    error_description: "Your role on the folder does not allow this address.",
  });
  expect((await send(request, call, reader.accessToken, `/mcp/${projects.id}/reader`)).status()).toBe(200);

  await getTestDb().folderRole.update({ where, data: { role: "writer" } });

  expect((await send(request, call, writer.accessToken, `/mcp/${projects.id}/writer`)).status()).toBe(200);
  expect(await getTestDb().oAuthGrant.count({ where: { userId: bob.id } })).toBe(2);
});

test("after a Manager is lowered or loses the role the Manager connection answers 403, and works again once the user is Manager again", async ({
  request,
}) => {
  const bob = await createUser({ name: "bob", mustChangePassword: false });
  await createFolderRole({ folder: projects, user: bob, role: "manager" });
  const manager = await createGrant({ owner: bob, folder: projects, role: "manager" });
  const to = `/mcp/${projects.id}/manager`;
  const where = { folderId_userId: { folderId: projects.id, userId: bob.id } };
  const call = { method: "tools/call", params: { name: "list_folder", arguments: {} } };
  const tooLow = {
    error: "role_too_low",
    error_description: "Your role on the folder does not allow this address.",
  };

  expect((await send(request, call, manager.accessToken, to)).status()).toBe(200);
  for (const role of ["writer", "reader"] as const) {
    await getTestDb().folderRole.update({ where, data: { role } });
    const refused = await send(request, call, manager.accessToken, to);
    expect(refused.status(), role).toBe(403);
    expect(await refused.json()).toEqual(tooLow);
  }
  await getTestDb().folderRole.delete({ where });
  const removed = await send(request, call, manager.accessToken, to);
  expect(removed.status()).toBe(403);
  expect(await removed.json()).toEqual(tooLow);

  await createFolderRole({ folder: projects, user: bob, role: "manager" });

  expect((await send(request, call, manager.accessToken, to)).status()).toBe(200);
  expect(await getTestDb().oAuthGrant.count({ where: { userId: bob.id } })).toBe(1);
});

test("after the folder is renamed the connection lists and reads its pages under the new name", async ({ request }) => {
  await createPage({ folder: projects, name: "plan", content: "# Plan" });
  await getTestDb().folder.update({ where: { id: projects.id }, data: { name: "renamed" } });

  const listed = await callTool(request, "list_folder");
  const read = await callTool(request, "read_page", { page: "plan" });

  expect(listed.structuredContent).toMatchObject({
    folder: { name: "renamed", address: `${PUBLIC_URL}/folders/renamed` },
    pages: [{ name: "plan", address: `${PUBLIC_URL}/folders/renamed/plan.md` }],
  });
  expect(read.structuredContent).toMatchObject({ folder: "renamed", title: "Plan" });
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

  const result = await callTool(request, "list_folder");
  // A folder argument is no argument of the tool: the folder is the one of the connection.
  const named = await callTool(request, "list_folder", { folder: "notes" });

  expect(result.isError).toBeUndefined();
  expect(result.structuredContent).toEqual({
    folder: { name: "projects", address: `${PUBLIC_URL}/folders/projects` },
    tabs: [
      {
        name: "guides",
        address: `${PUBLIC_URL}/folders/projects/guides`,
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
        address: `${PUBLIC_URL}/folders/projects/overview.md`,
        lastChanged: "2026-03-04T09:00:00.000Z",
        lastEditedBy: "carol",
        lastEditedVia: "web",
      },
      {
        name: "install",
        title: "Install",
        tab: "guides",
        address: `${PUBLIC_URL}/folders/projects/guides/install.md`,
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

  const direct = await callTool(request, "read_page", { page: "overview" });
  const inTab = await callTool(request, "read_page", { tab: "guides", page: "install" });

  expect(direct.isError).toBeUndefined();
  expect(direct.structuredContent).toEqual({
    name: "overview",
    title: "Overview",
    folder: "projects",
    tab: null,
    content: "# Overview\n\nWelcome to the **projects**.",
    address: `${PUBLIC_URL}/folders/projects/overview.md`,
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
    address: `${PUBLIC_URL}/folders/projects/guides/install.md`,
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
    const result = await callTool(request, "read_page", args);

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Secret text");
  }
});

test("a tool call marks the grant as used", async ({ request }) => {
  const { grant, accessToken: fresh } = await createGrant({ owner: KNOWN_USER, folder: projects });

  expect((await getTestDb().oAuthGrant.findUniqueOrThrow({ where: { id: grant.id } })).lastUsedAt).toBeNull();
  const response = await send(request, { method: "tools/list" }, fresh);

  expect(response.status()).toBe(200);
  expect((await getTestDb().oAuthGrant.findUniqueOrThrow({ where: { id: grant.id } })).lastUsedAt).not.toBeNull();
});

test("the access token of a revoked grant stops working at once", async ({ request }) => {
  const { grant, accessToken: revoked } = await createGrant({ owner: KNOWN_USER, folder: projects });
  expect((await send(request, { method: "tools/list" }, revoked)).status()).toBe(200);

  await getTestDb().oAuthGrant.delete({ where: { id: grant.id } });

  expect((await send(request, { method: "tools/list" }, revoked)).status()).toBe(401);
});

test.describe("the write tools", () => {
  /** The access token of a Writer connection of the known user to "projects", and its address. */
  let writer: string;
  let writerAddress: string;

  test.beforeEach(async () => {
    ({ accessToken: writer } = await createGrant({ owner: KNOWN_USER, folder: projects, role: "writer" }));
    writerAddress = `/mcp/${projects.id}/writer`;
  });

  /** Calls a tool at the Writer address. */
  function write(request: APIRequestContext, name: string, args: Record<string, unknown>) {
    return callTool(request, name, args, writer, writerAddress);
  }

  /** The last editor and the channel of the pages of "projects" as stored, by name. */
  async function storedEditors() {
    return getTestDb().page.findMany({
      where: { folderId: projects.id },
      orderBy: { name: "asc" },
      select: { name: true, lastEditedById: true, lastEditedVia: true },
    });
  }

  /** The pages of "projects" as stored, by name, with what a write changes. */
  async function storedPages() {
    return getTestDb().page.findMany({
      where: { folderId: projects.id },
      orderBy: { name: "asc" },
      select: { name: true, title: true, content: true, tabId: true, version: true },
    });
  }

  test("are listed for a Writer connection and not for a Reader connection; a call at the Reader address changes nothing", async ({
    request,
  }) => {
    const writeTools = ["create_page", "replace_page_content", "move_or_rename_page"];
    const listed = async (token: string, to: string) =>
      (
        (await (await send(request, { method: "tools/list" }, token, to)).json()) as {
          result: { tools: { name: string }[] };
        }
      ).result.tools.map((tool) => tool.name);

    expect(await listed(writer, writerAddress)).toEqual(["list_folder", "read_page", ...writeTools]);
    expect(await listed(secret, address)).toEqual(["list_folder", "read_page"]);

    const answer = await send(request, {
      method: "tools/call",
      params: { name: "create_page", arguments: { content: "# Sneaky" } },
    });
    expect(JSON.stringify(await answer.json())).toContain("create_page");
    expect(await storedPages()).toEqual([]);
  });

  test("create_page without a name gives the page the suggested name; bad input is a tool error and creates nothing", async ({
    request,
  }) => {
    await createTab({ folder: projects, name: "guides" });

    const created = await write(request, "create_page", { content: "# Release Notes\n\nFirst." });
    const inTab = await write(request, "create_page", { content: "# Setup", tab: "guides", name: "install" });

    expect(created.isError).toBeUndefined();
    expect(created.structuredContent).toEqual({
      name: "release-notes",
      title: "Release Notes",
      tab: null,
      address: `${PUBLIC_URL}/folders/projects/release-notes.md`,
      version: 1,
    });
    expect(inTab.structuredContent).toMatchObject({ name: "install", tab: "guides", version: 1 });
    expect(await storedEditors()).toEqual([
      { name: "install", lastEditedById: KNOWN_USER.id, lastEditedVia: "mcp" },
      { name: "release-notes", lastEditedById: KNOWN_USER.id, lastEditedVia: "mcp" },
    ]);
    const before = await storedPages();

    for (const [args, message] of [
      [{ content: "No title" }, "must start with a title heading"],
      [{ content: "# 日本語" }, "The title suggests no name"],
      [{ content: "# Other", name: "release-notes" }, 'A page named "release-notes" already exists'],
      [{ content: "# Other", name: "Not A Name" }, "The name is not valid"],
      [{ content: "# Other", tab: "nowhere" }, 'There is no tab named "nowhere"'],
    ] as const) {
      const result = await write(request, "create_page", args);

      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.content[0]?.text).toContain(message);
    }
    expect(await storedPages()).toEqual(before);
  });

  test("replace_page_content gives the page the new content and the title of its new heading; content without a title heading changes nothing", async ({
    request,
  }) => {
    await createPage({ folder: projects, name: "plan", content: "# Plan\n\nOld." });
    const { version } = (await callTool(request, "read_page", { page: "plan" })).structuredContent as {
      version: number;
    };

    const replaced = await write(request, "replace_page_content", {
      page: "plan",
      version,
      content: "# Roadmap\n\nNew.",
    });
    const refused = await write(request, "replace_page_content", { page: "plan", version: 2, content: "No title" });

    expect(replaced.structuredContent).toMatchObject({ name: "plan", title: "Roadmap", version: 2 });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain("must start with a title heading");
    expect(await storedPages()).toEqual([
      { name: "plan", title: "Roadmap", content: "# Roadmap\n\nNew.", tabId: null, version: 2 },
    ]);
    expect(await storedEditors()).toEqual([{ name: "plan", lastEditedById: KNOWN_USER.id, lastEditedVia: "mcp" }]);
  });

  test("replace_page_content with lists nested too deep is refused and the page keeps its content and version", async ({
    request,
  }) => {
    await createPage({ folder: projects, name: "plan", content: "# Plan\n\nOld." });
    const before = await storedPages();

    const refused = await write(request, "replace_page_content", {
      page: "plan",
      version: 1,
      content: `# Plan\n\n${"- ".repeat(21)}too deep`,
    });

    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain("Lists and quotes must be nested at most 20 levels deep");
    expect(await storedPages()).toEqual(before);
    expect(before).toMatchObject([{ name: "plan", version: 1 }]);
  });

  test("move_or_rename_page puts the page at its new place; a taken name and a missing tab change nothing", async ({
    request,
  }) => {
    const guides = await createTab({ folder: projects, name: "guides" });
    await createPage({ folder: projects, name: "plan", content: "# Plan" });
    await createPage({ tab: guides, name: "taken", content: "# Taken" });

    const moved = await write(request, "move_or_rename_page", {
      page: "plan",
      version: 1,
      newTab: "guides",
      newName: "roadmap",
    });
    expect(moved.structuredContent).toEqual({
      name: "roadmap",
      title: "Plan",
      tab: "guides",
      address: `${PUBLIC_URL}/folders/projects/guides/roadmap.md`,
      version: 2,
    });
    expect(await storedEditors()).toEqual([
      { name: "roadmap", lastEditedById: KNOWN_USER.id, lastEditedVia: "mcp" },
      { name: "taken", lastEditedById: expect.any(String), lastEditedVia: "web" },
    ]);
    const before = await storedPages();

    for (const [args, message] of [
      [{ newTab: "guides", newName: "taken" }, 'A page named "taken" already exists'],
      [{ newTab: "nowhere", newName: "roadmap" }, 'There is no tab named "nowhere"'],
    ] as const) {
      const result = await write(request, "move_or_rename_page", {
        tab: "guides",
        page: "roadmap",
        version: 2,
        ...args,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(message);
    }
    expect(await storedPages()).toEqual(before);
  });

  test("of two changes based on the same version the first is stored and the second is refused with who changed the page, how and when", async ({
    request,
  }) => {
    await createPage({ folder: projects, name: "plan", content: "# Plan" });
    const { version } = (await callTool(request, "read_page", { page: "plan" })).structuredContent as {
      version: number;
    };

    const first = await write(request, "replace_page_content", { page: "plan", version, content: "# First" });
    const second = await write(request, "replace_page_content", { page: "plan", version, content: "# Second" });
    const none = await write(request, "replace_page_content", { page: "plan", content: "# None" });

    expect(first.isError).toBeUndefined();
    for (const refused of [second, none]) {
      expect(refused.isError).toBe(true);
      expect(refused.content[0]?.text).toMatch(
        new RegExp(
          `^The page was changed by ${KNOWN_USER.name} via mcp at \\d{4}-\\d{2}-\\d{2}T.*Read the page again with read_page`,
        ),
      );
    }
    expect(await storedPages()).toMatchObject([{ content: "# First", version: 2 }]);
  });

  test("read_page tells how the page was last changed: web after the browser, mcp and the user after a write tool", async ({
    request,
  }) => {
    const bob = await createUser({ name: "bob" });
    await createPage({ folder: projects, name: "plan", content: "# Plan", editor: bob });

    await expect(callTool(request, "read_page", { page: "plan" })).resolves.toMatchObject({
      structuredContent: { lastEditedBy: "bob", lastEditedVia: "web", version: 1 },
    });
    await write(request, "replace_page_content", { page: "plan", version: 1, content: "# Plan\n\nBy an agent." });

    const read = await callTool(request, "read_page", { page: "plan" });
    expect(read.structuredContent).toMatchObject({ lastEditedBy: KNOWN_USER.name, lastEditedVia: "mcp", version: 2 });
    expect(JSON.parse(read.content[0]?.text ?? "")).toEqual(read.structuredContent);
  });

  test("a change based on a version older than an edit in the browser is refused with the user, via web and the time", async ({
    request,
  }) => {
    const bob = await createUser({ name: "bob" });
    const plan = await createPage({ folder: projects, name: "plan", content: "# Plan" });
    const { version } = (await callTool(request, "read_page", { page: "plan" })).structuredContent as {
      version: number;
    };
    // bob saves the page in the browser meanwhile.
    const edited = await getTestDb().page.update({
      where: { id: plan.id },
      data: { content: "# Plan\n\nBy bob.", version: { increment: 1 }, lastEditedById: bob.id, lastEditedVia: "web" },
    });

    const refused = await write(request, "replace_page_content", { page: "plan", version, content: "# Mine" });

    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain(
      `The page was changed by bob via web at ${edited.updatedAt.toISOString()}, after the version`,
    );
    expect(await storedPages()).toMatchObject([{ content: "# Plan\n\nBy bob.", version: 2 }]);
  });

  test("after the user is lowered to Reader a write through the Writer connection is refused and the page stays as it was", async ({
    request,
  }) => {
    const bob = await createUser({ name: "bob", mustChangePassword: false });
    await createFolderRole({ folder: projects, user: bob, role: "writer" });
    await createPage({ folder: projects, name: "plan", content: "# Plan" });
    const { accessToken } = await createGrant({ owner: bob, folder: projects, role: "writer" });
    await getTestDb().folderRole.update({
      where: { folderId_userId: { folderId: projects.id, userId: bob.id } },
      data: { role: "reader" },
    });

    const response = await send(
      request,
      {
        method: "tools/call",
        params: { name: "replace_page_content", arguments: { page: "plan", version: 1, content: "# Changed" } },
      },
      accessToken,
      writerAddress,
    );

    expect(response.status()).toBe(403);
    expect(await storedPages()).toMatchObject([{ content: "# Plan", version: 1 }]);
  });

  test.describe("in the browser", () => {
    test.use({ storageState: USER_STORAGE_STATE });

    test("a page changed through MCP names the user and the channel mcp as its last change, and no app", async ({
      page,
      request,
    }) => {
      const bob = await createUser({ name: "bob" });
      await createPage({ folder: projects, name: "plan", content: "# Plan", editor: bob });

      await write(request, "replace_page_content", { page: "plan", version: 1, content: "# Plan\n\nBy an agent." });
      await page.goto("/folders/projects/plan.md");

      await expect(page.getByText(/^Last updated /)).toHaveText(new RegExp(`by ${KNOWN_USER.name} via mcp$`));
      await expect(page.getByRole("main")).not.toContainText(/agent app|connected app/i);
    });
  });
});

test.describe("the tools of a Manager connection", () => {
  /** The access token of a Manager connection of the known user, an Owner, to "projects", and its address. */
  let manager: string;
  let managerAddress: string;

  test.beforeEach(async () => {
    ({ accessToken: manager } = await createGrant({ owner: KNOWN_USER, folder: projects, role: "manager" }));
    managerAddress = `/mcp/${projects.id}/manager`;
  });

  /** Calls a tool at the Manager address. */
  function manage(request: APIRequestContext, name: string, args: Record<string, unknown> = {}) {
    return callTool(request, name, args, manager, managerAddress);
  }

  /** The tabs and pages that `list_folder` of the Manager connection lists. */
  async function listed(request: APIRequestContext) {
    return (await manage(request, "list_folder")).structuredContent as {
      tabs: { name: string; address: string }[];
      pages: { name: string; tab: string | null; address: string }[];
    };
  }

  /** The tabs and pages of "projects" as stored, in a stable order. */
  async function stored() {
    const db = getTestDb();
    return {
      tabs: await db.tab.findMany({ where: { folderId: projects.id }, orderBy: { name: "asc" } }),
      pages: await db.page.findMany({ where: { folderId: projects.id }, orderBy: { name: "asc" } }),
    };
  }

  /** The message of a tool error; fails the test if the call worked. */
  function errorOf(result: ToolResult): string {
    expect(result.isError).toBe(true);
    return result.content[0]?.text ?? "";
  }

  test("delete_page deletes a page and names it, its tab and the full address of the deleted pages", async ({
    request,
  }) => {
    const guides = await createTab({ folder: projects, name: "guides" });
    await createPage({ tab: guides, name: "setup", content: "# Setup" });
    await createPage({ folder: projects, name: "plan", content: "# Plan" });

    const result = await manage(request, "delete_page", { tab: "guides", page: "setup", version: 1 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      name: "setup",
      title: "Setup",
      tab: "guides",
      deletedPagesAddress: `${PUBLIC_URL}/deleted-pages/projects`,
      restore: expect.stringMatching(/restored by a Manager or Owner of the folder in the browser/),
    });
    expect((await listed(request)).pages.map(({ name }) => name)).toEqual(["plan"]);
    expect(errorOf(await manage(request, "read_page", { tab: "guides", page: "setup" }))).toContain(
      'There is no page named "setup"',
    );
    const deleted = await getTestDb().page.findFirstOrThrow({ where: { name: "setup" } });
    expect(deleted).toMatchObject({
      deletedAt: expect.any(Date),
      tabId: null,
      lastEditedById: KNOWN_USER.id,
      lastEditedVia: "mcp",
    });
  });

  test("delete_page based on an older version or on none is refused with who changed the page and when; a deleted page is not found", async ({
    request,
  }) => {
    const bob = await createUser({ name: "bob" });
    await createPage({ folder: projects, name: "plan", content: "# Plan", editor: bob, version: 3 });
    const before = await stored();

    for (const args of [{ page: "plan", version: 2 }, { page: "plan" }]) {
      const message = errorOf(await manage(request, "delete_page", args));
      expect(message).toMatch(/^The page was changed by bob via web at \d{4}-/);
      expect(message).toContain("read_page");
    }
    expect(await stored()).toEqual(before);

    await expect(manage(request, "delete_page", { page: "plan", version: 3 })).resolves.toMatchObject({
      structuredContent: { name: "plan" },
    });
    expect(errorOf(await manage(request, "delete_page", { page: "plan", version: 4 }))).toContain(
      'There is no page named "plan" directly in the folder "projects"',
    );
  });

  test("create_tab creates a tab into which create_page and move_or_rename_page put pages at once; a bad or taken name creates nothing", async ({
    request,
  }) => {
    await createPage({ folder: projects, name: "plan", content: "# Plan" });

    const result = await manage(request, "create_tab", { name: "meetings" });

    expect(result.structuredContent).toEqual({
      name: "meetings",
      address: `${PUBLIC_URL}/folders/projects/meetings`,
    });
    expect((await listed(request)).tabs.map(({ name }) => name)).toEqual(["meetings"]);
    await expect(getTestDb().tab.findFirstOrThrow({ where: { name: "meetings" } })).resolves.toMatchObject({
      lastEditedById: KNOWN_USER.id,
      lastEditedVia: "mcp",
    });
    await expect(manage(request, "create_page", { tab: "meetings", content: "# Kick-off" })).resolves.toMatchObject({
      structuredContent: { name: "kick-off", tab: "meetings" },
    });
    await expect(
      manage(request, "move_or_rename_page", { page: "plan", version: 1, newTab: "meetings", newName: "plan" }),
    ).resolves.toMatchObject({ structuredContent: { name: "plan", tab: "meetings" } });

    const before = await stored();
    expect(errorOf(await manage(request, "create_tab", { name: "Bad Name" }))).toContain("The name is not valid");
    expect(errorOf(await manage(request, "create_tab", { name: "meetings" }))).toContain(
      'A tab named "meetings" already exists in the folder "projects"',
    );
    expect(await stored()).toEqual(before);
  });

  test("rename_tab gives the tab and its pages new addresses; an unknown tab, a bad name and a taken name change nothing", async ({
    request,
  }) => {
    const misc = await createTab({ folder: projects, name: "misc" });
    await createTab({ folder: projects, name: "guides" });
    await createPage({ tab: misc, name: "notes", content: "# Notes" });

    const result = await manage(request, "rename_tab", { tab: "misc", newName: "archive" });

    expect(result.structuredContent).toEqual({
      name: "archive",
      address: `${PUBLIC_URL}/folders/projects/archive`,
    });
    const { tabs, pages } = await listed(request);
    expect(tabs.map(({ name }) => name)).toEqual(["archive", "guides"]);
    await expect(getTestDb().tab.findUniqueOrThrow({ where: { id: misc.id } })).resolves.toMatchObject({
      lastEditedById: KNOWN_USER.id,
      lastEditedVia: "mcp",
    });
    expect(pages).toMatchObject([
      { name: "notes", tab: "archive", address: `${PUBLIC_URL}/folders/projects/archive/notes.md` },
    ]);

    const before = await stored();
    expect(errorOf(await manage(request, "rename_tab", { tab: "misc", newName: "old" }))).toContain(
      'There is no tab named "misc" in the folder "projects"',
    );
    expect(errorOf(await manage(request, "rename_tab", { tab: "archive", newName: "Old Stuff" }))).toContain(
      "The name is not valid",
    );
    expect(errorOf(await manage(request, "rename_tab", { tab: "archive", newName: "guides" }))).toContain(
      'A tab named "guides" already exists in the folder "projects"',
    );
    expect(await stored()).toEqual(before);
  });

  test("delete_tab deletes a tab with its five pages at once, lists each of them, and frees the name of the tab", async ({
    request,
  }) => {
    const drafts = await createTab({ folder: projects, name: "drafts" });
    for (const i of [1, 2, 3, 4, 5]) {
      await createPage({ tab: drafts, name: `draft-${i}`, content: `# Draft ${i}` });
    }
    await createPage({ folder: projects, name: "plan", content: "# Plan" });

    const result = await manage(request, "delete_tab", { tab: "drafts" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      name: "drafts",
      pageCount: 5,
      pages: [1, 2, 3, 4, 5].map((i) => ({ name: `draft-${i}`, title: `Draft ${i}` })),
      deletedPagesAddress: `${PUBLIC_URL}/deleted-pages/projects`,
      restore: expect.stringMatching(/restored one by one by a Manager or Owner of the folder in the browser/),
    });
    const { tabs, pages } = await listed(request);
    expect(tabs).toEqual([]);
    expect(pages.map(({ name }) => name)).toEqual(["plan"]);
    const deleted = await getTestDb().page.findMany({ where: { name: { startsWith: "draft-" } } });
    expect(deleted).toHaveLength(5);
    for (const page of deleted) {
      expect(page).toMatchObject({
        deletedAt: expect.any(Date),
        tabId: null,
        lastEditedById: KNOWN_USER.id,
        lastEditedVia: "mcp",
      });
    }
    await expect(manage(request, "create_tab", { name: "drafts" })).resolves.toMatchObject({
      structuredContent: { name: "drafts" },
    });
  });

  test("delete_tab deletes an empty tab with 0 pages; a tab that does not exist is a tool error that changes nothing", async ({
    request,
  }) => {
    await createTab({ folder: projects, name: "empty" });
    await createTab({ folder: projects, name: "guides" });

    await expect(manage(request, "delete_tab", { tab: "empty" })).resolves.toMatchObject({
      structuredContent: { name: "empty", pageCount: 0, pages: [] },
    });

    const before = await stored();
    for (const tab of ["empty", "missing"]) {
      expect(errorOf(await manage(request, "delete_tab", { tab }))).toContain(
        `There is no tab named "${tab}" in the folder "projects", so nothing was changed.`,
      );
    }
    expect(await stored()).toEqual(before);
  });

  test("the tool list of a Manager connection has nine tools, the destructive hint on the deletes and none for deleted pages, roles or the folder", async ({
    request,
  }) => {
    const answer = await send(request, { method: "tools/list" }, manager, managerAddress);
    const tools = (
      (await answer.json()) as {
        result: { tools: { name: string; annotations: Record<string, boolean> }[] };
      }
    ).result.tools;

    expect(tools.map(({ name }) => name)).toEqual([
      "list_folder",
      "read_page",
      "create_page",
      "replace_page_content",
      "move_or_rename_page",
      "delete_page",
      "create_tab",
      "rename_tab",
      "delete_tab",
    ]);
    const hints = Object.fromEntries(tools.map(({ name, annotations }) => [name, annotations]));
    for (const name of ["delete_page", "create_tab", "rename_tab", "delete_tab"]) {
      expect(hints[name]?.readOnlyHint, name).toBe(false);
    }
    expect(hints.delete_page?.destructiveHint).toBe(true);
    expect(hints.delete_tab?.destructiveHint).toBe(true);
    expect(hints.create_tab?.destructiveHint).toBe(false);
    expect(hints.rename_tab?.destructiveHint).toBe(false);
    expect(tools.map(({ name }) => name).join(" ")).not.toMatch(/restore|deleted|role|owner|folder_/);
  });

  test("initialize at the Manager address gives the instructions of a Manager connection", async ({ request }) => {
    const response = await send(
      request,
      {
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } },
      },
      manager,
      managerAddress,
    );

    const { instructions } = ((await response.json()) as { result: { instructions: string } }).result;
    expect(instructions).toContain('the folder "projects" with the role Manager');
    expect(instructions).toContain("creates, renames and deletes tabs");
    expect(instructions).toContain("Deleting a tab deletes all its pages with it.");
    expect(instructions).toContain("Deleted pages can be neither seen nor restored through this connection");
  });

  test("a call of delete_page, create_tab, rename_tab or delete_tab through a Writer or a Reader connection changes nothing", async ({
    request,
  }) => {
    const { accessToken: writer } = await createGrant({ owner: KNOWN_USER, folder: projects, role: "writer" });
    await createTab({ folder: projects, name: "guides" });
    await createPage({ folder: projects, name: "plan", content: "# Plan" });
    const before = await stored();

    for (const [token, to] of [
      [writer, `/mcp/${projects.id}/writer`],
      [secret, address],
    ] as const) {
      for (const [name, args] of [
        ["delete_page", { page: "plan", version: 1 }],
        ["create_tab", { name: "news" }],
        ["rename_tab", { tab: "guides", newName: "news" }],
        ["delete_tab", { tab: "guides" }],
      ] as const) {
        const answer = await send(request, { method: "tools/call", params: { name, arguments: args } }, token, to);
        expect(JSON.stringify(await answer.json()), `${name} at ${to}`).toContain(name);
      }
    }
    expect(await stored()).toEqual(before);
  });

  test.describe("in the browser", () => {
    test.use({ storageState: USER_STORAGE_STATE });

    test("a page deleted through MCP is listed under Deleted pages with the user who deleted it, via mcp", async ({
      page,
      request,
    }) => {
      const bob = await createUser({ name: "bob" });
      await createPage({ folder: projects, name: "plan", content: "# Plan", editor: bob });

      await manage(request, "delete_page", { page: "plan", version: 1 });
      await page.goto("/deleted-pages/projects");

      const rows = page
        .getByRole("table", { name: "Deleted pages" })
        .getByRole("row")
        .filter({ has: page.getByRole("cell") });
      await expect(rows).toHaveCount(1);
      await expect(rows.nth(0)).toContainText("plan");
      await expect(rows.nth(0).getByRole("cell").nth(3)).toHaveText(KNOWN_USER.name);
      await expect(rows.nth(0).getByRole("cell").nth(4)).toHaveText("mcp");
    });

    test("the pages of a tab deleted through MCP are listed under Deleted pages with the user who deleted them, via mcp", async ({
      page,
      request,
    }) => {
      const bob = await createUser({ name: "bob" });
      const drafts = await createTab({ folder: projects, name: "drafts", editor: bob });
      for (const i of [1, 2, 3, 4, 5]) {
        await createPage({ tab: drafts, name: `draft-${i}`, content: `# Draft ${i}`, editor: bob });
      }

      await manage(request, "delete_tab", { tab: "drafts" });
      await page.goto("/deleted-pages/projects");

      const rows = page
        .getByRole("table", { name: "Deleted pages" })
        .getByRole("row")
        .filter({ has: page.getByRole("cell") });
      await expect(rows).toHaveCount(5);
      for (const i of [0, 1, 2, 3, 4]) {
        await expect(rows.nth(i).getByRole("cell").nth(3)).toHaveText(KNOWN_USER.name);
        await expect(rows.nth(i).getByRole("cell").nth(4)).toHaveText("mcp");
      }
    });

    test("a tab deleted in the browser meanwhile is a tool error of delete_tab that changes nothing", async ({
      page,
      request,
    }) => {
      const guides = await createTab({ folder: projects, name: "guides" });
      await createPage({ tab: guides, name: "intro", content: "# Intro" });
      await expect(manage(request, "list_folder")).resolves.toMatchObject({
        structuredContent: { tabs: [{ name: "guides" }] },
      });

      await page.goto("/folders/projects/guides?action=delete");
      await page.getByRole("dialog", { name: "Delete tab" }).getByRole("button", { name: "Delete" }).click();
      await expect(page).toHaveURL("/folders/projects");
      const before = await stored();

      expect(errorOf(await manage(request, "delete_tab", { tab: "guides" }))).toContain(
        'There is no tab named "guides" in the folder "projects"',
      );
      expect(await stored()).toEqual(before);
    });

    test("a tab created and a tab renamed through MCP show the user as their last editor", async ({
      page,
      request,
    }) => {
      const bob = await createUser({ name: "bob" });
      await createTab({ folder: projects, name: "misc", editor: bob });
      await createTab({ folder: projects, name: "other", editor: bob });
      const items = page.getByRole("list", { name: "Contents" }).getByRole("listitem");

      await manage(request, "create_tab", { name: "meetings" });
      await manage(request, "rename_tab", { tab: "misc", newName: "archive" });
      await page.goto("/folders/projects");

      await expect(items).toHaveText([
        new RegExp(`^archive.*by ${KNOWN_USER.name} via mcp$`),
        new RegExp(`^meetings.*by ${KNOWN_USER.name} via mcp$`),
        /^other.*by bob via web$/,
      ]);
    });
  });
});
