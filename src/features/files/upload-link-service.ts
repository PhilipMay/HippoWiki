// The signed upload links that AI apps get through MCP: the link that the MCP tool `get_file_upload_link` hands out,
// and the upload of a file by such a link. A link carries everything needed to check it (`link-token.ts`): the grant,
// the place, the name, the exact size, the choice of the metadata and, for a new version, the file and its lock
// version. So handing one out stores nothing, and nothing is cleaned up. It is signed with the key of the download
// links and lives as long as they do (`getLinkKey()` of `link-service.ts`, `HIPPOWIKI_FILE_LINK_LIFETIME`), so that
// deleting the key withdraws both kinds at once; its own `use` keeps one kind from passing for the other.
//
// A link follows the access of its connected app: it uploads with the actor of MCP of its grant, so it passes only
// while the grant is accepted at its MCP address (`callerOfGrant()` of the grants service), only into the folder of
// the grant and with the lower of the role of the grant and the role of its user. It stores at most one upload: a link
// for a new file is refused once its name is taken, also by its own upload, and a link for a new version once the
// lock version of the file has changed, also by its own upload. The token of a link is never logged.

import { inMcp, type McpActor } from "@/features/folder-roles/actors";
import { getLinkKey } from "@/features/files/link-service";
import {
  checkUploadLinkToken,
  expiryOf,
  isWithinLifetime,
  signUploadLinkToken,
  type UploadLinkData,
} from "@/features/files/link-token";
import type { FileFieldErrors } from "@/features/files/schema";
import { checkUploadName, uploadFile, type UploadedFile, type UploadFileError } from "@/features/files/service";
import { getStore } from "@/features/files/store";
import { isImageType, typeOfExtension, type FileType } from "@/features/files/types";
import * as folderService from "@/features/folders/service";
import { callerOfGrant, type McpCaller } from "@/features/grants/service";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { FILE_EXTENSIONS, NAME_MAX_LENGTH, NAME_PATTERN } from "@/lib/name-limits";
import { parseFileName } from "@/lib/names";
import type { Failed, FolderNotFound, InvalidInput, NotAllowed, Result, TabNotFound } from "@/lib/result";

/** The current time. The one place the service takes it from, so that tests can set the clock. */
function currentTime(): Date {
  return new Date();
}

/** What an app states when it asks for an upload link, besides the place and the name. */
export type UploadLinkRequest = {
  /** The exact size of the file in bytes. */
  size: number;
  /** The lock version of the file that a new version is based on, as `read_file` gave it; `null` for a new file. */
  lockVersion: number | null;
  /** Whether an image is written again without its location and camera data; a PDF is always kept byte for byte. */
  stripMetadata: boolean;
};

/** An upload link as the MCP tool hands it out: the file it uploads, the token and when it expires. */
export type UploadLink = {
  name: string;
  tab: string | null;
  type: FileType;
  /** The exact size in bytes that the link takes. */
  size: number;
  /** The token of the link, which the upload address carries as its only query `token`. */
  token: string;
  expiresAt: Date;
};

/**
 * Why no upload link was handed out:
 * - `not-allowed`, `folder-not-found`, `tab-not-found`, `failed`: as for every content write;
 * - `invalid-input`: the name breaks the rule of file names, with the messages of the name field;
 * - `invalid-extension`: the name is one of the rule but for its extension, which is of no accepted type;
 * - `invalid-size`: the size is no whole number of bytes from 1 up;
 * - `too-large`: the size is over the size limit of the wiki, in bytes;
 * - `files-off`: the files directory cannot be used;
 * - `name-taken`: a new file, but a file of the name is at the place;
 * - `file-not-found`: a new version, but no file of the name is at the place;
 * - `file-changed`: a new version, but the file has another lock version than the stated one.
 */
export type CreateUploadLinkError =
  | NotAllowed
  | FolderNotFound
  | TabNotFound
  | InvalidInput<FileFieldErrors>
  | { code: "invalid-extension" }
  | { code: "invalid-size" }
  | { code: "too-large"; limit: number }
  | { code: "files-off" }
  | { code: "name-taken" }
  | { code: "file-not-found" }
  | { code: "file-changed" }
  | Failed;

/**
 * Whether a name that breaks the rule of file names breaks it only by its extension: a name of the rule, a dot and an
 * extension that is no extension of an accepted type, such as `diagram.svg` or `photo.jpeg`.
 */
function hasOtherExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  const base = name.slice(0, dot);
  const extension = name.slice(dot + 1);
  return (
    base.length <= NAME_MAX_LENGTH &&
    NAME_PATTERN.test(base) &&
    !(FILE_EXTENSIONS as readonly string[]).includes(extension)
  );
}

/**
 * A signed link that uploads one image or PDF of exactly the given size under the name at the place, for the
 * connection of the actor of MCP: a new file without `lockVersion`, a new version of the file of the name with it.
 * Everything that can be checked without the bytes is checked first, in the order of every content write: the folder,
 * the tab, which must be one of the folder, the role `editFile` and the name with its extension (`checkUploadName()`),
 * then the size against the size limit, whether the files are on, and the file of the name at the place: none for a
 * new file, and for a new version one with the stated lock version. The link expires the lifetime of the server from
 * now, in whole seconds. Nothing is stored: the token carries the grant, the place, the name, the size, the choice of
 * the metadata (never for a PDF), the file and its lock version, signed with the key of the links.
 */
export async function createUploadLink(
  actor: McpActor,
  folderName: string,
  tabName: string | null,
  fileName: string,
  request: UploadLinkRequest,
): Promise<Result<UploadLink, CreateUploadLinkError>> {
  const folder = await folderService.getFolderByName(actor, folderName);
  if (!folder) return { ok: false, error: { code: "folder-not-found" } };
  let tab: { id: string; name: string } | null = null;
  if (tabName !== null) {
    tab = await folderService.getTab(actor, folderName, tabName);
    if (!tab) return { ok: false, error: { code: "tab-not-found" } };
  }

  const checked = await checkUploadName(actor, { folderId: folder.id, tabId: tab?.id ?? null }, fileName);
  if (!checked.ok) {
    if (checked.error.code === "invalid-input" && hasOtherExtension(fileName.trim())) {
      return { ok: false, error: { code: "invalid-extension" } };
    }
    return checked;
  }
  // The name as the rule reads it, without surrounding whitespace, as the upload in the browser stores it.
  const name = parseFileName(fileName.trim());
  if (!name) return { ok: false, error: { code: "invalid-input", fieldErrors: {} } };

  const limit = getServerEnv().HIPPOWIKI_FILE_SIZE_LIMIT;
  if (!Number.isSafeInteger(request.size) || request.size < 1) return { ok: false, error: { code: "invalid-size" } };
  if (request.size > limit) return { ok: false, error: { code: "too-large", limit } };
  if (!(await getStore()).on) return { ok: false, error: { code: "files-off" } };

  const existing = checked.value;
  if (request.lockVersion === null && existing) return { ok: false, error: { code: "name-taken" } };
  if (request.lockVersion !== null) {
    if (!existing) return { ok: false, error: { code: "file-not-found" } };
    if (existing.lockVersion !== request.lockVersion) return { ok: false, error: { code: "file-changed" } };
  }

  const type = typeOfExtension(name.extension);
  const exp = expiryOf(currentTime(), getServerEnv().HIPPOWIKI_FILE_LINK_LIFETIME);
  const token = signUploadLinkToken(await getLinkKey(), {
    grant: actor.connection.grantId,
    tab: tab?.id ?? null,
    name: name.name,
    size: request.size,
    // A PDF is stored byte for byte, so its link carries no choice of the metadata.
    strip: isImageType(type) && request.stripMetadata,
    file: request.lockVersion === null ? null : (existing?.id ?? null),
    lockVersion: request.lockVersion,
    exp,
  });
  return {
    ok: true,
    value: {
      name: name.name,
      tab: tab?.name ?? null,
      type,
      size: request.size,
      token,
      expiresAt: new Date(exp * 1000),
    },
  };
}

/**
 * Why an upload by a link was refused:
 * - `not-accepted`: the link is broken, forged, expired or no longer accepted, or the address is not the one of the
 *   link; the upload address answers every one of them with the same plain not-found;
 * - `tab-changed`: the tab of the link was renamed or deleted;
 * - `name-taken`: a link for a new file, but a file of the name was uploaded in the meantime, also by the link itself;
 * - `file-changed`: a link for a new version, but the file was changed, moved, renamed or deleted in the meantime, also
 *   by an upload by the link itself;
 * - the refusals of the content by the upload itself (`uploadFile()`): the type, the size, the image, the disk.
 */
export type UploadByLinkError =
  | { code: "not-accepted" }
  | { code: "tab-changed" }
  | { code: "name-taken" }
  | { code: "file-changed" }
  | Extract<
      UploadFileError,
      { code: "wrong-type" | "wrong-size" | "too-large" | "disk-full" | "invalid-image" | "failed" }
    >;

/** A file uploaded by a link, and who the link acts for: the user and the connection of its grant. */
export type UploadedByLink = { file: UploadedFile; caller: McpCaller };

/** The refusal of a link that no longer passes, logged at `info` with its reason and without the token. */
function notAccepted(reason: string, details: Record<string, unknown>): { ok: false; error: { code: "not-accepted" } } {
  logger.info({ reason, ...details }, "upload link refused");
  return { ok: false, error: { code: "not-accepted" } };
}

/**
 * Uploads the body as the file of a signed upload link, with the token of the link instead of a session. The checks run
 * in this order, and each failure is logged with its reason and without the token: the token itself, its shape,
 * signature and data (`warn`, because only a broken or forged link fails them), then its expiry against the lifetime of
 * the server, the grant and whether the files are on (`info`, because a link that no longer passes is expected); then
 * the address, which must name the folder of the grant, the tab of the link and the name of the link. A tab of the
 * link that is gone or named otherwise than in the address is refused as `tab-changed`. The upload itself is that of
 * the browser (`uploadFile()`), as the actor of MCP of the grant, with the exact size, the choice of the metadata and,
 * for a new version, the file and the lock version of the link: a new file never becomes a new version of a file
 * uploaded under its name in the meantime. Its refusals are logged at `info` with their reason.
 */
export async function uploadByLink(
  token: string,
  folderName: string,
  tabName: string | null,
  fileName: string,
  body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  contentLength: number | null,
): Promise<Result<UploadedByLink, UploadByLinkError>> {
  const checked = checkUploadLinkToken(await getLinkKey(), token);
  if (!checked.ok) {
    logger.warn({ reason: checked.reason }, "upload link refused");
    return { ok: false, error: { code: "not-accepted" } };
  }
  const link: UploadLinkData = checked.data;
  const grantId = link.grant;
  if (!isWithinLifetime(link.exp, currentTime(), getServerEnv().HIPPOWIKI_FILE_LINK_LIFETIME)) {
    return notAccepted("expired", { grantId, exp: link.exp });
  }
  const caller = await callerOfGrant(grantId);
  if (!caller) return notAccepted("grant", { grantId });
  if (!(await getStore()).on) return notAccepted("files-off", { grantId });

  const place = { folder: folderName, tab: tabName, name: fileName };
  const actor = inMcp(caller.actor, caller.connection);
  if (fileName !== link.name) return notAccepted("address", { grantId, ...place });
  const folder = await folderService.getFolderByName(actor, folderName);
  if (!folder || folder.id !== caller.connection.folderId) return notAccepted("address", { grantId, ...place });
  if (link.tab === null && tabName !== null) return notAccepted("address", { grantId, ...place });
  if (link.tab !== null) {
    const tab = (await folderService.listTabs(actor, folder.id))?.find(({ id }) => id === link.tab);
    if (!tab || tab.name !== tabName) {
      logger.info({ reason: "tab-changed", grantId, ...place }, "upload link refused");
      return { ok: false, error: { code: "tab-changed" } };
    }
  }

  const uploaded = await uploadFile(actor, { folderId: folder.id, tabId: link.tab }, link.name, body, {
    contentLength,
    stripMetadata: link.strip,
    replace: link.lockVersion,
    size: link.size,
    fileId: link.file,
  });
  if (uploaded.ok) return { ok: true, value: { file: uploaded.value, caller } };

  return refusedUpload(uploaded.error, { grantId, ...place });
}

/** The refusal of the upload of a valid link, logged at `info` with its reason and without the token. */
function refusedUpload(
  error: UploadFileError,
  details: Record<string, unknown>,
): { ok: false; error: UploadByLinkError } {
  const refusal = (refused: UploadByLinkError) => {
    logger.info({ reason: refused.code, ...details }, "upload link refused");
    return { ok: false as const, error: refused };
  };
  switch (error.code) {
    // The checks of the link above make these unexpected: the access or the place ended just now.
    case "not-allowed":
    case "folder-not-found":
    case "invalid-input":
    case "files-off":
      return notAccepted(error.code, details);
    case "tab-not-found":
      return refusal({ code: "tab-changed" });
    case "name-taken":
      return refusal({ code: "name-taken" });
    // The file of a new version was changed, or deleted, moved or renamed, after the link was made.
    case "file-changed":
    case "file-not-found":
      return refusal({ code: "file-changed" });
    case "wrong-type":
    case "wrong-size":
    case "too-large":
    case "disk-full":
    case "invalid-image":
    case "failed":
      return refusal(error);
  }
}
