import type { APIRequestContext, APIResponse } from "@playwright/test";

import { KNOWN_ADMIN, KNOWN_USER } from "../prisma/known-users";
import { NO_STORAGE_STATE } from "./support/auth";
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

/** Calls a tool and returns its result. */
async function callTool(request: APIRequestContext, name: string, args: Record<string, unknown> = {}) {
  const response = await send(request, { method: "tools/call", params: { name, arguments: args } });
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
  for (const to of [`/mcp/${projects.id}/owner`, `/mcp/${projects.id}/manager`, "/mcp/abc/reader"]) {
    expect((await send(request, { method: "tools/list" }, secret, to)).status(), to).toBe(404);
  }

  const missing = await send(request, { method: "tools/list" }, null, `/mcp/${crypto.randomUUID()}/reader`);
  const existing = await send(request, { method: "tools/list" }, null);
  for (const response of [missing, existing]) {
    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(/^Bearer resource_metadata="[^"]+\/reader"$/);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  }
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
  const guides = await createTab({ folder: projects, name: "guides", updatedAt: new Date("2026-03-02T09:00:00.000Z") });
  await createPage({ tab: guides, name: "install", title: "Install", updatedAt: new Date("2026-03-03T09:00:00.000Z") });
  await createPage({
    folder: projects,
    name: "overview",
    title: "Overview",
    updatedAt: new Date("2026-03-04T09:00:00.000Z"),
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
      { name: "guides", address: `${PUBLIC_URL}/folders/projects/guides`, lastChanged: "2026-03-02T09:00:00.000Z" },
    ],
    pages: [
      {
        name: "overview",
        title: "Overview",
        tab: null,
        address: `${PUBLIC_URL}/folders/projects/overview.md`,
        lastChanged: "2026-03-04T09:00:00.000Z",
      },
      {
        name: "install",
        title: "Install",
        tab: "guides",
        address: `${PUBLIC_URL}/folders/projects/guides/install.md`,
        lastChanged: "2026-03-03T09:00:00.000Z",
      },
    ],
  });
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
