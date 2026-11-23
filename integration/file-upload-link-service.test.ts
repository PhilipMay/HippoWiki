// Runs the upload links against the test database and a files directory of its own (`integration/setup.ts`): which
// links are handed out, what an upload by a link stores and records, and which changes of the file and of the access of
// the connected app end a link.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authService from "@/features/auth/service";
import { inBrowser, inMcp, type BrowserActor, type McpActor } from "@/features/folder-roles/actors";
import { forgetLinkKey, getLinkKey } from "@/features/files/link-service";
import { signUploadLinkToken, type UploadLink } from "@/features/files/link-token";
import * as fileService from "@/features/files/service";
import type { StoreState } from "@/features/files/store";
import { createUploadLink, uploadByLink, type UploadLinkRequest } from "@/features/files/upload-link-service";
import * as grantService from "@/features/grants/service";
import { isOAuthOn } from "@/features/oauth/issuer";
import type { Folder, OAuthGrant, Tab, User } from "@/generated/prisma/client";

import {
  createFile,
  createFolder,
  createGrant,
  createPage,
  createTab,
  createUser,
  getTestDb,
  TEST_PASSWORD,
  testFilesDir,
} from "../e2e/support/database";
import { PHOTO_CAMERA, pdfBytes, phonePhoto, pngBytes } from "../e2e/support/files";
import { KNOWN_USER } from "../prisma/known-users";

// The real check of OAuth, watched, so that a test can switch OAuth off as a server without `HIPPOWIKI_PUBLIC_URL` is.
vi.mock(import("@/features/oauth/issuer"), { spy: true });

/** The known user `alice`, Owner of the folder of the tests, who connected an app to it as a Writer. */
let alice: User;
let browser: BrowserActor;
let folder: Folder;
let guides: Tab;
let grant: OAuthGrant;
/** The actor of MCP of the connection of the grant. */
let actor: McpActor;

beforeEach(async () => {
  alice = await createUser({ id: KNOWN_USER.id, name: "alice", mustChangePassword: false });
  browser = inBrowser(alice);
  folder = await createFolder({ name: "handbook", roles: [{ user: alice, role: "owner" }] });
  guides = await createTab({ folder, name: "guides" });
  ({ grant } = await createGrant({ owner: alice, folder, role: "writer" }));
  actor = inMcp(alice, { grantId: grant.id, folderId: folder.id, role: "writer" });
});

afterEach(() => {
  vi.useRealTimers();
});

/** A request for a link for a new file of the given bytes, with the metadata removed. */
function newFile(bytes: Uint8Array, changes: Partial<UploadLinkRequest> = {}): UploadLinkRequest {
  return { size: bytes.length, lockVersion: null, stripMetadata: true, ...changes };
}

/** The token of a link for the request, as the tool hands it out; fails the test if no link is handed out. */
async function linkFor(tab: string | null, name: string, request: UploadLinkRequest): Promise<string> {
  const created = await createUploadLink(actor, "handbook", tab, name, request);
  if (!created.ok) return expect.fail(`no link: ${created.error.code}`);
  return created.value.token;
}

/** Uploads the bytes by the link at the given place. */
function send(token: string, tab: string | null, name: string, bytes: Uint8Array) {
  return uploadByLink(token, "handbook", tab, name, [bytes], bytes.length);
}

/** The bytes of the current version of the file at the place, as the store keeps them. */
async function currentBytes(tab: string | null, name: string): Promise<Buffer> {
  const content = await fileService.getFileContent(browser, "handbook", tab, name, null);
  if (!content) throw new Error("no content");
  return Buffer.from(await new Response(content.blob.stream).arrayBuffer());
}

/** Every file and version of the database, to compare before and after a refused upload. */
async function stored() {
  return {
    files: await getTestDb().file.findMany({ orderBy: { id: "asc" } }),
    versions: await getTestDb().fileVersion.findMany({ orderBy: { id: "asc" } }),
  };
}

/** Uses a store in the given state instead of the files directory, until the end of `run`. */
async function withStore<T>(state: StoreState, run: () => Promise<T>): Promise<T> {
  const global = globalThis as { hippowikiFileStore?: Promise<StoreState> };
  const before = global.hippowikiFileStore;
  global.hippowikiFileStore = Promise.resolve(state);
  try {
    return await run();
  } finally {
    global.hippowikiFileStore = before;
  }
}

describe("createUploadLink", () => {
  it.each<[string, string | null, string, Partial<UploadLinkRequest>, string]>([
    ["a name against the rule", null, "Diagram.PNG", {}, "invalid-input"],
    ["an extension of another type", null, "diagram.svg", {}, "invalid-extension"],
    ["a tab that does not exist", "nowhere", "diagram.png", {}, "tab-not-found"],
    ["a size over the size limit", null, "diagram.png", { size: 26_214_401 }, "too-large"],
    ["a taken name for a new file", "guides", "taken.png", {}, "name-taken"],
    ["a missing file for a new version", null, "missing.png", { lockVersion: 1 }, "file-not-found"],
    ["an old lock version for a new version", "guides", "taken.png", { lockVersion: 1 }, "file-changed"],
  ])("refuses %s with an error and no link", async (_case, tab, name, changes, code) => {
    const taken = await createFile({ tab: guides, name: "taken.png", editor: alice, lockVersion: 2 });
    expect(taken.lockVersion).toBe(2);

    const created = await createUploadLink(actor, "handbook", tab, name, newFile(await pngBytes(), changes));

    expect(created).toMatchObject({ ok: false, error: { code } });
  });

  it("refuses with files-off while the files directory cannot be used", async () => {
    const created = await withStore({ on: false, reason: "not-set", dir: null }, async () =>
      createUploadLink(actor, "handbook", null, "diagram.png", newFile(await pngBytes())),
    );

    expect(created).toStrictEqual({ ok: false, error: { code: "files-off" } });
  });

  it("hands out a link for a new file and for a new version based on the current lock version, and stores nothing", async () => {
    await createFile({ tab: guides, name: "taken.png", editor: alice, lockVersion: 2 });
    const before = await stored();

    await expect(
      createUploadLink(actor, "handbook", null, "new.png", newFile(await pngBytes())),
    ).resolves.toMatchObject({ ok: true, value: { name: "new.png", tab: null, type: "png" } });
    await expect(
      createUploadLink(actor, "handbook", "guides", "taken.png", newFile(await pngBytes(), { lockVersion: 2 })),
    ).resolves.toMatchObject({ ok: true, value: { name: "taken.png", tab: "guides" } });
    expect(await stored()).toEqual(before);
  });
});

describe("uploadByLink", () => {
  it("stores a new file with the user of the connection and the channel mcp, and answers with its version", async () => {
    const bytes = await pngBytes(30, 20);
    const token = await linkFor("guides", "diagram.png", newFile(bytes));

    const result = await send(token, "guides", "diagram.png", bytes);

    expect(result).toMatchObject({
      ok: true,
      value: {
        file: {
          name: "diagram.png",
          type: "png",
          lockVersion: 1,
          lastEditedBy: { name: "alice", via: "mcp" },
          tab: { name: "guides" },
          version: { number: 1, width: 30, height: 20 },
        },
        caller: { actor: { id: alice.id }, connection: { grantId: grant.id } },
      },
    });
    const file = await fileService.getFile(actor, "handbook", "guides", "diagram.png");
    expect(file?.lastEditedBy).toEqual({ name: "alice", via: "mcp" });
    expect(file?.versions[0]?.uploadedBy).toEqual({ name: "alice", via: "mcp" });
  });

  it("stores a new version of a PDF byte for byte, based on the lock version of the link", async () => {
    await createFile({ folder, name: "manual.pdf", editor: alice, versions: [{ bytes: pdfBytes("first") }] });
    const second = pdfBytes("second");
    const token = await linkFor(null, "manual.pdf", newFile(second, { lockVersion: 1 }));

    const result = await send(token, null, "manual.pdf", second);

    expect(result).toMatchObject({ ok: true, value: { file: { lockVersion: 2, version: { number: 2 } } } });
    expect(await currentBytes(null, "manual.pdf")).toEqual(second);
    const file = await fileService.getFile(browser, "handbook", null, "manual.pdf");
    expect(file?.versions.map(({ number, uploadedBy }) => [number, uploadedBy.via])).toEqual([
      [2, "mcp"],
      [1, "web"],
    ]);
  });

  it("removes the location and camera data of an image by default, and keeps its bytes with the choice turned off", async () => {
    const photo = await phonePhoto();
    const stripped = await linkFor(null, "stripped.jpg", newFile(photo));
    const kept = await linkFor(null, "kept.jpg", newFile(photo, { stripMetadata: false }));

    await expect(send(stripped, null, "stripped.jpg", photo)).resolves.toMatchObject({ ok: true });
    await expect(send(kept, null, "kept.jpg", photo)).resolves.toMatchObject({ ok: true });

    const strippedBytes = await currentBytes(null, "stripped.jpg");
    expect(strippedBytes.toString("latin1")).not.toContain(PHOTO_CAMERA);
    expect((await sharp(strippedBytes).metadata()).exif).toBeUndefined();
    expect(await currentBytes(null, "kept.jpg")).toEqual(photo);
  });

  it("refuses a body of one byte more or less than the stated size, and stores nothing", async () => {
    const bytes = await pngBytes();
    const token = await linkFor(null, "diagram.png", newFile(bytes));
    const before = await stored();

    await expect(send(token, null, "diagram.png", Buffer.concat([bytes, Buffer.from([0])]))).resolves.toStrictEqual({
      ok: false,
      error: { code: "wrong-size", expected: bytes.length },
    });
    await expect(send(token, null, "diagram.png", bytes.subarray(0, -1))).resolves.toStrictEqual({
      ok: false,
      error: { code: "wrong-size", expected: bytes.length },
    });
    expect(await stored()).toEqual(before);
  });

  it("refuses HTML named .png, a PDF sent for a .png link and an image that does not decode, and stores nothing", async () => {
    const html = Buffer.from("<!DOCTYPE html><html><body>Hi</body></html>");
    const pdf = pdfBytes();
    const png = await pngBytes();
    const broken = Buffer.concat([png.subarray(0, 40), Buffer.alloc(60)]);
    const before = await stored();

    for (const [bytes, code] of [
      [html, "wrong-type"],
      [pdf, "wrong-type"],
      [broken, "invalid-image"],
    ] as const) {
      const token = await linkFor(null, "diagram.png", newFile(bytes));
      await expect(send(token, null, "diagram.png", bytes), code).resolves.toMatchObject({
        ok: false,
        error: { code },
      });
    }
    expect(await stored()).toEqual(before);
  });

  it("refuses a new version after a version uploaded in the browser, and leaves the file as the browser left it", async () => {
    await createFile({ folder, name: "manual.pdf", editor: alice, versions: [{ bytes: pdfBytes("first") }] });
    const byLink = pdfBytes("by link");
    const token = await linkFor(null, "manual.pdf", newFile(byLink, { lockVersion: 1 }));
    const inBrowser = pdfBytes("in the browser");
    await expect(
      fileService.uploadFile(browser, { folderId: folder.id, tabId: null }, "manual.pdf", [inBrowser], {
        contentLength: null,
        stripMetadata: true,
        replace: 1,
        size: null,
        fileId: null,
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(send(token, null, "manual.pdf", byLink)).resolves.toStrictEqual({
      ok: false,
      error: { code: "file-changed" },
    });
    expect(await currentBytes(null, "manual.pdf")).toEqual(inBrowser);
  });

  it("refuses a new file after a file of the free name uploaded in the browser, and never makes it a new version", async () => {
    const byLink = await pngBytes(10, 10);
    const token = await linkFor(null, "diagram.png", newFile(byLink));
    const inBrowser = await pngBytes(12, 12);
    await fileService.uploadFile(browser, { folderId: folder.id, tabId: null }, "diagram.png", [inBrowser], {
      contentLength: null,
      stripMetadata: false,
      replace: null,
      size: null,
      fileId: null,
    });

    await expect(send(token, null, "diagram.png", byLink)).resolves.toStrictEqual({
      ok: false,
      error: { code: "name-taken" },
    });
    expect(await currentBytes(null, "diagram.png")).toEqual(inBrowser);
    expect(await getTestDb().fileVersion.count()).toBe(1);
  });

  it("refuses a new version for another file that took the name and the lock version of the file of the link", async () => {
    const first = await createFile({ folder, name: "manual.pdf", editor: alice });
    const token = await linkFor(null, "manual.pdf", newFile(pdfBytes("by link"), { lockVersion: 1 }));
    await getTestDb().file.update({ where: { id: first.id }, data: { deletedAt: new Date(), tabId: null } });
    await getTestDb().file.update({ where: { id: first.id }, data: { name: "old.pdf" } });
    await createFile({ folder, name: "manual.pdf", editor: alice });

    await expect(send(token, null, "manual.pdf", pdfBytes("by link"))).resolves.toStrictEqual({
      ok: false,
      error: { code: "file-changed" },
    });
  });

  it("stores at most one upload by a link: a second one is refused, and the file keeps the first", async () => {
    const first = await pngBytes(10, 10);
    const newToken = await linkFor(null, "diagram.png", newFile(first));
    await expect(send(newToken, null, "diagram.png", first)).resolves.toMatchObject({ ok: true });
    await expect(send(newToken, null, "diagram.png", first)).resolves.toStrictEqual({
      ok: false,
      error: { code: "name-taken" },
    });

    const second = await pngBytes(12, 12);
    const versionToken = await linkFor(null, "diagram.png", newFile(second, { lockVersion: 1, stripMetadata: false }));
    await expect(send(versionToken, null, "diagram.png", second)).resolves.toMatchObject({ ok: true });
    await expect(send(versionToken, null, "diagram.png", second)).resolves.toStrictEqual({
      ok: false,
      error: { code: "file-changed" },
    });
    expect(await currentBytes(null, "diagram.png")).toEqual(second);
    expect(await getTestDb().fileVersion.count()).toBe(2);
  });

  it("refuses a link whose tab was renamed or deleted as tab-changed", async () => {
    const bytes = await pngBytes();
    const token = await linkFor("guides", "diagram.png", newFile(bytes));
    await getTestDb().tab.update({ where: { id: guides.id }, data: { name: "manuals" } });

    await expect(send(token, "guides", "diagram.png", bytes)).resolves.toStrictEqual({
      ok: false,
      error: { code: "tab-changed" },
    });

    await getTestDb().tab.delete({ where: { id: guides.id } });
    await expect(send(token, "manuals", "diagram.png", bytes)).resolves.toStrictEqual({
      ok: false,
      error: { code: "tab-changed" },
    });
    // A new tab of the old name is another tab.
    await createTab({ folder, name: "guides" });
    await expect(send(token, "guides", "diagram.png", bytes)).resolves.toStrictEqual({
      ok: false,
      error: { code: "tab-changed" },
    });
    expect(await getTestDb().file.count()).toBe(0);
  });

  it("refuses the address of another name, another place or another folder as not accepted", async () => {
    const bytes = await pngBytes();
    const token = await linkFor(null, "diagram.png", newFile(bytes));
    await createFolder({ name: "notes", roles: [{ user: alice, role: "owner" }] });

    for (const [at, tab, name] of [
      ["handbook", null, "other.png"],
      ["handbook", "guides", "diagram.png"],
      ["notes", null, "diagram.png"],
    ] as const) {
      await expect(uploadByLink(token, at, tab, name, [bytes], bytes.length)).resolves.toStrictEqual({
        ok: false,
        error: { code: "not-accepted" },
      });
    }
    expect(await getTestDb().file.count()).toBe(0);
  });

  it("changes no page: no page gets a new revision", async () => {
    const page = await createPage({ folder, name: "setup", content: "# Setup\n\n![[diagram.png]]" });
    const bytes = await pngBytes();

    await send(await linkFor(null, "diagram.png", newFile(bytes)), null, "diagram.png", bytes);

    expect(await getTestDb().pageRevision.count({ where: { pageId: page.id } })).toBe(1);
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).version).toBe(1);
  });
});

describe("the end of an upload link", () => {
  let bytes: Buffer;
  let token: string;

  beforeEach(async () => {
    bytes = await pngBytes();
    token = await linkFor(null, "diagram.png", newFile(bytes));
  });

  /** Expects the upload by the link to be refused as not accepted, with nothing stored. */
  async function expectRefused(): Promise<void> {
    await expect(send(token, null, "diagram.png", bytes)).resolves.toStrictEqual({
      ok: false,
      error: { code: "not-accepted" },
    });
    expect(await getTestDb().file.count()).toBe(0);
  }

  /** The token of a link for the file with the given fields changed, signed with the key of the links. */
  async function signed(changes: Partial<UploadLink>): Promise<string> {
    return signUploadLinkToken(await getLinkKey(), {
      grant: grant.id,
      tab: null,
      name: "diagram.png",
      size: bytes.length,
      strip: true,
      file: null,
      lockVersion: null,
      exp: Math.floor(Date.now() / 1000) + 600,
      ...changes,
    });
  }

  it("comes at its expiry", async () => {
    vi.useFakeTimers({ now: Date.now() + 600_000, toFake: ["Date"] });

    await expectRefused();
  });

  it("comes for a link that expires later than the lifetime allows, as after the lifetime was lowered", async () => {
    token = await signed({ exp: Math.floor(Date.now() / 1000) + 3600 });

    await expectRefused();
  });

  it("comes once the app is revoked", async () => {
    await grantService.revokeGrant(alice, grant.id);
    await expectRefused();
  });

  it("comes once all apps are revoked", async () => {
    await grantService.revokeAllGrants(alice);
    await expectRefused();
  });

  it("comes once the user changed the own password and disconnected the apps", async () => {
    const login = await authService.logIn({ name: alice.name, password: TEST_PASSWORD }, new Headers(), "shared");
    if (!login.ok) return expect.fail(`login failed: ${login.error.code}`);
    const cookies = login.value.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
    const password = "my-new-password";
    const changed = await authService.changeOwnPassword(
      { currentPassword: TEST_PASSWORD, newPassword: password, repeatPassword: password },
      new Headers({ cookie: cookies.join("; ") }),
      "shared",
      true,
    );
    expect(changed.ok).toBe(true);

    await expectRefused();
  });

  it("comes at the end of the grant", async () => {
    await getTestDb().oAuthGrant.update({ where: { id: grant.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expectRefused();
  });

  it("comes while the role of the user is below the role of the grant or taken away", async () => {
    const where = { folderId_userId: { folderId: folder.id, userId: alice.id } };
    await getTestDb().folderRole.update({ where, data: { role: "reader" } });
    await expectRefused();

    await getTestDb().folderRole.delete({ where });
    await expectRefused();
  });

  it("comes once the same app is connected to the same address again, which replaces the grant", async () => {
    // A new grant of the same app at the same address deletes the older one (`replacedGrants()` of the token service).
    await getTestDb().oAuthGrant.delete({ where: { id: grant.id } });
    await expectRefused();
  });

  it("comes while OAuth is off, as on a server without HIPPOWIKI_PUBLIC_URL", async () => {
    vi.mocked(isOAuthOn).mockReturnValueOnce(false);
    await expectRefused();
  });

  it("comes once the key of the links is deleted and the server restarted", async () => {
    await getTestDb().fileLinkKey.deleteMany();
    forgetLinkKey();
    await expectRefused();
  });

  it("does not come before: the same upload by the link is stored", async () => {
    await expect(send(token, null, "diagram.png", bytes)).resolves.toMatchObject({ ok: true });
  });
});
