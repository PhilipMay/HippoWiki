import type { APIRequestContext, APIResponse } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { NO_STORAGE_STATE } from "./support/auth";
import {
  createApiToken,
  createFolder,
  createPage,
  createTab,
  createUser,
  getTestDb,
  resetTestDatabase,
} from "./support/database";
import { expect, test } from "./support/test";

// An MCP client has no session cookie: it only has its token.
test.use({ storageState: NO_STORAGE_STATE });

/** The public URL of the test server (`HIPPOWIKI_PUBLIC_URL` in `playwright.config.ts`): the addresses are full URLs. */
const PUBLIC_URL = "http://localhost:3100";

let secret: string;

test.beforeEach(async () => {
  await resetTestDatabase();
  ({ secret } = await createApiToken({ owner: KNOWN_USER }));
});

/** Sends a JSON-RPC message to `/mcp` with the given bearer token, as a client of the protocol of 2025 does. */
function send(
  request: APIRequestContext,
  message: Record<string, unknown>,
  token: string | null = secret,
): Promise<APIResponse> {
  return request.post("/mcp", {
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

  const response = await send(request, { method: "tools/call", params: { name: "list_folders" } }, null);

  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toMatch(/^Bearer\b/);
  expect(await response.text()).not.toContain("handbook");
});

for (const [what, token] of [
  ["a token that the server does not know", `hw_${"A".repeat(43)}`],
  ["a value that is no token", "not-a-token"],
] as const) {
  test(`with ${what} /mcp answers 401`, async ({ request }) => {
    const response = await send(request, { method: "tools/list" }, token);

    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(/^Bearer\b/);
  });
}

test("with an expired token and with the token of a user with the first password /mcp answers 401", async ({
  request,
}) => {
  const expired = await createApiToken({ owner: KNOWN_USER, expiresAt: new Date(Date.now() - 1000) });
  const newcomer = await createApiToken({ owner: await createUser({ name: "newcomer" }) });

  for (const token of [expired.secret, newcomer.secret]) {
    const response = await send(request, { method: "tools/list" }, token);

    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(/^Bearer error="invalid_token"/);
  }
});

test("with a token without the scope read /mcp answers 403 and names the scope", async ({ request }) => {
  const writeOnly = await createApiToken({ owner: KNOWN_USER, scopes: ["write"] });

  const response = await send(request, { method: "tools/list" }, writeOnly.secret);

  expect(response.status()).toBe(403);
  expect(response.headers()["www-authenticate"]).toContain('error="insufficient_scope"');
  expect(response.headers()["www-authenticate"]).toContain('scope="read"');
});

for (const method of ["get", "delete"] as const) {
  test(`${method.toUpperCase()} /mcp answers 405, with and without a token`, async ({ request }) => {
    const headerSets: Record<string, string>[] = [{}, { authorization: `Bearer ${secret}` }];
    for (const headers of headerSets) {
      const response = await request[method]("/mcp", { headers, maxRedirects: 0 });

      expect(response.status()).toBe(405);
      expect(response.headers().allow).toBe("POST");
    }
  });
}

test("a request from a page of another site is refused with 403", async ({ request }) => {
  const response = await request.post("/mcp", {
    headers: { authorization: `Bearer ${secret}`, origin: "https://evil.example" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });

  expect(response.status()).toBe(403);
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
  expect(result.instructions).toContain("folders");
  expect(result.capabilities).toHaveProperty("tools");
});

test("a request of the current protocol is answered as JSON as well", async ({ request }) => {
  const response = await request.post("/mcp", {
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
  expect(result.tools.map((tool) => tool.name)).toEqual(["list_folders", "list_folder", "read_page"]);
});

test("tools/list offers the three read tools", async ({ request }) => {
  const response = await send(request, { method: "tools/list" });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/json");
  const { result } = (await response.json()) as {
    result: { tools: { name: string; description: string; annotations: { readOnlyHint: boolean } }[] };
  };
  expect(result.tools.map((tool) => tool.name)).toEqual(["list_folders", "list_folder", "read_page"]);
  for (const tool of result.tools) {
    expect(tool.description).not.toBe("");
    expect(tool.annotations.readOnlyHint).toBe(true);
  }
});

test("list_folders lists the folders by name with their addresses and last changes", async ({ request }) => {
  await createFolder({ name: "notes", updatedAt: new Date("2026-02-01T10:00:00.000Z") });
  await createFolder({ name: "handbook", updatedAt: new Date("2026-03-01T12:00:00.000Z") });

  const result = await callTool(request, "list_folders");

  expect(result.isError).toBeUndefined();
  expect(result.structuredContent).toEqual({
    folders: [
      { name: "handbook", address: `${PUBLIC_URL}/folders/handbook`, lastChanged: "2026-03-01T12:00:00.000Z" },
      { name: "notes", address: `${PUBLIC_URL}/folders/notes`, lastChanged: "2026-02-01T10:00:00.000Z" },
    ],
  });
  expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(result.structuredContent);
});

test("list_folder lists the tabs and the pages of a folder, pages placed directly in it first, and no deleted page", async ({
  request,
}) => {
  const handbook = await createFolder({ name: "handbook" });
  const guides = await createTab({ folder: handbook, name: "guides", updatedAt: new Date("2026-03-02T09:00:00.000Z") });
  await createPage({ tab: guides, name: "install", title: "Install", updatedAt: new Date("2026-03-03T09:00:00.000Z") });
  await createPage({
    folder: handbook,
    name: "overview",
    title: "Overview",
    updatedAt: new Date("2026-03-04T09:00:00.000Z"),
  });
  await createPage({ folder: handbook, name: "removed", title: "Removed", deletedAt: new Date() });
  await createPage({ folder: await createFolder({ name: "notes" }), name: "elsewhere" });

  const result = await callTool(request, "list_folder", { folder: "handbook" });

  expect(result.isError).toBeUndefined();
  expect(result.structuredContent).toEqual({
    folder: { name: "handbook", address: `${PUBLIC_URL}/folders/handbook` },
    tabs: [
      { name: "guides", address: `${PUBLIC_URL}/folders/handbook/guides`, lastChanged: "2026-03-02T09:00:00.000Z" },
    ],
    pages: [
      {
        name: "overview",
        title: "Overview",
        tab: null,
        address: `${PUBLIC_URL}/folders/handbook/overview.md`,
        lastChanged: "2026-03-04T09:00:00.000Z",
      },
      {
        name: "install",
        title: "Install",
        tab: "guides",
        address: `${PUBLIC_URL}/folders/handbook/guides/install.md`,
        lastChanged: "2026-03-03T09:00:00.000Z",
      },
    ],
  });
});

test("list_folder reports a folder that does not exist as a tool error, not as a protocol error", async ({
  request,
}) => {
  const result = await callTool(request, "list_folder", { folder: "nowhere" });

  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain('There is no folder named "nowhere"');
});

test("read_page reads a page placed directly in a folder and a page in a tab", async ({ request }) => {
  const editor = await getTestDb().user.findUniqueOrThrow({ where: { id: KNOWN_USER.id } });
  const handbook = await createFolder({ name: "handbook" });
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({
    folder: handbook,
    name: "overview",
    content: "# Overview\n\nWelcome to the **handbook**.",
    updatedAt: new Date("2026-03-04T09:00:00.000Z"),
    editor,
  });
  await createPage({ tab: guides, name: "install", content: "# Install\n\n1. Download\n2. Run" });

  const direct = await callTool(request, "read_page", { folder: "handbook", page: "overview" });
  const inTab = await callTool(request, "read_page", { folder: "handbook", tab: "guides", page: "install" });

  expect(direct.isError).toBeUndefined();
  expect(direct.structuredContent).toEqual({
    name: "overview",
    title: "Overview",
    folder: "handbook",
    tab: null,
    content: "# Overview\n\nWelcome to the **handbook**.",
    address: `${PUBLIC_URL}/folders/handbook/overview.md`,
    lastChanged: "2026-03-04T09:00:00.000Z",
    lastEditedBy: KNOWN_USER.name,
  });
  expect(inTab.structuredContent).toMatchObject({
    name: "install",
    title: "Install",
    tab: "guides",
    content: "# Install\n\n1. Download\n2. Run",
    address: `${PUBLIC_URL}/folders/handbook/guides/install.md`,
  });
});

test("read_page does not find a deleted page, a page of another tab or a malformed name", async ({ request }) => {
  const handbook = await createFolder({ name: "handbook" });
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ folder: handbook, name: "removed", content: "# Removed\n\nSecret text", deletedAt: new Date() });
  await createPage({ tab: guides, name: "install", content: "# Install\n\nSecret text" });

  for (const args of [
    { folder: "handbook", page: "removed" },
    // The page is in the tab, not directly in the folder.
    { folder: "handbook", page: "install" },
    { folder: "handbook", tab: "nowhere", page: "install" },
    { folder: "nowhere", page: "install" },
    { folder: "handbook", page: "Install.md" },
  ]) {
    const result = await callTool(request, "read_page", args);

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Secret text");
  }
});

test("a tool call marks the token as used", async ({ request }) => {
  const { token, secret: fresh } = await createApiToken({ owner: KNOWN_USER });

  expect((await getTestDb().apiToken.findUniqueOrThrow({ where: { id: token.id } })).lastUsedAt).toBeNull();
  const response = await send(request, { method: "tools/list" }, fresh);

  expect(response.status()).toBe(200);
  expect((await getTestDb().apiToken.findUniqueOrThrow({ where: { id: token.id } })).lastUsedAt).not.toBeNull();
});

test("a revoked token stops working at once", async ({ request }) => {
  const { token, secret: revoked } = await createApiToken({ owner: KNOWN_USER });
  expect((await send(request, { method: "tools/list" }, revoked)).status()).toBe(200);

  await getTestDb().apiToken.delete({ where: { id: token.id } });

  expect((await send(request, { method: "tools/list" }, revoked)).status()).toBe(401);
});
