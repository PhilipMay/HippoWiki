// The signed links to files that AI apps get through MCP: the key that signs them, the link that the MCP tool
// `get_file_download_link` hands out, and the read of a file by a link.
// A link carries everything needed to check it (`link-token.ts`), so handing one out stores nothing and nothing is
// cleaned up.
//
// A link follows the access of its connected app: it reads the file with the actor of MCP of its grant, so it passes
// only while the grant is accepted at its MCP address (`callerOfGrant()` of the grants service), only in the folder of
// the grant and with the lower of the role of the grant and the role of its user. It names the version of the file
// that was current when it was made, which never repeats, so a new version, a revert, a move, a rename and a delete
// each end it; a restore to the same place brings it back. The token of a link is never logged.
//
// The key is a key of its own, not the secret of the session cookies, so that a new key for the links logs nobody out.
// It is kept in the single row of `FileLinkKey`, generated on first use, so that all processes sign with the same key.
// Each process keeps the key in memory once read: deleting the row and restarting the server withdraws every link.

import { randomBytes } from "node:crypto";

import { inMcp, type McpActor } from "@/features/folder-roles/actors";
import { checkLinkToken, expiryOf, isWithinLifetime, signLinkToken } from "@/features/files/link-token";
import { getCurrentFileVersion, getFileContent, type FileContent } from "@/features/files/service";
import { getStore } from "@/features/files/store";
import { callerOfGrant, type McpCaller } from "@/features/grants/service";
import { getDb } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { Result } from "@/lib/result";
import type { FileType } from "@/features/files/types";

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

/** The current time. The one place the service takes it from, so that tests can set the clock. */
function currentTime(): Date {
  return new Date();
}

/** A link to the current version of a file, as the MCP tool hands it out: the file, the token and when it expires. */
export type FileLink = {
  name: string;
  tab: string | null;
  type: FileType;
  /** The size of the current version in bytes. */
  size: number;
  /** The token of the link, which the address of the file carries as its query `token`. */
  token: string;
  expiresAt: Date;
};

/**
 * `file-not-found`: no such file at the place for the actor, also a deleted one or one of another folder.
 * `files-off`: the files directory cannot be used, so no link could download anything.
 */
export type CreateFileLinkError = { code: "file-not-found" } | { code: "files-off" };

/**
 * A signed link to the current version of the file of the given name at the place, for the connection of the actor of
 * MCP. The file is read as `read_file` reads it, so a missing file, a deleted file and a file of another folder are
 * not found; while the files are off no link is made, because it could only answer 404. The link expires the
 * lifetime of the server from now, in whole seconds. Nothing is stored: the token carries the grant of the connection,
 * the id of the version and the expiry, signed with the key of the links.
 */
export async function createFileLink(
  actor: McpActor,
  folderName: string,
  tabName: string | null,
  fileName: string,
): Promise<Result<FileLink, CreateFileLinkError>> {
  const file = await getCurrentFileVersion(actor, folderName, tabName, fileName);
  if (!file) return { ok: false, error: { code: "file-not-found" } };
  if (!(await getStore()).on) return { ok: false, error: { code: "files-off" } };

  const exp = expiryOf(currentTime(), getServerEnv().HIPPOWIKI_FILE_LINK_LIFETIME);
  const token = signLinkToken(await getLinkKey(), { grant: actor.connection.grantId, version: file.version.id, exp });
  return {
    ok: true,
    value: {
      name: file.name,
      tab: file.tab?.name ?? null,
      type: file.type,
      size: file.version.size,
      token,
      expiresAt: new Date(exp * 1000),
    },
  };
}

/** The content of a file read by a signed link, and who the link acts for: the user and the connection of its grant. */
export type LinkedFileContent = { content: FileContent; caller: McpCaller };

/**
 * The content of the current version of the file of the given name at the place, read with the token of a signed link
 * instead of a session, or `null`. The checks run in this order, and each failure is logged with its reason and
 * without the token: the token itself, its shape, signature and data (`warn`, because only a broken or forged link
 * fails them), then its expiry against the lifetime of the server, the grant, whether the files are on, the file at
 * the place, read as the connected app would, and its current version against the version of the link (`info`,
 * because a link that no longer passes is expected).
 */
export async function getLinkedFileContent(
  token: string,
  folderName: string,
  tabName: string | null,
  fileName: string,
): Promise<LinkedFileContent | null> {
  const checked = checkLinkToken(await getLinkKey(), token);
  if (!checked.ok) {
    logger.warn({ reason: checked.reason }, "file link refused");
    return null;
  }
  const { grant: grantId, version: versionId, exp } = checked.data;
  if (!isWithinLifetime(exp, currentTime(), getServerEnv().HIPPOWIKI_FILE_LINK_LIFETIME)) {
    logger.info({ reason: "expired", grantId, exp }, "file link refused");
    return null;
  }
  const caller = await callerOfGrant(grantId);
  if (!caller) {
    logger.info({ reason: "grant", grantId }, "file link refused");
    return null;
  }
  // Without a usable files directory no content can be read; the link answers as a missing file does.
  if (!(await getStore()).on) {
    logger.info({ reason: "files-off", grantId }, "file link refused");
    return null;
  }
  const place = { folder: folderName, tab: tabName, name: fileName };
  const content = await getFileContent(inMcp(caller.actor, caller.connection), folderName, tabName, fileName, null);
  if (!content) {
    logger.info({ reason: "file", grantId, ...place }, "file link refused");
    return null;
  }
  if (content.version.id !== versionId) {
    await content.blob.stream.cancel();
    logger.info({ reason: "version", grantId, ...place, version: content.version.number }, "file link refused");
    return null;
  }
  return { content, caller };
}
