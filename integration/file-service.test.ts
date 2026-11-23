// Runs the files service against the test database and a files directory of its own (`integration/setup.ts`), to
// check its reads and writes on real data and real blobs.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";

import { inBrowser, type BrowserActor } from "@/features/folder-roles/actors";
import * as fileService from "@/features/files/service";
import * as pageService from "@/features/pages/service";
import type { User } from "@/generated/prisma/client";

import {
  createFile,
  createFolder,
  createPage,
  createTab,
  createUser,
  getTestDb,
  testFilesDir,
} from "../e2e/support/database";
import { PHOTO_CAMERA, pdfBytes, phonePhoto, pngBytes } from "../e2e/support/files";
import { KNOWN_USER } from "../prisma/known-users";
import { createBob, NOT_ALLOWED, revisionsOf, storedPage } from "./helpers";

/** The user who makes the writes, the known user `alice`, Owner of every folder a test creates without roles. */
let user: User;
let actor: BrowserActor;

beforeEach(async () => {
  user = await createUser({ id: KNOWN_USER.id, name: "alice" });
  actor = inBrowser(user);
});

/** The options of an upload of a new file, with the metadata removed. */
const NEW_FILE = { contentLength: null, stripMetadata: true, replace: null };

/** Every blob in the files directory, by its SHA-256. */
async function blobs(): Promise<string[]> {
  const entries = await readdir(join(testFilesDir(), "blobs"), { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

/** The bytes of the blob of the given SHA-256. */
function blobBytes(sha256: string): Promise<Buffer> {
  return readFile(join(testFilesDir(), "blobs", sha256.slice(0, 2), sha256));
}

describe("uploading a file", () => {
  it("stores a new file in a tab with its first version and its blob", async () => {
    const tab = await createTab({ name: "guides" });
    const bytes = await pngBytes(64, 48);

    const result = await fileService.uploadFile(
      actor,
      { folderId: tab.folderId, tabId: tab.id },
      "diagram.png",
      [bytes],
      NEW_FILE,
    );

    expect(result).toMatchObject({ ok: true, value: { name: "diagram.png", type: "png", lockVersion: 1 } });
    const file = await getTestDb().file.findFirstOrThrow({ include: { versions: true } });
    expect(file).toMatchObject({
      name: "diagram.png",
      type: "png",
      folderId: tab.folderId,
      tabId: tab.id,
      deletedAt: null,
      lastEditedById: user.id,
      lastEditedVia: "web",
      lockVersion: 1,
    });
    expect(file.versions).toEqual([
      expect.objectContaining({ number: 1, width: 64, height: 48, userId: user.id, via: "web", revertedTo: null }),
    ]);
    const [version] = file.versions;
    if (!version) throw new Error("no version");
    expect(await blobs()).toEqual([version.sha256]);
    expect((await blobBytes(version.sha256)).length).toBe(version.size);
  });

  it("stores a photo upright and without its metadata, or as uploaded", async () => {
    const folder = await createFolder();
    const photo = await phonePhoto();

    await fileService.uploadFile(actor, { folderId: folder.id, tabId: null }, "stripped.jpg", [photo], NEW_FILE);
    await fileService.uploadFile(actor, { folderId: folder.id, tabId: null }, "kept.jpg", [photo], {
      ...NEW_FILE,
      stripMetadata: false,
    });

    const files = await getTestDb().file.findMany({ include: { versions: true }, orderBy: { name: "asc" } });
    const [kept, stripped] = files.map((file) => file.versions[0]);
    if (!kept || !stripped) throw new Error("not stored");
    expect([stripped.width, stripped.height, kept.width, kept.height]).toEqual([30, 40, 30, 40]);
    expect(await blobBytes(kept.sha256)).toEqual(photo);
    const strippedBytes = await blobBytes(stripped.sha256);
    expect(strippedBytes.toString("latin1")).not.toContain(PHOTO_CAMERA);
    expect((await sharp(strippedBytes).metadata()).exif).toBeUndefined();
  });

  it("stores a new version of the file of the name, based on its lock version, and the address returns it", async () => {
    const folder = await createFolder({ name: "handbook" });
    const file = await createFile({ folder, name: "manual.pdf", versions: [{ bytes: pdfBytes("first") }] });
    const second = pdfBytes("second");

    const result = await fileService.uploadFile(actor, { folderId: folder.id, tabId: null }, "manual.pdf", [second], {
      ...NEW_FILE,
      replace: 1,
    });

    expect(result).toMatchObject({ ok: true, value: { id: file.id, lockVersion: 2 } });
    const versions = await getTestDb().fileVersion.findMany({ where: { fileId: file.id }, orderBy: { number: "asc" } });
    expect(versions.map(({ number, userId }) => ({ number, userId }))).toEqual([
      { number: 1, userId: file.lastEditedById },
      { number: 2, userId: user.id },
    ]);
    const content = await fileService.getFileContent(actor, "handbook", null, "manual.pdf", null);
    expect(content?.version.number).toBe(2);
    expect(Buffer.from(await new Response(content?.blob.stream).arrayBuffer())).toEqual(second);
    const first = await fileService.getFileContent(actor, "handbook", null, "manual.pdf", 1);
    expect(Buffer.from(await new Response(first?.blob.stream).arrayBuffer())).toEqual(pdfBytes("first"));
  });

  it("refuses a taken name with the file of that name and stores nothing", async () => {
    const tab = await createTab();
    const file = await createFile({ tab, name: "diagram.png" });
    const before = await blobs();

    const result = await fileService.uploadFile(
      actor,
      { folderId: tab.folderId, tabId: tab.id },
      "diagram.png",
      [await pngBytes(5, 5)],
      NEW_FILE,
    );

    expect(result).toMatchObject({ ok: false, error: { code: "name-taken", file: { id: file.id } } });
    expect(await getTestDb().fileVersion.count()).toBe(1);
    expect(await blobs()).toEqual(before);
  });

  it("stores a file setup.png next to a page setup, and the same name in another tab and directly in the folder", async () => {
    const folder = await createFolder();
    const [first, second] = [await createTab({ folder }), await createTab({ folder })];
    await createPage({ folder, name: "setup" });
    await createFile({ tab: first, name: "setup.png" });

    for (const tabId of [null, second.id]) {
      const result = await fileService.uploadFile(
        actor,
        { folderId: folder.id, tabId },
        "setup.png",
        [await pngBytes()],
        NEW_FILE,
      );
      expect(result, String(tabId)).toMatchObject({ ok: true });
    }
    expect(await getTestDb().file.count({ where: { name: "setup.png" } })).toBe(3);
  });

  it("stores one of two uploads of a new file of the same name at the same time", async () => {
    const folder = await createFolder();
    const upload = async (colour: string) =>
      fileService.uploadFile(
        actor,
        { folderId: folder.id, tabId: null },
        "diagram.png",
        [await pngBytes(8, 8, colour)],
        NEW_FILE,
      );

    for (let round = 0; round < 5; round += 1) {
      await getTestDb().fileVersion.deleteMany();
      await getTestDb().file.deleteMany();
      const results = await Promise.all([upload("red"), upload("blue")]);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "name-taken" }) }),
      ]);
      expect(await getTestDb().file.count()).toBe(1);
    }
  });

  it("refuses a new version based on an older lock version, and keeps the blob of no version", async () => {
    const folder = await createFolder();
    await createFile({ folder, name: "diagram.png", lockVersion: 3 });
    const before = await blobs();

    const result = await fileService.uploadFile(
      actor,
      { folderId: folder.id, tabId: null },
      "diagram.png",
      [await pngBytes(9, 9)],
      { ...NEW_FILE, replace: 2 },
    );

    expect(result).toMatchObject({ ok: false, error: { code: "file-changed", file: { lockVersion: 3 } } });
    expect(await getTestDb().fileVersion.count()).toBe(1);
    expect(await blobs()).toEqual(before);
  });

  it("stores one of two new versions based on the same lock version at the same time", async () => {
    const folder = await createFolder();
    const file = await createFile({ folder, name: "diagram.png" });
    const upload = async (colour: string) =>
      fileService.uploadFile(
        actor,
        { folderId: folder.id, tabId: null },
        "diagram.png",
        [await pngBytes(8, 8, colour)],
        { ...NEW_FILE, replace: 1 },
      );

    const results = await Promise.all([upload("red"), upload("blue")]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ error: { code: "file-changed" } });
    expect(await getTestDb().fileVersion.count({ where: { fileId: file.id } })).toBe(2);
  });

  it("refuses an upload into a tab of another folder and one by a Reader, and stores nothing", async () => {
    const folder = await createFolder();
    const otherTab = await createTab();
    const bob = await createBob();
    const readable = await createFolder({ roles: [{ user: bob, role: "reader" }] });

    await expect(
      fileService.uploadFile(actor, { folderId: folder.id, tabId: otherTab.id }, "a.png", [await pngBytes()], NEW_FILE),
    ).resolves.toEqual({ ok: false, error: { code: "tab-not-found" } });
    await expect(
      fileService.uploadFile(
        inBrowser(bob),
        { folderId: readable.id, tabId: null },
        "a.png",
        [await pngBytes()],
        NEW_FILE,
      ),
    ).resolves.toEqual(NOT_ALLOWED);
    expect(await getTestDb().file.count()).toBe(0);
  });

  it("removes the blob of an upload whose transaction fails, unless another version holds it", async () => {
    const folder = await createFolder();
    const held = await createFile({ folder, name: "held.png", versions: [{ bytes: await pngBytes(7, 7) }] });
    const db = getTestDb();
    await db.$executeRawUnsafe(`
      CREATE FUNCTION test_refuse_file() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'refused by the test'; END $$`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER test_refuse_file BEFORE INSERT ON "File" FOR EACH ROW EXECUTE FUNCTION test_refuse_file()`,
    );
    try {
      const before = await blobs();
      const kept = { ...NEW_FILE, stripMetadata: false };
      const place = { folderId: folder.id, tabId: null };

      await expect(fileService.uploadFile(actor, place, "new.png", [await pngBytes(13, 13)], kept)).resolves.toEqual({
        ok: false,
        error: { code: "failed" },
      });
      expect(await blobs()).toEqual(before);

      const sameContent = await blobBytes(held.versions[0]?.sha256 ?? "");
      await fileService.uploadFile(actor, place, "again.png", [sameContent], kept);
      expect(await blobs()).toEqual(before);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER test_refuse_file ON "File"`);
      await db.$executeRawUnsafe(`DROP FUNCTION test_refuse_file()`);
    }
    expect(await db.file.count()).toBe(1);
  });
});

describe("reverting a file", () => {
  it("stores the blob of the old version as the newest version and writes no blob", async () => {
    const folder = await createFolder({ name: "handbook" });
    const file = await createFile({
      folder,
      name: "diagram.png",
      lockVersion: 2,
      versions: [{ bytes: await pngBytes(10, 10) }, { bytes: await pngBytes(20, 20) }],
    });
    const before = await blobs();

    const result = await fileService.revertFile(actor, file.id, { version: 1, lockVersion: 2 });

    expect(result).toMatchObject({ ok: true, value: { lockVersion: 3 } });
    expect(await blobs()).toEqual(before);
    const versions = await getTestDb().fileVersion.findMany({ where: { fileId: file.id }, orderBy: { number: "asc" } });
    const [first, , third] = versions;
    expect(versions).toHaveLength(3);
    expect(third).toMatchObject({
      number: 3,
      sha256: first?.sha256,
      size: first?.size,
      width: 10,
      height: 10,
      userId: user.id,
      via: "web",
      revertedTo: 1,
    });
    const content = await fileService.getFileContent(actor, "handbook", null, "diagram.png", null);
    expect(content?.version).toMatchObject({ number: 3, sha256: first?.sha256 });
    expect(await getTestDb().file.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
      lockVersion: 3,
      lastEditedById: user.id,
    });
  });

  it("refuses a revert based on an older lock version and one to the current version, and stores nothing", async () => {
    const folder = await createFolder();
    const file = await createFile({ folder, lockVersion: 2, versions: [{}, {}] });

    await expect(fileService.revertFile(actor, file.id, { version: 1, lockVersion: 1 })).resolves.toMatchObject({
      ok: false,
      error: { code: "file-changed", file: { lockVersion: 2 } },
    });
    await expect(fileService.revertFile(actor, file.id, { version: 2, lockVersion: 2 })).resolves.toEqual({
      ok: false,
      error: { code: "version-not-found" },
    });
    expect(await getTestDb().fileVersion.count()).toBe(2);
    expect((await getTestDb().file.findUniqueOrThrow({ where: { id: file.id } })).lockVersion).toBe(2);
  });

  it("stores one of a new version and a revert based on the same lock version at the same time", async () => {
    for (let round = 0; round < 5; round += 1) {
      const folder = await createFolder();
      const file = await createFile({ folder, name: "diagram.png", lockVersion: 2, versions: [{}, {}] });

      const results = await Promise.all([
        fileService.revertFile(actor, file.id, { version: 1, lockVersion: 2 }),
        fileService.uploadFile(actor, { folderId: folder.id, tabId: null }, "diagram.png", [await pngBytes(9, 9)], {
          ...NEW_FILE,
          replace: 2,
        }),
      ]);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.find((result) => !result.ok)).toMatchObject({ error: { code: "file-changed" } });
      expect(await getTestDb().fileVersion.count({ where: { fileId: file.id } })).toBe(3);
    }
  });

  it("refuses a revert by a Reader", async () => {
    const bob = await createBob();
    const folder = await createFolder({ roles: [{ user: bob, role: "reader" }] });
    const file = await createFile({ folder, versions: [{}, {}] });

    await expect(fileService.revertFile(inBrowser(bob), file.id, { version: 1, lockVersion: 1 })).resolves.toEqual(
      NOT_ALLOWED,
    );
  });
});

describe("moving and renaming a file", () => {
  it("updates the links and embeds of every page that is not deleted, with a revision each, and keeps the versions", async () => {
    const folder = await createFolder();
    const guides = await createTab({ folder, name: "guides" });
    const file = await createFile({ tab: guides, name: "diagram.png", versions: [{}, {}] });
    const setup = await createPage({
      folder,
      name: "setup",
      content: "# Setup\n\n![[guides/diagram.png|The network]]",
    });
    const network = await createPage({ tab: guides, name: "network", content: "# Network\n\n[[guides/diagram.png]]" });
    const other = await createPage({ folder, name: "other", content: "# Other\n\n[[guides/diagram]] [[diagram.png]]" });
    const deleted = await createPage({ folder, content: "# Gone\n\n![[guides/diagram.png]]", deletedAt: new Date() });
    const untouched = await Promise.all([other, deleted].map(({ id }) => storedPage(id)));

    const result = await fileService.moveOrRenameFile(actor, file.id, {
      name: "network.png",
      tabId: null,
      lockVersion: file.lockVersion,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { name: "network.png", tab: null, lockVersion: file.lockVersion + 1, lastEditedBy: { name: "alice" } },
    });
    expect(result.ok && result.value.updatedPages.map(({ name }) => name)).toEqual(["network", "setup"]);
    expect((await storedPage(setup.id)).content).toBe("# Setup\n\n![[network.png|The network]]");
    expect((await storedPage(network.id)).content).toBe("# Network\n\n[[network.png]]");
    for (const id of [setup.id, network.id]) {
      expect((await revisionsOf(id)).at(-1)).toMatchObject({ userId: user.id, via: "web", linksUpdated: true });
    }
    expect(await Promise.all([other, deleted].map(({ id }) => storedPage(id)))).toEqual(untouched);
    expect(await getTestDb().fileVersion.count({ where: { fileId: file.id } })).toBe(2);
    await expect(fileService.getFile(actor, folder.name, null, "network.png")).resolves.toMatchObject({
      versions: [{ number: 2 }, { number: 1 }],
    });
  });

  it("changes only the targets of a linking page whose footnote definition with an embed stands before another link, and back", async () => {
    const folder = await createFolder();
    const guides = await createTab({ folder, name: "guides" });
    const file = await createFile({ tab: guides, name: "diagram.png" });
    const original =
      "# Notes\n\n[^1]: see ![[guides/diagram.png]]\n\nText[^1] and [[guides/diagram.png|the diagram]].\n";
    const notes = await createPage({ folder, name: "notes", content: original });
    const links = async () =>
      (await getTestDb().pageLink.findMany({ where: { pageId: notes.id } })).map(({ tabName, pageName }) =>
        tabName === null ? pageName : `${tabName}/${pageName}`,
      );
    const move = async (name: string, tabId: string | null) => {
      const { lockVersion } = await getTestDb().file.findUniqueOrThrow({ where: { id: file.id } });
      return fileService.moveOrRenameFile(actor, file.id, { name, tabId, lockVersion });
    };

    await expect(move("network.png", null)).resolves.toMatchObject({ ok: true });

    const moved = "# Notes\n\n[^1]: see ![[network.png]]\n\nText[^1] and [[network.png|the diagram]].\n";
    expect((await storedPage(notes.id)).content).toBe(moved);
    expect(await links()).toEqual(["network.png"]);
    expect((await revisionsOf(notes.id)).at(-1)).toMatchObject({ number: 2, content: moved, linksUpdated: true });

    await expect(move("diagram.png", guides.id)).resolves.toMatchObject({ ok: true });

    expect((await storedPage(notes.id)).content).toBe(original);
    expect(await links()).toEqual(["guides/diagram.png"]);
    expect((await revisionsOf(notes.id)).at(-1)).toMatchObject({ number: 3, content: original, linksUpdated: true });
  });

  it("refuses a taken name, a tab of another folder and an older lock version, and changes no page", async () => {
    const folder = await createFolder();
    const guides = await createTab({ folder, name: "guides" });
    const file = await createFile({ tab: guides, name: "diagram.png", lockVersion: 2 });
    await createFile({ folder, name: "taken.png" });
    const elsewhere = await createTab({ folder: await createFolder(), name: "elsewhere" });
    const page = await createPage({ folder, content: "# Setup\n\n![[guides/diagram.png]]" });
    const before = await storedPage(page.id);

    const move = (input: { name?: string; tabId?: string | null; lockVersion?: number }) =>
      fileService.moveOrRenameFile(actor, file.id, { name: "network.png", tabId: null, lockVersion: 2, ...input });
    await expect(move({ name: "taken.png" })).resolves.toEqual({ ok: false, error: { code: "name-taken" } });
    await expect(move({ tabId: elsewhere.id })).resolves.toEqual({ ok: false, error: { code: "tab-not-found" } });
    await expect(move({ lockVersion: 1 })).resolves.toMatchObject({
      ok: false,
      error: { code: "file-changed", file: { name: "diagram.png", lockVersion: 2 } },
    });
    await expect(move({ name: "network.pdf" })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });

    expect(await storedPage(page.id)).toEqual(before);
    expect(await getTestDb().file.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
      name: "diagram.png",
      tabId: guides.id,
      lockVersion: 2,
    });
  });

  it("stores nothing for a move to the own name and place, and refuses a Reader", async () => {
    const bob = await createBob();
    const folder = await createFolder({
      roles: [
        { user, role: "owner" },
        { user: bob, role: "reader" },
      ],
    });
    const file = await createFile({ folder, name: "diagram.png", editor: bob });
    const stored = await getTestDb().file.findUniqueOrThrow({ where: { id: file.id } });

    await expect(
      fileService.moveOrRenameFile(actor, file.id, { name: "diagram.png", tabId: null, lockVersion: 1 }),
    ).resolves.toMatchObject({ ok: true, value: { name: "diagram.png", lockVersion: 1, updatedPages: [] } });
    await expect(
      fileService.moveOrRenameFile(inBrowser(bob), file.id, { name: "other.png", tabId: null, lockVersion: 1 }),
    ).resolves.toEqual(NOT_ALLOWED);

    expect(await getTestDb().file.findUniqueOrThrow({ where: { id: file.id } })).toEqual(stored);
  });
});

describe("deleting and restoring a file", () => {
  it("loses its tab, frees its name at once and keeps its versions, and a restore brings all of them back", async () => {
    const folder = await createFolder();
    const guides = await createTab({ folder, name: "guides" });
    const file = await createFile({ tab: guides, name: "diagram.png", versions: [{}, {}] });

    await expect(fileService.deleteFile(actor, file.id, { lockVersion: file.lockVersion })).resolves.toEqual({
      ok: true,
      value: { folder: { name: folder.name }, tab: { name: "guides" } },
    });
    expect(await getTestDb().file.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
      tabId: null,
      deletedAt: expect.any(Date),
      lastEditedById: user.id,
      lockVersion: file.lockVersion + 1,
    });
    await expect(fileService.getFile(actor, folder.name, "guides", "diagram.png")).resolves.toBeNull();
    await expect(fileService.listTabFiles(actor, guides.id)).resolves.toEqual([]);
    await expect(fileService.getDeletedFile(actor, folder.name, file.id)).resolves.toMatchObject({
      name: "diagram.png",
      versions: [{ number: 2 }, { number: 1 }],
    });

    // The name is free at once: a new file takes it, so the restore under it is refused.
    const taken = await createFile({ tab: guides, name: "diagram.png" });
    await expect(fileService.restoreFile(actor, file.id, { name: "diagram.png", tabId: guides.id })).resolves.toEqual({
      ok: false,
      error: { code: "name-taken" },
    });
    await expect(fileService.restoreFile(actor, file.id, { name: "diagram.png", tabId: null })).resolves.toMatchObject({
      ok: true,
      value: { name: "diagram.png", tab: null, lockVersion: file.lockVersion + 2 },
    });
    await expect(fileService.getFile(actor, folder.name, null, "diagram.png")).resolves.toMatchObject({
      versions: [{ number: 2 }, { number: 1 }],
    });
    expect(taken.deletedAt).toBeNull();
  });

  it("refuses a delete based on an older lock version, and one by a Writer, and deletes nothing", async () => {
    const bob = await createBob();
    const folder = await createFolder({
      roles: [
        { user, role: "owner" },
        { user: bob, role: "writer" },
      ],
    });
    const file = await createFile({ folder, name: "diagram.png", lockVersion: 2 });

    await expect(fileService.deleteFile(actor, file.id, { lockVersion: 1 })).resolves.toMatchObject({
      ok: false,
      error: { code: "file-changed", file: { lockVersion: 2 } },
    });
    await expect(fileService.deleteFile(inBrowser(bob), file.id, { lockVersion: 2 })).resolves.toEqual(NOT_ALLOWED);
    expect(await getTestDb().file.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({ deletedAt: null });
  });

  it("lists the deleted files of the folder only, newest first, and only for a Manager or Owner", async () => {
    const bob = await createBob();
    const folder = await createFolder({
      roles: [
        { user, role: "owner" },
        { user: bob, role: "writer" },
      ],
    });
    await createFile({ folder, name: "older.png", deletedAt: new Date("2026-11-01T10:00:00Z") });
    await createFile({ folder, name: "newer.pdf", deletedAt: new Date("2026-11-02T10:00:00Z") });
    await createFile({ folder, name: "kept.png" });
    await createFile({ folder: await createFolder(), name: "other.png", deletedAt: new Date() });

    expect((await fileService.listDeletedFiles(actor, folder.id))?.map(({ name }) => name)).toEqual([
      "newer.pdf",
      "older.png",
    ]);
    await expect(fileService.listDeletedFiles(inBrowser(bob), folder.id)).resolves.toBeNull();
  });
});

describe("the reads of files", () => {
  it("list the files of a folder and of a tab by name, without deleted files and without those of the other place", async () => {
    const folder = await createFolder();
    const tab = await createTab({ folder });
    await createFile({ folder, name: "zeta.pdf" });
    await createFile({ folder, name: "alpha.png" });
    await createFile({ folder, name: "gone.png", deletedAt: new Date() });
    await createFile({ tab, name: "in-tab.gif" });

    const direct = await fileService.listFolderFiles(actor, folder.id);
    const inTab = await fileService.listTabFiles(actor, tab.id);

    expect(direct?.map(({ name, type }) => [name, type])).toEqual([
      ["alpha.png", "png"],
      ["zeta.pdf", "pdf"],
    ]);
    expect(inTab?.map(({ name }) => name)).toEqual(["in-tab.gif"]);
    expect(direct?.[1]?.size).toBe(pdfBytes().length);
  });

  it("return a file with its details and versions, newest first, and never a deleted one", async () => {
    const folder = await createFolder({ name: "handbook" });
    const tab = await createTab({ folder, name: "guides" });
    await createFile({ tab, name: "diagram.png", versions: [{}, { revertedTo: 1 }] });
    await createFile({ folder, name: "gone.png", deletedAt: new Date() });

    const file = await fileService.getFile(actor, "handbook", "guides", "diagram.png");

    expect(file).toMatchObject({
      name: "diagram.png",
      type: "png",
      role: "owner",
      folder: { id: folder.id, name: "handbook" },
      tab: { id: tab.id, name: "guides" },
    });
    expect(file?.versions.map(({ number, revertedTo, width }) => [number, revertedTo, width])).toEqual([
      [2, 1, 40],
      [1, null, 40],
    ]);
    await expect(fileService.getFile(actor, "handbook", null, "gone.png")).resolves.toBeNull();
    await expect(fileService.getFileContent(actor, "handbook", null, "gone.png", null)).resolves.toBeNull();
    await expect(fileService.getFile(actor, "handbook", null, "diagram.png")).resolves.toBeNull();
  });

  it("stay as they were for a file once a page that shows it is deleted", async () => {
    const folder = await createFolder({ name: "handbook" });
    await createFile({ folder, name: "diagram.png" });
    const page = await createPage({ folder, content: "# Intro\n\n![Diagram](/files/handbook/diagram.png)" });

    await expect(pageService.deletePage(actor, page.id, { version: 1 })).resolves.toMatchObject({ ok: true });

    expect((await fileService.listFolderFiles(actor, folder.id))?.map(({ name }) => name)).toEqual(["diagram.png"]);
    await expect(fileService.getFile(actor, "handbook", null, "diagram.png")).resolves.toMatchObject({
      name: "diagram.png",
    });
    const content = await fileService.getFileContent(actor, "handbook", null, "diagram.png", null);
    expect(content).toMatchObject({ name: "diagram.png", version: { number: 1 } });
    const bytes = Buffer.from(await new Response(content?.blob.stream).arrayBuffer());
    expect(bytes).toEqual(await blobBytes(content?.version.sha256 ?? ""));
  });

  it("read nothing of a folder without a role and nothing of a version that does not exist", async () => {
    const bob = await createBob();
    const folder = await createFolder({ name: "secret", roles: [{ user: bob, role: "owner" }] });
    await createFile({ folder, name: "diagram.png" });

    await expect(fileService.getFile(actor, "secret", null, "diagram.png")).resolves.toBeNull();
    await expect(fileService.getFileContent(actor, "secret", null, "diagram.png", null)).resolves.toBeNull();
    await expect(fileService.listFolderFiles(actor, folder.id)).resolves.toBeNull();
    await expect(fileService.getFileContent(inBrowser(bob), "secret", null, "diagram.png", 2)).resolves.toBeNull();
    await expect(fileService.getFileContent(inBrowser(bob), "secret", null, "diagram.png", 1)).resolves.toMatchObject({
      version: { number: 1 },
    });
  });
});
