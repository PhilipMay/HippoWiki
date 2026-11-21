// The store of the contents of files: blobs on disk below the files directory (`HIPPOWIKI_FILES_DIR`), each kept by the
// SHA-256 of its bytes as `blobs/<first two hex digits>/<sha256>`, written through a temporary file in `tmp/` of the
// same directory, so that a blob is either complete or missing. Two uploads of the same content write the same blob, a
// revert writes none, and no blob is removed but one that a failed upload wrote and no version holds. Server only: it
// uses the file system of the server.

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, statfs } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";

import { SIGNATURE_LENGTH } from "@/features/files/types";
import { getServerEnv } from "@/lib/env";
import type { Result } from "@/lib/result";

/** Why files are off: no files directory is set, it is missing, or the server cannot write it. */
export type FilesOffReason = "not-set" | "missing" | "not-writable";

/** Whether the store can be used: the absolute path of the files directory, or why files are off. */
export type StoreState = { on: true; dir: string } | { on: false; reason: FilesOffReason; dir: string | null };

/** The directory of the temporary files of uploads, below the files directory. */
const TMP_DIR = "tmp";
/** The directory of the blobs, below the files directory. */
const BLOBS_DIR = "blobs";

/** A SHA-256 as the store names a blob by it: 64 lowercase hex digits. */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Whether the error is one of the file system with the given code, such as `ENOENT`. */
function hasCode(err: unknown, ...codes: string[]): boolean {
  return err instanceof Error && "code" in err && codes.includes(String(err.code));
}

/**
 * Checks whether the directory can hold the files: it is set, it exists, and the server can create `tmp/` and `blobs/`
 * in it and write a file there, which a probe file shows that is removed at once. A relative path is resolved against
 * the working directory of the server.
 */
export async function checkStore(dir: string | undefined): Promise<StoreState> {
  if (dir === undefined) return { on: false, reason: "not-set", dir: null };
  const absolute = resolve(dir);
  try {
    if (!(await stat(absolute)).isDirectory()) return { on: false, reason: "missing", dir: absolute };
  } catch {
    return { on: false, reason: "missing", dir: absolute };
  }
  try {
    await mkdir(join(absolute, TMP_DIR), { recursive: true });
    await mkdir(join(absolute, BLOBS_DIR), { recursive: true });
    const probe = join(absolute, TMP_DIR, `probe-${randomUUID()}`);
    const handle = await open(probe, "wx");
    await handle.close();
    await rm(probe, { force: true });
  } catch {
    return { on: false, reason: "not-writable", dir: absolute };
  }
  return { on: true, dir: absolute };
}

// The state is checked once per process and kept. It lives on `globalThis`, so that a module evaluated twice (a hot
// reload in development, or two bundles of the server) checks it once.
const globalForStore = globalThis as typeof globalThis & { hippowikiFileStore?: Promise<StoreState> };

/** The store of the server, from `HIPPOWIKI_FILES_DIR`, checked on first use and kept. */
export function getStore(): Promise<StoreState> {
  globalForStore.hippowikiFileStore ??= checkStore(getServerEnv().HIPPOWIKI_FILES_DIR);
  return globalForStore.hippowikiFileStore;
}

/** The path of the blob with the given SHA-256. Throws for anything else, so that no path leaves the directory. */
export function blobPath(dir: string, sha256: string): string {
  if (!SHA256_PATTERN.test(sha256)) throw new Error("not a SHA-256");
  return join(dir, BLOBS_DIR, sha256.slice(0, 2), sha256);
}

/** How many bytes the file system of the directory has free for the server. */
async function freeBytes(dir: string): Promise<number> {
  const { bavail, bsize } = await statfs(dir);
  return bavail * bsize;
}

/** A body is longer than the limit; thrown inside `receiveBlob()` to stop reading it. */
class TooLargeError extends Error {}

/** A received body in a temporary file, not yet a blob: its path, SHA-256, size and first bytes. */
export type StagedBlob = { path: string; sha256: string; size: number; head: Uint8Array };

/** A blob in the store: its SHA-256, size and first bytes. */
export type StoredBlob = { sha256: string; size: number; head: Uint8Array };

/** Why a body was not stored: it is longer than the limit, or it does not fit on the disk. */
export type ReceiveError = { code: "too-large" } | { code: "disk-full" };

/** What the store needs to know about a body before it reads it. */
type ReceiveOptions = {
  /** The most bytes the body may have. */
  limit: number;
  /** The length that the request announced in `Content-Length`, or `null` without one. It is not trusted. */
  contentLength: number | null;
};

/**
 * Reads the body into a temporary file of `tmp/`: counts its bytes and stops at the limit, hashes it while it reads and
 * keeps its first bytes for the detection of its type; then syncs the file to the disk. A `Content-Length` over the
 * limit is refused before anything is read, and the free space is checked before the first byte is written, against
 * the announced length when there is one. The bytes are counted, so a body without a length or with a false one is
 * held to the limit as well. On every failure, a full disk (`ENOSPC`) included, the temporary file is removed and
 * nothing is left; an error that is neither too large nor a full disk is thrown.
 */
export async function receiveBlob(
  dir: string,
  body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  { limit, contentLength }: ReceiveOptions,
): Promise<Result<StagedBlob, ReceiveError>> {
  if (contentLength !== null && contentLength > limit) return { ok: false, error: { code: "too-large" } };
  if ((await freeBytes(dir)) < Math.max(contentLength ?? 0, 1)) return { ok: false, error: { code: "disk-full" } };

  const path = join(dir, TMP_DIR, randomUUID());
  const hash = createHash("sha256");
  const head: number[] = [];
  let size = 0;
  const handle = await open(path, "wx");
  try {
    for await (const chunk of body) {
      size += chunk.length;
      if (size > limit) throw new TooLargeError();
      hash.update(chunk);
      if (head.length < SIGNATURE_LENGTH) head.push(...chunk.subarray(0, SIGNATURE_LENGTH - head.length));
      await handle.write(chunk);
    }
    await handle.sync();
  } catch (err) {
    await handle.close().catch(() => undefined);
    await rm(path, { force: true });
    if (err instanceof TooLargeError) return { ok: false, error: { code: "too-large" } };
    if (hasCode(err, "ENOSPC", "EDQUOT")) return { ok: false, error: { code: "disk-full" } };
    throw err;
  }
  await handle.close();
  return { ok: true, value: { path, sha256: hash.digest("hex"), size, head: Uint8Array.from(head) } };
}

/**
 * Turns a received body into the blob of its SHA-256: renames the temporary file into `blobs/<aa>/<sha256>`, or removes
 * it when that blob is there already, which holds the same bytes.
 */
export async function commitBlob(dir: string, staged: StagedBlob): Promise<StoredBlob> {
  const target = blobPath(dir, staged.sha256);
  await mkdir(dirname(target), { recursive: true });
  try {
    await stat(target);
    await rm(staged.path, { force: true });
  } catch (err) {
    if (!hasCode(err, "ENOENT")) throw err;
    await rename(staged.path, target);
  }
  return { sha256: staged.sha256, size: staged.size, head: staged.head };
}

/** Removes a received body that does not become a blob, such as an upload that was refused after it was read. */
export async function discardStaged(staged: StagedBlob): Promise<void> {
  await rm(staged.path, { force: true });
}

/** Stores the body as a blob, as `receiveBlob()` and then `commitBlob()` do. */
export async function writeBlob(
  dir: string,
  body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  options: ReceiveOptions,
): Promise<Result<StoredBlob, ReceiveError>> {
  const received = await receiveBlob(dir, body, options);
  if (!received.ok) return received;
  return { ok: true, value: await commitBlob(dir, received.value) };
}

/** Stores the bytes as a blob, such as an image written again without its metadata; only a full disk refuses them. */
export async function writeBytes(dir: string, bytes: Uint8Array): Promise<Result<StoredBlob, { code: "disk-full" }>> {
  const stored = await writeBlob(dir, [bytes], { limit: Number.MAX_SAFE_INTEGER, contentLength: bytes.length });
  if (stored.ok) return stored;
  return { ok: false, error: { code: "disk-full" } };
}

/** An open blob: its size and its bytes as a stream of the web, as a route handler sends them. */
export type OpenBlob = { size: number; stream: ReadableStream<Uint8Array> };

/** Opens the blob with the given SHA-256 for reading, or `null` when it is missing. */
export async function readBlob(dir: string, sha256: string): Promise<OpenBlob | null> {
  const path = blobPath(dir, sha256);
  try {
    const { size } = await stat(path);
    return { size, stream: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array> };
  } catch (err) {
    if (hasCode(err, "ENOENT")) return null;
    throw err;
  }
}

/**
 * Removes the blob of a failed upload unless a version holds it, which `isUsed` tells: another upload of the same
 * content may have stored a version of it meanwhile. A missing blob is no error.
 */
export async function removeBlobIfUnused(dir: string, sha256: string, isUsed: () => Promise<boolean>): Promise<void> {
  if (await isUsed()) return;
  await rm(blobPath(dir, sha256), { force: true });
}
