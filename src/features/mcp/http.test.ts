import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleMcpRequest } from "@/features/mcp/http";

const mocks = vi.hoisted(() => ({
  authenticateToken: vi.fn(),
  getServerEnv: vi.fn(),
  listFolders: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/features/tokens/service", () => ({ authenticateToken: mocks.authenticateToken }));
vi.mock("@/features/folders/service", () => ({ listFolders: mocks.listFolders }));
vi.mock("@/features/pages/service", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

const ACTOR = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice" };
const TOKEN = `hw_${"A".repeat(43)}`;
const URL_OF_MCP = "http://localhost:3000/mcp";

/** Sets the public URL that the adapter reads from the server environment. */
function setPublicUrl(publicUrl: string | undefined): void {
  mocks.getServerEnv.mockReturnValue({ HIPPOWIKI_PUBLIC_URL: publicUrl });
}

/** A `POST` to `/mcp` with a JSON-RPC message, as an MCP client sends it. */
function post(message: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_OF_MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${TOKEN}`,
      host: "localhost:3000",
      ...headers,
    },
    body: typeof message === "string" ? message : JSON.stringify(message),
  });
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
};
const TOOLS_LIST = { jsonrpc: "2.0", id: 2, method: "tools/list" };

/** The `_meta` envelope and the headers of a request of the current protocol. */
const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
};
function modernHeaders(method: string, name?: string): Record<string, string> {
  return { "mcp-protocol-version": "2026-07-28", "mcp-method": method, ...(name ? { "mcp-name": name } : {}) };
}

beforeEach(() => {
  vi.resetAllMocks();
  setPublicUrl(undefined);
  mocks.authenticateToken.mockResolvedValue({ ok: true, value: ACTOR });
});

describe("the method", () => {
  it.each(["GET", "DELETE", "PUT", "HEAD"])("answers %s with 405 and does not look at the token", async (method) => {
    const response = await handleMcpRequest(
      new Request(URL_OF_MCP, { method, headers: { authorization: `Bearer ${TOKEN}`, accept: "text/event-stream" } }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(mocks.authenticateToken).not.toHaveBeenCalled();
  });
});

describe("the origin", () => {
  it("lets a request without an Origin header pass, as MCP clients send it", async () => {
    const response = await handleMcpRequest(post(TOOLS_LIST));

    expect(response.status).toBe(200);
  });

  it.each([
    ["the host the request was sent to", "http://localhost:3000"],
    ["the same host with another scheme", "https://localhost:3000"],
  ])("without a public URL, lets a request from %s pass", async (_case, origin) => {
    const response = await handleMcpRequest(post(TOOLS_LIST, { origin }));

    expect(response.status).toBe(200);
  });

  it.each([
    ["another site", "https://evil.example"],
    ["another port of the same host", "http://localhost:6274"],
    ["an opaque origin", "null"],
    ["something that is not an origin", "not an origin"],
  ])("without a public URL, refuses a request from %s with 403 before the token is checked", async (_case, origin) => {
    const response = await handleMcpRequest(post(TOOLS_LIST, { origin }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden_origin" });
    expect(mocks.authenticateToken).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledOnce();
  });

  it("with a public URL, lets only a request from exactly that origin pass", async () => {
    setPublicUrl("https://wiki.example.com");

    expect((await handleMcpRequest(post(TOOLS_LIST, { origin: "https://wiki.example.com" }))).status).toBe(200);
    for (const origin of [
      "http://wiki.example.com",
      "https://wiki.example.com:8443",
      "https://evil.example",
      // The host the request was sent to is not enough: a page with a rebound host name would send it as well.
      "http://localhost:3000",
      "null",
    ]) {
      expect((await handleMcpRequest(post(TOOLS_LIST, { origin }))).status).toBe(403);
    }
  });
});

describe("the token", () => {
  it("checks the headers of the request for a token with the scope read", async () => {
    const request = post(TOOLS_LIST);

    await handleMcpRequest(request);

    expect(mocks.authenticateToken).toHaveBeenCalledExactlyOnceWith(request.headers, "read");
  });

  it.each([
    ["missing-token", 401, "Bearer", "unauthorized"],
    ["invalid-token", 401, 'Bearer error="invalid_token"', "invalid_token"],
    ["insufficient-scope", 403, 'Bearer error="insufficient_scope", scope="read"', "insufficient_scope"],
  ])(
    "answers %s with %i and WWW-Authenticate: %s, without reaching the tools",
    async (code, status, challenge, error) => {
      mocks.authenticateToken.mockResolvedValue({ ok: false, error: { code } });

      const response = await handleMcpRequest(
        post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_folders" } }),
      );

      expect(response.status).toBe(status);
      expect(response.headers.get("www-authenticate")).toBe(challenge);
      await expect(response.json()).resolves.toEqual({ error });
      expect(mocks.listFolders).not.toHaveBeenCalled();
    },
  );

  it("answers a token that could not be checked with 500 and no challenge", async () => {
    mocks.authenticateToken.mockResolvedValue({ ok: false, error: { code: "failed" } });

    const response = await handleMcpRequest(post(TOOLS_LIST));

    expect(response.status).toBe(500);
    expect(response.headers.get("www-authenticate")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "server_error" });
  });

  it("never logs or returns the token", async () => {
    mocks.authenticateToken.mockResolvedValue({ ok: false, error: { code: "invalid-token" } });

    const response = await handleMcpRequest(post(TOOLS_LIST));

    const logged = JSON.stringify([mocks.info.mock.calls, mocks.warn.mock.calls, mocks.error.mock.calls]);
    expect(logged).not.toContain(TOKEN);
    expect(await response.text()).not.toContain(TOKEN);
  });
});

describe("a client of the protocol of 2025", () => {
  it("gets the answer to initialize as JSON, without a session", async () => {
    const response = await handleMcpRequest(post(INITIALIZE));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("mcp-session-id")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      id: 1,
      result: { protocolVersion: "2025-06-18", serverInfo: { name: "hippowiki" }, instructions: expect.any(String) },
    });
  });

  it("gets the tools and the result of a tool as JSON", async () => {
    mocks.listFolders.mockResolvedValue([
      {
        id: "id-1",
        name: "handbook",
        updatedAt: new Date("2026-03-01T12:00:00.000Z"),
        lastEditedBy: { name: "alice" },
      },
    ]);

    const list = await handleMcpRequest(post(TOOLS_LIST, { "mcp-protocol-version": "2025-06-18" }));
    const call = await handleMcpRequest(
      post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_folders", arguments: {} } }),
    );

    expect(list.headers.get("content-type")).toBe("application/json");
    const tools = ((await list.json()) as { result: { tools: { name: string }[] } }).result.tools;
    expect(tools.map((tool) => tool.name)).toEqual(["list_folders", "list_folder", "read_page"]);
    expect(call.headers.get("content-type")).toBe("application/json");
    await expect(call.json()).resolves.toMatchObject({
      id: 3,
      result: { structuredContent: { folders: [{ name: "handbook", address: "/folders/handbook" }] } },
    });
  });

  it("gets full addresses with a public URL", async () => {
    setPublicUrl("https://wiki.example.com");
    mocks.listFolders.mockResolvedValue([
      {
        id: "id-1",
        name: "handbook",
        updatedAt: new Date("2026-03-01T12:00:00.000Z"),
        lastEditedBy: { name: "alice" },
      },
    ]);

    const call = await handleMcpRequest(
      post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_folders", arguments: {} } }),
    );

    await expect(call.json()).resolves.toMatchObject({
      result: { structuredContent: { folders: [{ address: "https://wiki.example.com/folders/handbook" }] } },
    });
  });

  it("gets 202 without a body for a notification", async () => {
    const response = await handleMcpRequest(post({ jsonrpc: "2.0", method: "notifications/initialized" }));

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });
});

describe("a client of the current protocol", () => {
  it("gets the tools and the result of a tool as JSON", async () => {
    mocks.listFolders.mockResolvedValue([]);

    const list = await handleMcpRequest(
      post({ ...TOOLS_LIST, params: { _meta: MODERN_META } }, modernHeaders("tools/list")),
    );
    const call = await handleMcpRequest(
      post(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "list_folders", arguments: {}, _meta: MODERN_META },
        },
        modernHeaders("tools/call", "list_folders"),
      ),
    );

    expect(list.status).toBe(200);
    expect(list.headers.get("content-type")).toBe("application/json");
    const tools = ((await list.json()) as { result: { tools: { name: string }[] } }).result.tools;
    expect(tools.map((tool) => tool.name)).toEqual(["list_folders", "list_folder", "read_page"]);
    expect(call.status).toBe(200);
    expect(call.headers.get("content-type")).toBe("application/json");
    await expect(call.json()).resolves.toMatchObject({ id: 3, result: { structuredContent: { folders: [] } } });
  });

  it("is refused a subscription with a JSON answer instead of a stream", async () => {
    const response = await handleMcpRequest(
      post(
        { jsonrpc: "2.0", id: 4, method: "subscriptions/listen", params: { _meta: MODERN_META, notifications: {} } },
        modernHeaders("subscriptions/listen"),
      ),
    );

    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toMatchObject({ id: 4, error: { message: expect.any(String) } });
  });
});

describe("a body that is not a message", () => {
  it("is answered with 400 as JSON", async () => {
    const response = await handleMcpRequest(post("{not json"));

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({ error: { code: -32700 } });
  });
});
