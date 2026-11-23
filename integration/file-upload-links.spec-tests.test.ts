// Tests of signed upload links written from the requirements alone (spec/signed-upload-links-requirements.md),
// against the real services, the real MCP tools and the test database: a link handed out by `get_file_upload_link`
// and the upload by it, as an app makes them. The other rules are checked by integration/file-upload-link-service.test.ts,
// src/features/mcp/tools.test.ts, src/features/files/http.test.ts and e2e/file-upload-links.spec.ts.
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inBrowser, inMcp, type McpActor } from "@/features/folder-roles/actors";
import { getLinkKey } from "@/features/files/link-service";
import * as fileService from "@/features/files/service";
import { createUploadLink, uploadByLink } from "@/features/files/upload-link-service";
import { createWikiServer } from "@/features/mcp/server";
import type { Folder, OAuthGrant, Tab, User } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";

import {
  createFile,
  createFolder,
  createGrant,
  createTab,
  createUser,
  getTestDb,
  testFilesDir,
} from "../e2e/support/database";
import { PHOTO_CAMERA, pdfBytes, phonePhoto, pngBytes } from "../e2e/support/files";
import { owners } from "./helpers";

/** The lifetime of the links that the server reads, in seconds; `null` for the one of `integration/setup.ts`. */
const lifetime = vi.hoisted(() => ({ seconds: null as number | null }));

// The environment of `integration/setup.ts`, with a lifetime of the links that a test can lower, as an operator does
// with HIPPOWIKI_FILE_LINK_LIFETIME before a restart.
vi.mock(import("@/lib/env"), async (importOriginal) => {
  const { TEST_DATABASE_URL } = await import("../e2e/support/container");
  const original = await importOriginal();
  const { FILE_LINK_LIFETIME, FILE_SIZE_LIMIT, MCP_BODY_LIMIT, MCP_RATE_BURST, MCP_RATE_PER_MINUTE } = original;
  return {
    ...original,
    getServerEnv: () => ({
      DATABASE_URL: TEST_DATABASE_URL,
      NODE_ENV: "test",
      HIPPOWIKI_LOG_CLIENT_ADDRESS: false,
      HIPPOWIKI_TRUSTED_PROXIES: 0,
      HIPPOWIKI_MCP_BODY_LIMIT: MCP_BODY_LIMIT.default,
      HIPPOWIKI_MCP_RATE_BURST: MCP_RATE_BURST.default,
      HIPPOWIKI_MCP_RATE_PER_MINUTE: MCP_RATE_PER_MINUTE.default,
      HIPPOWIKI_FILE_SIZE_LIMIT: FILE_SIZE_LIMIT.default,
      HIPPOWIKI_FILE_LINK_LIFETIME: lifetime.seconds ?? FILE_LINK_LIFETIME.default,
      HIPPOWIKI_PUBLIC_URL: "https://wiki.example.com",
      HIPPOWIKI_FILES_DIR: process.env.HIPPOWIKI_TEST_FILES_DIR,
    }),
  };
});

const PUBLIC_URL = "https://wiki.example.com";

/** A tool result as the server answers it. */
type ToolResult = { content: { type: string; text: string }[]; structuredContent?: unknown; isError?: boolean };

let user: User;
let folder: Folder;
let guides: Tab;
let grant: OAuthGrant;
/** The actor of MCP of the Writer connection of the grant. */
let actor: McpActor;

beforeEach(async () => {
  user = await createUser({ name: "alice", mustChangePassword: false });
  folder = await createFolder({ name: "handbook", editor: user, roles: owners(user) });
  guides = await createTab({ folder, name: "guides" });
  ({ grant } = await createGrant({ owner: user, folder, role: "writer" }));
  actor = inMcp(user, { grantId: grant.id, folderId: folder.id, role: "writer" });
});

afterEach(() => {
  lifetime.seconds = null;
  vi.useRealTimers();
});

/** Calls a tool of the connection of `actor` on a new server, as an MCP request does. */
async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const server = createWikiServer({ publicUrl: PUBLIC_URL, actor, folder: { id: folder.id, name: folder.name } });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(
    new Request(`${PUBLIC_URL}/mcp/${folder.id}/${actor.connection.role}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  await server.close();
  const answer = (await response.json()) as { result?: ToolResult; error?: unknown };
  expect(answer.result, `${name}: ${JSON.stringify(answer.error)}`).toBeDefined();
  return answer.result as ToolResult;
}

/** The structured result of a tool call that worked; fails the test otherwise. */
async function called(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await callTool(name, args);
  expect(result.isError, `${name}: ${result.content[0]?.text}`).toBeFalsy();
  return result.structuredContent as Record<string, unknown>;
}

/** The token of the upload link of a result of get_file_upload_link. */
function tokenOf(link: Record<string, unknown>): string {
  return new URL(String(link.uploadLink)).searchParams.get("token") ?? "";
}

/** Gets a link from the tool and sends the bytes by it, as one chunk with their length announced. */
async function uploadWithTool(args: { tab?: string; file: string; removeMetadata?: boolean }, bytes: Uint8Array) {
  const link = await called("get_file_upload_link", { ...args, size: bytes.length });
  return uploadByLink(tokenOf(link), "handbook", args.tab ?? null, args.file, [bytes], bytes.length);
}

/** The token of a link of the service for a new file of the given size directly in the folder. */
async function linkFor(name: string, size: number, linkActor: McpActor = actor): Promise<string> {
  const created = await createUploadLink(linkActor, "handbook", null, name, {
    size,
    lockVersion: null,
    stripMetadata: true,
  });
  if (!created.ok) return expect.fail(`no link: ${created.error.code}`);
  return created.value.token;
}

/** The bytes of the current version of the file at the place, as the store keeps them. */
async function storedBytes(tab: string | null, name: string): Promise<Buffer> {
  const content = await fileService.getFileContent(inBrowser(user), "handbook", tab, name, null);
  if (!content) throw new Error(`no content of ${name}`);
  return Buffer.from(await new Response(content.blob.stream).arrayBuffer());
}

/** Every file and version of the database, to compare before and after a refused upload. */
async function storedFiles() {
  return {
    files: await getTestDb().file.findMany({ orderBy: { id: "asc" } }),
    versions: await getTestDb().fileVersion.findMany({ orderBy: { id: "asc" } }),
  };
}

/** Every row of every table of the test database, as sorted JSON, to compare the whole database before and after. */
async function allRows(): Promise<Record<string, string[]>> {
  const db = getTestDb();
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  const rows: Record<string, string[]> = {};
  for (const { tablename } of tables) {
    const found = await db.$queryRawUnsafe<{ row: string }[]>(
      `SELECT row_to_json(t)::text AS row FROM "public"."${tablename.replaceAll('"', '""')}" AS t`,
    );
    rows[tablename] = found.map(({ row }) => row).sort();
  }
  return rows;
}

/** The names of all files below the directory of the blobs of the files directory. */
async function blobFiles(): Promise<string[]> {
  const entries = await readdir(join(testFilesDir(), "blobs"), { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

/** The token with another first character of its signature, as a forged link has it. */
function forged(token: string): string {
  const [data = "", signature = ""] = token.split(".");
  return `${data}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
}

/** Splits the bytes into chunks of the given length, as a body arrives over the network. */
function* chunksOf(bytes: Uint8Array, length: number): Generator<Uint8Array> {
  for (let start = 0; start < bytes.length; start += length) yield bytes.subarray(start, start + length);
}

describe("get_file_upload_link and the upload by its link", () => {
  // spec/signed-upload-links-requirements.md, R20: handing out a link stores nothing
  it("handing out a link for a new file and for a new version writes no row to the database", async () => {
    const manual = await createFile({ folder, name: "manual.pdf", editor: user });
    await getLinkKey();
    const before = await allRows();

    await called("get_file_upload_link", { tab: "guides", file: "diagram.png", size: 100 });
    await called("get_file_upload_link", { file: "manual.pdf", size: 100, lockVersion: manual.lockVersion });

    expect(await allRows()).toEqual(before);
  });

  // spec/signed-upload-links-requirements.md, R13: the choice is on unless the app turns it off
  it("an image uploaded by a link made without the choice of the metadata has no location and camera data", async () => {
    const photo = await phonePhoto();

    await expect(uploadWithTool({ file: "photo.jpg" }, photo)).resolves.toMatchObject({ ok: true });

    const stored = await storedBytes(null, "photo.jpg");
    expect(stored.toString("latin1")).not.toContain(PHOTO_CAMERA);
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
  });

  // spec/signed-upload-links-requirements.md, R13: the link carries the choice, and the upload follows it
  it("an image uploaded by a link made with the choice turned off keeps the bytes as sent", async () => {
    const photo = await phonePhoto();

    await expect(
      uploadWithTool({ tab: "guides", file: "photo.jpg", removeMetadata: false }, photo),
    ).resolves.toMatchObject({ ok: true });

    expect(await storedBytes("guides", "photo.jpg")).toEqual(photo);
  });

  // spec/signed-upload-links-requirements.md, R13: a PDF is always stored byte for byte
  it("a PDF uploaded by a link made with the choice turned on is stored byte for byte", async () => {
    const pdf = pdfBytes("A PDF with its own metadata");

    await expect(uploadWithTool({ file: "manual.pdf", removeMetadata: true }, pdf)).resolves.toMatchObject({
      ok: true,
    });

    expect(await storedBytes(null, "manual.pdf")).toEqual(pdf);
  });

  // spec/signed-upload-links-requirements.md, R6: the user of the connection and MCP in list_folder and read_file
  it("list_folder and read_file show the user of the connection and the channel mcp for a file uploaded by link", async () => {
    await createFile({ tab: guides, name: "manual.pdf", editor: await createUser({ name: "bob" }) });
    const read = await called("read_file", { tab: "guides", file: "manual.pdf" });
    const second = pdfBytes("The second version");
    const link = await called("get_file_upload_link", {
      tab: "guides",
      file: "manual.pdf",
      size: second.length,
      lockVersion: read.lockVersion,
    });
    await expect(
      uploadByLink(tokenOf(link), "handbook", "guides", "manual.pdf", [second], second.length),
    ).resolves.toMatchObject({ ok: true });

    const listed = (await called("list_folder", {})) as { files: Record<string, unknown>[] };
    expect(listed.files.find((file) => file.name === "manual.pdf")).toMatchObject({
      lastEditedBy: "alice",
      lastEditedVia: "mcp",
    });
    expect(await called("read_file", { tab: "guides", file: "manual.pdf" })).toMatchObject({
      lastEditedBy: "alice",
      lastEditedVia: "mcp",
      versions: 2,
    });
  });

  // spec/signed-upload-links-requirements.md, R5: the same content stored once
  it("an upload by link of the content of another file stores that content once", async () => {
    const bytes = pdfBytes("The same content");
    const existing = await createFile({ folder, name: "manual.pdf", editor: user, versions: [{ bytes }] });
    const blobsBefore = await blobFiles();

    await expect(uploadWithTool({ tab: "guides", file: "copy.pdf" }, bytes)).resolves.toMatchObject({ ok: true });

    expect(await blobFiles()).toEqual(blobsBefore);
    const copy = await getTestDb().fileVersion.findFirstOrThrow({ where: { file: { name: "copy.pdf" } } });
    expect(copy.sha256).toBe(existing.versions[0]?.sha256);
  });
});

describe("the size and the type of an upload by link", () => {
  // spec/signed-upload-links-requirements.md, R12: the bytes are counted, whatever the request announces
  it("refuses a body with one byte more than stated although the request announces the stated size, and stores nothing", async () => {
    const bytes = await pngBytes();
    const token = await linkFor("diagram.png", bytes.length);
    const before = await storedFiles();

    const longer = Buffer.concat([bytes, Buffer.from([0])]);
    await expect(
      uploadByLink(token, "handbook", null, "diagram.png", chunksOf(longer, 64), bytes.length),
    ).resolves.toMatchObject({ ok: false, error: { code: "wrong-size" } });

    expect(await storedFiles()).toEqual(before);
  });

  // spec/signed-upload-links-requirements.md, R12: the bytes are counted, whatever the request announces
  it("refuses a body with one byte less than stated although the request announces the stated size, and stores nothing", async () => {
    const bytes = await pngBytes();
    const token = await linkFor("diagram.png", bytes.length);
    const before = await storedFiles();

    await expect(
      uploadByLink(token, "handbook", null, "diagram.png", chunksOf(bytes.subarray(0, -1), 64), bytes.length),
    ).resolves.toMatchObject({ ok: false, error: { code: "wrong-size" } });

    expect(await storedFiles()).toEqual(before);
  });

  // spec/signed-upload-links-requirements.md, R12: the bytes are counted, whatever the request announces
  it("refuses a body without an announced length that runs past the stated size, and stores nothing", async () => {
    const bytes = await pngBytes();
    const token = await linkFor("diagram.png", bytes.length);
    const before = await storedFiles();

    const longer = Buffer.concat([bytes, Buffer.alloc(1000)]);
    await expect(
      uploadByLink(token, "handbook", null, "diagram.png", chunksOf(longer, 100), null),
    ).resolves.toMatchObject({ ok: false, error: { code: "wrong-size" } });

    expect(await storedFiles()).toEqual(before);
  });

  // spec/signed-upload-links-requirements.md, R12: a file of exactly the stated size is taken
  it("stores a body of exactly the stated size that arrives in many chunks without an announced length", async () => {
    const bytes = await pngBytes(30, 20);
    const token = await linkFor("diagram.png", bytes.length);

    await expect(uploadByLink(token, "handbook", null, "diagram.png", chunksOf(bytes, 7), null)).resolves.toMatchObject(
      { ok: true, value: { file: { version: { width: 30, height: 20 } } } },
    );
  });

  // spec/signed-upload-links-requirements.md, R12: only a file of the type of its extension
  it("refuses a PNG sent by a link for a .jpg name, and stores nothing", async () => {
    const png = await pngBytes();
    const token = await linkFor("photo.jpg", png.length);
    const before = await storedFiles();

    await expect(uploadByLink(token, "handbook", null, "photo.jpg", [png], png.length)).resolves.toMatchObject({
      ok: false,
      error: { code: "wrong-type" },
    });

    expect(await storedFiles()).toEqual(before);
  });
});

describe("the validity of an upload link", () => {
  // spec/signed-upload-links-requirements.md, R18: a lower lifetime also shortens the links already handed out
  it("refuses a link older than a lifetime lowered after it was handed out, and stores nothing", async () => {
    const bytes = await pngBytes();
    const token = await linkFor("diagram.png", bytes.length);

    lifetime.seconds = 60;
    vi.useFakeTimers({ now: Date.now() + 120_000, toFake: ["Date"] });

    await expect(uploadByLink(token, "handbook", null, "diagram.png", [bytes], bytes.length)).resolves.toStrictEqual({
      ok: false,
      error: { code: "not-accepted" },
    });
    expect(await getTestDb().file.count()).toBe(0);
  });

  // spec/signed-upload-links-requirements.md, R18: a link lives as long as the lifetime set by the operator
  it("takes a link handed out under a lowered lifetime before it expires", async () => {
    lifetime.seconds = 60;
    const bytes = await pngBytes();
    const token = await linkFor("diagram.png", bytes.length);
    vi.useFakeTimers({ now: Date.now() + 50_000, toFake: ["Date"] });

    await expect(uploadByLink(token, "handbook", null, "diagram.png", [bytes], bytes.length)).resolves.toMatchObject({
      ok: true,
    });
  });

  // spec/signed-upload-links-requirements.md, R8: the role on the folder lowered below the role of the grant
  it("refuses the link of a Manager connection once the role of its user is lowered to Writer, and stores nothing", async () => {
    const { grant: managerGrant } = await createGrant({ owner: user, folder, role: "manager" });
    const manager = inMcp(user, { grantId: managerGrant.id, folderId: folder.id, role: "manager" });
    const bytes = await pngBytes();
    const token = await linkFor("diagram.png", bytes.length, manager);

    await getTestDb().folderRole.update({
      where: { folderId_userId: { folderId: folder.id, userId: user.id } },
      data: { role: "writer" },
    });

    await expect(uploadByLink(token, "handbook", null, "diagram.png", [bytes], bytes.length)).resolves.toStrictEqual({
      ok: false,
      error: { code: "not-accepted" },
    });
    expect(await getTestDb().file.count()).toBe(0);
  });

  // spec/signed-upload-links-requirements.md, R8: a link works while its app may still upload into the folder
  it("takes the link of a Writer connection once the role of its user is lowered to the role of the grant", async () => {
    const bytes = await pngBytes();
    const token = await linkFor("diagram.png", bytes.length);

    await getTestDb().folderRole.update({
      where: { folderId_userId: { folderId: folder.id, userId: user.id } },
      data: { role: "writer" },
    });

    await expect(uploadByLink(token, "handbook", null, "diagram.png", [bytes], bytes.length)).resolves.toMatchObject({
      ok: true,
    });
  });
});

describe("the log of upload links", () => {
  const LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

  /** Watches every level of the logger of the server, and gives the lines of each level that were written since. */
  function watchLog(): Record<(typeof LEVELS)[number], unknown[][]> {
    const spies = Object.fromEntries(LEVELS.map((level) => [level, vi.spyOn(logger, level)]));
    return new Proxy({} as Record<(typeof LEVELS)[number], unknown[][]>, {
      get: (_target, level: string) => spies[level]?.mock.calls ?? [],
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // spec/signed-upload-links-requirements.md, R11: never the token, of the tool call, an upload, a refused upload or
  // an error
  it("writes no part of the token of a link, for the tool call, an upload, a refused upload and a forged link", async () => {
    const log = watchLog();
    const bytes = await pngBytes();

    const link = await called("get_file_upload_link", { tab: "guides", file: "diagram.png", size: bytes.length });
    const token = tokenOf(link);
    const [data = "", signature = ""] = token.split(".");
    await expect(
      uploadByLink(token, "handbook", "guides", "diagram.png", [bytes], bytes.length),
    ).resolves.toMatchObject({ ok: true });
    // Refused: the name is taken now, the size is not the stated one, and a forged signature.
    await uploadByLink(token, "handbook", "guides", "diagram.png", [bytes], bytes.length);
    await uploadByLink(token, "handbook", "guides", "diagram.png", [bytes.subarray(1)], bytes.length - 1);
    await uploadByLink(forged(token), "handbook", "guides", "diagram.png", [bytes], 1);

    const written = JSON.stringify(LEVELS.map((level) => log[level]));
    expect(written.length).toBeGreaterThan(2);
    expect(written).not.toContain(data.slice(0, 24));
    expect(written).not.toContain(data.slice(-24));
    expect(written).not.toContain(signature.slice(0, 24));
    expect(written).not.toContain(signature.slice(-24));
  });

  // spec/signed-upload-links-requirements.md, R23: a forged link is logged at warn with its reason
  it("logs a forged link in one line at warn with its reason", async () => {
    const bytes = await pngBytes();
    const token = await linkFor("diagram.png", bytes.length);
    const log = watchLog();

    await uploadByLink(forged(token), "handbook", null, "diagram.png", [bytes], bytes.length);

    expect(log.warn).toHaveLength(1);
    expect(log.warn[0]?.[0]).toMatchObject({ reason: expect.any(String) });
    expect(log.error).toHaveLength(0);
  });

  // spec/signed-upload-links-requirements.md, R23: at info when a valid link no longer passes
  it("logs an expired link at info with its reason, and nothing at warn", async () => {
    const bytes = await pngBytes();
    const token = await linkFor("diagram.png", bytes.length);
    vi.useFakeTimers({ now: Date.now() + 601_000, toFake: ["Date"] });
    const log = watchLog();

    await uploadByLink(token, "handbook", null, "diagram.png", [bytes], bytes.length);

    expect(log.info).toHaveLength(1);
    expect(log.info[0]?.[0]).toMatchObject({ reason: expect.any(String) });
    expect(log.warn).toHaveLength(0);
  });

  // spec/signed-upload-links-requirements.md, R23: at info when the file of a valid link is refused
  it("logs the refusal of the file of a valid link at info with its reason, and nothing at warn", async () => {
    const bytes = await pngBytes();
    const token = await linkFor("diagram.png", bytes.length);
    const log = watchLog();

    await expect(
      uploadByLink(token, "handbook", null, "diagram.png", [bytes.subarray(1)], bytes.length - 1),
    ).resolves.toMatchObject({ ok: false, error: { code: "wrong-size" } });

    expect(log.info.map(([details]) => details)).toContainEqual(expect.objectContaining({ reason: "wrong-size" }));
    expect(log.warn).toEqual([]);
  });

  // spec/signed-upload-links-requirements.md, R23 and R20: a second upload by the same link no longer passes, at info
  it("logs the second upload by a link, refused because its name is taken, at info, and nothing at warn", async () => {
    const bytes = await pngBytes();
    const token = await linkFor("diagram.png", bytes.length);
    await expect(uploadByLink(token, "handbook", null, "diagram.png", [bytes], bytes.length)).resolves.toMatchObject({
      ok: true,
    });
    const log = watchLog();

    await expect(uploadByLink(token, "handbook", null, "diagram.png", [bytes], bytes.length)).resolves.toMatchObject({
      ok: false,
      error: { code: "name-taken" },
    });

    expect(log.info.map(([details]) => details)).toContainEqual(expect.objectContaining({ reason: "name-taken" }));
    expect(log.warn).toEqual([]);
  });
});
