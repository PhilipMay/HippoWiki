// The signed links to files that AI apps get through MCP: the key that signs them. A link carries everything needed to
// check it (`link-token.ts`), so handing one out stores nothing and nothing is cleaned up.
//
// The key is a key of its own, not the secret of the session cookies, so that a new key for the links logs nobody out.
// It is kept in the single row of `FileLinkKey`, generated on first use, so that all processes sign with the same key.
// Each process keeps the key in memory once read: deleting the row and restarting the server withdraws every link.

import { randomBytes } from "node:crypto";

import { getDb } from "@/lib/db";

/** The id of the one row of `FileLinkKey`. */
const KEY_ROW_ID = 1;

/** The random bytes of the key: 256 bits, as long as the HMAC-SHA256 that it signs with. */
const KEY_BYTES = 32;

/**
 * The key from the single row of `FileLinkKey`. When there is no row yet, it stores a new random key; if another
 * process stored one first, that one is kept (`skipDuplicates`), and the stored key is read again, so that all
 * processes sign with the same key.
 */
async function readKey(): Promise<Buffer> {
  const db = getDb();
  const where = { id: KEY_ROW_ID };
  const existing = await db.fileLinkKey.findUnique({ where, select: { secret: true } });
  if (existing) return Buffer.from(existing.secret, "hex");

  await db.fileLinkKey.createMany({
    data: [{ id: KEY_ROW_ID, secret: randomBytes(KEY_BYTES).toString("hex") }],
    skipDuplicates: true,
  });
  const stored = await db.fileLinkKey.findUniqueOrThrow({ where, select: { secret: true } });
  return Buffer.from(stored.secret, "hex");
}

// The key is read once per process and kept. It lives on `globalThis`, so that a module evaluated twice (a hot reload
// in development, or two bundles of the server) reads it once.
const globalForLinks = globalThis as typeof globalThis & { hippowikiFileLinkKey?: Promise<Buffer> };

/** The key of the links, read on first use and kept for the life of the process. */
export function getLinkKey(): Promise<Buffer> {
  globalForLinks.hippowikiFileLinkKey ??= readKey().catch((err: unknown) => {
    // E.g. the database was not reachable: the next call tries again instead of keeping the failure.
    globalForLinks.hippowikiFileLinkKey = undefined;
    throw err;
  });
  return globalForLinks.hippowikiFileLinkKey;
}

/** Forgets the key in memory, as a restart of the server does; for the tests. */
export function forgetLinkKey(): void {
  globalForLinks.hippowikiFileLinkKey = undefined;
}
