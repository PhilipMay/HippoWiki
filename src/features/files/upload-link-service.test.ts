import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  callerOfGrant: vi.fn(),
  checkUploadName: vi.fn(),
  uploadFile: vi.fn(),
  getFolderByName: vi.fn(),
  getTab: vi.fn(),
  listTabs: vi.fn(),
  getStore: vi.fn(),
  lifetime: 600,
  sizeLimit: 26_214_400,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    fileLinkKey: {
      findUnique: mocks.findUnique,
      createMany: mocks.createMany,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
    },
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    HIPPOWIKI_FILE_LINK_LIFETIME: mocks.lifetime,
    HIPPOWIKI_FILE_SIZE_LIMIT: mocks.sizeLimit,
  }),
}));
vi.mock("@/features/grants/service", () => ({ callerOfGrant: mocks.callerOfGrant }));
vi.mock("@/features/files/service", () => ({
  checkUploadName: mocks.checkUploadName,
  uploadFile: mocks.uploadFile,
}));
vi.mock("@/features/folders/service", () => ({
  getFolderByName: mocks.getFolderByName,
  getTab: mocks.getTab,
  listTabs: mocks.listTabs,
}));
vi.mock("@/features/files/store", () => ({ getStore: mocks.getStore }));

import type { McpActor } from "@/features/folder-roles/actors";
import { forgetLinkKey } from "@/features/files/link-service";
import { checkUploadLinkToken, signLinkToken, signUploadLinkToken, type UploadLink } from "@/features/files/link-token";
import { createUploadLink, uploadByLink, type UploadLinkRequest } from "@/features/files/upload-link-service";

const KEY = randomBytes(32);
const NOW = new Date("2026-11-23T10:00:00.000Z");
const NOW_SECONDS = NOW.getTime() / 1000;
const GRANT_ID = "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01";
const FOLDER_ID = "3a5c7e90-1b2d-4f6a-8c0e-2d4f6a8c0e11";
const TAB_ID = "8e6c4a20-1f3d-4b5a-9c7e-0d2f4b6a8c31";
const FILE_ID = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1003";
const CALLER = {
  actor: { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", type: "user" },
  connection: { grantId: GRANT_ID, folderId: FOLDER_ID, role: "writer" },
};
const ACTOR: McpActor = {
  id: CALLER.actor.id,
  name: "alice",
  type: "user",
  channel: "mcp",
  connection: { grantId: GRANT_ID, folderId: FOLDER_ID, role: "writer" },
};
/** The file of the name at the place, as `checkUploadName()` returns it. */
const STORED = { id: FILE_ID, name: "diagram.png", type: "png", lockVersion: 3 };
/** The file as `uploadFile()` stores it. */
const UPLOADED = { ...STORED, lockVersion: 4, version: { number: 2, size: 4096, width: 30, height: 40 } };

/** An upload link for a new version of the file in the tab, as the wiki makes it, with the given changes. */
function linkOf(changes: Partial<UploadLink> = {}): UploadLink {
  return {
    grant: GRANT_ID,
    tab: TAB_ID,
    name: "diagram.png",
    size: 4096,
    strip: true,
    file: FILE_ID,
    lockVersion: 3,
    exp: NOW_SECONDS + 600,
    ...changes,
  };
}

function tokenOf(changes: Partial<UploadLink> = {}, key = KEY): string {
  return signUploadLinkToken(key, linkOf(changes));
}

const BODY = [new Uint8Array([1, 2, 3])];

function upload(token: string, tab: string | null = "guides", name = "diagram.png", folder = "handbook") {
  return uploadByLink(token, folder, tab, name, BODY, 4096);
}

/** Everything that was passed to the logger, as one string. */
function logged(): string {
  return JSON.stringify([mocks.info.mock.calls, mocks.warn.mock.calls, mocks.error.mock.calls]);
}

/** That no part of the token was logged: neither its data part nor its signature. */
function expectTokenNotLogged(token: string): void {
  const [dataPart = "", signature = ""] = token.split(".");
  expect(logged()).not.toContain(dataPart.slice(0, 16));
  expect(logged()).not.toContain(signature.slice(0, 16));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  forgetLinkKey();
  mocks.lifetime = 600;
  mocks.sizeLimit = 26_214_400;
  mocks.findUnique.mockResolvedValue({ secret: KEY.toString("hex") });
  mocks.callerOfGrant.mockResolvedValue(CALLER);
  mocks.getStore.mockResolvedValue({ on: true, dir: "/srv/files" });
  mocks.getFolderByName.mockResolvedValue({ id: FOLDER_ID, name: "handbook", role: "writer" });
  mocks.getTab.mockResolvedValue({ id: TAB_ID, name: "guides" });
  mocks.listTabs.mockResolvedValue([{ id: TAB_ID, name: "guides" }]);
  mocks.checkUploadName.mockResolvedValue({ ok: true, value: STORED });
  mocks.uploadFile.mockResolvedValue({ ok: true, value: UPLOADED });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createUploadLink", () => {
  const NEW_VERSION: UploadLinkRequest = { size: 4096, lockVersion: 3, stripMetadata: true };
  const NEW_FILE: UploadLinkRequest = { size: 4096, lockVersion: null, stripMetadata: true };

  function create(request = NEW_VERSION, tab: string | null = "guides", name = "diagram.png") {
    return createUploadLink(ACTOR, "handbook", tab, name, request);
  }

  it("signs a token for a new version with the grant, the ids, the name, the size, the choice, the file, the lock version and the expiry", async () => {
    const created = await create();

    if (!created.ok) return expect.fail(`no link: ${created.error.code}`);
    expect(mocks.getFolderByName).toHaveBeenCalledExactlyOnceWith(ACTOR, "handbook");
    expect(mocks.getTab).toHaveBeenCalledExactlyOnceWith(ACTOR, "handbook", "guides");
    expect(mocks.checkUploadName).toHaveBeenCalledExactlyOnceWith(
      ACTOR,
      { folderId: FOLDER_ID, tabId: TAB_ID },
      "diagram.png",
    );
    const { token, ...link } = created.value;
    expect(link).toStrictEqual({
      name: "diagram.png",
      tab: "guides",
      type: "png",
      size: 4096,
      expiresAt: new Date((NOW_SECONDS + 600) * 1000),
    });
    expect(checkUploadLinkToken(KEY, token)).toStrictEqual({
      ok: true,
      data: { use: "file-upload-link", v: 1, ...linkOf() },
    });
  });

  it("signs a token for a new file directly in the folder without a file and a lock version", async () => {
    mocks.checkUploadName.mockResolvedValue({ ok: true, value: null });

    const created = await create({ ...NEW_FILE, stripMetadata: false }, null, "photo.jpg");

    if (!created.ok) return expect.fail(`no link: ${created.error.code}`);
    expect(mocks.getTab).not.toHaveBeenCalled();
    expect(created.value).toMatchObject({ name: "photo.jpg", tab: null, type: "jpeg" });
    expect(checkUploadLinkToken(KEY, created.value.token)).toMatchObject({
      ok: true,
      data: { tab: null, name: "photo.jpg", strip: false, file: null, lockVersion: null },
    });
  });

  it("never carries the choice of the metadata for a PDF, which is stored byte for byte", async () => {
    mocks.checkUploadName.mockResolvedValue({ ok: true, value: null });

    const created = await create(NEW_FILE, null, "manual.pdf");

    expect(created.ok && checkUploadLinkToken(KEY, created.value.token)).toMatchObject({
      ok: true,
      data: { strip: false },
    });
  });

  it("takes the name without surrounding whitespace, as the upload in the browser does", async () => {
    const created = await create(NEW_VERSION, "guides", " diagram.png ");

    expect(created.ok && created.value.name).toBe("diagram.png");
  });

  it("writes no row: it only reads the key of the links", async () => {
    await create();
    await create();

    expect(mocks.findUnique).toHaveBeenCalledOnce();
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ["a folder that the actor cannot read", () => mocks.getFolderByName.mockResolvedValue(null), "folder-not-found"],
    ["a tab that does not exist", () => mocks.getTab.mockResolvedValue(null), "tab-not-found"],
    [
      "a role that does not allow it",
      () => mocks.checkUploadName.mockResolvedValue({ ok: false, error: { code: "not-allowed" } }),
      "not-allowed",
    ],
    [
      "a failed read",
      () => mocks.checkUploadName.mockResolvedValue({ ok: false, error: { code: "failed" } }),
      "failed",
    ],
  ])("refuses %s, without a token", async (_case, arrange, code) => {
    arrange();

    await expect(create()).resolves.toStrictEqual({ ok: false, error: { code } });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a name against the rule with the messages of the name field, and an extension of another type apart", async () => {
    const fieldErrors = { name: ["Use lowercase letters, digits and single hyphens, then a dot and png"] };
    mocks.checkUploadName.mockResolvedValue({ ok: false, error: { code: "invalid-input", fieldErrors } });

    await expect(create(NEW_FILE, null, "Diagram.PNG")).resolves.toStrictEqual({
      ok: false,
      error: { code: "invalid-input", fieldErrors },
    });
    for (const name of ["diagram.svg", "photo.jpeg", "notes.txt"]) {
      await expect(create(NEW_FILE, null, name), name).resolves.toStrictEqual({
        ok: false,
        error: { code: "invalid-extension" },
      });
    }
    await expect(create(NEW_FILE, null, "diagram")).resolves.toMatchObject({ error: { code: "invalid-input" } });
  });

  it.each([
    ["0", 0],
    ["a fraction", 4096.5],
    ["a negative size", -1],
    ["not a number", Number.NaN],
  ])("refuses a size of %s, after the name and without a token", async (_case, size) => {
    await expect(create({ ...NEW_VERSION, size })).resolves.toStrictEqual({
      ok: false,
      error: { code: "invalid-size" },
    });
    expect(mocks.checkUploadName).toHaveBeenCalledOnce();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("takes a size up to the size limit and refuses one over it with the limit", async () => {
    await expect(create({ ...NEW_VERSION, size: 26_214_400 })).resolves.toMatchObject({ ok: true });
    await expect(create({ ...NEW_VERSION, size: 26_214_401 })).resolves.toStrictEqual({
      ok: false,
      error: { code: "too-large", limit: 26_214_400 },
    });
  });

  it("refuses while the files are off, after the size", async () => {
    mocks.getStore.mockResolvedValue({ on: false, reason: "not-set", dir: null });

    await expect(create()).resolves.toStrictEqual({ ok: false, error: { code: "files-off" } });
    await expect(create({ ...NEW_VERSION, size: 0 })).resolves.toStrictEqual({
      ok: false,
      error: { code: "invalid-size" },
    });
  });

  it("refuses a new file whose name is taken, a new version of a missing file and one based on another lock version", async () => {
    await expect(create(NEW_FILE)).resolves.toStrictEqual({ ok: false, error: { code: "name-taken" } });
    await expect(create({ ...NEW_VERSION, lockVersion: 2 })).resolves.toStrictEqual({
      ok: false,
      error: { code: "file-changed" },
    });
    mocks.checkUploadName.mockResolvedValue({ ok: true, value: null });
    await expect(create()).resolves.toStrictEqual({ ok: false, error: { code: "file-not-found" } });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});

describe("uploadByLink", () => {
  it("uploads with the actor of MCP of the grant at the place of the link, with its size, choice, file and lock version", async () => {
    const token = tokenOf();

    await expect(upload(token)).resolves.toStrictEqual({ ok: true, value: { file: UPLOADED, caller: CALLER } });

    expect(mocks.callerOfGrant).toHaveBeenCalledExactlyOnceWith(GRANT_ID);
    const actor = { ...CALLER.actor, channel: "mcp", connection: CALLER.connection };
    expect(mocks.getFolderByName).toHaveBeenCalledExactlyOnceWith(actor, "handbook");
    expect(mocks.uploadFile).toHaveBeenCalledExactlyOnceWith(
      actor,
      { folderId: FOLDER_ID, tabId: TAB_ID },
      "diagram.png",
      BODY,
      { contentLength: 4096, stripMetadata: true, replace: 3, size: 4096, fileId: FILE_ID, refusalLevel: "info" },
    );
    expect(logged()).toBe("[[],[],[]]");
  });

  it("uploads a new file directly in the folder without a lock version, so that a taken name is refused", async () => {
    await upload(tokenOf({ tab: null, file: null, lockVersion: null, strip: false }), null);

    expect(mocks.listTabs).not.toHaveBeenCalled();
    expect(mocks.uploadFile.mock.calls[0]?.[1]).toEqual({ folderId: FOLDER_ID, tabId: null });
    expect(mocks.uploadFile.mock.calls[0]?.[4]).toEqual({
      contentLength: 4096,
      stripMetadata: false,
      replace: null,
      size: 4096,
      fileId: null,
      refusalLevel: "info",
    });
  });

  it.each([
    ["a token of another shape", () => `${"a".repeat(40)}=.${"b".repeat(43)}`, "malformed"],
    ["a token signed with another key", () => tokenOf({}, randomBytes(32)), "bad-signature"],
    [
      "a download token",
      () => signLinkToken(KEY, { grant: GRANT_ID, version: FILE_ID, exp: NOW_SECONDS + 600 }),
      "bad-data",
    ],
  ])("refuses %s at warn, without the token and without asking for the grant", async (_case, token, reason) => {
    const value = token();

    await expect(upload(value)).resolves.toStrictEqual({ ok: false, error: { code: "not-accepted" } });

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ reason }, "upload link refused");
    expect(mocks.callerOfGrant).not.toHaveBeenCalled();
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expectTokenNotLogged(value);
  });

  it.each([
    ["past its expiry", NOW_SECONDS - 1],
    ["at its expiry", NOW_SECONDS],
    ["further away than the lifetime", NOW_SECONDS + 601],
  ])("refuses a link %s at info, without asking for the grant", async (_case, exp) => {
    const token = tokenOf({ exp });

    await expect(upload(token)).resolves.toStrictEqual({ ok: false, error: { code: "not-accepted" } });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { reason: "expired", grantId: GRANT_ID, exp },
      "upload link refused",
    );
    expect(mocks.callerOfGrant).not.toHaveBeenCalled();
    expectTokenNotLogged(token);
  });

  it("refuses a link whose grant is no longer accepted at info, before the files and the address", async () => {
    mocks.callerOfGrant.mockResolvedValue(null);
    const token = tokenOf();

    await expect(upload(token)).resolves.toStrictEqual({ ok: false, error: { code: "not-accepted" } });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith({ reason: "grant", grantId: GRANT_ID }, "upload link refused");
    expect(mocks.getStore).not.toHaveBeenCalled();
    expect(mocks.getFolderByName).not.toHaveBeenCalled();
    expectTokenNotLogged(token);
  });

  it("refuses a valid link while the files are off, at info, before the address", async () => {
    mocks.getStore.mockResolvedValue({ on: false, reason: "not-set", dir: null });

    await expect(upload(tokenOf())).resolves.toStrictEqual({ ok: false, error: { code: "not-accepted" } });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { reason: "files-off", grantId: GRANT_ID },
      "upload link refused",
    );
    expect(mocks.getFolderByName).not.toHaveBeenCalled();
  });

  it.each([
    ["another name", () => upload(tokenOf(), "guides", "other.png")],
    ["another folder", () => upload(tokenOf(), "guides", "diagram.png", "notes")],
    ["a tab for a link directly in the folder", () => upload(tokenOf({ tab: null }), "guides")],
  ])("refuses the address with %s at info, as not accepted", async (_case, run) => {
    mocks.getFolderByName.mockImplementation((_actor: unknown, name: string) =>
      Promise.resolve(name === "handbook" ? { id: FOLDER_ID, name } : { id: TAB_ID, name }),
    );

    await expect(run()).resolves.toStrictEqual({ ok: false, error: { code: "not-accepted" } });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ reason: "address", grantId: GRANT_ID }),
      "upload link refused",
    );
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it.each([
    ["deleted", [], "guides"],
    ["renamed", [{ id: TAB_ID, name: "manuals" }], "guides"],
    ["named otherwise in the address", [{ id: TAB_ID, name: "guides" }], null],
  ])("refuses a link whose tab was %s as tab-changed, at info", async (_case, tabs, tab) => {
    mocks.listTabs.mockResolvedValue(tabs);

    await expect(upload(tokenOf(), tab)).resolves.toStrictEqual({ ok: false, error: { code: "tab-changed" } });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ reason: "tab-changed", grantId: GRANT_ID }),
      "upload link refused",
    );
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it.each([
    ["name-taken", { code: "name-taken", file: STORED }, { code: "name-taken" }],
    ["file-changed", { code: "file-changed", file: STORED }, { code: "file-changed" }],
    ["file-not-found", { code: "file-not-found" }, { code: "file-changed" }],
    ["tab-not-found", { code: "tab-not-found" }, { code: "tab-changed" }],
    ["wrong-type", { code: "wrong-type", detected: "pdf", expected: "png" }, undefined],
    ["wrong-size", { code: "wrong-size", expected: 4096 }, undefined],
    ["too-large", { code: "too-large", limit: 1024 }, undefined],
    ["disk-full", { code: "disk-full" }, undefined],
    ["invalid-image", { code: "invalid-image", reason: "unreadable" }, undefined],
    ["failed", { code: "failed" }, undefined],
    ["not-allowed", { code: "not-allowed" }, { code: "not-accepted" }],
    ["folder-not-found", { code: "folder-not-found" }, { code: "not-accepted" }],
    ["files-off", { code: "files-off" }, { code: "not-accepted" }],
  ])("answers the refusal %s of the upload, logged at info with its reason", async (reason, error, expected) => {
    mocks.uploadFile.mockResolvedValue({ ok: false, error });
    const token = tokenOf();

    const result = await upload(token);

    expect(result).toStrictEqual({ ok: false, error: expected ?? error });
    const [details, message] = mocks.info.mock.calls[0] ?? [];
    expect(message).toBe("upload link refused");
    // A refusal that ends the link names the refusal of the upload; any other names what the app is told.
    const loggedReason = expected?.code === "not-accepted" ? reason : (expected ?? error).code;
    expect(details).toStrictEqual({
      reason: loggedReason,
      grantId: GRANT_ID,
      folder: "handbook",
      tab: "guides",
      name: "diagram.png",
    });
    expect(mocks.warn).not.toHaveBeenCalled();
    expectTokenNotLogged(token);
  });
});
