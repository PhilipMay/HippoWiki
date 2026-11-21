import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  /** When set, every write of a temporary file fails with this error after its first chunk. */
  writeError: null as NodeJS.ErrnoException | null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      let writes = 0;
      const write = handle.write.bind(handle) as (chunk: Uint8Array) => Promise<unknown>;
      return Object.assign(handle, {
        write: async (chunk: Uint8Array) => {
          writes += 1;
          if (mocks.writeError && writes > 1) throw mocks.writeError;
          return write(chunk);
        },
      });
    },
  };
});

import {
  blobPath,
  checkStore,
  commitBlob,
  discardStaged,
  readBlob,
  receiveBlob,
  removeBlobIfUnused,
  writeBlob,
  writeBytes,
} from "@/features/files/store";

let dir: string;

beforeEach(async () => {
  mocks.writeError = null;
  dir = await mkdtemp(join(tmpdir(), "hippowiki-store-"));
  await mkdir(join(dir, "tmp"));
});

afterEach(async () => {
  await chmod(dir, 0o700).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

/** A body of the bytes in chunks of the given size, as a request body streams in. */
async function* chunked(bytes: Uint8Array, size = 1000): AsyncGenerator<Uint8Array> {
  for (let start = 0; start < bytes.length; start += size) yield bytes.subarray(start, start + size);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Every file below the directory, as paths relative to it. */
async function filesIn(path: string): Promise<string[]> {
  const entries = await readdir(path, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(path.length));
}

const LIMIT = 10_000;
const AT_LIMIT = new Uint8Array(LIMIT).fill(7);

describe("checkStore", () => {
  it("is on for a directory the server can write, with tmp and blobs created and no probe left", async () => {
    await expect(checkStore(dir)).resolves.toEqual({ on: true, dir });
    expect((await readdir(dir)).sort()).toEqual(["blobs", "tmp"]);
    expect(await filesIn(dir)).toEqual([]);
  });

  it("is off without a directory", async () => {
    await expect(checkStore(undefined)).resolves.toEqual({ on: false, reason: "not-set", dir: null });
  });

  it("is off for a directory that is missing, and for a file in its place", async () => {
    await expect(checkStore(join(dir, "missing"))).resolves.toEqual({
      on: false,
      reason: "missing",
      dir: join(dir, "missing"),
    });
    await writeFile(join(dir, "plain"), "x");
    await expect(checkStore(join(dir, "plain"))).resolves.toMatchObject({ on: false, reason: "missing" });
  });

  it.skipIf(process.getuid?.() === 0)("is off for a directory the server cannot write", async () => {
    const readOnly = join(dir, "read-only");
    await mkdir(readOnly);
    await chmod(readOnly, 0o500);

    await expect(checkStore(readOnly)).resolves.toEqual({ on: false, reason: "not-writable", dir: readOnly });
    await chmod(readOnly, 0o700);
  });

  it("resolves a relative directory against the working directory", async () => {
    const state = await checkStore("files-that-do-not-exist");
    expect(state).toEqual({ on: false, reason: "missing", dir: join(process.cwd(), "files-that-do-not-exist") });
  });
});

describe("getStore", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as { hippowikiFileStore?: unknown }).hippowikiFileStore;
  });

  it("checks the directory of HIPPOWIKI_FILES_DIR on first use and keeps the result", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://hippowiki:hippowiki@localhost:5432/hippowiki");
    vi.stubEnv("HIPPOWIKI_FILES_DIR", dir);
    vi.resetModules();
    const { getStore } = await import("@/features/files/store");

    await expect(getStore()).resolves.toEqual({ on: true, dir });
    await rm(dir, { recursive: true, force: true });
    await expect(getStore()).resolves.toEqual({ on: true, dir });
  });
});

describe("writeBlob", () => {
  it("stores a file at the limit by its SHA-256, with its size and first bytes, and leaves nothing in tmp", async () => {
    const stored = await writeBlob(dir, chunked(AT_LIMIT), { limit: LIMIT, contentLength: LIMIT });

    expect(stored).toEqual({
      ok: true,
      value: { sha256: sha256(AT_LIMIT), size: LIMIT, head: AT_LIMIT.subarray(0, 12) },
    });
    const hash = sha256(AT_LIMIT);
    expect(await filesIn(dir)).toEqual([`/blobs/${hash.slice(0, 2)}/${hash}`]);
    expect(new Uint8Array(await readFile(blobPath(dir, hash)))).toEqual(AT_LIMIT);
  });

  it("refuses one byte more and leaves nothing in tmp and blobs", async () => {
    const bytes = new Uint8Array(LIMIT + 1);

    await expect(writeBlob(dir, chunked(bytes), { limit: LIMIT, contentLength: LIMIT + 1 })).resolves.toEqual({
      ok: false,
      error: { code: "too-large" },
    });
    await expect(writeBlob(dir, chunked(bytes), { limit: LIMIT, contentLength: null })).resolves.toEqual({
      ok: false,
      error: { code: "too-large" },
    });
    expect(await filesIn(dir)).toEqual([]);
  });

  it("refuses an announced length over the limit without reading the body", async () => {
    const body = { [Symbol.asyncIterator]: vi.fn() };

    await expect(writeBlob(dir, body, { limit: LIMIT, contentLength: LIMIT + 1 })).resolves.toEqual({
      ok: false,
      error: { code: "too-large" },
    });
    expect(body[Symbol.asyncIterator]).not.toHaveBeenCalled();
  });

  it("counts the bytes of a body without a length and of one with a false length", async () => {
    const over = new Uint8Array(LIMIT + 500);

    await expect(writeBlob(dir, chunked(over), { limit: LIMIT, contentLength: 10 })).resolves.toEqual({
      ok: false,
      error: { code: "too-large" },
    });
    const small = new Uint8Array([1, 2, 3]);
    const stored = await writeBlob(dir, chunked(small), { limit: LIMIT, contentLength: 9_000 });
    expect(stored).toMatchObject({ ok: true, value: { size: 3 } });
    expect(await filesIn(dir)).toHaveLength(1);
  });

  it("stores the same content twice as one blob", async () => {
    const first = await writeBlob(dir, chunked(AT_LIMIT), { limit: LIMIT, contentLength: null });
    const second = await writeBlob(dir, chunked(AT_LIMIT, 333), { limit: LIMIT, contentLength: null });

    expect(second).toEqual(first);
    expect(await filesIn(dir)).toHaveLength(1);
  });

  it("stores an empty body as a blob of size 0", async () => {
    const stored = await writeBlob(dir, chunked(new Uint8Array()), { limit: LIMIT, contentLength: 0 });

    expect(stored).toEqual({ ok: true, value: { sha256: sha256(new Uint8Array()), size: 0, head: new Uint8Array() } });
  });

  it("answers a full disk while it writes and leaves nothing", async () => {
    mocks.writeError = Object.assign(new Error("no space left on device"), { code: "ENOSPC" });

    await expect(writeBlob(dir, chunked(AT_LIMIT), { limit: LIMIT, contentLength: LIMIT })).resolves.toEqual({
      ok: false,
      error: { code: "disk-full" },
    });
    expect(await filesIn(dir)).toEqual([]);
  });

  it("refuses a body longer than the free space before it writes", async () => {
    const huge = Number.MAX_SAFE_INTEGER;

    await expect(writeBlob(dir, chunked(AT_LIMIT), { limit: huge, contentLength: huge })).resolves.toEqual({
      ok: false,
      error: { code: "disk-full" },
    });
    expect(await filesIn(dir)).toEqual([]);
  });

  it("throws any other error of the disk and leaves nothing", async () => {
    mocks.writeError = Object.assign(new Error("input/output error"), { code: "EIO" });

    await expect(writeBlob(dir, chunked(AT_LIMIT), { limit: LIMIT, contentLength: LIMIT })).rejects.toThrow(
      "input/output error",
    );
    expect(await filesIn(dir)).toEqual([]);
  });

  it("throws a failure of the body and leaves nothing", async () => {
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array([1, 2, 3]);
      throw new Error("the connection was closed");
    }

    await expect(writeBlob(dir, failing(), { limit: LIMIT, contentLength: null })).rejects.toThrow(
      "the connection was closed",
    );
    expect(await filesIn(dir)).toEqual([]);
  });
});

describe("receiveBlob, commitBlob and discardStaged", () => {
  it("keeps a received body in tmp until it is committed or discarded", async () => {
    const received = await receiveBlob(dir, chunked(AT_LIMIT), { limit: LIMIT, contentLength: null });
    if (!received.ok) throw new Error("not received");
    expect(await filesIn(join(dir, "tmp"))).toHaveLength(1);

    await discardStaged(received.value);
    expect(await filesIn(dir)).toEqual([]);

    const again = await receiveBlob(dir, chunked(AT_LIMIT), { limit: LIMIT, contentLength: null });
    if (!again.ok) throw new Error("not received");
    await commitBlob(dir, again.value);
    expect(await filesIn(dir)).toEqual([`/blobs/${again.value.sha256.slice(0, 2)}/${again.value.sha256}`]);
  });
});

describe("writeBytes", () => {
  it("stores the bytes as a blob of their SHA-256", async () => {
    const bytes = new Uint8Array([9, 8, 7]);

    await expect(writeBytes(dir, bytes)).resolves.toMatchObject({ ok: true, value: { sha256: sha256(bytes) } });
  });
});

describe("readBlob", () => {
  it("opens a stored blob with its size and its bytes", async () => {
    const stored = await writeBlob(dir, chunked(AT_LIMIT), { limit: LIMIT, contentLength: null });
    if (!stored.ok) throw new Error("not stored");

    const blob = await readBlob(dir, stored.value.sha256);
    expect(blob?.size).toBe(LIMIT);
    expect(new Uint8Array(await new Response(blob?.stream).arrayBuffer())).toEqual(AT_LIMIT);
  });

  it("answers null for a missing blob and throws for a name that is no SHA-256", async () => {
    await expect(readBlob(dir, "a".repeat(64))).resolves.toBeNull();
    await expect(readBlob(dir, "../../etc/passwd")).rejects.toThrow("not a SHA-256");
  });
});

describe("removeBlobIfUnused", () => {
  it("removes a blob that no version holds, and keeps one that a version holds", async () => {
    const stored = await writeBlob(dir, chunked(AT_LIMIT), { limit: LIMIT, contentLength: null });
    if (!stored.ok) throw new Error("not stored");

    await removeBlobIfUnused(dir, stored.value.sha256, () => Promise.resolve(true));
    expect(await filesIn(dir)).toHaveLength(1);

    await removeBlobIfUnused(dir, stored.value.sha256, () => Promise.resolve(false));
    expect(await filesIn(dir)).toEqual([]);
    await removeBlobIfUnused(dir, stored.value.sha256, () => Promise.resolve(false));
  });
});
