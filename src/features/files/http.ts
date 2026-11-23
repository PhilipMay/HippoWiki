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
// A `GET` or `HEAD` of the file address with the query `token` is a download by a signed link, which an AI app got
// through MCP (`link-service.ts`); the proxy lets it pass without a session cookie. It is checked by the token alone,
// with or without a session, and the session is not read; besides `token` its query may hold only `download`. Every
// failure answers the same not-found page as a file that does not exist, and the answer asks every cache not to keep a
// copy. The token is never logged.
//
// The upload address is left out of the proxy, because the proxy would buffer at most 10 MB of a body and cut the rest
// (`experimental.proxyClientMaxBodySize`). It checks the session itself, refuses a request from another site (an
// `Origin` other than the own, or `Sec-Fetch-Site: cross-site`), a user with the first password, an admin and a user
// who may not upload with the not-found page, and answers everything else as JSON (`UploadAnswer` of `forms.ts`).
//
// A `POST` of the upload address with the query `token` is an upload by a signed upload link, which an AI app got
// through MCP (`upload-link-service.ts`). It is checked by the token alone, with or without a session, and the session
// is not read; its query is exactly the one `token`, because every choice of the upload comes from the link. A request
// from another site is refused as in the browser, but one without `Origin`, as `curl` sends it, passes. A link that is
// broken, forged, expired or no longer accepted answers the same not-found page for every reason; the refusal of a
// valid link answers JSON with a message for the app (`UploadByLinkAnswer`). The token is never logged.

import { notFound } from "next/navigation";

import { getCurrentUser } from "@/features/auth/session";
import * as linkService from "@/features/files/link-service";
import * as uploadLinkService from "@/features/files/upload-link-service";
import { inBrowser, type BrowserActor } from "@/features/folder-roles/actors";
import {
  FOLDER_GONE_MESSAGE,
  TAB_GONE_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  uploadedFileState,
  type UploadAnswer,
  type UploadField,
} from "@/features/files/forms";
import { parseNumberParam } from "@/features/files/schema";
import * as fileService from "@/features/files/service";
import { ACCEPTED_TYPES_MESSAGE, FILE_TYPES, isImageType, type FileType } from "@/features/files/types";
import * as folderService from "@/features/folders/service";
import { embedLinkOf, wikiLinkOf } from "@/features/pages/wiki-link-target";
import { FILE_LINK_TOKEN_PARAM, filePath } from "@/lib/addresses";
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
 * The query of a download by a signed link: exactly one `token`, and at most one `download` without a value; `null`
 * for anything else, `version` included, because a link downloads only the version it names.
 */
function fileLinkQuery(url: URL): { token: string; download: boolean } | null {
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== FILE_LINK_TOKEN_PARAM && key !== "download")) return null;
  const tokens = url.searchParams.getAll(FILE_LINK_TOKEN_PARAM);
  const downloads = url.searchParams.getAll("download");
  const token = tokens[0];
  if (tokens.length !== 1 || token === undefined) return null;
  if (downloads.length > 1 || downloads.some((value) => value !== "")) return null;
  return { token, download: downloads.length === 1 };
}

/**
 * The answer with the content of a file: the type decided at the upload, the name in `Content-Disposition` (`inline`,
 * or `attachment` for a download), the caching and the SHA-256 as `ETag`, with 304 for a matching `If-None-Match` and
 * no content for `HEAD`. The headers that run nothing in a file come from `next.config.ts`.
 */
async function contentResponse(
  request: Request,
  content: fileService.FileContent,
  { download, cacheControl }: { download: boolean; cacheControl: string },
): Promise<Response> {
  const entityTag = `"${content.version.sha256}"`;
  const headers = new Headers({ "Cache-Control": cacheControl, ETag: entityTag });
  if (matchesEntityTag(request, entityTag)) {
    await content.blob.stream.cancel();
    return new Response(null, { status: 304, headers });
  }
  headers.set("Content-Type", FILE_TYPES[content.type].mimeType);
  headers.set("Content-Length", String(content.version.size));
  headers.set("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${content.name}"`);
  if (request.method === "HEAD") {
    await content.blob.stream.cancel();
    return new Response(null, { status: 200, headers });
  }
  return new Response(content.blob.stream, { status: 200, headers });
}

/**
 * Answers a `GET` or `HEAD` of the file address with the content of the file, `Cache-Control: private, no-cache`, so
 * that the browser checks the role again before it uses a copy. With the query `token` it is a download by a signed
 * link instead (`handleFileLinkRequest()`). Everything else shows the not-found page.
 */
export async function handleFileRequest(request: Request, segments: FileSegments): Promise<Response> {
  const url = new URL(request.url);
  // Decided by the query alone, before the session is read: a request with a token is checked by the token only.
  if (url.searchParams.has(FILE_LINK_TOKEN_PARAM)) return handleFileLinkRequest(request, segments, url);

  const actor = await sessionActor();
  const place = placeOf(segments);
  const query = fileQuery(url);
  if (!actor || !place || !query) notFound();

  const content = await fileService.getFileContent(actor, place.folder, place.tab, place.name, query.version);
  if (!content) {
    logger.debug({ actorId: actor.id, ...place, version: query.version }, "file not found at its address");
    notFound();
  }

  const response = await contentResponse(request, content, {
    download: query.download,
    cacheControl: "private, no-cache",
  });
  if (request.method !== "HEAD" && response.status === 200) {
    logger.debug({ actorId: actor.id, ...place, version: content.version.number }, "file sent");
  }
  return response;
}

/**
 * Answers a download by a signed link: the current version of the file, if the token is valid for it
 * (`getLinkedFileContent()` of the links service), with `Cache-Control: private, no-store`, so that no cache of a
 * browser or a proxy keeps a copy. Every `GET` and `HEAD` that sends the file is logged at `info` with the grant, the
 * user, the place and the version, because whoever holds the link may download; every failure answers the not-found
 * page of a missing file. Neither the last use of the grant nor the rate limit of MCP is touched.
 */
async function handleFileLinkRequest(request: Request, segments: FileSegments, url: URL): Promise<Response> {
  const place = placeOf(segments);
  const query = fileLinkQuery(url);
  if (!place || !query) {
    logger.info({ reason: "address" }, "file link refused");
    notFound();
  }

  const linked = await linkService.getLinkedFileContent(query.token, place.folder, place.tab, place.name);
  if (!linked) notFound();

  const { content, caller } = linked;
  const response = await contentResponse(request, content, {
    download: query.download,
    cacheControl: "private, no-store",
  });
  logger.info(
    {
      grantId: caller.connection.grantId,
      userId: caller.actor.id,
      ...place,
      version: content.version.number,
      method: request.method,
      status: response.status,
    },
    "file sent by link",
  );
  return response;
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
 * another site can make the browser of a logged-in user upload a file. With `withoutOrigin`, a request without
 * `Origin` passes as well, such as an upload by link that an app sends with `curl`, which no browser sends.
 */
function isOwnOrigin(request: Request, { withoutOrigin = false }: { withoutOrigin?: boolean } = {}): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return withoutOrigin;
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

/** A refused upload as JSON, with its status, the field it belongs to and the message. */
function refused(
  status: number,
  code: string,
  field: UploadField,
  message: string,
  file?: fileService.StoredFile,
): Response {
  const answer: UploadAnswer = { ok: false, code, field, message, ...(file ? { file: uploadedFileState(file) } : {}) };
  return Response.json(answer, { status });
}

/** The answer to the error of an upload that the service returned. */
function uploadRefusal(error: Exclude<fileService.UploadFileError, { code: "not-allowed" }>): Response {
  switch (error.code) {
    case "folder-not-found":
      return refused(404, error.code, null, FOLDER_GONE_MESSAGE);
    case "tab-not-found":
      return refused(404, error.code, null, TAB_GONE_MESSAGE);
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
    // The browser states no exact size, so its upload is never refused for one.
    case "wrong-size":
    case "failed":
      return refused(500, "failed", null, UPLOAD_FAILED_MESSAGE);
  }
}

/**
 * Answers the `POST` of an upload: stores its body as the file of the name at the place of the address, as a new
 * file or, with `?replace=<lock version>`, as a new version of the file of that name, and answers with the address of
 * its details page. The image is written again without its metadata unless the query says `strip=0`. With the query
 * `token` it is an upload by a signed link instead (`handleUploadLinkRequest()`).
 */
export async function handleUploadRequest(request: Request, segments: FileSegments): Promise<Response> {
  const url = new URL(request.url);
  // Decided by the query alone, before the session is read: a request with a token is checked by the token only.
  if (url.searchParams.has(FILE_LINK_TOKEN_PARAM)) return handleUploadLinkRequest(request, segments, url);

  if (!isOwnOrigin(request)) {
    logger.warn({ origin: request.headers.get("origin") }, "upload from another site refused");
    notFound();
  }
  const actor = await sessionActor();
  const place = placeOf(segments);
  const query = uploadQuery(url);
  if (!actor || !place || !query) notFound();

  const folder = await folderService.getFolderByName(actor, place.folder);
  if (!folder) notFound();
  let tabId: string | null = null;
  if (place.tab !== null) {
    const tab = await folderService.getTab(actor, place.folder, place.tab);
    if (!tab) return refused(404, "tab-not-found", null, TAB_GONE_MESSAGE);
    tabId = tab.id;
  }

  const uploaded = await fileService.uploadFile(actor, { folderId: folder.id, tabId }, place.name, bodyOf(request), {
    contentLength: contentLengthOf(request),
    stripMetadata: query.stripMetadata,
    replace: query.replace,
    size: null,
    fileId: null,
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

/** The token of an upload by link: exactly one `token` and no other query; `null` for anything else. */
function uploadLinkToken(url: URL): string | null {
  const keys = [...url.searchParams.keys()];
  const tokens = url.searchParams.getAll(FILE_LINK_TOKEN_PARAM);
  if (keys.length !== 1 || tokens.length !== 1) return null;
  return tokens[0] ?? null;
}

/**
 * The answer of an upload by link, as JSON: the file as stored, with what a page needs to show or link it, the same
 * texts as `read_file` of MCP gives; or why a valid link stored nothing, with what to do next.
 */
type UploadByLinkAnswer =
  | {
      ok: true;
      name: string;
      tab: string | null;
      type: FileType;
      /** The size of the stored version in bytes, of an image as written again without its metadata. */
      size: number;
      version: number;
      width: number | null;
      height: number | null;
      wikiLink: string;
      embedLink: string | null;
    }
  | { ok: false; code: string; message: string };

/** The refusal of an upload by a valid link, as JSON, with its status and the message for the app. */
function refusedByLink(status: number, code: string, message: string): Response {
  const answer: UploadByLinkAnswer = { ok: false, code, message };
  return Response.json(answer, { status });
}

/** What every refusal of an upload by a valid link adds: nothing of the file is kept. */
const NOTHING_STORED = "Nothing was stored.";

/**
 * The answer to the refusal of an upload by a valid link: the status of the upload in the browser for the same
 * reason, with a message for an AI app, which says why and what to do next.
 */
function uploadByLinkRefusal(error: Exclude<uploadLinkService.UploadByLinkError, { code: "not-accepted" }>): Response {
  switch (error.code) {
    case "tab-changed":
      return refusedByLink(
        404,
        error.code,
        `The tab of the link was renamed or deleted after the link was made. ${NOTHING_STORED} Use list_folder to ` +
          "see the tabs of the folder, and get a new link.",
      );
    case "name-taken":
      return refusedByLink(
        409,
        error.code,
        `A file of this name was stored at this place after the link was made, also by an upload by this link. ` +
          `${NOTHING_STORED} Read the file with read_file; to replace it, get a link for a new version with its ` +
          "lockVersion.",
      );
    case "file-changed":
      return refusedByLink(
        409,
        error.code,
        `The file was changed, moved, renamed or deleted after the link was made, also by an upload by this link. ` +
          `${NOTHING_STORED} Read the file again with read_file and decide what to do.`,
      );
    case "wrong-type":
      return refusedByLink(
        415,
        error.code,
        error.detected === null
          ? `The file is none of the accepted types: PNG, JPEG, GIF, WebP and PDF. ${NOTHING_STORED}`
          : `The file is a ${FILE_TYPES[error.detected].label}, but the link is for a name that ends in ` +
              `.${FILE_TYPES[error.expected].extension}. ${NOTHING_STORED} Get a link for a name that ends in ` +
              `.${FILE_TYPES[error.detected].extension}.`,
      );
    case "wrong-size":
      return refusedByLink(
        400,
        error.code,
        `The file does not have the size of ${error.expected} bytes that was stated for the link. ${NOTHING_STORED} ` +
          "Get a new link with the exact size of the file in bytes.",
      );
    case "too-large":
      return refusedByLink(
        413,
        error.code,
        `The file is larger than ${formatBytes(error.limit)}, the size limit of the wiki. ${NOTHING_STORED}`,
      );
    case "invalid-image":
      return refusedByLink(
        422,
        error.code,
        error.reason === "too-many-pixels"
          ? `The image has more than 100 megapixels, the limit. ${NOTHING_STORED}`
          : `The image could not be read as an image of its type; it may be damaged. ${NOTHING_STORED}`,
      );
    case "disk-full":
      return refusedByLink(
        507,
        error.code,
        `The file does not fit on the disk of the server. ${NOTHING_STORED} Try again later.`,
      );
    case "failed":
      return refusedByLink(500, error.code, `The file could not be stored. ${NOTHING_STORED} Try again later.`);
  }
}

/**
 * Answers an upload by a signed upload link: stores the body as the file of the link, if the token is valid for the
 * address (`uploadByLink()` of the upload links service), and answers `201` with the file as stored. A request from
 * another site, a query besides the one `token`, and a link that is broken, forged, expired or no longer accepted
 * answer the not-found page, the same for every reason; a valid link whose upload is refused answers JSON with the
 * reason. Every stored upload is logged at `info` with the grant, the user, the place and the version number, because
 * whoever holds the link may upload; neither the token nor the address with its query is logged. Neither the last use
 * of the grant nor the rate limit of MCP is touched.
 */
async function handleUploadLinkRequest(request: Request, segments: FileSegments, url: URL): Promise<Response> {
  if (!isOwnOrigin(request, { withoutOrigin: true })) {
    logger.warn({ origin: request.headers.get("origin") }, "upload from another site refused");
    notFound();
  }
  const place = placeOf(segments);
  const token = uploadLinkToken(url);
  if (!place || token === null) {
    logger.info({ reason: "address" }, "upload link refused");
    notFound();
  }

  const uploaded = await uploadLinkService.uploadByLink(
    token,
    place.folder,
    place.tab,
    place.name,
    bodyOf(request),
    contentLengthOf(request),
  );
  if (!uploaded.ok) {
    if (uploaded.error.code === "not-accepted") notFound();
    return uploadByLinkRefusal(uploaded.error);
  }

  revalidateContent();
  const { file, caller } = uploaded.value;
  const tab = file.tab?.name ?? null;
  logger.info(
    {
      grantId: caller.connection.grantId,
      userId: caller.actor.id,
      folder: file.folder.name,
      tab,
      name: file.name,
      version: file.version.number,
    },
    "file uploaded by link",
  );
  const answer: UploadByLinkAnswer = {
    ok: true,
    name: file.name,
    tab,
    type: file.type,
    size: file.version.size,
    version: file.version.number,
    width: file.version.width,
    height: file.version.height,
    wikiLink: wikiLinkOf({ tab, name: file.name }),
    embedLink: isImageType(file.type) ? embedLinkOf({ tab, name: file.name }) : null,
  };
  return Response.json(answer, { status: 201 });
}
