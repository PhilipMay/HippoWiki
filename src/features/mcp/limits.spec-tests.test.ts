// Tests written from the spec alone ("The endpoint" and "The connections" in `spec/mcp.md`, "Configuration" in
// `spec/container-image.md`), for the rules or the parts of rules that the other tests of the MCP adapter leave open:
// batches at every address, the body limit in bytes and for the current protocol, what counts against the rate limit,
// the value of `Retry-After`, the log of the refusals over time, the variables of the limits and the order of the
// refusals.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { handleMcpRequest as HandleMcpRequest } from "@/features/mcp/http";
import { MCP_BODY_LIMIT, MCP_RATE_BURST, MCP_RATE_PER_MINUTE } from "@/lib/env";

let handleMcpRequest: typeof HandleMcpRequest;

const mocks = vi.hoisted(() => ({
  authenticateAccessToken: vi.fn(),
  getServerEnv: vi.fn(),
  getFolderById: vi.fn(),
  listTabs: vi.fn(),
  listAllFolderPages: vi.fn(),
  getPage: vi.fn(),
  createPage: vi.fn(),
  updatePageContent: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/features/grants/service", () => ({ authenticateAccessToken: mocks.authenticateAccessToken }));
vi.mock("@/features/folders/service", () => ({ getFolderById: mocks.getFolderById, listTabs: mocks.listTabs }));
vi.mock("@/features/pages/service", () => ({
  listAllFolderPages: mocks.listAllFolderPages,
  getPage: mocks.getPage,
  createPage: mocks.createPage,
  updatePageContent: mocks.updatePageContent,
}));
vi.mock(import("@/lib/env"), async (importOriginal) => ({
  ...(await importOriginal()),
  getServerEnv: mocks.getServerEnv,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

type Role = "reader" | "writer" | "manager";

const ALICE = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", type: "user" };
const BOB = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1003", name: "bob", type: "user" };
const FOLDER_ID = "3a5c7e90-1b2d-4f6a-8c0e-2d4f6a8c0e11";
const OTHER_FOLDER_ID = "3a5c7e90-1b2d-4f6a-8c0e-2d4f6a8c0e12";
const TOKEN = `hwa_${"A".repeat(43)}`;
const PUBLIC_URL = "https://wiki.example.com";
const MIB = 1024 * 1024;

/** The grant of a connection: one per folder and role, so that every address of a test has a grant of its own. */
function grantIdOf(folderId: string, role: Role): string {
  const index = ["reader", "writer", "manager"].indexOf(role) + (folderId === FOLDER_ID ? 0 : 3);
  return `0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a0${index}`;
}

/** Lets every token be valid for the address it is sent to, as a token of the given user. */
function tokensOf(actor: typeof ALICE): void {
  mocks.authenticateAccessToken.mockImplementation(
    async (_headers: Headers, { folderId, role }: { folderId: string; role: Role }) => ({
      ok: true,
      value: { actor, connection: { grantId: grantIdOf(folderId, role), folderId, role } },
    }),
  );
}

/** Lets every token be one of alice whose role on the folder no longer allows the address. */
function roleTooLow(): void {
  mocks.authenticateAccessToken.mockImplementation(
    async (_headers: Headers, { folderId, role }: { folderId: string; role: Role }) => ({
      ok: false,
      error: { code: "role-too-low", userId: ALICE.id, grantId: grantIdOf(folderId, role) },
    }),
  );
}

/** The server environment that the adapter reads: the public URL and the limits of MCP, their defaults unless given. */
function setLimits(limits: { bodyLimit?: number; rateBurst?: number; ratePerMinute?: number } = {}): void {
  mocks.getServerEnv.mockReturnValue({
    HIPPOWIKI_PUBLIC_URL: PUBLIC_URL,
    HIPPOWIKI_MCP_BODY_LIMIT: limits.bodyLimit ?? MCP_BODY_LIMIT.default,
    HIPPOWIKI_MCP_RATE_BURST: limits.rateBurst ?? MCP_RATE_BURST.default,
    HIPPOWIKI_MCP_RATE_PER_MINUTE: limits.ratePerMinute ?? MCP_RATE_PER_MINUTE.default,
  });
}

/** Loads the adapter anew, as a restarted server does: its budget of the rate limit starts full. */
async function loadAdapter(): Promise<void> {
  vi.resetModules();
  ({ handleMcpRequest } = await import("@/features/mcp/http"));
}

beforeEach(async () => {
  vi.resetAllMocks();
  await loadAdapter();
  setLimits();
  tokensOf(ALICE);
  mocks.getFolderById.mockImplementation(async (_actor: unknown, id: string) => ({
    id,
    name: "handbook",
    role: "manager",
  }));
  mocks.listTabs.mockResolvedValue([]);
  mocks.listAllFolderPages.mockResolvedValue([]);
  mocks.getPage.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

/** The `_meta` envelope and the headers of a request of the current protocol. */
const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
};
function modernHeaders(method: string, name?: string): Record<string, string> {
  return { "mcp-protocol-version": "2026-07-28", "mcp-method": method, ...(name ? { "mcp-name": name } : {}) };
}

const TOOLS_LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const MODERN_TOOLS_LIST = { ...TOOLS_LIST, params: { _meta: MODERN_META } };
const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
};

/** A `tools/call` of the tool with the arguments, as a client of the protocol of 2025 or, with `_meta`, of now. */
function toolCall(id: number, name: string, args: Record<string, unknown>, modern = false): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args, ...(modern ? { _meta: MODERN_META } : {}) },
  };
}

/** The URL of the MCP address of the folder for the role. */
function urlOf(folderId: string, role: Role): string {
  return `http://localhost:3000/mcp/${folderId}/${role}`;
}

/**
 * A `POST` of the body to the MCP address of the folder for the role, with the headers of an MCP client: a text with
 * its `Content-Length`, as a client sends a body it holds whole, or a stream without one, as a body sent in chunks.
 */
function post(
  body: unknown,
  {
    folderId = FOLDER_ID,
    role = "reader",
    headers = {},
  }: { folderId?: string; role?: Role; headers?: Record<string, string> } = {},
): Request {
  const text = typeof body === "string" || body instanceof ReadableStream ? body : JSON.stringify(body);
  return new Request(urlOf(folderId, role), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${TOKEN}`,
      ...(typeof text === "string" ? { "content-length": String(new TextEncoder().encode(text).length) } : {}),
      ...headers,
    },
    body: text as BodyInit,
    ...(typeof text === "string" ? {} : { duplex: "half" }),
  } as RequestInit);
}

/** Sends the request to the adapter, at the address it was built for. */
function send(request: Request): Promise<Response> {
  const [, , folderId = "", role = ""] = new URL(request.url).pathname.split("/");
  return handleMcpRequest(request, [folderId, role]);
}

/** Sends `count` lists of the tools at the Reader address, one after the other, and returns the statuses. */
async function sendMany(count: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let index = 0; index < count; index += 1) statuses.push((await send(post(TOOLS_LIST))).status);
  return statuses;
}

/** A body of JSON, a `tools/list` padded with spaces, of exactly the given number of bytes. */
function bodyOfSize(bytes: number, message: unknown = TOOLS_LIST): string {
  const text = JSON.stringify(message);
  return text + " ".repeat(bytes - text.length);
}

/**
 * The text as a body sent in chunks of 64 KiB without a `Content-Length`; `pulled()` says how many bytes the stream
 * has handed out so far.
 */
function inChunks(text: string): { stream: ReadableStream<Uint8Array>; pulled: () => number } {
  const encoded = new TextEncoder().encode(text);
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

const BATCH_ERROR = { code: -32600, message: expect.stringMatching(/batch[\s\S]*not supported[\s\S]*one by one/i) };

/** The warning lines whose data names the user. */
function warningsOf(userId: string): unknown[][] {
  return mocks.warn.mock.calls.filter(([data]) => JSON.stringify(data).includes(userId));
}

describe("a batch", () => {
  // mcp.md, "The endpoint": refused as a whole on every MCP address and for every protocol
  // revision, with 400 and -32600, before any tool runs.
  it.each([
    ["writer", false, { "mcp-protocol-version": "2025-03-26" }],
    ["writer", true, modernHeaders("tools/call", "read_page")],
    ["manager", false, { "mcp-protocol-version": "2025-06-18" }],
    ["manager", true, modernHeaders("tools/call", "read_page")],
  ] as const)(
    "at the %s address (with _meta: %s) is refused with 400 and -32600, and no tool runs",
    async (role, modern, headers) => {
      const batch = [toolCall(1, "read_page", { page: "a" }, modern), toolCall(2, "read_page", { page: "b" }, modern)];

      const response = await send(post(batch, { role, headers }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ jsonrpc: "2.0", error: BATCH_ERROR });
      expect(mocks.getPage).not.toHaveBeenCalled();
      expect(mocks.info).not.toHaveBeenCalled();
    },
  );

  // mcp.md, "The endpoint": "before any tool runs", also for the write tools of a Writer.
  it("of create_page calls at the Writer address creates no page", async () => {
    const batch = [toolCall(1, "create_page", { content: "# One" }), toolCall(2, "create_page", { content: "# Two" })];

    const response = await send(post(batch, { role: "writer", headers: { "mcp-protocol-version": "2025-03-26" } }));

    expect(response.status).toBe(400);
    expect(mocks.createPage).not.toHaveBeenCalled();
    expect(mocks.updatePageContent).not.toHaveBeenCalled();
  });

  // mcp.md, "The endpoint": a batch is a JSON array of messages, whatever it holds.
  it.each([
    ["one call", [toolCall(1, "read_page", { page: "a" })]],
    ["an initialize of 2025-03-26", [INITIALIZE]],
    ["only notifications", [{ jsonrpc: "2.0", method: "notifications/initialized" }]],
    ["a list of the tools and a call", [TOOLS_LIST, toolCall(2, "read_page", { page: "a" })]],
  ])("of %s is refused with 400 and -32600", async (_case, batch) => {
    const response = await send(post(batch, { headers: { "mcp-protocol-version": "2025-03-26" } }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: BATCH_ERROR });
    expect(mocks.getPage).not.toHaveBeenCalled();
  });

  // mcp.md, "The endpoint": one warning line with the user, the grant and the address.
  it("is logged once with the user, the grant and the address of the Writer address it was sent to", async () => {
    await send(post([toolCall(1, "create_page", { content: "# Secret title\n\nSecret text" })], { role: "writer" }));

    expect(mocks.warn).toHaveBeenCalledOnce();
    const logged = JSON.stringify(mocks.warn.mock.calls);
    expect(logged).toContain(ALICE.id);
    expect(logged).toContain(grantIdOf(FOLDER_ID, "writer"));
    expect(logged).toContain(FOLDER_ID);
    expect(logged).toContain("writer");
    expect(logged).not.toContain("Secret");
  });
});

describe("the body limit", () => {
  // mcp.md, "The endpoint": for every protocol revision, the current one included.
  it.each(["reader", "writer", "manager"] as const)(
    "refuses a body of 1 MiB and one byte of the current protocol at the %s address with 413",
    async (role) => {
      const headers = modernHeaders("tools/list");
      const text = bodyOfSize(MIB + 1, MODERN_TOOLS_LIST);

      const withLength = await send(post(text, { role, headers }));
      const chunked = await send(post(inChunks(text).stream, { role, headers }));

      expect(withLength.status).toBe(413);
      expect(chunked.status).toBe(413);
    },
  );

  // mcp.md, "The endpoint" and container-image.md, "Configuration": the limit is a number of bytes, not of
  // characters.
  it("counts bytes: a body of fewer than 1 MiB characters but more than 1 MiB of UTF-8 is refused with 413", async () => {
    const call = toolCall(1, "read_page", { page: "a" });
    const text = JSON.stringify({ ...call, params: { ...(call.params as object), pad: "ä".repeat(MIB / 2) } });
    expect(text.length).toBeLessThan(MIB);
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(MIB);

    const withLength = await send(post(text));
    const chunked = await send(post(inChunks(text).stream));

    expect(withLength.status).toBe(413);
    expect(chunked.status).toBe(413);
    expect(mocks.getPage).not.toHaveBeenCalled();
  });

  // mcp.md, "The endpoint": a larger body is refused, whatever its Content-Length claims.
  it("refuses a body in chunks larger than the limit whose Content-Length claims less", async () => {
    const response = await send(post(inChunks(bodyOfSize(MIB + 1)).stream, { headers: { "content-length": "100" } }));

    expect(response.status).toBe(413);
  });

  // container-image.md, "Configuration": a value within the bounds changes the body limit accordingly.
  it("follows HIPPOWIKI_MCP_BODY_LIMIT at 2 MiB: 2 MiB fits and 2 MiB and one byte is refused", async () => {
    setLimits({ bodyLimit: 2 * MIB });

    const fits = await send(post(bodyOfSize(2 * MIB)));
    const fitsInChunks = await send(post(inChunks(bodyOfSize(2 * MIB)).stream));
    const tooLarge = await send(post(bodyOfSize(2 * MIB + 1)));
    const tooLargeInChunks = await send(post(inChunks(bodyOfSize(2 * MIB + 1)).stream));

    expect([fits.status, fitsInChunks.status, tooLarge.status, tooLargeInChunks.status]).toEqual([200, 200, 413, 413]);
  });

  // mcp.md, "The endpoint": the bound applies before the body is parsed, so an oversized batch is
  // refused as too large.
  it("refuses a batch over the limit with 413", async () => {
    const batch = JSON.stringify([toolCall(1, "read_page", { page: "a" }), toolCall(2, "read_page", { page: "b" })]);
    const response = await send(post(batch + " ".repeat(MIB + 1 - batch.length)));

    expect(response.status).toBe(413);
  });
});

describe("what counts against the rate limit", () => {
  // mcp.md, "The endpoint": every request whose token is valid counts, whatever message it carries.
  it.each([
    ["a refused batch", () => post([TOOLS_LIST, TOOLS_LIST]), 400],
    ["a body that is not JSON", () => post("{not json"), 400],
    ["a notification", () => post({ jsonrpc: "2.0", method: "notifications/initialized" }), 202],
    ["an initialize", () => post(INITIALIZE), 200],
    [
      "a list of the tools of the current protocol",
      () => post(MODERN_TOOLS_LIST, { headers: modernHeaders("tools/list") }),
      200,
    ],
    ["a body over the limit sent in chunks", () => post(inChunks(bodyOfSize(MIB + 1)).stream), 413],
  ] as const)("counts %s", async (_case, request, status) => {
    setLimits({ rateBurst: 1, ratePerMinute: 1 });

    const first = await send(request());
    const next = await send(post(TOOLS_LIST));

    expect(first.status).toBe(status);
    expect(next.status).toBe(429);
  });

  // mcp.md, "The endpoint": one budget across all the user's connections and addresses.
  it("shares one budget between the Reader, Writer and Manager addresses of several folders of a user", async () => {
    setLimits({ rateBurst: 3, ratePerMinute: 1 });

    const statuses = [
      (await send(post(TOOLS_LIST, { folderId: FOLDER_ID, role: "reader" }))).status,
      (await send(post(TOOLS_LIST, { folderId: OTHER_FOLDER_ID, role: "writer" }))).status,
      (await send(post(TOOLS_LIST, { folderId: OTHER_FOLDER_ID, role: "manager" }))).status,
      (await send(post(TOOLS_LIST, { folderId: FOLDER_ID, role: "writer" }))).status,
    ];

    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe("the answer over the budget", () => {
  // mcp.md, "The endpoint" and container-image.md, "Configuration": Retry-After is the number of seconds until the
  // next request is allowed, and HIPPOWIKI_MCP_RATE_PER_MINUTE sets how fast the budget refills.
  it.each([1, 7, 40, 60, 300])(
    "with %i a minute gives Retry-After in whole seconds, after which the next request is allowed",
    async (perMinute) => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-21T10:00:00Z") });
      await loadAdapter();
      setLimits({ rateBurst: 1, ratePerMinute: perMinute });

      expect((await send(post(TOOLS_LIST))).status).toBe(200);
      const refused = await send(post(TOOLS_LIST));
      const retryAfter = refused.headers.get("retry-after") ?? "";
      vi.setSystemTime(Date.now() + Number(retryAfter) * 1000);
      const afterTheWait = await send(post(TOOLS_LIST));

      expect(refused.status).toBe(429);
      expect(retryAfter).toMatch(/^[1-9]\d*$/);
      // Not more than a second longer than the wait that the rate of refill gives.
      expect(Number(retryAfter)).toBeLessThanOrEqual(Math.ceil(60 / perMinute));
      expect(afterTheWait.status).toBe(200);
    },
  );

  // container-image.md, "Configuration": HIPPOWIKI_MCP_RATE_PER_MINUTE changes the rate limit.
  it("follows HIPPOWIKI_MCP_RATE_PER_MINUTE: with 60 a minute exactly one request more is allowed a second later", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-21T10:00:00Z") });
    await loadAdapter();
    setLimits({ rateBurst: 5, ratePerMinute: 60 });

    const burst = await sendMany(6);
    vi.setSystemTime(Date.now() + 1000);
    const aSecondLater = await sendMany(2);

    expect(burst).toEqual([200, 200, 200, 200, 200, 429]);
    expect(aSecondLater).toEqual([200, 429]);
  });
});

describe("the log of the rate limit", () => {
  // mcp.md, "The endpoint": at most one line per user and minute; the next line a minute or more
  // later says how many requests were refused since the line before.
  it("writes one line for 100 refusals within a minute, and a second line a minute later that counts the 99 others", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-21T10:00:00Z") });
    await loadAdapter();
    await sendMany(60);

    const refused = await sendMany(100);
    const linesWithinTheMinute = warningsOf(ALICE.id).length;
    vi.setSystemTime(Date.now() + 60_000);
    const afterTheMinute = await sendMany(61);

    expect(refused.every((status) => status === 429)).toBe(true);
    expect(linesWithinTheMinute).toBe(1);
    expect(afterTheMinute.at(-1)).toBe(429);
    const lines = warningsOf(ALICE.id);
    expect(lines).toHaveLength(2);
    expect(JSON.stringify(lines[1])).toMatch(/\b99\b/);
    expect(JSON.stringify(lines[1])).toContain(grantIdOf(FOLDER_ID, "reader"));
    expect(JSON.stringify(lines[1])).toContain(FOLDER_ID);
  });

  // mcp.md, "The endpoint": the minute is one of each user: the first refusal of another user in
  // the same minute writes a line of its own.
  it("writes a line for the first refusal of another user within the minute of the first", async () => {
    setLimits({ rateBurst: 1, ratePerMinute: 1 });
    await sendMany(3);
    tokensOf(BOB);

    await sendMany(3);

    expect(warningsOf(ALICE.id)).toHaveLength(1);
    expect(warningsOf(BOB.id)).toHaveLength(1);
  });
});

describe("the budget", () => {
  // mcp.md, "The endpoint": the budget is kept by the running server only.
  it("is full again after a restart of the server", async () => {
    setLimits({ rateBurst: 1, ratePerMinute: 1 });
    expect(await sendMany(2)).toEqual([200, 429]);

    await loadAdapter();

    expect(await sendMany(1)).toEqual([200]);
  });
});

describe("the order of the refusals", () => {
  // mcp.md, "The connections": the rate limit comes after the check of
  // the token, so a request without a valid token gets 401 also from a user whose budget is used up.
  it("answers 401 before 429", async () => {
    setLimits({ rateBurst: 1, ratePerMinute: 1 });
    await sendMany(2);
    mocks.authenticateAccessToken.mockResolvedValue({ ok: false, error: { code: "invalid-token" } });

    expect((await send(post(TOOLS_LIST))).status).toBe(401);
  });

  // mcp.md, "The endpoint" and "Decisions": over the budget the request is refused before the
  // protocol and before the body is read, so a batch and a body over the limit get 429.
  it("answers 429 before 400 for a batch and before 413 for a body over the limit, without reading the body", async () => {
    setLimits({ rateBurst: 1, ratePerMinute: 1 });
    await sendMany(1);
    const large = inChunks(bodyOfSize(4 * MIB));

    const batch = await send(post([TOOLS_LIST, TOOLS_LIST]));
    const tooLarge = await send(post(large.stream));
    const tooLargeWithLength = await send(post(bodyOfSize(MIB + 1)));

    expect([batch.status, tooLarge.status, tooLargeWithLength.status]).toEqual([429, 429, 429]);
    expect(large.pulled()).toBe(0);
  });

  // mcp.md, "The connections": the rate limit comes before the check of
  // the role and the protocol, so the role is checked before the body: 403 before 413 and 400.
  it("answers 403 for a role that is too low before 413 for a body over the limit and 400 for a batch", async () => {
    roleTooLow();

    const batch = await send(post([toolCall(1, "read_page", { page: "a" }), toolCall(2, "read_page", { page: "b" })]));
    const tooLarge = await send(post(inChunks(bodyOfSize(4 * MIB)).stream));
    const tooLargeWithLength = await send(post(bodyOfSize(MIB + 1)));

    expect([batch.status, tooLarge.status, tooLargeWithLength.status]).toEqual([403, 403, 403]);
    expect(mocks.getPage).not.toHaveBeenCalled();
  });
});
