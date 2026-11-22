import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fileFindFirst: vi.fn(),
  fileFindUnique: vi.fn(),
  fileFindMany: vi.fn(),
  fileCreate: vi.fn(),
  fileUpdateMany: vi.fn(),
  fileFindUniqueOrThrow: vi.fn(),
  versionCount: vi.fn(),
  versionFindFirst: vi.fn(),
  versionCreate: vi.fn(),
  txFileFindFirst: vi.fn(),
  executeRaw: vi.fn(),
  linkFindMany: vi.fn(),
  roleFindFirst: vi.fn(),
  tabFindFirst: vi.fn(),
  transaction: vi.fn(),
  getStore: vi.fn(),
  receiveBlob: vi.fn(),
  commitBlob: vi.fn(),
  discardStaged: vi.fn(),
  writeBytes: vi.fn(),
  readBlob: vi.fn(),
  removeBlobIfUnused: vi.fn(),
  processImage: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    file: {
      findFirst: mocks.fileFindFirst,
      findUnique: mocks.fileFindUnique,
      findMany: mocks.fileFindMany,
      create: mocks.fileCreate,
      updateMany: mocks.fileUpdateMany,
    },
    fileVersion: { count: mocks.versionCount },
    folderRole: { findFirst: mocks.roleFindFirst },
    tab: { findFirst: mocks.tabFindFirst },
    $transaction: mocks.transaction,
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: mocks.warn, error: mocks.error, debug: mocks.debug },
}));

vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  getServerEnv: () => ({ HIPPOWIKI_FILE_SIZE_LIMIT: 26_214_400 }),
}));

vi.mock("@/features/files/store", () => ({
  getStore: mocks.getStore,
  receiveBlob: mocks.receiveBlob,
  commitBlob: mocks.commitBlob,
  discardStaged: mocks.discardStaged,
  writeBytes: mocks.writeBytes,
  readBlob: mocks.readBlob,
  removeBlobIfUnused: mocks.removeBlobIfUnused,
}));

vi.mock("@/features/files/images", () => ({
  processImage: mocks.processImage,
  ImageBusyError: class ImageBusyError extends Error {},
}));

import { ImageBusyError } from "@/features/files/images";
import * as fileService from "@/features/files/service";
import { allows, contentWritesOf, ROLES } from "@/test/content-writes";
import type { ContentActor } from "@/features/folder-roles/actors";
import {
  ACTOR,
  ACTOR_ID,
  ADMIN,
  FILE_ID,
  FOLDER_ID,
  foreignKeyViolation,
  knownError,
  MALFORMED_ACTOR,
  MALFORMED_ID,
  mcpActor,
  TAB_ID,
  uniqueViolation,
} from "@/test/unit";

const DIR = "/srv/files";
const SHA = "a".repeat(64);
const PROCESSED_SHA = "b".repeat(64);
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF_HEAD = new TextEncoder().encode("%PDF-1.7\n%..");
const HTML_HEAD = new TextEncoder().encode("<!DOCTYPE ht");

/** The file of the name at the place as the service reads it. */
const STORED_ROW = {
  id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002",
  name: "diagram.png",
  type: "png",
  lockVersion: 3,
  updatedAt: new Date("2026-11-20T10:00:00Z"),
  lastEditedBy: { username: "bob" },
  lastEditedVia: "web",
  folder: { name: "handbook" },
  tab: { name: "guides" },
};
const STORED_FILE = {
  id: STORED_ROW.id,
  name: "diagram.png",
  type: "png",
  lockVersion: 3,
  updatedAt: STORED_ROW.updatedAt,
  lastEditedBy: { name: "bob", via: "web" },
  folder: { name: "handbook" },
  tab: { name: "guides" },
};

const PLACE = { folderId: FOLDER_ID, tabId: TAB_ID };
const NEW_FILE = { contentLength: 1000, stripMetadata: true, replace: null };

/** A staged body of the given first bytes. */
function staged(head: Uint8Array, sha256 = SHA) {
  return { path: `${DIR}/tmp/upload`, sha256, size: 1000, head };
}

/** Uploads the file of the name with the options, by the actor. */
function upload(name = "diagram.png", options: fileService.UploadOptions = NEW_FILE, actor: ContentActor = ACTOR) {
  return fileService.uploadFile(actor, PLACE, name, [], options);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.roleFindFirst.mockResolvedValue({ role: "writer" });
  mocks.tabFindFirst.mockResolvedValue({ id: TAB_ID });
  mocks.fileFindFirst.mockResolvedValue(null);
  mocks.getStore.mockResolvedValue({ on: true, dir: DIR });
  mocks.receiveBlob.mockResolvedValue({ ok: true, value: staged(PNG_HEAD) });
  mocks.commitBlob.mockImplementation((_dir: string, blob: { sha256: string; size: number; head: Uint8Array }) =>
    Promise.resolve({ sha256: blob.sha256, size: blob.size, head: blob.head }),
  );
  mocks.writeBytes.mockResolvedValue({ ok: true, value: { sha256: PROCESSED_SHA, size: 800, head: PNG_HEAD } });
  mocks.processImage.mockResolvedValue({ ok: true, value: { width: 30, height: 40, bytes: Buffer.from("png") } });
  mocks.fileCreate.mockResolvedValue({ ...STORED_ROW, lockVersion: 1 });
  mocks.removeBlobIfUnused.mockResolvedValue(undefined);
  // A file with the lock version 3 and the versions 1 and 2, of which version 2 is the current one.
  mocks.fileUpdateMany.mockResolvedValue({ count: 1 });
  mocks.versionFindFirst.mockImplementation(({ where }: { where: { number?: number } }) =>
    Promise.resolve(
      where.number === undefined
        ? { number: 2 }
        : where.number <= 2
          ? { sha256: SHA, size: 1000, width: 30, height: 40 }
          : null,
    ),
  );
  mocks.fileFindUniqueOrThrow.mockResolvedValue({ ...STORED_ROW, lockVersion: 4 });
  // The file to move or rename: a PNG in the tab guides, and no page shows or links it.
  mocks.fileFindUnique.mockResolvedValue({ ...STORED_ROW, folderId: FOLDER_ID });
  mocks.txFileFindFirst.mockResolvedValue({ name: "diagram.png", tab: { name: "guides" } });
  mocks.linkFindMany.mockResolvedValue([]);
  mocks.transaction.mockImplementation((run: (tx: unknown) => Promise<unknown>) =>
    run({
      file: {
        findFirst: mocks.txFileFindFirst,
        updateMany: mocks.fileUpdateMany,
        findUniqueOrThrow: mocks.fileFindUniqueOrThrow,
      },
      fileVersion: { findFirst: mocks.versionFindFirst, create: mocks.versionCreate },
      pageLink: { findMany: mocks.linkFindMany },
      $executeRaw: mocks.executeRaw,
    }),
  );
});

describe("the content writes of files", () => {
  const WRITES = contentWritesOf("files");

  it.each(WRITES)("$name refuses an admin before it asks the database", async (write) => {
    await expect(write.call(ADMIN)).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });
    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ actorId: ACTOR_ID }, `${write.what}: the actor is an admin`);
  });

  it.each(WRITES)("$name answers a malformed actor id with failed", async (write) => {
    await expect(write.call(MALFORMED_ACTOR)).resolves.toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
  });

  it.each(WRITES)("$name refuses an actor without a role on the folder", async (write) => {
    mocks.roleFindFirst.mockResolvedValue(null);

    await expect(write.call(ACTOR)).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });
    expect(mocks.warn).toHaveBeenCalledWith(
      { actorId: ACTOR_ID, ...write.target },
      `${write.what}: the actor has no role on the folder`,
    );
  });

  describe.each(WRITES)("$name and the roles", (write) => {
    it.each(ROLES)("with the role %s", async (role) => {
      mocks.roleFindFirst.mockResolvedValue({ role });

      const result = await write.call(ACTOR);

      if (allows(write, role)) {
        expect(result).toMatchObject({ ok: true });
      } else {
        expect(result).toEqual({ ok: false, error: { code: "not-allowed" } });
        expect(mocks.warn).toHaveBeenCalledWith(
          { actorId: ACTOR_ID, ...write.target, role },
          `${write.what}: the role of the actor does not allow it`,
        );
      }
    });
  });

  it.each(WRITES)("$name answers a failed lookup of the role with failed", async (write) => {
    mocks.roleFindFirst.mockRejectedValue(new Error("connection lost"));

    await expect(write.call(ACTOR)).resolves.toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ ...write.target }), write.failure);
  });

  it.each(WRITES)("$name answers a missing actor with failed", async (write) => {
    mocks.fileCreate.mockRejectedValue(foreignKeyViolation({ index: write.editorKey }));
    mocks.fileUpdateMany.mockRejectedValue(foreignKeyViolation({ index: write.editorKey }));
    mocks.roleFindFirst.mockResolvedValue({ role: "owner" });
    mocks.transaction.mockRejectedValue(foreignKeyViolation({ index: write.editorKey }));

    await expect(write.call(ACTOR)).resolves.toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR_ID }),
      "actor of write not found",
    );
  });
});

describe("uploadFile", () => {
  it("stores a new image without its metadata, with its size upright, and logs it", async () => {
    const result = await upload();

    expect(result).toEqual({ ok: true, value: { ...STORED_FILE, lockVersion: 1 } });
    expect(mocks.processImage).toHaveBeenCalledWith(`${DIR}/tmp/upload`, "png", { stripMetadata: true });
    // The received body with its metadata is removed; the image written again is the blob.
    expect(mocks.discardStaged).toHaveBeenCalledWith(staged(PNG_HEAD));
    expect(mocks.commitBlob).not.toHaveBeenCalled();
    expect(mocks.fileCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        name: "diagram.png",
        type: "png",
        folderId: FOLDER_ID,
        tabId: TAB_ID,
        lastEditedById: ACTOR_ID,
        lastEditedVia: "web",
        versions: {
          create: {
            number: 1,
            sha256: PROCESSED_SHA,
            size: 800,
            width: 30,
            height: 40,
            userId: ACTOR_ID,
            via: "web",
            revertedTo: null,
          },
        },
      },
    });
    expect(mocks.info).toHaveBeenCalledWith(
      { fileId: STORED_ROW.id, lockVersion: 1, size: 800, channel: "web" },
      "file uploaded",
    );
  });

  it("keeps the bytes of an image as uploaded when asked", async () => {
    mocks.processImage.mockResolvedValue({ ok: true, value: { width: 30, height: 40, bytes: null } });

    await upload("diagram.png", { ...NEW_FILE, stripMetadata: false });

    expect(mocks.processImage).toHaveBeenCalledWith(`${DIR}/tmp/upload`, "png", { stripMetadata: false });
    expect(mocks.commitBlob).toHaveBeenCalledWith(DIR, staged(PNG_HEAD));
    expect(mocks.discardStaged).not.toHaveBeenCalled();
    expect(mocks.fileCreate.mock.calls[0]?.[0]).toMatchObject({ data: { versions: { create: { sha256: SHA } } } });
  });

  it("stores a PDF as uploaded, without processing it and without width and height", async () => {
    mocks.receiveBlob.mockResolvedValue({ ok: true, value: staged(PDF_HEAD) });

    await upload("manual.pdf");

    expect(mocks.processImage).not.toHaveBeenCalled();
    expect(mocks.fileCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { type: "pdf", versions: { create: { sha256: SHA, width: null, height: null } } },
    });
  });

  it("stores a file placed directly in the folder without asking for a tab", async () => {
    await fileService.uploadFile(ACTOR, { folderId: FOLDER_ID, tabId: null }, "diagram.png", [], NEW_FILE);

    expect(mocks.tabFindFirst).not.toHaveBeenCalled();
    expect(mocks.fileCreate.mock.calls[0]?.[0]).toMatchObject({ data: { tabId: null } });
  });

  it("stores the channel of MCP for an actor of MCP", async () => {
    await upload("diagram.png", NEW_FILE, mcpActor("writer"));

    expect(mocks.fileCreate.mock.calls[0]?.[0]).toMatchObject({ data: { lastEditedVia: "mcp" } });
  });

  it("answers malformed ids without asking the database", async () => {
    await expect(
      fileService.uploadFile(ACTOR, { folderId: MALFORMED_ID, tabId: null }, "diagram.png", [], NEW_FILE),
    ).resolves.toEqual({ ok: false, error: { code: "folder-not-found" } });
    await expect(
      fileService.uploadFile(ACTOR, { folderId: FOLDER_ID, tabId: MALFORMED_ID }, "diagram.png", [], NEW_FILE),
    ).resolves.toEqual({ ok: false, error: { code: "tab-not-found" } });
    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
  });

  it("refuses a tab of another folder or a missing tab before it reads the body", async () => {
    mocks.tabFindFirst.mockResolvedValue(null);

    await expect(upload()).resolves.toEqual({ ok: false, error: { code: "tab-not-found" } });
    expect(mocks.receiveBlob).not.toHaveBeenCalled();
  });

  it.each(["Diagram.png", "my file.png", "a.b.png", "photo.jpeg", "diagram", ""])(
    "refuses the name %j at the name field before it reads the body",
    async (name) => {
      const result = await upload(name);

      expect(result).toMatchObject({
        ok: false,
        error: { code: "invalid-input", fieldErrors: { name: [expect.any(String)] } },
      });
      expect(mocks.fileFindFirst).not.toHaveBeenCalled();
      expect(mocks.receiveBlob).not.toHaveBeenCalled();
    },
  );

  it("answers a taken name with the file of that name, before it reads the body", async () => {
    mocks.fileFindFirst.mockResolvedValue(STORED_ROW);

    await expect(upload()).resolves.toEqual({ ok: false, error: { code: "name-taken", file: STORED_FILE } });
    expect(mocks.receiveBlob).not.toHaveBeenCalled();
  });

  it("refuses a new version of a file that is missing or that was changed, before it reads the body", async () => {
    await expect(upload("diagram.png", { ...NEW_FILE, replace: 3 })).resolves.toEqual({
      ok: false,
      error: { code: "file-not-found" },
    });
    mocks.fileFindFirst.mockResolvedValue(STORED_ROW);
    await expect(upload("diagram.png", { ...NEW_FILE, replace: 2 })).resolves.toEqual({
      ok: false,
      error: { code: "file-changed", file: STORED_FILE },
    });
    expect(mocks.receiveBlob).not.toHaveBeenCalled();
  });

  it("refuses every upload while the files are off", async () => {
    mocks.getStore.mockResolvedValue({ on: false, reason: "missing", dir: DIR });

    await expect(upload()).resolves.toEqual({ ok: false, error: { code: "files-off" } });
    expect(mocks.receiveBlob).not.toHaveBeenCalled();
  });

  it("refuses a body over the limit with the limit, and a full disk", async () => {
    mocks.receiveBlob.mockResolvedValueOnce({ ok: false, error: { code: "too-large" } });
    await expect(upload()).resolves.toEqual({ ok: false, error: { code: "too-large", limit: 26_214_400 } });
    expect(mocks.receiveBlob).toHaveBeenCalledWith(DIR, [], { limit: 26_214_400, contentLength: 1000 });

    mocks.receiveBlob.mockResolvedValueOnce({ ok: false, error: { code: "disk-full" } });
    await expect(upload()).resolves.toEqual({ ok: false, error: { code: "disk-full" } });
    expect(mocks.fileCreate).not.toHaveBeenCalled();
  });

  it("refuses content of no accepted type and content of another type than its name, and keeps nothing", async () => {
    mocks.receiveBlob.mockResolvedValueOnce({ ok: true, value: staged(HTML_HEAD) });
    await expect(upload()).resolves.toEqual({
      ok: false,
      error: { code: "wrong-type", detected: null, expected: "png" },
    });

    mocks.receiveBlob.mockResolvedValueOnce({ ok: true, value: staged(PDF_HEAD) });
    await expect(upload()).resolves.toEqual({
      ok: false,
      error: { code: "wrong-type", detected: "pdf", expected: "png" },
    });

    expect(mocks.discardStaged).toHaveBeenCalledTimes(2);
    expect(mocks.processImage).not.toHaveBeenCalled();
    expect(mocks.fileCreate).not.toHaveBeenCalled();
  });

  it("refuses an image that does not decode or has too many pixels, and keeps nothing", async () => {
    mocks.processImage.mockResolvedValueOnce({ ok: false, error: { code: "unreadable" } });
    await expect(upload()).resolves.toEqual({ ok: false, error: { code: "invalid-image", reason: "unreadable" } });

    mocks.processImage.mockResolvedValueOnce({ ok: false, error: { code: "too-many-pixels" } });
    await expect(upload()).resolves.toEqual({
      ok: false,
      error: { code: "invalid-image", reason: "too-many-pixels" },
    });

    expect(mocks.discardStaged).toHaveBeenCalledTimes(2);
    expect(mocks.fileCreate).not.toHaveBeenCalled();
  });

  it("answers a busy image processing and a failed body with failed, and keeps nothing", async () => {
    mocks.processImage.mockRejectedValueOnce(new ImageBusyError());
    await expect(upload()).resolves.toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.discardStaged).toHaveBeenCalledTimes(1);

    mocks.receiveBlob.mockRejectedValueOnce(new Error("the connection was closed"));
    await expect(upload()).resolves.toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: FOLDER_ID }),
      "failed to receive uploaded file",
    );
    expect(mocks.fileCreate).not.toHaveBeenCalled();
  });

  it("removes the blob again when the transaction fails, and answers each error", async () => {
    mocks.fileCreate.mockRejectedValueOnce(knownError("P1001"));
    await expect(upload()).resolves.toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.removeBlobIfUnused).toHaveBeenCalledWith(DIR, PROCESSED_SHA, expect.any(Function));

    mocks.fileCreate.mockRejectedValueOnce(foreignKeyViolation({ index: "File_tabId_folderId_fkey" }));
    await expect(upload()).resolves.toEqual({ ok: false, error: { code: "tab-not-found" } });

    expect(mocks.removeBlobIfUnused).toHaveBeenCalledTimes(2);
  });

  it("keeps a blob that a version holds when it removes the blob of a failed upload", async () => {
    mocks.fileCreate.mockRejectedValueOnce(knownError("P1001"));
    await upload();
    const isUsed = mocks.removeBlobIfUnused.mock.calls[0]?.[2] as () => Promise<boolean>;

    mocks.versionCount.mockResolvedValueOnce(1);
    await expect(isUsed()).resolves.toBe(true);
    mocks.versionCount.mockResolvedValueOnce(0);
    await expect(isUsed()).resolves.toBe(false);
  });

  it("answers a name taken by an upload at the same time with the file that took it", async () => {
    mocks.fileCreate.mockRejectedValueOnce(uniqueViolation({ index: "File_tabId_name_key" }));
    mocks.fileFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(STORED_ROW);

    await expect(upload()).resolves.toEqual({ ok: false, error: { code: "name-taken", file: STORED_FILE } });
    expect(mocks.removeBlobIfUnused).toHaveBeenCalled();
  });

  it("stores a new version based on the lock version, with the next number, and logs it", async () => {
    mocks.fileFindFirst.mockResolvedValue(STORED_ROW);
    mocks.fileUpdateMany.mockResolvedValue({ count: 1 });
    mocks.versionFindFirst.mockResolvedValue({ number: 2 });
    mocks.fileFindUniqueOrThrow.mockResolvedValue({ ...STORED_ROW, lockVersion: 4 });

    const result = await upload("diagram.png", { ...NEW_FILE, replace: 3 });

    expect(result).toEqual({ ok: true, value: { ...STORED_FILE, lockVersion: 4 } });
    expect(mocks.fileUpdateMany.mock.calls[0]?.[0]).toMatchObject({
      data: { lockVersion: { increment: 1 }, lastEditedById: ACTOR_ID, lastEditedVia: "web" },
    });
    expect(mocks.versionCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { fileId: STORED_ROW.id, number: 3, sha256: PROCESSED_SHA, userId: ACTOR_ID, via: "web" },
    });
    expect(mocks.fileCreate).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: STORED_ROW.id }),
      "file version uploaded",
    );
  });

  it("refuses a new version when the file was changed while the upload ran, and removes the blob", async () => {
    mocks.fileFindFirst.mockResolvedValue(STORED_ROW);
    mocks.fileUpdateMany.mockResolvedValue({ count: 0 });
    mocks.fileFindUnique.mockResolvedValue({ ...STORED_ROW, lockVersion: 4 });

    await expect(upload("diagram.png", { ...NEW_FILE, replace: 3 })).resolves.toEqual({
      ok: false,
      error: { code: "file-changed", file: { ...STORED_FILE, lockVersion: 4 } },
    });
    expect(mocks.versionCreate).not.toHaveBeenCalled();
    expect(mocks.removeBlobIfUnused).toHaveBeenCalled();

    mocks.fileFindUnique.mockResolvedValue(null);
    await expect(upload("diagram.png", { ...NEW_FILE, replace: 3 })).resolves.toEqual({
      ok: false,
      error: { code: "file-not-found" },
    });
  });
});

describe("checkUploadName", () => {
  const check = (name: string, actor: ContentActor = ACTOR) => fileService.checkUploadName(actor, PLACE, name);

  it("answers a free name with null and a taken one with the file of that name", async () => {
    await expect(check("diagram.png")).resolves.toEqual({ ok: true, value: null });
    mocks.fileFindFirst.mockResolvedValue(STORED_ROW);
    await expect(check("diagram.png")).resolves.toEqual({ ok: true, value: STORED_FILE });
    expect(mocks.receiveBlob).not.toHaveBeenCalled();
  });

  it("makes the checks of an upload: an admin, the role, the tab and the name", async () => {
    await expect(check("diagram.png", ADMIN)).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });
    mocks.roleFindFirst.mockResolvedValueOnce({ role: "reader" });
    await expect(check("diagram.png")).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });
    mocks.tabFindFirst.mockResolvedValueOnce(null);
    await expect(check("diagram.png")).resolves.toEqual({ ok: false, error: { code: "tab-not-found" } });
    await expect(check("photo.jpeg")).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(mocks.fileFindFirst).not.toHaveBeenCalled();
  });

  it("answers a failed read with failed", async () => {
    mocks.fileFindFirst.mockRejectedValue(new Error("connection lost"));

    await expect(check("diagram.png")).resolves.toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: FOLDER_ID }),
      "failed to check upload name",
    );
  });
});

describe("revertFile", () => {
  const revert = (version: number, lockVersion: number | null = 3) =>
    fileService.revertFile(ACTOR, FILE_ID, { version, lockVersion });

  it("stores the content of the version as the newest version, without a blob, and logs it", async () => {
    await expect(revert(1)).resolves.toEqual({ ok: true, value: { ...STORED_FILE, lockVersion: 4 } });
    expect(mocks.fileUpdateMany.mock.calls[0]?.[0]).toMatchObject({
      data: { lockVersion: { increment: 1 }, lastEditedById: ACTOR_ID, lastEditedVia: "web" },
    });
    expect(mocks.versionCreate.mock.calls[0]?.[0]).toEqual({
      data: {
        sha256: SHA,
        size: 1000,
        width: 30,
        height: 40,
        fileId: FILE_ID,
        number: 3,
        userId: ACTOR_ID,
        via: "web",
        revertedTo: 1,
      },
    });
    expect(mocks.receiveBlob).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith(
      { fileId: FILE_ID, lockVersion: 4, version: 1, channel: "web" },
      "file reverted",
    );
  });

  it("refuses a version that does not exist and the current version", async () => {
    await expect(revert(5)).resolves.toEqual({ ok: false, error: { code: "version-not-found" } });
    await expect(revert(2)).resolves.toEqual({ ok: false, error: { code: "version-not-found" } });
    expect(mocks.versionCreate).not.toHaveBeenCalled();
  });

  it("refuses a revert based on an older lock version, or on none, with the file as it is now", async () => {
    mocks.fileUpdateMany.mockResolvedValue({ count: 0 });
    mocks.fileFindUnique.mockResolvedValue({ ...STORED_ROW, lockVersion: 4 });

    await expect(revert(1)).resolves.toEqual({
      ok: false,
      error: { code: "file-changed", file: { ...STORED_FILE, lockVersion: 4 } },
    });
    await expect(revert(1, null)).resolves.toEqual({
      ok: false,
      error: { code: "file-changed", file: { ...STORED_FILE, lockVersion: 4 } },
    });
    mocks.fileFindUnique.mockResolvedValue(null);
    await expect(revert(1)).resolves.toEqual({ ok: false, error: { code: "file-not-found" } });
    expect(mocks.versionCreate).not.toHaveBeenCalled();
  });

  it("answers a malformed id without asking the database, and any other error with failed", async () => {
    await expect(fileService.revertFile(ACTOR, MALFORMED_ID, { version: 1, lockVersion: 3 })).resolves.toEqual({
      ok: false,
      error: { code: "file-not-found" },
    });
    expect(mocks.roleFindFirst).not.toHaveBeenCalled();

    mocks.transaction.mockRejectedValue(knownError("P1001"));
    await expect(revert(1)).resolves.toEqual({ ok: false, error: { code: "failed" } });
  });
});

describe("moveOrRenameFile", () => {
  const move = (input: Partial<{ name: string; tabId: string | null; lockVersion: number | null }> = {}) =>
    fileService.moveOrRenameFile(ACTOR, FILE_ID, { name: "network.png", tabId: null, lockVersion: 3, ...input });

  it("stores the name and place under the exclusive lock of the links, counts the lock version up and logs it", async () => {
    await expect(move()).resolves.toEqual({
      ok: true,
      value: { ...STORED_FILE, lockVersion: 4, updatedPages: [] },
    });
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(String(mocks.executeRaw.mock.calls[0]?.[0])).toContain("pg_advisory_xact_lock(");
    expect(mocks.fileUpdateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: FILE_ID, lockVersion: 3, deletedAt: null },
      data: { name: "network.png", tabId: null, lockVersion: { increment: 1 }, lastEditedById: ACTOR_ID },
    });
    // The links and embeds of the old name and place are looked up in the index.
    expect(mocks.linkFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { folderId: FOLDER_ID, tabName: "guides", pageName: "diagram.png" },
    });
    expect(mocks.info).toHaveBeenCalledWith(
      { fileId: FILE_ID, tabId: null, lockVersion: 4, linkingPages: 0, channel: "web" },
      "file moved or renamed",
    );
  });

  it("stores nothing for the own name and place, and answers with the file as stored", async () => {
    mocks.fileUpdateMany.mockResolvedValue({ count: 0 });
    mocks.txFileFindFirst.mockImplementation(({ where }: { where: { OR?: unknown } }) =>
      Promise.resolve(where.OR ? null : STORED_ROW),
    );

    await expect(move({ name: "diagram.png", tabId: TAB_ID })).resolves.toEqual({
      ok: true,
      value: { ...STORED_FILE, updatedPages: [] },
    });
    expect(mocks.linkFindMany).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith(
      { fileId: FILE_ID, channel: "web" },
      "file not changed: name and place are the same",
    );
  });

  it("refuses a move based on an older lock version, or on none, with the file as it is now", async () => {
    mocks.fileUpdateMany.mockResolvedValue({ count: 0 });
    mocks.txFileFindFirst.mockResolvedValue(null);
    mocks.fileFindUnique
      .mockResolvedValueOnce({ type: "png", folderId: FOLDER_ID })
      .mockResolvedValueOnce({ ...STORED_ROW, lockVersion: 4 })
      .mockResolvedValueOnce({ type: "png", folderId: FOLDER_ID })
      .mockResolvedValueOnce({ ...STORED_ROW, lockVersion: 4 });

    const changed = { ok: false, error: { code: "file-changed", file: { ...STORED_FILE, lockVersion: 4 } } };
    await expect(move()).resolves.toEqual(changed);
    await expect(move({ lockVersion: null })).resolves.toEqual(changed);
    expect(mocks.linkFindMany).not.toHaveBeenCalled();
  });

  it("checks in the order of a move: the id, the place, the name rule, the file, the extension", async () => {
    await expect(
      fileService.moveOrRenameFile(ACTOR, MALFORMED_ID, { name: "a.png", tabId: null, lockVersion: 3 }),
    ).resolves.toEqual({ ok: false, error: { code: "file-not-found" } });
    expect(mocks.roleFindFirst).not.toHaveBeenCalled();

    await expect(move({ tabId: MALFORMED_ID })).resolves.toEqual({ ok: false, error: { code: "tab-not-found" } });
    await expect(move({ name: "Network.png" })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-input", fieldErrors: { name: [expect.any(String)] } },
    });
    await expect(move({ name: "network.jpg" })).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid-input",
        fieldErrors: { name: ["The name must end in .png, because the type of a file cannot change"] },
      },
    });
    mocks.fileFindUnique.mockResolvedValue(null);
    await expect(move()).resolves.toEqual({ ok: false, error: { code: "file-not-found" } });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("answers a taken name, a tab of another folder and any other error", async () => {
    mocks.transaction.mockRejectedValueOnce(uniqueViolation({ index: "File_tabId_name_key" }));
    await expect(move()).resolves.toEqual({ ok: false, error: { code: "name-taken" } });
    mocks.transaction.mockRejectedValueOnce(foreignKeyViolation({ index: "File_tabId_folderId_fkey" }));
    await expect(move({ tabId: TAB_ID })).resolves.toEqual({ ok: false, error: { code: "tab-not-found" } });
    mocks.transaction.mockRejectedValueOnce(knownError("P1001"));
    await expect(move()).resolves.toEqual({ ok: false, error: { code: "failed" } });
  });
});

describe("deleteFile", () => {
  beforeEach(() => mocks.roleFindFirst.mockResolvedValue({ role: "manager" }));

  const remove = (lockVersion: number | null = 3) => fileService.deleteFile(ACTOR, FILE_ID, { lockVersion });

  it("soft deletes the file based on its lock version, returns its place and logs it", async () => {
    mocks.txFileFindFirst.mockResolvedValue({ folder: { name: "handbook" }, tab: { name: "guides" } });

    await expect(remove()).resolves.toEqual({
      ok: true,
      value: { folder: { name: "handbook" }, tab: { name: "guides" } },
    });
    expect(mocks.fileUpdateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: FILE_ID, lockVersion: 3, deletedAt: null },
      data: {
        deletedAt: expect.any(Date),
        tabId: null,
        lastEditedById: ACTOR_ID,
        lastEditedVia: "web",
        lockVersion: { increment: 1 },
      },
    });
    expect(mocks.info).toHaveBeenCalledWith({ fileId: FILE_ID, channel: "web" }, "file deleted");
  });

  it("refuses a delete based on an older lock version, or on none, with the file as it is now", async () => {
    mocks.txFileFindFirst.mockResolvedValue(null);
    mocks.fileFindUnique.mockResolvedValue({ ...STORED_ROW, lockVersion: 4 });

    const changed = { ok: false, error: { code: "file-changed", file: { ...STORED_FILE, lockVersion: 4 } } };
    await expect(remove()).resolves.toEqual(changed);
    await expect(remove(null)).resolves.toEqual(changed);
    mocks.fileFindUnique.mockResolvedValue(null);
    await expect(remove()).resolves.toEqual({ ok: false, error: { code: "file-not-found" } });
    expect(mocks.fileUpdateMany).not.toHaveBeenCalled();
  });

  it("answers a malformed id without asking the database, and any other error with failed", async () => {
    await expect(fileService.deleteFile(ACTOR, MALFORMED_ID, { lockVersion: 3 })).resolves.toEqual({
      ok: false,
      error: { code: "file-not-found" },
    });
    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
    mocks.transaction.mockRejectedValue(knownError("P1001"));
    await expect(remove()).resolves.toEqual({ ok: false, error: { code: "failed" } });
  });
});

describe("restoreFile", () => {
  beforeEach(() => mocks.roleFindFirst.mockResolvedValue({ role: "manager" }));

  const restore = (input: Partial<{ name: string; tabId: string | null }> = {}) =>
    fileService.restoreFile(ACTOR, FILE_ID, { name: "diagram.png", tabId: TAB_ID, ...input });

  it("restores the deleted file under the name and place, with the next lock version, and logs it", async () => {
    await expect(restore()).resolves.toMatchObject({ ok: true, value: STORED_FILE });
    expect(mocks.fileUpdateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: FILE_ID, deletedAt: { not: null } },
      data: {
        deletedAt: null,
        name: "diagram.png",
        tabId: TAB_ID,
        lastEditedById: ACTOR_ID,
        lastEditedVia: "web",
        lockVersion: { increment: 1 },
      },
    });
    expect(mocks.info).toHaveBeenCalledWith({ fileId: FILE_ID, tabId: TAB_ID, channel: "web" }, "file restored");
  });

  it("checks the place, the name rule and the extension of the type, and refuses a file that is not deleted", async () => {
    await expect(restore({ tabId: MALFORMED_ID })).resolves.toEqual({ ok: false, error: { code: "tab-not-found" } });
    await expect(restore({ name: "Diagram.png" })).resolves.toMatchObject({ error: { code: "invalid-input" } });
    await expect(restore({ name: "diagram.pdf" })).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid-input",
        fieldErrors: { name: ["The name must end in .png, because the type of a file cannot change"] },
      },
    });
    expect(mocks.fileUpdateMany).not.toHaveBeenCalled();
    mocks.fileFindUnique.mockResolvedValue(null);
    await expect(restore()).resolves.toEqual({ ok: false, error: { code: "file-not-found" } });
  });

  it("answers a taken name, a tab of another folder and any other error", async () => {
    mocks.fileUpdateMany.mockRejectedValueOnce(uniqueViolation({ index: "File_folderId_name_key" }));
    await expect(restore()).resolves.toEqual({ ok: false, error: { code: "name-taken" } });
    mocks.fileUpdateMany.mockRejectedValueOnce(foreignKeyViolation({ index: "File_tabId_folderId_fkey" }));
    await expect(restore()).resolves.toEqual({ ok: false, error: { code: "tab-not-found" } });
    mocks.fileUpdateMany.mockRejectedValueOnce(knownError("P1001"));
    await expect(restore()).resolves.toEqual({ ok: false, error: { code: "failed" } });
  });
});

describe("the reads of deleted files", () => {
  it("read nothing for an admin, and nothing for malformed ids or names", async () => {
    await expect(fileService.listDeletedFiles(ADMIN, FOLDER_ID)).resolves.toBeNull();
    await expect(fileService.getDeletedFile(ADMIN, "handbook", FILE_ID)).resolves.toBeNull();
    await expect(fileService.getDeletedFile(ACTOR, "Handbook", FILE_ID)).resolves.toBeNull();
    await expect(fileService.getDeletedFile(ACTOR, "handbook", MALFORMED_ID)).resolves.toBeNull();
    expect(mocks.fileFindFirst).not.toHaveBeenCalled();
  });

  it("read nothing for a Writer, for whom deleted items do not exist", async () => {
    mocks.roleFindFirst.mockResolvedValue({ role: "writer" });
    await expect(fileService.listDeletedFiles(ACTOR, FOLDER_ID)).resolves.toBeNull();
    expect(mocks.fileFindMany).not.toHaveBeenCalled();
  });

  it("list the deleted files with their size and who deleted them, newest first", async () => {
    mocks.roleFindFirst.mockResolvedValue({ role: "manager" });
    const deletedAt = new Date("2026-11-21T10:00:00Z");
    mocks.fileFindMany.mockResolvedValue([{ ...STORED_ROW, deletedAt, versions: [{ size: 1000 }] }]);

    await expect(fileService.listDeletedFiles(ACTOR, FOLDER_ID)).resolves.toMatchObject([
      { id: STORED_ROW.id, name: "diagram.png", type: "png", size: 1000, deletedAt, lastEditedBy: { name: "bob" } },
    ]);
    expect(mocks.fileFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { folderId: FOLDER_ID, deletedAt: { not: null } },
      orderBy: [{ deletedAt: "desc" }, { id: "asc" }],
    });
  });
});

describe("uploadSettings", () => {
  it("tells whether the store can be used, with the size limit", async () => {
    await expect(fileService.uploadSettings()).resolves.toEqual({ on: true, sizeLimit: 26_214_400 });
    mocks.getStore.mockResolvedValue({ on: false, reason: "not-set", dir: null });
    await expect(fileService.uploadSettings()).resolves.toEqual({ on: false, sizeLimit: 26_214_400 });
  });
});

describe("the reads of files", () => {
  it("read nothing for an admin", async () => {
    await expect(fileService.listFolderFiles(ADMIN, FOLDER_ID)).resolves.toBeNull();
    await expect(fileService.listTabFiles(ADMIN, TAB_ID)).resolves.toBeNull();
    await expect(fileService.getFile(ADMIN, "handbook", null, "diagram.png")).resolves.toBeNull();
    await expect(fileService.getFileContent(ADMIN, "handbook", null, "diagram.png", null)).resolves.toBeNull();
    expect(mocks.fileFindFirst).not.toHaveBeenCalled();
    expect(mocks.fileFindMany).not.toHaveBeenCalled();
  });

  it("read nothing for malformed names", async () => {
    for (const [folder, tab, name] of [
      ["Handbook", null, "diagram.png"],
      ["handbook", "Guides", "diagram.png"],
      ["handbook", null, "diagram.md"],
      ["handbook", null, "photo.jpeg"],
    ] as const) {
      await expect(fileService.getFile(ACTOR, folder, tab, name)).resolves.toBeNull();
      await expect(fileService.getFileContent(ACTOR, folder, tab, name, null)).resolves.toBeNull();
    }
    expect(mocks.fileFindFirst).not.toHaveBeenCalled();
  });

  it("list the files with the size of their current version and their last editor", async () => {
    const { id, name, type, updatedAt, lastEditedBy, lastEditedVia } = STORED_ROW;
    mocks.fileFindMany.mockResolvedValue([
      { id, name, type, updatedAt, lastEditedBy, lastEditedVia, versions: [{ size: 1234 }] },
    ]);

    await expect(fileService.listFolderFiles(ACTOR, FOLDER_ID)).resolves.toEqual([
      { id, name, type, updatedAt, lastEditedBy: { name: "bob", via: "web" }, size: 1234 },
    ]);
  });

  it("return a file with its role and its versions, newest first", async () => {
    const version = (number: number) => ({
      number,
      size: number * 100,
      width: 30,
      height: 40,
      createdAt: new Date("2026-11-20T10:00:00Z"),
      revertedTo: null,
      via: "web",
      user: { username: "bob" },
    });
    mocks.fileFindFirst.mockResolvedValue({
      ...STORED_ROW,
      folder: { id: FOLDER_ID, name: "handbook", roles: [{ role: "reader" }] },
      tab: { id: TAB_ID, name: "guides" },
      versions: [version(2), version(1)],
    });

    const file = await fileService.getFile(ACTOR, "handbook", "guides", "diagram.png");

    expect(file).toMatchObject({
      name: "diagram.png",
      role: "reader",
      folder: { id: FOLDER_ID, name: "handbook" },
      tab: { id: TAB_ID, name: "guides" },
      lastEditedBy: { name: "bob", via: "web" },
    });
    expect(file?.versions.map(({ number, uploadedBy }) => [number, uploadedBy])).toEqual([
      [2, { name: "bob", via: "web" }],
      [1, { name: "bob", via: "web" }],
    ]);
  });

  it("read no content while the files are off, and none of a missing blob", async () => {
    mocks.fileFindFirst.mockResolvedValue({
      name: "diagram.png",
      type: "png",
      versions: [{ number: 1, sha256: SHA, size: 10 }],
    });
    mocks.getStore.mockResolvedValueOnce({ on: false, reason: "not-set", dir: null });
    await expect(fileService.getFileContent(ACTOR, "handbook", null, "diagram.png", null)).resolves.toBeNull();

    mocks.readBlob.mockResolvedValueOnce(null);
    await expect(fileService.getFileContent(ACTOR, "handbook", null, "diagram.png", null)).resolves.toBeNull();
    expect(mocks.error).toHaveBeenCalledWith({ fileName: "diagram.png", version: 1 }, "blob of file version missing");

    const blob = { size: 10, stream: new ReadableStream() };
    mocks.readBlob.mockResolvedValueOnce(blob);
    await expect(fileService.getFileContent(ACTOR, "handbook", null, "diagram.png", 1)).resolves.toEqual({
      name: "diagram.png",
      type: "png",
      version: { number: 1, sha256: SHA, size: 10 },
      blob,
    });
    expect(mocks.readBlob).toHaveBeenLastCalledWith(DIR, SHA);
  });
});
