// The limits of the MCP addresses: one call per request (a JSON-RPC batch is refused), the body limit of a request and
// the rate limit per user. The servers of the tests keep the default limits. Every test connects a user of its own, so
// that it starts with a full budget and its requests do not count against the budget of the known user, which the
// other MCP specs use.
import type { APIRequestContext } from "@playwright/test";

import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";

import { NO_STORAGE_STATE } from "./support/auth";
import { createFolder, createGrant, createPage, createUser, getTestDb, resetTestDatabase } from "./support/database";
import { callTool, mcpPath, type McpConnection } from "./support/mcp";
import { ISSUER } from "./support/oauth";
import { expect, test } from "./support/test";

// An MCP client has no session cookie: it only has the access token of its grant.
test.use({ storageState: NO_STORAGE_STATE });

const MIB = 1024 * 1024;

/** The folder of the test and a user of its own who is Owner of it. */
let folder: Awaited<ReturnType<typeof createFolder>>;
let owner: Awaited<ReturnType<typeof createUser>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  owner = await createUser({ mustChangePassword: false });
  folder = await createFolder({ name: "projects", roles: [{ user: owner, role: "owner" }] });
});

/** A connection of the owner of the test to the folder with the given role. */
async function connect(role: "reader" | "writer"): Promise<McpConnection> {
  const { accessToken } = await createGrant({ owner, folder, role });
  return { address: mcpPath(folder, role), token: accessToken };
}

/** The headers of a client of the protocol of 2025 with the given token. */
function headersOf(token: string | null): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(token === null ? {} : { authorization: `Bearer ${token}` }),
  };
}

/** Sends the given body as it is, a text with its `Content-Length`, to the address of the connection. */
function postText(request: APIRequestContext, { address, token }: McpConnection, body: string) {
  return request.post(address, { headers: headersOf(token), data: body, maxRedirects: 0 });
}

/** A `tools/call` of `read_page` with the given id and page. */
function readPageCall(id: number, page: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name: "read_page", arguments: { page } } };
}

/** JSON as a client writes it that escapes every character beyond ASCII as `\uXXXX`, like `json.dumps` of Python. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u0080-￿]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** A `replace_page_content` of the page "plan" at version 1, padded with spaces to exactly the given number of bytes. */
function replaceOfSize(bytes: number): string {
  const message = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "replace_page_content", arguments: { page: "plan", version: 1, content: "# Replaced" } },
  });
  return message + " ".repeat(bytes - message.length);
}

/** The page "plan" of the folder as stored. */
function storedPlan() {
  return getTestDb().page.findFirstOrThrow({
    where: { folderId: folder.id, name: "plan" },
    select: { title: true, content: true, version: true },
  });
}

test.describe("a batch", () => {
  test("of two read_page calls at a Reader address is refused with 400 and -32600; one by one both work", async ({
    request,
  }) => {
    await createPage({ folder, name: "plan", content: "# Plan" });
    await createPage({ folder, name: "notes", content: "# Notes" });
    const reader = await connect("reader");

    const batch = await postText(request, reader, JSON.stringify([readPageCall(1, "plan"), readPageCall(2, "notes")]));
    const first = await callTool(request, reader, "read_page", { page: "plan" });
    const second = await callTool(request, reader, "read_page", { page: "notes" });

    expect(batch.status()).toBe(400);
    expect(await batch.json()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        message: "Invalid Request: batches are not supported. Send the calls one by one, each in a request of its own.",
      },
    });
    expect(first.structuredContent).toMatchObject({ name: "plan", title: "Plan" });
    expect(second.structuredContent).toMatchObject({ name: "notes", title: "Notes" });
  });
});

test.describe("the body limit", () => {
  test("a replace_page_content with content at the length limit of a page, every character escaped as \\uXXXX, fits and works", async ({
    request,
  }) => {
    await createPage({ folder, name: "plan", content: "# Plan" });
    const writer = await connect("writer");
    const heading = "# Big\n\n";
    const content = heading + "ä".repeat(CONTENT_MAX_LENGTH - heading.length);
    const body = asciiJson({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "replace_page_content", arguments: { page: "plan", version: 1, content } },
    });
    // Six bytes for each character beyond ASCII: about 600 KB, below the limit of 1 MiB.
    expect(body.length).toBeGreaterThan(6 * (CONTENT_MAX_LENGTH - heading.length));

    const response = await postText(request, writer, body);

    expect(response.status()).toBe(200);
    const { result } = (await response.json()) as { result: { isError?: boolean; structuredContent: unknown } };
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ name: "plan", title: "Big", version: 2 });
    expect(await storedPlan()).toEqual({ title: "Big", content, version: 2 });
  });

  test("a body of 1 MiB and one byte with a Content-Length is refused with 413, and the page is unchanged", async ({
    request,
  }) => {
    await createPage({ folder, name: "plan", content: "# Plan" });
    const writer = await connect("writer");
    const before = await storedPlan();

    const response = await postText(request, writer, replaceOfSize(MIB + 1));

    expect(response.status()).toBe(413);
    expect(await response.json()).toEqual({ error: "request_too_large" });
    expect(await storedPlan()).toEqual(before);
  });

  test("a body of 1 MiB and one byte sent in chunks is refused with 413, and the page is unchanged", async () => {
    await createPage({ folder, name: "plan", content: "# Plan" });
    const writer = await connect("writer");
    const before = await storedPlan();
    const encoded = new TextEncoder().encode(replaceOfSize(MIB + 1));
    const chunk = 64 * 1024;
    let offset = 0;
    // A stream without a `Content-Length`: `fetch` of Node.js sends it with `Transfer-Encoding: chunked`.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= encoded.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoded.subarray(offset, offset + chunk));
        offset += chunk;
      },
    });

    const response = await fetch(new URL(writer.address, ISSUER), {
      method: "POST",
      headers: headersOf(writer.token),
      body,
      duplex: "half",
    } as RequestInit);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "request_too_large" });
    expect(await storedPlan()).toEqual(before);
  });

  test("a body of exactly 1 MiB fits", async ({ request }) => {
    await createPage({ folder, name: "plan", content: "# Plan" });
    const writer = await connect("writer");

    const response = await postText(request, writer, replaceOfSize(MIB));

    expect(response.status()).toBe(200);
    expect(await storedPlan()).toMatchObject({ title: "Replaced", version: 2 });
  });
});

/** A list of the tools, the smallest request a connected app sends. */
const TOOLS_LIST = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

/** Sends lists of the tools, one after the other, `count` times, and returns the statuses of the answers. */
async function listMany(request: APIRequestContext, connection: McpConnection, count: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let index = 0; index < count; index += 1) {
    statuses.push((await postText(request, connection, TOOLS_LIST)).status());
  }
  return statuses;
}

test.describe("the rate limit", () => {
  test("lets at least 60 requests of a user pass, then answers 429 with Retry-After, and after the wait lets one pass", async ({
    request,
  }) => {
    const reader = await connect("reader");
    const started = Date.now();
    let passed = 0;
    let refused = await postText(request, reader, TOOLS_LIST);
    // A safe stop far above what the budget allows, so that a missing limit fails the test instead of hanging it.
    while (refused.status() === 200 && passed < 1000) {
      passed += 1;
      refused = await postText(request, reader, TOOLS_LIST);
    }
    const seconds = (Date.now() - started) / 1000;

    expect(refused.status()).toBe(429);
    expect(await refused.json()).toEqual({ error: "rate_limited" });
    // 60 at once, and five more a second for the time the requests took.
    expect(passed).toBeGreaterThanOrEqual(60);
    expect(passed).toBeLessThanOrEqual(60 + Math.ceil(5 * seconds));
    const retryAfter = Number(refused.headers()["retry-after"]);
    expect(retryAfter).toBeGreaterThanOrEqual(1);

    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));

    expect((await postText(request, reader, TOOLS_LIST)).status()).toBe(200);
  });

  test("shares one budget between the addresses of a user, and leaves another user unaffected", async ({ request }) => {
    const reader = await connect("reader");
    const writer = await connect("writer");
    const other = await createUser({ mustChangePassword: false });
    const othersFolder = await createFolder({ roles: [{ user: other, role: "owner" }] });
    const { accessToken } = await createGrant({ owner: other, folder: othersFolder, role: "reader" });
    const othersConnection = { address: mcpPath(othersFolder, "reader"), token: accessToken };

    const started = Date.now();
    const atTheReader = await listMany(request, reader, 30);
    const statusesAtTheWriter = [];
    let atTheWriter = await postText(request, writer, TOOLS_LIST);
    while (atTheWriter.status() === 200 && statusesAtTheWriter.length < 1000) {
      statusesAtTheWriter.push(atTheWriter.status());
      atTheWriter = await postText(request, writer, TOOLS_LIST);
    }
    const seconds = (Date.now() - started) / 1000;
    const ofTheOther = await postText(request, othersConnection, TOOLS_LIST);

    expect(atTheReader.every((status) => status === 200)).toBe(true);
    // The Writer address gets only what the 30 requests at the Reader address left of the budget, and the refill.
    expect(atTheWriter.status()).toBe(429);
    expect(statusesAtTheWriter.length).toBeGreaterThanOrEqual(30);
    expect(statusesAtTheWriter.length).toBeLessThanOrEqual(30 + Math.ceil(5 * seconds));
    expect(ofTheOther.status()).toBe(200);
  });

  test("lets 70 requests without a token and 70 with an invalid token get 401, and takes nothing from the budget", async ({
    request,
  }) => {
    const reader = await connect("reader");

    const withoutToken = await listMany(request, { address: reader.address, token: null }, 70);
    const withInvalidToken = await listMany(request, { address: reader.address, token: `hwa_${"A".repeat(43)}` }, 70);
    const afterwards = await listMany(request, reader, 60);

    expect(withoutToken.every((status) => status === 401)).toBe(true);
    expect(withInvalidToken.every((status) => status === 401)).toBe(true);
    expect(afterwards.every((status) => status === 200)).toBe(true);
  });
});
