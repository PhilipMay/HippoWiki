import { beforeEach, describe, expect, it, vi } from "vitest";

import type { handleMcpRequest as HandleMcpRequest } from "@/features/mcp/http";
import { MCP_BODY_LIMIT, MCP_RATE_BURST, MCP_RATE_PER_MINUTE } from "@/lib/env";

/**
 * The adapter, loaded again for every test (see `beforeEach`), so that every test starts with a fresh budget of the
 * rate limit, which the module keeps for the running server.
 */
let handleMcpRequest: typeof HandleMcpRequest;

const mocks = vi.hoisted(() => ({
  authenticateAccessToken: vi.fn(),
  getServerEnv: vi.fn(),
  getFolderById: vi.fn(),
  listTabs: vi.fn(),
  listAllFolderPages: vi.fn(),
  getPage: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/features/grants/service", () => ({ authenticateAccessToken: mocks.authenticateAccessToken }));
vi.mock("@/features/folders/service", () => ({ getFolderById: mocks.getFolderById, listTabs: mocks.listTabs }));
vi.mock("@/features/pages/service", () => ({
  listAllFolderPages: mocks.listAllFolderPages,
  getPage: mocks.getPage,
}));
vi.mock(import("@/lib/env"), async (importOriginal) => ({
  ...(await importOriginal()),
  getServerEnv: mocks.getServerEnv,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

const ACTOR = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", type: "user" };
const FOLDER_ID = "3a5c7e90-1b2d-4f6a-8c0e-2d4f6a8c0e11";
/** The segments of the path of the MCP address of the tests after `/mcp`: the Reader address of a folder. */
const PATH = [FOLDER_ID, "reader"];
const CONNECTION = { grantId: "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01", folderId: FOLDER_ID, role: "reader" };
const CALLER = { actor: ACTOR, connection: CONNECTION };
/** The error of a valid token whose user's role no longer allows the address, with the user and the grant. */
const ROLE_TOO_LOW = { code: "role-too-low", userId: ACTOR.id, grantId: CONNECTION.grantId };
/** The actor of MCP that the tools pass to the services: the user of the token with the connection of its grant. */
const MCP_ACTOR = { ...ACTOR, channel: "mcp", connection: CONNECTION };
const TOKEN = `hwa_${"A".repeat(43)}`;
const PUBLIC_URL = "https://wiki.example.com";
const RESOURCE_METADATA = `resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource/mcp/${FOLDER_ID}/reader"`;
const URL_OF_MCP = `http://localhost:3000/mcp/${FOLDER_ID}/reader`;

/** The server environment that the adapter reads: the public URL and the limits of MCP, their defaults unless given. */
function setServerEnv(env: { publicUrl?: string | undefined; bodyLimit?: number; rateBurst?: number } = {}): void {
  mocks.getServerEnv.mockReturnValue({
    HIPPOWIKI_PUBLIC_URL: "publicUrl" in env ? env.publicUrl : PUBLIC_URL,
    HIPPOWIKI_MCP_BODY_LIMIT: env.bodyLimit ?? MCP_BODY_LIMIT.default,
    HIPPOWIKI_MCP_RATE_BURST: env.rateBurst ?? MCP_RATE_BURST.default,
    HIPPOWIKI_MCP_RATE_PER_MINUTE: MCP_RATE_PER_MINUTE.default,
  });
}

/** Sets the public URL that the adapter reads from the server environment. */
function setPublicUrl(publicUrl: string | undefined): void {
  setServerEnv({ publicUrl });
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

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  ({ handleMcpRequest } = await import("@/features/mcp/http"));
  setPublicUrl(PUBLIC_URL);
  mocks.authenticateAccessToken.mockResolvedValue({ ok: true, value: CALLER });
  mocks.getFolderById.mockResolvedValue({ id: FOLDER_ID, name: "handbook", role: "reader" });
  mocks.listTabs.mockResolvedValue([]);
  mocks.listAllFolderPages.mockResolvedValue([]);
  mocks.getPage.mockResolvedValue(null);
});

describe("without a public URL", () => {
  it.each([
    ["POST with a valid token", "POST", { authorization: `Bearer ${TOKEN}` }],
    ["POST without a token", "POST", {}],
    ["POST from a foreign origin", "POST", { authorization: `Bearer ${TOKEN}`, origin: "https://evil.example" }],
    ["GET with a valid token", "GET", { authorization: `Bearer ${TOKEN}` }],
    ["GET without a token", "GET", {}],
    ["DELETE with a valid token", "DELETE", { authorization: `Bearer ${TOKEN}` }],
    ["DELETE from a foreign origin", "DELETE", { origin: "https://evil.example" }],
  ])("answers %s with 404 and does not look at the token", async (_case, method, headers) => {
    setPublicUrl(undefined);

    const response = await handleMcpRequest(
      new Request(URL_OF_MCP, {
        method,
        headers,
        ...(method === "POST" ? { body: JSON.stringify(TOOLS_LIST) } : {}),
      }),
      PATH,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("www-authenticate")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
    expect(mocks.authenticateAccessToken).not.toHaveBeenCalled();
    expect(mocks.listTabs).not.toHaveBeenCalled();
  });
});

describe("the address", () => {
  it.each([
    ["/mcp", undefined],
    ["/mcp with an empty path", []],
    ["the role Owner", [FOLDER_ID, "owner"]],
    ["a part that is no UUID", ["abc", "reader"]],
    ["a UUID in upper case", [FOLDER_ID.toUpperCase(), "reader"]],
    ["a folder without a role", [FOLDER_ID]],
    ["a further segment", [FOLDER_ID, "reader", "more"]],
  ])("answers %s with 404, before the method, the origin and the token", async (_case, path) => {
    for (const request of [
      post(TOOLS_LIST),
      new Request(URL_OF_MCP, { method: "GET" }),
      post(TOOLS_LIST, { origin: "https://evil.example" }),
    ]) {
      const response = await handleMcpRequest(request, path);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "not_found" });
    }
    expect(mocks.authenticateAccessToken).not.toHaveBeenCalled();
  });

  it.each(["writer", "manager"])(
    "answers the address of the role %s like the Reader address, and names it in the 401",
    async (role) => {
      mocks.authenticateAccessToken.mockResolvedValue({ ok: false, error: { code: "missing-token" } });

      const response = await handleMcpRequest(post(TOOLS_LIST), [FOLDER_ID, role]);

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(
        `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource/mcp/${FOLDER_ID}/${role}"`,
      );
      expect(mocks.authenticateAccessToken).toHaveBeenCalledWith(expect.anything(), {
        folderId: FOLDER_ID,
        role,
      });
    },
  );
});

describe("the folder of the connection", () => {
  it("answers a folder that can no longer be read with the actor like a role that is too low, and runs no tool", async () => {
    mocks.getFolderById.mockResolvedValue(null);

    const response = await handleMcpRequest(
      post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_folder", arguments: {} } }),
      PATH,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "role_too_low",
      error_description: "Your role on the folder does not allow this address.",
    });
    expect(mocks.listTabs).not.toHaveBeenCalled();
  });

  it("names the folder by its current name in the instructions", async () => {
    mocks.getFolderById.mockResolvedValue({ id: FOLDER_ID, name: "renamed", role: "reader" });

    const response = await handleMcpRequest(post(INITIALIZE), PATH);

    const { result } = (await response.json()) as { result: { instructions: string } };
    expect(result.instructions).toContain('the folder "renamed" with the role Reader');
  });

  it("answers 500 when the folder cannot be read, and logs it", async () => {
    mocks.getFolderById.mockRejectedValue(new Error("connection lost"));

    const response = await handleMcpRequest(post(TOOLS_LIST), PATH);

    expect(response.status).toBe(500);
    expect(mocks.error).toHaveBeenCalledOnce();
  });
});

describe("the method", () => {
  it.each(["GET", "DELETE", "PUT", "HEAD"])("answers %s with 405 and does not look at the token", async (method) => {
    const response = await handleMcpRequest(
      new Request(URL_OF_MCP, { method, headers: { authorization: `Bearer ${TOKEN}`, accept: "text/event-stream" } }),
      PATH,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(mocks.authenticateAccessToken).not.toHaveBeenCalled();
  });
});

describe("the origin", () => {
  it("lets a request without an Origin header pass, as MCP clients send it", async () => {
    const response = await handleMcpRequest(post(TOOLS_LIST), PATH);

    expect(response.status).toBe(200);
  });

  it("lets a request from exactly the public URL pass", async () => {
    const response = await handleMcpRequest(post(TOOLS_LIST, { origin: PUBLIC_URL }), PATH);

    expect(response.status).toBe(200);
  });

  it.each([
    ["another scheme", "http://wiki.example.com"],
    ["another port", "https://wiki.example.com:8443"],
    ["another site", "https://evil.example"],
    // The host the request was sent to is not enough: a page with a rebound host name would send it as well.
    ["the host the request was sent to", "http://localhost:3000"],
    ["an opaque origin", "null"],
    ["something that is not an origin", "not an origin"],
  ])("refuses a request from %s with 403 before the token is checked", async (_case, origin) => {
    const response = await handleMcpRequest(post(TOOLS_LIST, { origin }), PATH);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden_origin" });
    expect(mocks.authenticateAccessToken).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledOnce();
  });
});

describe("the token", () => {
  it("checks the headers of the request for an access token for the address, without a scope", async () => {
    const request = post(TOOLS_LIST);

    await handleMcpRequest(request, PATH);

    expect(mocks.authenticateAccessToken).toHaveBeenCalledExactlyOnceWith(request.headers, {
      folderId: FOLDER_ID,
      role: "reader",
    });
  });

  it("answers role-too-low with 403 and a message, without insufficient_scope or a challenge, and runs no tool", async () => {
    mocks.authenticateAccessToken.mockResolvedValue({ ok: false, error: ROLE_TOO_LOW });

    const response = await handleMcpRequest(
      post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_folder" } }),
      PATH,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toBeNull();
    const body = await response.json();
    expect(body).toEqual({
      error: "role_too_low",
      error_description: "Your role on the folder does not allow this address.",
    });
    expect(JSON.stringify(body)).not.toContain("insufficient_scope");
    expect(mocks.listTabs).not.toHaveBeenCalled();
  });

  it.each([
    ["missing-token", 401, `Bearer ${RESOURCE_METADATA}`, "unauthorized"],
    ["invalid-token", 401, `Bearer error="invalid_token", ${RESOURCE_METADATA}`, "invalid_token"],
  ])(
    "answers %s with %i and says where the authorization server is found, without reaching the tools",
    async (code, status, challenge, error) => {
      mocks.authenticateAccessToken.mockResolvedValue({ ok: false, error: { code } });

      const response = await handleMcpRequest(
        post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_folder" } }),
        PATH,
      );

      expect(response.status).toBe(status);
      expect(response.headers.get("www-authenticate")).toBe(challenge);
      await expect(response.json()).resolves.toEqual({ error });
      expect(mocks.listTabs).not.toHaveBeenCalled();
    },
  );

  it("answers a token that could not be checked with 500 and no challenge", async () => {
    mocks.authenticateAccessToken.mockResolvedValue({ ok: false, error: { code: "failed" } });

    const response = await handleMcpRequest(post(TOOLS_LIST), PATH);

    expect(response.status).toBe(500);
    expect(response.headers.get("www-authenticate")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "server_error" });
  });

  it("never logs or returns the token", async () => {
    mocks.authenticateAccessToken.mockResolvedValue({ ok: false, error: { code: "invalid-token" } });

    const response = await handleMcpRequest(post(TOOLS_LIST), PATH);

    const logged = JSON.stringify([mocks.info.mock.calls, mocks.warn.mock.calls, mocks.error.mock.calls]);
    expect(logged).not.toContain(TOKEN);
    expect(await response.text()).not.toContain(TOKEN);
  });
});

describe("a client of the protocol of 2025", () => {
  it("gets the answer to initialize as JSON, without a session", async () => {
    const response = await handleMcpRequest(post(INITIALIZE), PATH);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("mcp-session-id")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      id: 1,
      result: { protocolVersion: "2025-06-18", serverInfo: { name: "hippowiki" }, instructions: expect.any(String) },
    });
  });

  it("gets the tools and the result of a tool as JSON", async () => {
    const list = await handleMcpRequest(post(TOOLS_LIST, { "mcp-protocol-version": "2025-06-18" }), PATH);
    const call = await handleMcpRequest(
      post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_folder", arguments: {} } }),
      PATH,
    );

    expect(list.headers.get("content-type")).toBe("application/json");
    const tools = ((await list.json()) as { result: { tools: { name: string }[] } }).result.tools;
    expect(tools.map((tool) => tool.name)).toEqual(["list_folder", "read_page", "search_pages"]);
    expect(call.headers.get("content-type")).toBe("application/json");
    await expect(call.json()).resolves.toMatchObject({
      id: 3,
      result: { structuredContent: { folder: { name: "handbook", address: `${PUBLIC_URL}/folders/handbook` } } },
    });
    // The adapter reads the folder of the connection, and the tools read as the user of the token, through MCP.
    expect(mocks.getFolderById).toHaveBeenCalledWith(MCP_ACTOR, FOLDER_ID);
    expect(mocks.listTabs).toHaveBeenCalledExactlyOnceWith(MCP_ACTOR, FOLDER_ID);
  });

  it("gets 202 without a body for a notification", async () => {
    const response = await handleMcpRequest(post({ jsonrpc: "2.0", method: "notifications/initialized" }), PATH);

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });
});

describe("a client of the current protocol", () => {
  it("gets the tools and the result of a tool as JSON", async () => {
    const list = await handleMcpRequest(
      post({ ...TOOLS_LIST, params: { _meta: MODERN_META } }, modernHeaders("tools/list")),
      PATH,
    );
    const call = await handleMcpRequest(
      post(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "list_folder", arguments: {}, _meta: MODERN_META },
        },
        modernHeaders("tools/call", "list_folder"),
      ),
      PATH,
    );

    expect(list.status).toBe(200);
    expect(list.headers.get("content-type")).toBe("application/json");
    const tools = ((await list.json()) as { result: { tools: { name: string }[] } }).result.tools;
    expect(tools.map((tool) => tool.name)).toEqual(["list_folder", "read_page", "search_pages"]);
    expect(call.status).toBe(200);
    expect(call.headers.get("content-type")).toBe("application/json");
    await expect(call.json()).resolves.toMatchObject({
      id: 3,
      result: { structuredContent: { folder: { name: "handbook" }, tabs: [], pages: [] } },
    });
    // The tools read as the user of the token, also when the handler of the SDK builds the server.
    expect(mocks.listTabs).toHaveBeenCalledExactlyOnceWith(MCP_ACTOR, FOLDER_ID);
  });

  it("gives the tools of each request the user of its own token", async () => {
    const other = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1003", name: "bob", type: "user" };
    const call = () =>
      handleMcpRequest(
        post(
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "list_folder", arguments: {}, _meta: MODERN_META },
          },
          modernHeaders("tools/call", "list_folder"),
        ),
        PATH,
      );

    await call();
    mocks.authenticateAccessToken.mockResolvedValue({ ok: true, value: { actor: other, connection: CONNECTION } });
    await call();

    expect(mocks.listTabs.mock.calls).toEqual([
      [MCP_ACTOR, FOLDER_ID],
      [{ ...other, channel: "mcp", connection: CONNECTION }, FOLDER_ID],
    ]);
  });

  it("is refused a subscription with a JSON answer instead of a stream", async () => {
    const response = await handleMcpRequest(
      post(
        { jsonrpc: "2.0", id: 4, method: "subscriptions/listen", params: { _meta: MODERN_META, notifications: {} } },
        modernHeaders("subscriptions/listen"),
      ),
      PATH,
    );

    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toMatchObject({ id: 4, error: { message: expect.any(String) } });
  });
});

describe("a body that is not a message", () => {
  it("is answered with 400 as JSON", async () => {
    const response = await handleMcpRequest(post("{not json"), PATH);

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({ error: { code: -32700 } });
  });
});

/** A `tools/call` of `read_page` with the given id, as a client of the protocol of 2025 or, with `_meta`, of now. */
function readPageCall(id: number, modern = false): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "read_page", arguments: { page: `page-${id}` }, ...(modern ? { _meta: MODERN_META } : {}) },
  };
}

/** A body of JSON, a `tools/list` padded with spaces, of exactly the given number of bytes. */
function bodyOfSize(bytes: number): string {
  const message = JSON.stringify(TOOLS_LIST);
  return message + " ".repeat(bytes - message.length);
}

/**
 * A body sent in chunks of 64 KiB without a `Content-Length`, of the given number of bytes; `pulled()` says how many
 * bytes the stream has handed out so far.
 */
function chunkedBody(bytes: number): { stream: ReadableStream<Uint8Array>; pulled: () => number } {
  const encoded = new TextEncoder().encode(bodyOfSize(bytes));
  const chunk = 64 * 1024;
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (offset >= encoded.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoded.subarray(offset, offset + chunk));
        offset += chunk;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, pulled: () => Math.min(offset, encoded.length) };
}

/**
 * A `POST` with the given body as it is, with the headers of an MCP client: a text with its `Content-Length`, as a
 * client sends a body it holds whole, or a stream without one, as a body sent in chunks.
 */
function postRaw(body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}): Request {
  return new Request(URL_OF_MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${TOKEN}`,
      ...(typeof body === "string" ? { "content-length": String(new TextEncoder().encode(body).length) } : {}),
      ...headers,
    },
    body,
    ...(typeof body === "string" ? {} : { duplex: "half" }),
  } as RequestInit);
}

const MIB = 1024 * 1024;

describe("the body limit", () => {
  it("lets a body of exactly 1 MiB pass, with a Content-Length and in chunks", async () => {
    const withLength = await handleMcpRequest(postRaw(bodyOfSize(MIB)), PATH);
    const inChunks = await handleMcpRequest(postRaw(chunkedBody(MIB).stream), PATH);

    expect(withLength.status).toBe(200);
    expect(inChunks.status).toBe(200);
    await expect(inChunks.json()).resolves.toMatchObject({ id: 2, result: { tools: expect.any(Array) } });
  });

  it("refuses a body of 1 MiB and one byte with a Content-Length with 413, and the SDK and no tool see it", async () => {
    const response = await handleMcpRequest(
      postRaw(bodyOfSize(MIB + 1).replace(JSON.stringify(TOOLS_LIST), JSON.stringify(readPageCall(5)))),
      PATH,
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ error: "request_too_large" });
    expect(mocks.getPage).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("refuses a body of 1 MiB and one byte in chunks with 413, and stops reading it at the limit", async () => {
    const large = chunkedBody(4 * MIB);
    const justOver = chunkedBody(MIB + 1);

    const response = await handleMcpRequest(postRaw(large.stream), PATH);
    const second = await handleMcpRequest(postRaw(justOver.stream), PATH);

    expect(response.status).toBe(413);
    expect(second.status).toBe(413);
    // The reader stops with the chunk that passes the limit: the stream of 4 MiB is not read to its end.
    expect(large.pulled()).toBeLessThanOrEqual(MIB + 64 * 1024);
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("refuses a Content-Length over the limit without reading the body", async () => {
    const small = chunkedBody(1024);

    const response = await handleMcpRequest(postRaw(small.stream, { "content-length": String(MIB + 1) }), PATH);

    expect(response.status).toBe(413);
    expect(small.pulled()).toBe(0);
  });

  it("follows HIPPOWIKI_MCP_BODY_LIMIT: with 4 MiB a body of 2 MiB fits", async () => {
    setServerEnv({ bodyLimit: 4 * MIB });

    const response = await handleMcpRequest(postRaw(bodyOfSize(2 * MIB)), PATH);
    const inChunks = await handleMcpRequest(postRaw(chunkedBody(2 * MIB).stream), PATH);

    expect(response.status).toBe(200);
    expect(inChunks.status).toBe(200);
  });

  it("does not read the body of a request without a token", async () => {
    mocks.authenticateAccessToken.mockResolvedValue({ ok: false, error: { code: "missing-token" } });
    const large = chunkedBody(4 * MIB);

    const response = await handleMcpRequest(postRaw(large.stream), PATH);

    expect(response.status).toBe(401);
    expect(large.pulled()).toBe(0);
  });
});

describe("a batch", () => {
  const BATCH_ERROR = {
    jsonrpc: "2.0",
    id: null,
    error: {
      code: -32600,
      message: "Invalid Request: batches are not supported. Send the calls one by one, each in a request of its own.",
    },
  };

  it.each([
    ["without the _meta envelope, of 2025-03-26", false, { "mcp-protocol-version": "2025-03-26" }],
    ["without the _meta envelope, of 2025-06-18", false, { "mcp-protocol-version": "2025-06-18" }],
    ["without the _meta envelope or a version header", false, {}],
    ["with the _meta envelope", true, modernHeaders("tools/call", "read_page")],
  ])("is refused as a whole with 400 and -32600, %s, and no tool runs", async (_case, modern, headers) => {
    const response = await handleMcpRequest(post([readPageCall(1, modern), readPageCall(2, modern)], headers), PATH);

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual(BATCH_ERROR);
    expect(mocks.getPage).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("is logged as one warning with the user, the grant and the address, without the calls", async () => {
    await handleMcpRequest(post([readPageCall(1), readPageCall(2)]), PATH);

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { userId: ACTOR.id, grantId: CONNECTION.grantId, folderId: FOLDER_ID, role: "reader" },
      expect.any(String),
    );
    const logged = JSON.stringify(mocks.warn.mock.calls);
    expect(logged).not.toContain("page-1");
    expect(logged).not.toContain("read_page");
    expect(logged).not.toContain(TOKEN);
  });

  it("is refused also when it is empty", async () => {
    const response = await handleMcpRequest(post([]), PATH);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(BATCH_ERROR);
  });

  it("is not read without a token: 401 comes first", async () => {
    mocks.authenticateAccessToken.mockResolvedValue({ ok: false, error: { code: "missing-token" } });

    const response = await handleMcpRequest(post([readPageCall(1), readPageCall(2)]), PATH);

    expect(response.status).toBe(401);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("leaves single calls working, one by one", async () => {
    const first = await handleMcpRequest(post(readPageCall(1)), PATH);
    const second = await handleMcpRequest(post(readPageCall(2)), PATH);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.getPage).toHaveBeenCalledTimes(2);
    expect(mocks.info).toHaveBeenCalledTimes(2);
  });
});

describe("the rate limit", () => {
  /** Sends `count` lists of the tools, one after the other, and returns the statuses of the answers. */
  async function sendMany(count: number, message: unknown = TOOLS_LIST): Promise<number[]> {
    const statuses: number[] = [];
    for (let index = 0; index < count; index += 1) {
      statuses.push((await handleMcpRequest(post(message), PATH)).status);
    }
    return statuses;
  }

  it("refuses the 61st request of a user with 429 and Retry-After, before the SDK and any tool, and logs it once", async () => {
    const statuses = await sendMany(60);
    mocks.warn.mockClear();

    const refused = await handleMcpRequest(post(readPageCall(61)), PATH);

    expect(statuses.every((status) => status === 200)).toBe(true);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(refused.headers.get("content-type")).toContain("application/json");
    await expect(refused.json()).resolves.toEqual({ error: "rate_limited" });
    expect(mocks.getPage).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { userId: ACTOR.id, grantId: CONNECTION.grantId, folderId: FOLDER_ID, role: "reader" },
      expect.any(String),
    );
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(TOKEN);
  });

  it("logs further refusals within the minute no more", async () => {
    await sendMany(60);
    mocks.warn.mockClear();

    const statuses = await sendMany(10);

    expect(statuses).toEqual(Array.from({ length: 10 }, () => 429));
    expect(mocks.warn).toHaveBeenCalledOnce();
  });

  it("counts a list of the tools and a request refused for its role like a tool call, and answers 429 before 403", async () => {
    await sendMany(30);
    await sendMany(10, readPageCall(1));
    mocks.authenticateAccessToken.mockResolvedValue({ ok: false, error: ROLE_TOO_LOW });

    const refusedForRole = await sendMany(20);
    const overTheBudget = await handleMcpRequest(post(TOOLS_LIST), PATH);

    expect(refusedForRole).toEqual(Array.from({ length: 20 }, () => 403));
    expect(overTheBudget.status).toBe(429);
  });

  it.each([
    ["without a token", "missing-token"],
    ["with an invalid token", "invalid-token"],
  ])("lets 70 requests %s get 401 and leaves the budget as it was", async (_case, code) => {
    mocks.authenticateAccessToken.mockResolvedValue({ ok: false, error: { code } });
    const unauthorized = await sendMany(70);
    mocks.authenticateAccessToken.mockResolvedValue({ ok: true, value: CALLER });

    const afterwards = await sendMany(60);

    expect(unauthorized).toEqual(Array.from({ length: 70 }, () => 401));
    expect(afterwards.every((status) => status === 200)).toBe(true);
  });

  it("takes nothing for a token that could not be checked", async () => {
    mocks.authenticateAccessToken.mockResolvedValue({ ok: false, error: { code: "failed" } });
    await sendMany(70);
    mocks.authenticateAccessToken.mockResolvedValue({ ok: true, value: CALLER });

    expect((await sendMany(60)).every((status) => status === 200)).toBe(true);
  });

  it("counts a body over the limit", async () => {
    await sendMany(59);

    const tooLarge = await handleMcpRequest(postRaw(bodyOfSize(MIB + 1)), PATH);
    const next = await handleMcpRequest(post(TOOLS_LIST), PATH);

    expect(tooLarge.status).toBe(413);
    expect(next.status).toBe(429);
  });

  it("gives another user a budget of their own", async () => {
    await sendMany(60);
    const other = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1003", name: "bob", type: "user" };
    mocks.authenticateAccessToken.mockResolvedValue({ ok: true, value: { actor: other, connection: CONNECTION } });

    expect((await handleMcpRequest(post(TOOLS_LIST), PATH)).status).toBe(200);
  });

  it("follows HIPPOWIKI_MCP_RATE_BURST: with 2 the third request is refused", async () => {
    setServerEnv({ rateBurst: 2 });

    expect(await sendMany(3)).toEqual([200, 200, 429]);
  });
});
