// The adapter of the two route handlers of files: the address of a file itself, `/files/<folder>/[<tab>/]<name.ext>`,
// which sends the content of a file, and the upload address, `/api/uploads/<folder>/[<tab>/]<name.ext>`, which stores
// the body of a `POST` as a file. Both find the actor from the session (`getCurrentUser()`) and call the files service.
//
// The file address is behind `src/proxy.ts`, which sends a request without a session cookie to the login page. It
// answers everything that is not the content of a file the user may read with the not-found page: a session that is
// no longer valid, a user who still has the first password, an admin, a user without a role on the folder, a missing
// or deleted file, a version that does not exist, and any other query than `version` and `download`. So nobody learns
// from an address whether a file exists. The role is checked on every request, and every answer asks the browser to
// check again before it uses a copy, so that a removed role ends the access with the next request.
//
// The upload address is left out of the proxy, because the proxy would buffer at most 10 MB of a body and cut the rest
// (`experimental.proxyClientMaxBodySize`). It checks the session itself, refuses a request from another site (an
// `Origin` other than the own, or `Sec-Fetch-Site: cross-site`), a user with the first password, an admin and a user
// who may not upload with the not-found page, and answers everything else as JSON (`UploadAnswer` of `forms.ts`).

import { notFound } from "next/navigation";

import { getCurrentUser } from "@/features/auth/session";
import { inBrowser, type BrowserActor } from "@/features/folder-roles/actors";
import type { UploadAnswer, UploadField, UploadedFileState } from "@/features/files/forms";
import { parseNumberParam } from "@/features/files/schema";
import * as fileService from "@/features/files/service";
import { ACCEPTED_TYPES_MESSAGE, FILE_TYPES } from "@/features/files/types";
import * as folderService from "@/features/folders/service";
import { filePath } from "@/lib/addresses";
import { getServerEnv } from "@/lib/env";
import { formatBytes } from "@/lib/format";
import { logger } from "@/lib/logger";
import { revalidateContent } from "@/lib/revalidate";

/** The segments of a file address or an upload address after the prefix: the folder, then the tab and the name. */
export type FileSegments = { folder: string; path: string[] };

/** The place and the name of a file from the segments, or `null` for any other number of segments. */
function placeOf({ folder, path }: FileSegments): { folder: string; tab: string | null; name: string } | null {
  if (path.length === 1 && path[0] !== undefined) return { folder, tab: null, name: path[0] };
  if (path.length === 2 && path[0] !== undefined && path[1] !== undefined) {
    return { folder, tab: path[0], name: path[1] };
  }
  return null;
}

/** The user of the session as the actor of the browser, or `null` without one or with the first password still set. */
async function sessionActor(): Promise<BrowserActor | null> {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return null;
  return inBrowser(user);
}

/** The query of a file address read: the number of a version, and whether to download; `null` for anything else. */
function fileQuery(url: URL): { version: number | null; download: boolean } | null {
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== "version" && key !== "download")) return null;
  const versions = url.searchParams.getAll("version");
  const downloads = url.searchParams.getAll("download");
  if (versions.length > 1 || downloads.length > 1 || downloads.some((value) => value !== "")) return null;
  const version = versions.length === 0 ? null : parseNumberParam(versions[0]);
  if (versions.length === 1 && version === null) return null;
  return { version, download: downloads.length === 1 };
}

/** Whether the `If-None-Match` header of the request names the entity tag. */
function matchesEntityTag(request: Request, entityTag: string): boolean {
  const header = request.headers.get("if-none-match");
  if (header === null) return false;
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === entityTag || tag === "*");
}

/**
 * Answers a `GET` or `HEAD` of the file address with the content of the file: the type decided at the upload, the
 * name in `Content-Disposition` (`inline`, or `attachment` with `?download`), `Cache-Control: private, no-cache` and the
 * SHA-256 as `ETag`, with 304 for a matching `If-None-Match`. The headers that run nothing in a file come from
 * `next.config.ts`. Everything else shows the not-found page.
 */
export async function handleFileRequest(request: Request, segments: FileSegments): Promise<Response> {
  const actor = await sessionActor();
  const place = placeOf(segments);
  const query = fileQuery(new URL(request.url));
  if (!actor || !place || !query) notFound();

  const content = await fileService.getFileContent(actor, place.folder, place.tab, place.name, query.version);
  if (!content) {
    logger.debug({ actorId: actor.id, ...place, version: query.version }, "file not found at its address");
    notFound();
  }

  const entityTag = `"${content.version.sha256}"`;
  const headers = new Headers({
    "Cache-Control": "private, no-cache",
    ETag: entityTag,
  });
  if (matchesEntityTag(request, entityTag)) {
    await content.blob.stream.cancel();
    return new Response(null, { status: 304, headers });
  }
  headers.set("Content-Type", FILE_TYPES[content.type].mimeType);
  headers.set("Content-Length", String(content.version.size));
  headers.set("Content-Disposition", `${query.download ? "attachment" : "inline"}; filename="${content.name}"`);
  if (request.method === "HEAD") {
    await content.blob.stream.cancel();
    return new Response(null, { status: 200, headers });
  }
  logger.debug({ actorId: actor.id, ...place, version: content.version.number }, "file sent");
  return new Response(content.blob.stream, { status: 200, headers });
}

/** The host names that the page of an upload may be served from: the host of the request and the public URL. */
function ownHosts(request: Request): string[] {
  const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host")];
  const publicUrl = getServerEnv().HIPPOWIKI_PUBLIC_URL;
  if (publicUrl) hosts.push(new URL(publicUrl).host);
  return hosts.filter((host): host is string => host !== null && host !== "");
}

/**
 * Whether the upload comes from a page of the wiki itself. A browser sends `Origin` with every `POST` of `fetch()`;
 * it must name one of the own hosts, and `Sec-Fetch-Site` must not say that the request crosses sites. So no page of
 * another site can make the browser of a logged-in user upload a file.
 */
function isOwnOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return ownHosts(request).includes(host);
}

/** The query of an upload read: whether to keep the metadata, and the lock version of a new version; `null` else. */
function uploadQuery(url: URL): { stripMetadata: boolean; replace: number | null } | null {
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== "strip" && key !== "replace")) return null;
  const strips = url.searchParams.getAll("strip");
  const replaces = url.searchParams.getAll("replace");
  if (strips.length > 1 || replaces.length > 1 || strips.some((value) => value !== "0")) return null;
  const replace = replaces.length === 0 ? null : parseNumberParam(replaces[0]);
  if (replaces.length === 1 && replace === null) return null;
  return { stripMetadata: strips.length === 0, replace };
}

/** The length the request announces, or `null` without a valid one; the store counts the bytes all the same. */
function contentLengthOf(request: Request): number | null {
  const header = request.headers.get("content-length");
  if (header === null || !/^[0-9]{1,16}$/.test(header)) return null;
  return Number(header);
}

/**
 * The body of the request as the store reads it, chunk by chunk, and nothing without a body. When the store stops
 * reading, at the size limit, the rest of the body is cancelled instead of read.
 */
async function* bodyOf(request: Request): AsyncGenerator<Uint8Array> {
  if (request.body === null) return;
  const reader = request.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** What the dialog shows of the file of a taken name or of a file changed meanwhile. */
function fileState(file: fileService.StoredFile): UploadedFileState {
  return { lockVersion: file.lockVersion, updatedAt: file.updatedAt.toISOString(), lastEditedBy: file.lastEditedBy };
}

/** A refused upload as JSON, with its status, the field it belongs to and the message. */
function refused(
  status: number,
  code: string,
  field: UploadField,
  message: string,
  file?: fileService.StoredFile,
): Response {
  const answer: UploadAnswer = { ok: false, code, field, message, ...(file ? { file: fileState(file) } : {}) };
  return Response.json(answer, { status });
}

/** The message of a failed upload, also of an unexpected answer of the server. */
const UPLOAD_FAILED_MESSAGE = "The file could not be uploaded. Please try again.";

/** The answer to the error of an upload that the service returned. */
function uploadRefusal(error: Exclude<fileService.UploadFileError, { code: "not-allowed" }>): Response {
  switch (error.code) {
    case "folder-not-found":
      return refused(404, error.code, null, "This folder no longer exists.");
    case "tab-not-found":
      return refused(404, error.code, null, "This tab no longer exists.");
    case "invalid-input":
      return refused(400, error.code, "name", error.fieldErrors.name?.[0] ?? "The name is not valid.");
    case "name-taken":
      return refused(409, error.code, "name", "A file of this name exists here already.", error.file);
    case "file-changed":
      return refused(409, error.code, null, "The file was changed after you opened this dialog.", error.file);
    case "file-not-found":
      return refused(404, error.code, null, "This file no longer exists.");
    case "files-off":
      return refused(503, error.code, null, "Files cannot be uploaded: the server has no place to keep them.");
    case "wrong-type":
      return refused(
        415,
        error.code,
        "file",
        error.detected === null
          ? ACCEPTED_TYPES_MESSAGE
          : `The file is a ${FILE_TYPES[error.detected].label}, but the name ends in .${FILE_TYPES[error.expected].extension}: use a name that ends in .${FILE_TYPES[error.detected].extension}.`,
      );
    case "too-large":
      return refused(413, error.code, "file", `The file is larger than ${formatBytes(error.limit)}, the limit.`);
    case "disk-full":
      return refused(507, error.code, "file", "The file does not fit on the disk of the server. Nothing was stored.");
    case "invalid-image":
      return refused(
        422,
        error.code,
        "file",
        error.reason === "too-many-pixels"
          ? "The image has more than 100 megapixels, the limit."
          : "The image could not be read. It may be damaged.",
      );
    case "failed":
      return refused(500, error.code, null, UPLOAD_FAILED_MESSAGE);
  }
}

/**
 * Answers the `POST` of an upload: stores its body as the file of the name at the place of the address, as a new
 * file or, with `?replace=<lock version>`, as a new version of the file of that name, and answers with the address of
 * its details page. The image is written again without its metadata unless the query says `strip=0`.
 */
export async function handleUploadRequest(request: Request, segments: FileSegments): Promise<Response> {
  if (!isOwnOrigin(request)) {
    logger.warn({ origin: request.headers.get("origin") }, "upload from another site refused");
    notFound();
  }
  const actor = await sessionActor();
  const place = placeOf(segments);
  const query = uploadQuery(new URL(request.url));
  if (!actor || !place || !query) notFound();

  const folder = await folderService.getFolderByName(actor, place.folder);
  if (!folder) notFound();
  let tabId: string | null = null;
  if (place.tab !== null) {
    const tab = await folderService.getTab(actor, place.folder, place.tab);
    if (!tab) return refused(404, "tab-not-found", null, "This tab no longer exists.");
    tabId = tab.id;
  }

  const uploaded = await fileService.uploadFile(actor, { folderId: folder.id, tabId }, place.name, bodyOf(request), {
    contentLength: contentLengthOf(request),
    stripMetadata: query.stripMetadata,
    replace: query.replace,
  });
  if (!uploaded.ok) {
    // What an account may not change does not exist for it, as for every other write of the content.
    if (uploaded.error.code === "not-allowed") notFound();
    return uploadRefusal(uploaded.error);
  }

  revalidateContent();
  const file = uploaded.value;
  const answer: UploadAnswer = { ok: true, address: filePath(file.folder.name, file.tab?.name ?? null, file.name) };
  return Response.json(answer, { status: 201 });
}
