// The reads and writes of files: images and PDFs of a folder, placed directly in it or in one of its tabs, each with
// its versions. The service knows nothing about Next.js, forms or addresses, so that the browser (through `queries.ts`,
// `actions.ts` and the adapter of the upload and file addresses, `http.ts`) and any other caller can use it, also
// outside a request. It trusts no caller: ids, names and input are parsed here again.
//
// Every function takes the acting user with the channel of the call. An admin sees and changes no files: for an admin
// every read returns `null` and every write `not-allowed`, before anything else is checked and without asking the
// database. A user sees only the files of the folders with a role of the user on them; every role reads them, and an
// upload needs the role of `editFile` (`FUNCTION_ROLES` in `roles.ts`). A write stores the actor as the last editor of
// the file, with the channel of the write (`openContentWrite()` in `actors.ts`), and counts its lock version up.
//
// The contents are the blobs of the store (`store.ts`), kept by their SHA-256: an upload writes its blob before the
// transaction that stores the file and its version, and removes it again when that transaction fails and no version
// holds it. Without a usable store the files are off: the reads still list the files, but no content is read and every
// upload is refused.

import type { Role } from "@/features/folder-roles/roles";
import {
  channelOf,
  lookUp,
  openContentWrite,
  refusedByRole,
  unknownActor,
  type BrowserActor,
  type ContentActor,
  type Editor,
} from "@/features/folder-roles/actors";
import {
  folderRoleOf,
  mayReadFolder,
  mayReadTab,
  readableFolderWhere,
  readerOf,
  roleOf,
  roleOnFolderOfFile,
  roleSelection,
} from "@/features/folder-roles/service";
import { parseFolderId, parseTabId } from "@/features/folders/schema";
import { ImageBusyError, processImage } from "@/features/files/images";
import {
  fileExtensionMessage,
  parseFileId,
  parseLockVersion,
  uploadInputSchema,
  type FileFieldErrors,
} from "@/features/files/schema";
import {
  commitBlob,
  discardStaged,
  getStore,
  readBlob,
  receiveBlob,
  removeBlobIfUnused,
  writeBytes,
  type OpenBlob,
  type StagedBlob,
  type StoredBlob,
} from "@/features/files/store";
import { detectType, isImageType, typeOfExtension, type FileType } from "@/features/files/types";
import { softDeleteFileData } from "@/features/files/writes";
import { LINKS_TRANSACTION, lockFolderLinks, updateLinks, type LinkingPage } from "@/features/pages/links-service";
import { pageMoved } from "@/features/pages/wiki-links";
import { LAST_EDITOR_SELECT, withLastEditor, type LastEditor } from "@/features/users/records";
import type { ChangeChannel, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { FILE_NAME, isForeignKeyViolation, isUniqueViolation, LAST_EDITOR } from "@/lib/db-errors";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { parseFileName, parseName } from "@/lib/names";
import {
  invalidInput,
  type Failed,
  type FolderNotFound,
  type InvalidInput,
  type NameTaken,
  type NotAllowed,
  type Result,
  type TabNotFound,
} from "@/lib/result";

/** What the lists show of a file: its name, type and size, and when and by whom it was last changed. */
export type FileSummary = {
  id: string;
  name: string;
  type: FileType;
  size: number;
  updatedAt: Date;
  lastEditedBy: LastEditor;
};

/** A version of a file as its details page lists it. */
type FileVersionEntry = {
  number: number;
  size: number;
  /** The width and height of an image upright; `null` for a PDF. */
  width: number | null;
  height: number | null;
  createdAt: Date;
  /** Who uploaded the version or reverted to it, and how. */
  uploadedBy: LastEditor;
  /** The version a revert went back to; `null` for an upload. */
  revertedTo: number | null;
};

/**
 * A file with its folder and tab, the role of the actor on its folder, its current version and every version, newest
 * first: what its details page shows.
 */
export type FileWithPlace = {
  id: string;
  name: string;
  type: FileType;
  lockVersion: number;
  updatedAt: Date;
  lastEditedBy: LastEditor;
  folder: { id: string; name: string };
  tab: { id: string; name: string } | null;
  role: Role | null;
  versions: [FileVersionEntry, ...FileVersionEntry[]];
};

/**
 * A file as a write stored it, or as it is now when a write was refused: what an address is built from and what the
 * dialog of a refused change shows.
 */
export type StoredFile = {
  id: string;
  name: string;
  type: FileType;
  lockVersion: number;
  updatedAt: Date;
  lastEditedBy: LastEditor;
  folder: { name: string };
  tab: { name: string } | null;
};

/**
 * The content of a version of a file, as its address sends it. The id of the version is what a signed link names
 * (`link-service.ts`); the address itself sends only its number, SHA-256 and size.
 */
export type FileContent = {
  name: string;
  type: FileType;
  version: { id: string; number: number; sha256: string; size: number };
  blob: OpenBlob;
};

/** Another file of the place has the name; the upload may store a new version of it instead. */
type FileNameTaken = { code: "name-taken"; file: StoredFile };
/** The file was changed after the lock version the write is based on; the file as it is now. */
type FileChanged = { code: "file-changed"; file: StoredFile };
/** The file does not exist at the place, or is deleted. */
type FileNotFound = { code: "file-not-found" };
/**
 * The content is none of the accepted types (`detected` is `null`), or of another type than the extension of the name
 * gives (`expected`).
 */
type WrongType = { code: "wrong-type"; detected: FileType | null; expected: FileType };
/** The content is larger than the size limit of the server, in bytes. */
type TooLarge = { code: "too-large"; limit: number };
/** The content does not fit on the disk of the files directory; nothing of it is stored. */
type DiskFull = { code: "disk-full" };
/** The files directory is missing or cannot be written, so files are off. */
type FilesOff = { code: "files-off" };
/** The image does not decode as an image of its type, or it has more pixels than allowed. */
type InvalidImage = { code: "invalid-image"; reason: "unreadable" | "too-many-pixels" };
/** The content has fewer or more bytes than the exact size of the upload (`UploadOptions.size`); nothing is stored. */
type WrongSize = { code: "wrong-size"; expected: number };

export type UploadFileError =
  | NotAllowed
  | FolderNotFound
  | TabNotFound
  | InvalidInput<FileFieldErrors>
  | FileNameTaken
  | FileChanged
  | FileNotFound
  | FilesOff
  | WrongType
  | TooLarge
  | DiskFull
  | InvalidImage
  | WrongSize
  | Failed;

/** The options of an upload, besides its place, its name and its body. */
export type UploadOptions = {
  /** The length that the request announced, or `null` without one; the bytes are counted all the same. */
  contentLength: number | null;
  /** Whether to write an image again without the metadata of a photo, turned upright (`processImage()`). */
  stripMetadata: boolean;
  /**
   * `null` for a new file. For a new version of the file of the name at the place: the lock version of the file that
   * the upload is based on, as the dialog that asked whether to store a new version saw it.
   */
  replace: number | null;
  /**
   * The exact size of the content in bytes, or `null` for any size up to the size limit (the browser). With a size,
   * the body is read up to it, and a body with fewer or more bytes is refused with `wrong-size`, whatever the request
   * announced.
   */
  size: number | null;
  /**
   * The id of the file that a new version must be for, or `null` for the file of the name at the place, whichever it
   * is (the browser). Another file of the name is refused as `file-changed`.
   */
  fileId: string | null;
};

/** The version that an upload stored: its number, its size in bytes, and the width and height of an image. */
type UploadedVersion = { number: number; size: number; width: number | null; height: number | null };

/** A file as an upload stored it, with the version it stored. */
export type UploadedFile = StoredFile & { version: UploadedVersion };

/** The place of a file: its folder and the id of its tab, or `null` for a file placed directly in the folder. */
export type FilePlace = { folderId: string; tabId: string | null };

const VERSION_SELECT = {
  number: true,
  size: true,
  width: true,
  height: true,
  createdAt: true,
  revertedTo: true,
  via: true,
  user: { select: { username: true } },
} as const;

const STORED_FILE_SELECT = {
  id: true,
  name: true,
  type: true,
  lockVersion: true,
  updatedAt: true,
  ...LAST_EDITOR_SELECT,
  folder: { select: { name: true } },
  tab: { select: { name: true } },
} as const;

const SUMMARY_SELECT = {
  id: true,
  name: true,
  type: true,
  updatedAt: true,
  ...LAST_EDITOR_SELECT,
  versions: { select: { size: true }, orderBy: { number: "desc" }, take: 1 },
} as const;

/** A version as the reads return it, with who stored it as `LastEditor`. */
function versionEntry({
  user,
  via,
  ...version
}: {
  number: number;
  size: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
  revertedTo: number | null;
  via: ChangeChannel;
  user: { username: string };
}): FileVersionEntry {
  return { ...version, uploadedBy: { name: user.username, via } };
}

/** A file of a list with the size of its current version; every file has at least one version. */
function summaryOf(row: {
  id: string;
  name: string;
  type: FileType;
  updatedAt: Date;
  lastEditedBy: { username: string };
  lastEditedVia: ChangeChannel;
  versions: { size: number }[];
}): FileSummary {
  const { versions, ...rest } = withLastEditor(row);
  return { ...rest, size: versions[0]?.size ?? 0 };
}

/**
 * The files placed directly in the folder, by name; deleted files are left out. `null` for an admin and for a folder
 * without a role of the actor.
 */
export async function listFolderFiles(actor: ContentActor, folderId: string): Promise<FileSummary[] | null> {
  if (!(await mayReadFolder(actor, folderId))) return null;
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return [];
  const files = await getDb().file.findMany({
    where: { folderId: parsedFolderId, tabId: null, deletedAt: null },
    select: SUMMARY_SELECT,
    orderBy: { name: "asc" },
  });
  return files.map(summaryOf);
}

/**
 * The files of the tab, by name; deleted files are left out. `null` for an admin and for a tab of a folder without a
 * role of the actor.
 */
export async function listTabFiles(actor: ContentActor, tabId: string): Promise<FileSummary[] | null> {
  if (!(await mayReadTab(actor, tabId))) return null;
  const parsedTabId = parseTabId(tabId);
  if (!parsedTabId) return [];
  const files = await getDb().file.findMany({
    where: { tabId: parsedTabId, deletedAt: null },
    select: SUMMARY_SELECT,
    orderBy: { name: "asc" },
  });
  return files.map(summaryOf);
}

/**
 * A file of the folder as the Markdown editor and `list_folder` of MCP know it: its place, its type, the size, width
 * and height of its current version, its last change and its lock version, which a new version through MCP is based on.
 */
export type FolderFile = {
  name: string;
  type: FileType;
  tab: { name: string } | null;
  size: number;
  width: number | null;
  height: number | null;
  updatedAt: Date;
  lastEditedBy: LastEditor;
  lockVersion: number;
};

/**
 * Every file of the folder that is not deleted, placed directly in it or in one of its tabs, by name and then by tab,
 * with the size, width and height of its current version: what the editor shows and offers for links, and what
 * `list_folder` lists. `null` for an admin and for a folder without a role of the actor.
 */
export async function listAllFolderFiles(actor: ContentActor, folderId: string): Promise<FolderFile[] | null> {
  if (!(await mayReadFolder(actor, folderId))) return null;
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return [];
  const files = await getDb().file.findMany({
    where: { folderId: parsedFolderId, deletedAt: null },
    select: {
      name: true,
      type: true,
      updatedAt: true,
      lockVersion: true,
      ...LAST_EDITOR_SELECT,
      tab: { select: { name: true } },
      versions: { select: { size: true, width: true, height: true }, orderBy: { number: "desc" }, take: 1 },
    },
    orderBy: [{ name: "asc" }, { tab: { name: "asc" } }],
  });
  return files.map((row) => {
    const { versions, ...file } = withLastEditor(row);
    return {
      ...file,
      size: versions[0]?.size ?? 0,
      width: versions[0]?.width ?? null,
      height: versions[0]?.height ?? null,
    };
  });
}

/** The condition of a file at a place, by the names of its folder and tab, that is not deleted. */
function placedFileWhere(
  folder: string,
  tab: string | null,
  name: string,
  readable: NonNullable<ReturnType<typeof readableFolderWhere>>,
) {
  return {
    name,
    deletedAt: null,
    folder: { name: folder, ...readable },
    ...(tab === null ? { tabId: null } : { tab: { name: tab } }),
  };
}

/** The names of a place and a file parsed, or `null` when one of them is malformed. */
function parsedNames(
  folderName: string,
  tabName: string | null,
  fileName: string,
): { folder: string; tab: string | null; name: string } | null {
  const folder = parseName(folderName);
  const tab = tabName === null ? null : parseName(tabName);
  const name = parseFileName(fileName)?.name;
  if (!folder || !name || (tabName !== null && !tab)) return null;
  return { folder, tab, name };
}

/**
 * The file of the given name in the tab of the given name or, with `null`, placed directly in the folder of the given
 * name, with its folder, tab, the role of the actor and its versions, newest first. `null` for an admin, if a name is
 * malformed, the actor has no role on the folder or no such file exists there; a deleted file has no address, so it
 * is never found.
 */
export async function getFile(
  actor: ContentActor,
  folderName: string,
  tabName: string | null,
  fileName: string,
): Promise<FileWithPlace | null> {
  const reader = readerOf(actor);
  const readable = readableFolderWhere(actor);
  const names = parsedNames(folderName, tabName, fileName);
  if (!reader || !readable || !names) return null;
  const file = await getDb().file.findFirst({
    where: placedFileWhere(names.folder, names.tab, names.name, readable),
    select: {
      id: true,
      name: true,
      type: true,
      lockVersion: true,
      updatedAt: true,
      ...LAST_EDITOR_SELECT,
      folder: { select: { id: true, name: true, roles: roleSelection(reader) } },
      tab: { select: { id: true, name: true } },
      versions: { select: VERSION_SELECT, orderBy: { number: "desc" } },
    },
  });
  if (!file) return null;
  const { folder, versions, ...rest } = withLastEditor(file);
  const [newest, ...older] = versions.map(versionEntry);
  // Every file is stored with its first version, and versions are never removed.
  if (!newest) return null;
  return {
    ...rest,
    folder: { id: folder.id, name: folder.name },
    role: roleOf(folder, actor),
    versions: [newest, ...older],
  };
}

/**
 * The content of the file of the given name at the place, of the version with the given number or, with `null`, of
 * its current version: its name, type, the version and the open blob. `null` for an admin, if a name is malformed,
 * the actor has no role on the folder, no such file or version exists, the file is deleted, the files are off or its
 * blob is missing.
 */
export async function getFileContent(
  actor: ContentActor,
  folderName: string,
  tabName: string | null,
  fileName: string,
  versionNumber: number | null,
): Promise<FileContent | null> {
  const readable = readableFolderWhere(actor);
  const names = parsedNames(folderName, tabName, fileName);
  if (!readable || !names) return null;
  const file = await getDb().file.findFirst({
    where: placedFileWhere(names.folder, names.tab, names.name, readable),
    select: {
      name: true,
      type: true,
      versions: {
        select: { id: true, number: true, sha256: true, size: true },
        where: versionNumber === null ? {} : { number: versionNumber },
        orderBy: { number: "desc" },
        take: 1,
      },
    },
  });
  const version = file?.versions[0];
  if (!file || !version) return null;
  const store = await getStore();
  if (!store.on) return null;
  const blob = await readBlob(store.dir, version.sha256);
  if (!blob) {
    logger.error({ fileName: file.name, version: version.number }, "blob of file version missing");
    return null;
  }
  return { name: file.name, type: file.type, version, blob };
}

/** The current version of a file, as a signed link to it names it (`link-service.ts`). */
export type CurrentFileVersion = {
  name: string;
  type: FileType;
  tab: { name: string } | null;
  version: { id: string; number: number; size: number };
};

/**
 * The current version of the file of the given name at the place, with the name, type and tab of the file, as
 * `getFile()` finds it. `null` for an admin, if a name is malformed, the actor has no role on the folder or no such
 * file exists there; a deleted file is never found. It reads no content, so it does not depend on the files directory.
 */
export async function getCurrentFileVersion(
  actor: ContentActor,
  folderName: string,
  tabName: string | null,
  fileName: string,
): Promise<CurrentFileVersion | null> {
  const readable = readableFolderWhere(actor);
  const names = parsedNames(folderName, tabName, fileName);
  if (!readable || !names) return null;
  const file = await getDb().file.findFirst({
    where: placedFileWhere(names.folder, names.tab, names.name, readable),
    select: {
      name: true,
      type: true,
      tab: { select: { name: true } },
      versions: { select: { id: true, number: true, size: true }, orderBy: { number: "desc" }, take: 1 },
    },
  });
  const version = file?.versions[0];
  if (!file || !version) return null;
  return { name: file.name, type: file.type, tab: file.tab, version };
}

/** Whether files can be uploaded, and their size limit in bytes: what the views offer and the dialog checks first. */
export type UploadSettings = { on: boolean; sizeLimit: number };

/** Whether the files directory can be used, and the size limit of an upload (`HIPPOWIKI_FILE_SIZE_LIMIT`). */
export async function uploadSettings(): Promise<UploadSettings> {
  return { on: (await getStore()).on, sizeLimit: getServerEnv().HIPPOWIKI_FILE_SIZE_LIMIT };
}

export type CheckUploadNameError = NotAllowed | FolderNotFound | TabNotFound | InvalidInput<FileFieldErrors> | Failed;

/**
 * The checks of an upload before its file is sent, which store nothing: the actor, the ids, the role `editFile`, the
 * place and the name, as `uploadFile()` makes them; then the file of the name at the place that is not deleted, or
 * `null` when the name is free there.
 */
export async function checkUploadName(
  actor: ContentActor,
  place: FilePlace,
  name: string,
): Promise<Result<StoredFile | null, CheckUploadNameError>> {
  const opened = openContentWrite(actor, "upload name not checked");
  if (opened.refused) return opened.refused;
  const checked = await checkedPlace(actor, place, "upload name not checked", "failed to check upload name");
  if (!checked.ok) return checked;
  const { folderId, tabId, ids } = checked.value;

  const parsed = uploadInputSchema.safeParse({ name });
  if (!parsed.success) return invalidInput(parsed.error);
  return lookUp(() => findPlacedFile(folderId, tabId, parsed.data.name), ids, "failed to check upload name");
}

/** The ids of a place, parsed, with the ids that the log lines of a write name. */
type CheckedPlace = { folderId: string; tabId: string | null; ids: Record<string, string> };

/**
 * The checks of the place of an upload, in the order of every content write: the ids, the role `editFile` of the actor
 * on the folder, and the tab, which must be one of the folder.
 */
async function checkedPlace(
  actor: ContentActor,
  place: FilePlace,
  what: string,
  failure: string,
): Promise<Result<CheckedPlace, NotAllowed | FolderNotFound | TabNotFound | Failed>> {
  const folderId = parseFolderId(place.folderId);
  if (!folderId) return { ok: false, error: { code: "folder-not-found" } };
  const tabId = place.tabId === null ? null : parseTabId(place.tabId);
  if (tabId === null && place.tabId !== null) return { ok: false, error: { code: "tab-not-found" } };
  const ids = { folderId, ...(tabId ? { tabId } : {}) };

  const role = await lookUp(() => folderRoleOf(actor, folderId), ids, failure);
  if (!role.ok) return role;
  const refused = refusedByRole(actor, what, role.value, "editFile", ids);
  if (refused) return refused;

  if (tabId !== null) {
    const tab = await lookUp(
      () => getDb().tab.findFirst({ where: { id: tabId, folderId }, select: { id: true } }),
      ids,
      failure,
    );
    if (!tab.ok) return tab;
    if (!tab.value) {
      logger.warn(ids, `${what}: tab not found`);
      return { ok: false, error: { code: "tab-not-found" } };
    }
  }
  return { ok: true, value: { folderId, tabId, ids } };
}

/**
 * The file of the name at the place that is not deleted, as stored, or `null` without one. The place is the folder
 * and the tab of the given ids, already parsed.
 */
async function findPlacedFile(folderId: string, tabId: string | null, name: string): Promise<StoredFile | null> {
  const file = await getDb().file.findFirst({
    where: { folderId, tabId, name, deletedAt: null },
    select: STORED_FILE_SELECT,
  });
  return file && withLastEditor(file);
}

/** The file with the given id as stored, or `null` if it does not exist or is deleted. */
async function findStoredFile(fileId: string): Promise<StoredFile | null> {
  const file = await getDb().file.findUnique({ where: { id: fileId, deletedAt: null }, select: STORED_FILE_SELECT });
  return file && withLastEditor(file);
}

/**
 * The result of a write of a file that matched no row: `file-not-found` if the file does not exist or is deleted,
 * otherwise `file-changed` with the file as it is now, because the write is based on an older state of it. Both are
 * logged as `<what> not found` and `<what> changed`.
 */
async function refusedFileWrite(
  fileId: string,
  lockVersion: unknown,
  what: string,
): Promise<{ ok: false; error: FileNotFound | FileChanged }> {
  const file = await findStoredFile(fileId);
  if (!file) {
    logger.warn({ fileId }, `${what} not found`);
    return { ok: false, error: { code: "file-not-found" } };
  }
  logger.warn({ fileId, lockVersion }, `${what} changed after the lock version the write is based on`);
  return { ok: false, error: { code: "file-changed", file } };
}

/** The write of a new version found the file changed meanwhile; thrown inside its transaction to roll it back. */
class FileChangedMeanwhile extends Error {}

/** Whether a version of any file holds the blob of the SHA-256. */
async function isBlobUsed(sha256: string): Promise<boolean> {
  return (await getDb().fileVersion.count({ where: { sha256 } })) > 0;
}

/** What a new version stores of its content: its blob, and the width and height of an image. */
type VersionContent = { blob: StoredBlob; width: number | null; height: number | null };

/**
 * Turns a received body into the stored content of a version: a PDF and an image kept as uploaded become the blob of
 * their bytes; an image without its metadata becomes the blob of the image written again, and the received body is
 * removed. An image that does not decode is refused, and nothing of it is kept.
 */
async function storedContent(
  dir: string,
  staged: StagedBlob,
  type: FileType,
  stripMetadata: boolean,
): Promise<Result<VersionContent, InvalidImage | DiskFull>> {
  if (!isImageType(type))
    return { ok: true, value: { blob: await commitBlob(dir, staged), width: null, height: null } };
  let processed: Awaited<ReturnType<typeof processImage>>;
  try {
    processed = await processImage(staged.path, type, { stripMetadata });
  } catch (err) {
    await discardStaged(staged);
    throw err;
  }
  if (!processed.ok) {
    await discardStaged(staged);
    return { ok: false, error: { code: "invalid-image", reason: processed.error.code } };
  }
  const { width, height, bytes } = processed.value;
  if (bytes === null) return { ok: true, value: { blob: await commitBlob(dir, staged), width, height } };
  await discardStaged(staged);
  const written = await writeBytes(dir, bytes);
  if (!written.ok) return written;
  return { ok: true, value: { blob: written.value, width, height } };
}

/** The data of a new version of a file, by the actor. */
function versionData(content: VersionContent, editor: Editor, revertedTo: number | null = null) {
  return {
    sha256: content.blob.sha256,
    size: content.blob.size,
    width: content.width,
    height: content.height,
    userId: editor.lastEditedById,
    via: editor.lastEditedVia,
    revertedTo,
  };
}

/**
 * Stores a new version of the file in one transaction, based on the lock version: counts the lock version of the file
 * up, makes the actor its last editor and adds the version with the next number, which it returns with the file.
 * Throws `FileChangedMeanwhile` when the file was changed or deleted after that lock version.
 */
async function storeNewVersion(
  fileId: string,
  lockVersion: number,
  editor: Editor,
  data: ReturnType<typeof versionData>,
): Promise<{ file: StoredFile; number: number }> {
  const { file, number } = await getDb().$transaction(async (tx) => {
    const { count } = await tx.file.updateMany({
      where: { id: fileId, lockVersion, deletedAt: null },
      data: { lockVersion: { increment: 1 }, ...editor },
    });
    if (count === 0) throw new FileChangedMeanwhile();
    // The update holds the row of the file until the end of the transaction, so no other version takes the number.
    const newest = await tx.fileVersion.findFirst({
      where: { fileId },
      select: { number: true },
      orderBy: { number: "desc" },
    });
    const number = (newest?.number ?? 0) + 1;
    await tx.fileVersion.create({ data: { ...data, fileId, number } });
    return { file: await tx.file.findUniqueOrThrow({ where: { id: fileId }, select: STORED_FILE_SELECT }), number };
  });
  return { file: withLastEditor(file), number };
}

/**
 * Uploads a file into the tab with the id `place.tabId` or, with `null`, directly into the folder with the id
 * `place.folderId`, under the given name, and returns it as stored, with the version it stored. The body is the
 * content itself. Without `replace` it stores a new file with version 1; with `replace`, the lock version it is based
 * on, a new version of the file of that name at the place, which must be the file `fileId` when it is given.
 *
 * The checks come in the order of every content write: the actor, the ids, the role `editFile`, the place, the name,
 * the file of the name at the place (taken without `replace`, missing or changed with it), the store, then the content:
 * its size against the limit, or against the exact size, while it is read, its type from its first bytes against the
 * extension of the name, and an image by its decode (`processImage()`). Only then is the file stored, with its
 * version, in one transaction; when that fails, the blob is removed again unless a version holds it. A new version is
 * refused with `file-changed` when the file was changed after its lock version, also while the upload ran.
 */
export async function uploadFile(
  actor: ContentActor,
  place: FilePlace,
  name: string,
  body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  options: UploadOptions,
): Promise<Result<UploadedFile, UploadFileError>> {
  const opened = openContentWrite(actor, "file not uploaded");
  if (opened.refused) return opened.refused;
  const { editor } = opened;

  const checked = await checkedPlace(actor, place, "file not uploaded", "failed to upload file");
  if (!checked.ok) return checked;
  const { folderId, tabId, ids } = checked.value;

  const parsed = uploadInputSchema.safeParse({ name });
  if (!parsed.success) return invalidInput(parsed.error);
  const fileName = parseFileName(parsed.data.name);
  if (!fileName) return { ok: false, error: { code: "invalid-input", fieldErrors: {} } };
  const expected = typeOfExtension(fileName.extension);

  const existing = await lookUp(() => findPlacedFile(folderId, tabId, fileName.name), ids, "failed to upload file");
  if (!existing.ok) return existing;
  const replace = options.replace === null ? null : parseLockVersion(options.replace);
  if (options.replace === null && existing.value) {
    logger.warn({ ...ids, name: fileName.name }, "name of uploaded file already in use");
    return { ok: false, error: { code: "name-taken", file: existing.value } };
  }
  if (options.replace !== null) {
    if (!existing.value) {
      logger.warn({ ...ids, name: fileName.name }, "file of new version not found");
      return { ok: false, error: { code: "file-not-found" } };
    }
    if (existing.value.lockVersion !== replace || (options.fileId !== null && existing.value.id !== options.fileId)) {
      logger.warn(
        { fileId: existing.value.id, lockVersion: options.replace, expectedFileId: options.fileId },
        "file of new version changed after the lock version the write is based on",
      );
      return { ok: false, error: { code: "file-changed", file: existing.value } };
    }
  }

  const store = await getStore();
  if (!store.on) {
    logger.warn({ ...ids, reason: store.reason }, "file not uploaded: files are off");
    return { ok: false, error: { code: "files-off" } };
  }

  const limit = getServerEnv().HIPPOWIKI_FILE_SIZE_LIMIT;
  const { size } = options;
  if (size !== null && size > limit) {
    logger.warn({ ...ids, name: fileName.name, size, limit }, "uploaded file refused: exact size over the limit");
    return { ok: false, error: { code: "too-large", limit } };
  }
  let content: VersionContent;
  try {
    // With an exact size, the body is read up to it, so a longer one stops there.
    const received = await receiveBlob(store.dir, body, { limit: size ?? limit, contentLength: options.contentLength });
    if (!received.ok) {
      const error: TooLarge | DiskFull | WrongSize =
        received.error.code === "disk-full"
          ? received.error
          : size === null
            ? { code: "too-large", limit }
            : { code: "wrong-size", expected: size };
      logger.warn({ ...ids, name: fileName.name, reason: error.code }, "uploaded file refused");
      return { ok: false, error };
    }
    if (size !== null && received.value.size !== size) {
      await discardStaged(received.value);
      logger.warn(
        { ...ids, name: fileName.name, size: received.value.size, expected: size },
        "uploaded file refused: wrong size",
      );
      return { ok: false, error: { code: "wrong-size", expected: size } };
    }
    const detected = detectType(received.value.head);
    if (detected !== expected) {
      await discardStaged(received.value);
      logger.warn({ ...ids, name: fileName.name, detected }, "uploaded file refused: wrong type");
      return { ok: false, error: { code: "wrong-type", detected, expected } };
    }
    const stored = await storedContent(store.dir, received.value, expected, options.stripMetadata);
    if (!stored.ok) {
      logger.warn({ ...ids, name: fileName.name, reason: stored.error.code }, "uploaded file refused");
      return stored;
    }
    content = stored.value;
  } catch (err) {
    if (err instanceof ImageBusyError) {
      logger.warn({ ...ids, name: fileName.name }, "uploaded file refused: too many images are being processed");
    } else {
      logger.error({ err, ...ids, name: fileName.name }, "failed to receive uploaded file");
    }
    return { ok: false, error: { code: "failed" } };
  }

  const data = versionData(content, editor);
  const removeBlob = () =>
    removeBlobIfUnused(store.dir, content.blob.sha256, () => isBlobUsed(content.blob.sha256)).catch((err: unknown) => {
      logger.error({ err, sha256: content.blob.sha256 }, "failed to remove blob of failed upload");
    });

  let file: StoredFile;
  let number = 1;
  try {
    if (existing.value && replace !== null) {
      ({ file, number } = await storeNewVersion(existing.value.id, replace, editor, data));
    } else {
      const created = await getDb().file.create({
        data: {
          name: fileName.name,
          type: expected,
          folderId,
          tabId,
          ...editor,
          versions: { create: { ...data, number: 1 } },
        },
        select: STORED_FILE_SELECT,
      });
      file = withLastEditor(created);
    }
  } catch (err) {
    await removeBlob();
    if (err instanceof FileChangedMeanwhile && existing.value) {
      return refusedFileWrite(existing.value.id, replace, "file of new version");
    }
    // Before the folder and tab keys: a missing actor must not be reported as a missing folder or tab.
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
    if (isUniqueViolation(err, FILE_NAME)) {
      logger.warn({ ...ids, name: fileName.name }, "name of uploaded file already in use");
      const taken = await lookUp(() => findPlacedFile(folderId, tabId, fileName.name), ids, "failed to upload file");
      if (!taken.ok) return taken;
      if (taken.value) return { ok: false, error: { code: "name-taken", file: taken.value } };
      return { ok: false, error: { code: "failed" } };
    }
    if (isForeignKeyViolation(err)) {
      // A missing folder, a missing tab or a tab of another folder: the composite foreign key refuses all of them.
      logger.warn(ids, "folder or tab of uploaded file not found");
      return { ok: false, error: { code: tabId ? "tab-not-found" : "folder-not-found" } };
    }
    logger.error({ err, ...ids }, "failed to upload file");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info(
    { fileId: file.id, lockVersion: file.lockVersion, size: content.blob.size, ...channelOf(actor) },
    existing.value ? "file version uploaded" : "file uploaded",
  );
  return {
    ok: true,
    value: { ...file, version: { number, size: content.blob.size, width: content.width, height: content.height } },
  };
}

/** The version to revert to does not exist, or it is the current version, which a revert would not change. */
type VersionNotFound = { code: "version-not-found" };

export type RevertFileError = NotAllowed | FileNotFound | FileChanged | VersionNotFound | Failed;

/** The version of a revert was not found in its transaction; thrown inside it to roll it back. */
class VersionMissing extends Error {}

/**
 * Reverts the file with the given id to an earlier version, based on the lock version that the dialog was opened with:
 * stores the content of that version as the newest version, which names the version it went back to, by the actor, and
 * counts the lock version up, in one transaction. No byte is written: the new version holds the blob of the old one.
 * Only the browser reverts. It is refused with `file-changed` when the file was changed after that lock version, and
 * with `version-not-found` for a version that does not exist or is the current one.
 */
export async function revertFile(
  actor: BrowserActor,
  id: string,
  input: { version: number; lockVersion: number | null },
): Promise<Result<StoredFile, RevertFileError>> {
  const opened = openContentWrite(actor, "file not reverted");
  if (opened.refused) return opened.refused;
  const { editor } = opened;

  const fileId = parseFileId(id);
  if (!fileId) return { ok: false, error: { code: "file-not-found" } };

  const role = await lookUp(() => roleOnFolderOfFile(actor, fileId), { fileId }, "failed to revert file");
  if (!role.ok) return role;
  const refused = refusedByRole(actor, "file not reverted", role.value, "editFile", { fileId });
  if (refused) return refused;

  const lockVersion = parseLockVersion(input.lockVersion);
  if (lockVersion === null) return refusedFileWrite(fileId, input.lockVersion, "file to revert");

  let file: StoredFile;
  try {
    file = withLastEditor(
      await getDb().$transaction(async (tx) => {
        const { count } = await tx.file.updateMany({
          where: { id: fileId, lockVersion, deletedAt: null },
          data: { lockVersion: { increment: 1 }, ...editor },
        });
        if (count === 0) throw new FileChangedMeanwhile();
        // The update holds the row of the file, so the newest version stays the newest until the end.
        const newest = await tx.fileVersion.findFirst({
          where: { fileId },
          select: { number: true },
          orderBy: { number: "desc" },
        });
        const target = await tx.fileVersion.findFirst({
          where: { fileId, number: input.version },
          select: { sha256: true, size: true, width: true, height: true },
        });
        if (!newest || !target || newest.number === input.version) throw new VersionMissing();
        await tx.fileVersion.create({
          data: {
            ...target,
            fileId,
            number: newest.number + 1,
            userId: editor.lastEditedById,
            via: editor.lastEditedVia,
            revertedTo: input.version,
          },
        });
        return tx.file.findUniqueOrThrow({ where: { id: fileId }, select: STORED_FILE_SELECT });
      }),
    );
  } catch (err) {
    if (err instanceof FileChangedMeanwhile) return refusedFileWrite(fileId, lockVersion, "file to revert");
    if (err instanceof VersionMissing) {
      logger.warn({ fileId, version: input.version }, "version to revert to not found");
      return { ok: false, error: { code: "version-not-found" } };
    }
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
    logger.error({ err, fileId }, "failed to revert file");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ fileId, lockVersion: file.lockVersion, version: input.version, ...channelOf(actor) }, "file reverted");
  return { ok: true, value: file };
}

export type MoveOrRenameFileError =
  NotAllowed | FileNotFound | FileChanged | TabNotFound | InvalidInput<FileFieldErrors> | NameTaken | Failed;

/** A file as stored by a move or rename, with the pages whose links and embeds of it were updated. */
export type MovedFile = StoredFile & { updatedPages: LinkingPage[] };

/** What the store of a move or rename did. */
type FileMoveWrite =
  | { kind: "stored"; file: StoredFile; updatedPages: LinkingPage[] }
  | { kind: "unchanged"; file: StoredFile }
  | { kind: "refused" };

/**
 * Stores the given name and place of the file with the given id, based on the lock version that the dialog was opened
 * with, and returns the file as stored with the pages whose links and embeds of it were updated. The file is placed in
 * the tab with the id `tabId` of its folder or, with `null`, directly in the folder; a tab of another folder is
 * refused by the composite foreign key and counts as missing. The extension stays, because it fixes the type: a name
 * with another one is refused at the name field. The checks are those of a move of a page: the actor, the id, the role
 * `editFile`, the place, the name and the lock version, which a change since the dialog was opened makes refuse the
 * move with `file-changed`, also when the name is taken. A move to the name and place the file has stored stores
 * nothing and is logged apart. A stored move counts the lock version up, makes the actor the last editor and updates
 * every link and embed of the file in the pages of the folder that are not deleted, in one transaction that holds the
 * exclusive lock of the links of the folder (`lockFolderLinks()`), each updated page with a revision marked as links
 * updated; a move that is refused or fails changes no page. Only the browser moves files.
 */
export async function moveOrRenameFile(
  actor: BrowserActor,
  id: string,
  input: { name: string; tabId: string | null; lockVersion: number | null },
): Promise<Result<MovedFile, MoveOrRenameFileError>> {
  const opened = openContentWrite(actor, "file not moved or renamed");
  if (opened.refused) return opened.refused;
  const { editor } = opened;

  const fileId = parseFileId(id);
  if (!fileId) return { ok: false, error: { code: "file-not-found" } };

  const failure = "failed to move or rename file";
  const role = await lookUp(() => roleOnFolderOfFile(actor, fileId), { fileId }, failure);
  if (!role.ok) return role;
  const refused = refusedByRole(actor, "file not moved or renamed", role.value, "editFile", { fileId });
  if (refused) return refused;

  const tabId = input.tabId === null ? null : parseTabId(input.tabId);
  if (tabId === null && input.tabId !== null) return { ok: false, error: { code: "tab-not-found" } };

  const parsed = uploadInputSchema.safeParse({ name: input.name });
  if (!parsed.success) return invalidInput(parsed.error);
  const { name } = parsed.data;
  const stored = await lookUp(
    () => getDb().file.findUnique({ where: { id: fileId, deletedAt: null }, select: { type: true, folderId: true } }),
    { fileId },
    failure,
  );
  if (!stored.ok) return stored;
  if (!stored.value) {
    logger.warn({ fileId }, "file to move or rename not found");
    return { ok: false, error: { code: "file-not-found" } };
  }
  const extension = parseFileName(name)?.extension;
  if (!extension || typeOfExtension(extension) !== stored.value.type) {
    return {
      ok: false,
      error: { code: "invalid-input", fieldErrors: { name: [fileExtensionMessage(stored.value.type)] } },
    };
  }

  const lockVersion = parseLockVersion(input.lockVersion);
  let written: FileMoveWrite;
  try {
    if (lockVersion === null) return await refusedFileWrite(fileId, input.lockVersion, "file to move or rename");
    written = await storeFileMove(fileId, stored.value.folderId, lockVersion, { name, tabId }, editor);
  } catch (err) {
    // Before the tab key: a missing actor must not be reported as a missing tab.
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
    if (isUniqueViolation(err, FILE_NAME)) {
      logger.warn({ fileId, tabId, name }, "name of moved or renamed file already in use at the target");
      return { ok: false, error: { code: "name-taken" } };
    }
    if (isForeignKeyViolation(err)) {
      logger.warn({ fileId, tabId }, "target tab of moved or renamed file not found in the file's folder");
      return { ok: false, error: { code: "tab-not-found" } };
    }
    logger.error({ err, fileId, tabId }, failure);
    return { ok: false, error: { code: "failed" } };
  }
  if (written.kind === "refused") return refusedFileWrite(fileId, lockVersion, "file to move or rename");
  if (written.kind === "unchanged") {
    logger.info({ fileId, ...channelOf(actor) }, "file not changed: name and place are the same");
    return { ok: true, value: { ...written.file, updatedPages: [] } };
  }
  const { file, updatedPages } = written;
  logger.info(
    { fileId, tabId, lockVersion: file.lockVersion, linkingPages: updatedPages.length, ...channelOf(actor) },
    "file moved or renamed",
  );
  return { ok: true, value: { ...file, updatedPages } };
}

/**
 * The transaction of a move or rename of a file: takes the exclusive lock of the links of the folder, stores the name
 * and place if the file is not deleted, has the lock version and differs from them, counts the lock version up, and
 * updates the links and embeds of the old name and place in the pages of the folder (`updateLinks()`). A file with the
 * lock version and this name and place stores nothing (`unchanged`); anything else that matched no row is `refused`.
 */
async function storeFileMove(
  fileId: string,
  folderId: string,
  lockVersion: number,
  target: { name: string; tabId: string | null },
  editor: Editor,
): Promise<FileMoveWrite> {
  const { name, tabId } = target;
  const current = { id: fileId, lockVersion, deletedAt: null };
  // `not` never matches a column that is `null`, so a file directly in the folder is matched apart.
  const differs: Prisma.FileWhereInput[] = [
    { name: { not: name } },
    ...(tabId === null ? [{ tabId: { not: null } }] : [{ tabId: null }, { tabId: { not: tabId } }]),
  ];
  return getDb().$transaction(async (tx): Promise<FileMoveWrite> => {
    await lockFolderLinks(tx, folderId, "exclusive");
    // The name and place before the move, which the links name.
    const before = await tx.file.findFirst({
      where: { ...current, OR: differs },
      select: { name: true, tab: { select: { name: true } } },
    });
    const { count } = await tx.file.updateMany({
      where: { ...current, OR: differs },
      data: { name, tabId, lockVersion: { increment: 1 }, ...editor },
    });
    if (count === 0 || !before) {
      const unchanged = await tx.file.findFirst({ where: { ...current, name, tabId }, select: STORED_FILE_SELECT });
      return unchanged ? { kind: "unchanged", file: withLastEditor(unchanged) } : { kind: "refused" };
    }
    const file = withLastEditor(await tx.file.findUniqueOrThrow({ where: { id: fileId }, select: STORED_FILE_SELECT }));
    const updatedPages = await updateLinks(
      tx,
      folderId,
      { tabName: before.tab?.name ?? null, pageName: before.name },
      pageMoved(
        { kind: "file", tab: before.tab?.name ?? null, name: before.name },
        { kind: "file", tab: file.tab?.name ?? null, name: file.name },
      ),
      editor,
    );
    return { kind: "stored", file, updatedPages };
  }, LINKS_TRANSACTION);
}

export type DeleteFileError = NotAllowed | FileNotFound | FileChanged | Failed;

/** Where a deleted file was: the names of its folder and tab, the address to go to after the delete. */
export type FilePlaceNames = { folder: { name: string }; tab: { name: string } | null };

/**
 * Deletes the file with the given id as a soft delete, based on the lock version that the dialog was opened with, and
 * returns the place it was in. The file keeps its row, its folder and its versions, so it can be restored; it gets the
 * time of deletion, loses its tab, because its place inside the folder is forgotten, and the actor becomes its last
 * editor (`softDeleteFileData()`). Its name is free at once. A file that is already deleted counts as missing. The
 * delete is refused with `file-changed` when the file was changed after that lock version. Only the browser deletes a
 * single file; a delete of a tab deletes the files of the tab with it, also through MCP (`deleteTab()` of the folders
 * service).
 */
export async function deleteFile(
  actor: BrowserActor,
  id: string,
  input: { lockVersion: number | null },
): Promise<Result<FilePlaceNames, DeleteFileError>> {
  const opened = openContentWrite(actor, "file not deleted");
  if (opened.refused) return opened.refused;

  const fileId = parseFileId(id);
  if (!fileId) return { ok: false, error: { code: "file-not-found" } };

  const role = await lookUp(() => roleOnFolderOfFile(actor, fileId), { fileId }, "failed to delete file");
  if (!role.ok) return role;
  const refused = refusedByRole(actor, "file not deleted", role.value, "deleteFile", { fileId });
  if (refused) return refused;

  const lockVersion = parseLockVersion(input.lockVersion);
  if (lockVersion === null) return refusedFileWrite(fileId, input.lockVersion, "file to delete");

  let place: FilePlaceNames | null;
  try {
    // The read of the place and the update in one transaction: the lock version in the condition of the update makes
    // the place the one the file had when it was deleted, because a move in between counts the lock version up.
    place = await getDb().$transaction(async (tx) => {
      const where = { id: fileId, lockVersion, deletedAt: null };
      const file = await tx.file.findFirst({
        where,
        select: { folder: { select: { name: true } }, tab: { select: { name: true } } },
      });
      if (!file) return null;
      const { count } = await tx.file.updateMany({ where, data: softDeleteFileData(opened.editor) });
      return count === 0 ? null : file;
    });
  } catch (err) {
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
    logger.error({ err, fileId }, "failed to delete file");
    return { ok: false, error: { code: "failed" } };
  }
  if (place === null) return refusedFileWrite(fileId, lockVersion, "file to delete");

  logger.info({ fileId, ...channelOf(actor) }, "file deleted");
  return { ok: true, value: place };
}

/**
 * What the list of deleted items shows of a file: its name, type and size, and when and by whom it was deleted. Nothing
 * writes to a deleted file, so its last editor is the user who deleted it, with the channel of the delete.
 */
export type DeletedFileSummary = {
  id: string;
  name: string;
  type: FileType;
  size: number;
  deletedAt: Date;
  lastEditedBy: LastEditor;
};

/** A deleted file with its folder and its versions, newest first, as the view of a deleted file shows it. */
export type DeletedFile = {
  id: string;
  name: string;
  type: FileType;
  deletedAt: Date;
  lastEditedBy: LastEditor;
  folder: { id: string; name: string };
  versions: [FileVersionEntry, ...FileVersionEntry[]];
};

/**
 * The deleted files of the folder, newest first, without their content. `null` for an admin and, in the browser, for
 * an actor whose role on the folder is not Manager or Owner.
 */
export async function listDeletedFiles(actor: ContentActor, folderId: string): Promise<DeletedFileSummary[] | null> {
  if (!(await mayReadFolder(actor, folderId, "deletedItems"))) return null;
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return [];
  const files = await getDb().file.findMany({
    where: { folderId: parsedFolderId, deletedAt: { not: null } },
    select: { ...SUMMARY_SELECT, deletedAt: true },
    // The id keeps files deleted at the same moment in a stable order.
    orderBy: [{ deletedAt: "desc" }, { id: "asc" }],
  });
  return files.flatMap(({ deletedAt, ...file }) => (deletedAt ? [{ ...summaryOf(file), deletedAt }] : []));
}

/**
 * The deleted file with the given id in the folder with the given name, with its folder and its versions, newest
 * first. `null` for an admin, if the name or the id is malformed, the file belongs to another folder or is not
 * deleted, and, in the browser, if the actor's role on the folder is not Manager or Owner.
 */
export async function getDeletedFile(actor: ContentActor, folderName: string, id: string): Promise<DeletedFile | null> {
  const readable = readableFolderWhere(actor, "deletedItems");
  if (!readable) return null;
  const folder = parseName(folderName);
  const fileId = parseFileId(id);
  if (!folder || !fileId) return null;
  const file = await getDb().file.findFirst({
    where: { id: fileId, folder: { name: folder, ...readable }, deletedAt: { not: null } },
    select: {
      id: true,
      name: true,
      type: true,
      deletedAt: true,
      ...LAST_EDITOR_SELECT,
      folder: { select: { id: true, name: true } },
      versions: { select: VERSION_SELECT, orderBy: { number: "desc" } },
    },
  });
  if (!file) return null;
  const { versions, deletedAt, ...rest } = withLastEditor(file);
  const [newest, ...older] = versions.map(versionEntry);
  if (!newest || !deletedAt) return null;
  return { ...rest, deletedAt, versions: [newest, ...older] };
}

export type RestoreFileError =
  NotAllowed | FileNotFound | TabNotFound | InvalidInput<FileFieldErrors> | NameTaken | Failed;

/**
 * Restores the deleted file with the given id into its folder, under the given name, at the given place, with all its
 * versions, and returns it as stored, with the actor as its last editor and the next lock version: in the tab with the
 * id `tabId` of its folder or, with `null`, directly in the folder. The extension of the name stays that of its type.
 * A file that is not deleted counts as missing; a tab of another folder is refused by the composite foreign key and
 * counts as missing as well. A name that is taken at the place gives `name-taken`: a deleted file never holds a name.
 * The checks are those of the restore of a page; only the browser restores.
 */
export async function restoreFile(
  actor: BrowserActor,
  id: string,
  input: { name: string; tabId: string | null },
): Promise<Result<StoredFile, RestoreFileError>> {
  const opened = openContentWrite(actor, "file not restored");
  if (opened.refused) return opened.refused;

  const fileId = parseFileId(id);
  if (!fileId) return { ok: false, error: { code: "file-not-found" } };

  const failure = "failed to restore file";
  const role = await lookUp(() => roleOnFolderOfFile(actor, fileId), { fileId }, failure);
  if (!role.ok) return role;
  const refused = refusedByRole(actor, "file not restored", role.value, "deletedItems", { fileId });
  if (refused) return refused;

  const tabId = input.tabId === null ? null : parseTabId(input.tabId);
  if (tabId === null && input.tabId !== null) return { ok: false, error: { code: "tab-not-found" } };

  const parsed = uploadInputSchema.safeParse({ name: input.name });
  if (!parsed.success) return invalidInput(parsed.error);
  const { name } = parsed.data;
  const deleted = await lookUp(
    () => getDb().file.findUnique({ where: { id: fileId, deletedAt: { not: null } }, select: { type: true } }),
    { fileId },
    failure,
  );
  if (!deleted.ok) return deleted;
  if (!deleted.value) {
    logger.warn({ fileId }, "deleted file to restore not found");
    return { ok: false, error: { code: "file-not-found" } };
  }
  const extension = parseFileName(name)?.extension;
  if (!extension || typeOfExtension(extension) !== deleted.value.type) {
    return {
      ok: false,
      error: { code: "invalid-input", fieldErrors: { name: [fileExtensionMessage(deleted.value.type)] } },
    };
  }

  let file: StoredFile | null;
  try {
    // Only a deleted file can be restored; `updateMany` reports any other as a count of 0.
    const { count } = await getDb().file.updateMany({
      where: { id: fileId, deletedAt: { not: null } },
      data: { deletedAt: null, name, tabId, ...opened.editor, lockVersion: { increment: 1 } },
    });
    file = count === 0 ? null : await findStoredFile(fileId);
  } catch (err) {
    // Before the tab key: a missing actor must not be reported as a missing tab.
    if (isForeignKeyViolation(err, LAST_EDITOR)) return unknownActor(err, actor);
    if (isUniqueViolation(err, FILE_NAME)) {
      logger.warn({ fileId, tabId, name }, "name of restored file already in use at the target");
      return { ok: false, error: { code: "name-taken" } };
    }
    if (isForeignKeyViolation(err)) {
      logger.warn({ fileId, tabId }, "target tab of restored file not found in the file's folder");
      return { ok: false, error: { code: "tab-not-found" } };
    }
    logger.error({ err, fileId, tabId }, failure);
    return { ok: false, error: { code: "failed" } };
  }
  if (file === null) {
    logger.warn({ fileId }, "deleted file to restore not found");
    return { ok: false, error: { code: "file-not-found" } };
  }

  logger.info({ fileId, tabId, ...channelOf(actor) }, "file restored");
  return { ok: true, value: file };
}
