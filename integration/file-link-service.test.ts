// Runs the read of a file by a signed link against the test database and a files directory of its own
// (`integration/setup.ts`): which changes of the file and of the access of the connected app end a link.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inBrowser, type BrowserActor } from "@/features/folder-roles/actors";
import { getLinkedFileContent } from "@/features/files/link-service";
import * as fileService from "@/features/files/service";
import * as grantService from "@/features/grants/service";
import type { File, FileVersion, Folder, OAuthGrant, Tab, User } from "@/generated/prisma/client";

import {
  createFile,
  createFolder,
  createGrant,
  createTab,
  createUser,
  getTestDb,
  signFileLinkToken,
} from "../e2e/support/database";
import { pngBytes } from "../e2e/support/files";
import { KNOWN_USER } from "../prisma/known-users";

/** The known user `alice`, Owner of the folder of the tests, who connected an app to it. */
let alice: User;
let actor: BrowserActor;
let folder: Folder;
let guides: Tab;
let grant: OAuthGrant;
/** The file of the tests, in the tab "guides", with two versions; the second is the current one. */
let file: File & { versions: FileVersion[] };
let current: FileVersion;

beforeEach(async () => {
  alice = await createUser({ id: KNOWN_USER.id, name: "alice", mustChangePassword: false });
  actor = inBrowser(alice);
  folder = await createFolder({ name: "handbook", roles: [{ user: alice, role: "owner" }] });
  guides = await createTab({ folder, name: "guides" });
  ({ grant } = await createGrant({ owner: alice, folder, role: "writer" }));
  file = await createFile({
    tab: guides,
    name: "diagram.png",
    editor: alice,
    versions: [{ bytes: await pngBytes(10, 10) }, { bytes: await pngBytes(12, 12) }],
  });
  const version = file.versions[1];
  if (!version) throw new Error("no second version");
  current = version;
});

afterEach(() => {
  vi.useRealTimers();
});

/** The token of a link of the grant of the tests to the current version of the file, or to the given version. */
function tokenOf(version: { id: string } = current, exp?: number): Promise<string> {
  return signFileLinkToken({ grant: grant.id, version: version.id, ...(exp === undefined ? {} : { exp }) });
}

/** Reads the file by the link at the given place, and the bytes it sends; `null` if the link is refused. */
async function download(token: string, tab: string | null = "guides", name = "diagram.png", at = "handbook") {
  const linked = await getLinkedFileContent(token, at, tab, name);
  if (!linked) return null;
  return { ...linked, bytes: Buffer.from(await new Response(linked.content.blob.stream).arrayBuffer()) };
}

/** The bytes of the blob of a version, as the store keeps them. */
async function bytesOf(version: FileVersion): Promise<Buffer> {
  const content = await fileService.getFileContent(actor, "handbook", "guides", "diagram.png", version.number);
  if (!content) throw new Error("no content");
  return Buffer.from(await new Response(content.blob.stream).arrayBuffer());
}

describe("getLinkedFileContent", () => {
  it("gives the content of the current version and the caller of the grant", async () => {
    const expected = await bytesOf(current);

    const result = await download(await tokenOf());

    expect(result?.bytes).toEqual(expected);
    expect(result?.content).toMatchObject({ name: "diagram.png", type: "png", version: { id: current.id, number: 2 } });
    expect(result?.caller).toStrictEqual({
      actor: { id: alice.id, name: "alice", type: "user" },
      connection: { grantId: grant.id, folderId: folder.id, role: "writer" },
    });
  });

  it("refuses a link to an earlier version", async () => {
    const [first] = file.versions;
    await expect(download(await tokenOf(first))).resolves.toBeNull();
  });

  it("refuses the link after the file is renamed, under its old address", async () => {
    const token = await tokenOf();
    await fileService.moveOrRenameFile(actor, file.id, {
      name: "network.png",
      tabId: guides.id,
      lockVersion: file.lockVersion,
    });

    await expect(download(token)).resolves.toBeNull();
  });

  it("refuses the link after the file is moved, under its old address", async () => {
    const token = await tokenOf();
    await fileService.moveOrRenameFile(actor, file.id, {
      name: "diagram.png",
      tabId: null,
      lockVersion: file.lockVersion,
    });

    await expect(download(token)).resolves.toBeNull();
  });

  it("refuses the link after a new version of the file", async () => {
    const token = await tokenOf();
    const uploaded = await fileService.uploadFile(
      actor,
      { folderId: folder.id, tabId: guides.id },
      "diagram.png",
      [await pngBytes(14, 14)],
      { contentLength: null, stripMetadata: true, replace: file.lockVersion, size: null, fileId: null },
    );
    expect(uploaded.ok).toBe(true);

    await expect(download(token)).resolves.toBeNull();
  });

  it("refuses the link after a revert of the file, also to the version of the link's content", async () => {
    const token = await tokenOf();
    const reverted = await fileService.revertFile(actor, file.id, { version: 1, lockVersion: file.lockVersion });
    expect(reverted.ok).toBe(true);
    const again = await fileService.revertFile(actor, file.id, { version: 2, lockVersion: file.lockVersion + 1 });
    expect(again.ok).toBe(true);

    await expect(download(token)).resolves.toBeNull();
  });

  it("refuses the link after a delete, and works again after a restore to the same place", async () => {
    const token = await tokenOf();
    await fileService.deleteFile(actor, file.id, { lockVersion: file.lockVersion });

    await expect(download(token)).resolves.toBeNull();

    const restored = await fileService.restoreFile(actor, file.id, { name: "diagram.png", tabId: guides.id });
    expect(restored.ok).toBe(true);
    await expect(download(token)).resolves.not.toBeNull();
  });

  it("refuses the link of one file under the address of another", async () => {
    await createFile({ tab: guides, name: "other.png", editor: alice });

    await expect(download(await tokenOf(), "guides", "other.png")).resolves.toBeNull();
    await expect(download(await tokenOf(), null, "diagram.png")).resolves.toBeNull();
  });

  it("refuses a link to a file of another folder, on which the user has a role", async () => {
    const other = await createFolder({ name: "notes", roles: [{ user: alice, role: "owner" }] });
    const elsewhere = await createFile({ folder: other, name: "diagram.png", editor: alice });
    const version = elsewhere.versions[0];
    if (!version) throw new Error("no version");

    await expect(download(await tokenOf(version), null, "diagram.png", "notes")).resolves.toBeNull();
  });

  it("refuses the link once the app is revoked", async () => {
    const token = await tokenOf();
    await grantService.revokeGrant(alice, grant.id);

    await expect(download(token)).resolves.toBeNull();
  });

  it("refuses the link while the role of the user is below the role of the grant", async () => {
    const token = await tokenOf();
    const where = { folderId_userId: { folderId: folder.id, userId: alice.id } };
    await getTestDb().folderRole.update({ where, data: { role: "reader" } });

    await expect(download(token)).resolves.toBeNull();

    await getTestDb().folderRole.update({ where, data: { role: "writer" } });
    await expect(download(token)).resolves.not.toBeNull();
  });

  it("refuses an expired link", async () => {
    const start = Date.now();
    const token = await tokenOf(current, Math.floor(start / 1000) + 60);
    await expect(download(token)).resolves.not.toBeNull();

    vi.useFakeTimers({ now: start + 60_000, toFake: ["Date"] });

    await expect(download(token)).resolves.toBeNull();
  });

  it("writes nothing and leaves the last use of the grant unchanged", async () => {
    const token = await tokenOf();
    const counts = async () => ({
      grants: await getTestDb().oAuthGrant.findMany(),
      keys: await getTestDb().fileLinkKey.findMany(),
      files: await getTestDb().file.findMany(),
      versions: await getTestDb().fileVersion.count(),
    });
    const before = await counts();

    await download(token);
    await download(token);

    expect(await counts()).toEqual(before);
    expect(before.grants.find(({ id }) => id === grant.id)?.lastUsedAt).toBeNull();
  });
});
