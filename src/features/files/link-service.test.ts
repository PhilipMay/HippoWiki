import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  callerOfGrant: vi.fn(),
  getFileContent: vi.fn(),
  getStore: vi.fn(),
  lifetime: 600,
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
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ HIPPOWIKI_FILE_LINK_LIFETIME: mocks.lifetime }) }));
vi.mock("@/features/grants/service", () => ({ callerOfGrant: mocks.callerOfGrant }));
vi.mock("@/features/files/service", () => ({ getFileContent: mocks.getFileContent }));
vi.mock("@/features/files/store", () => ({ getStore: mocks.getStore }));

import { forgetLinkKey, getLinkedFileContent } from "@/features/files/link-service";
import { signLinkToken } from "@/features/files/link-token";

const KEY = randomBytes(32);
const NOW = new Date("2026-11-23T10:00:00.000Z");
const NOW_SECONDS = NOW.getTime() / 1000;
const GRANT_ID = "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01";
const VERSION_ID = "5e7a9c1b-3d5f-4a7c-9e1b-3d5f7a9c1b20";
const FOLDER_ID = "3a5c7e90-1b2d-4f6a-8c0e-2d4f6a8c0e11";
const CALLER = {
  actor: { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", type: "user" },
  connection: { grantId: GRANT_ID, folderId: FOLDER_ID, role: "reader" },
};
const PLACE = { folder: "handbook", tab: "guides", name: "diagram.png" };

/** The token of a link of the grant to the version, signed with the key of the tests. */
function tokenOf({ version = VERSION_ID, exp = NOW_SECONDS + 600, key = KEY } = {}): string {
  return signLinkToken(key, { grant: GRANT_ID, version, exp });
}

/** The content of the file as the files service returns it, with a stream whose cancel is watched. */
function contentOf(versionId = VERSION_ID) {
  const cancel = vi.fn().mockResolvedValue(undefined);
  return {
    name: "diagram.png",
    type: "png",
    version: { id: versionId, number: 3, sha256: "c".repeat(64), size: 4 },
    blob: { size: 4, stream: { cancel } },
  };
}

function read(token: string) {
  return getLinkedFileContent(token, PLACE.folder, PLACE.tab, PLACE.name);
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
  mocks.findUnique.mockResolvedValue({ secret: KEY.toString("hex") });
  mocks.callerOfGrant.mockResolvedValue(CALLER);
  mocks.getStore.mockResolvedValue({ on: true, dir: "/srv/files" });
  mocks.getFileContent.mockResolvedValue(contentOf());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getLinkedFileContent", () => {
  it("gives the content of the current version and the caller of the grant, read as the connected app", async () => {
    const content = contentOf();
    mocks.getFileContent.mockResolvedValue(content);

    await expect(read(tokenOf())).resolves.toStrictEqual({ content, caller: CALLER });

    expect(mocks.callerOfGrant).toHaveBeenCalledExactlyOnceWith(GRANT_ID);
    expect(mocks.getFileContent).toHaveBeenCalledExactlyOnceWith(
      { ...CALLER.actor, channel: "mcp", connection: CALLER.connection },
      "handbook",
      "guides",
      "diagram.png",
      null,
    );
    expect(content.blob.stream.cancel).not.toHaveBeenCalled();
    expect(logged()).toBe("[[],[],[]]");
  });

  it("reads the key once and keeps it", async () => {
    await read(tokenOf());
    await read(tokenOf());

    expect(mocks.findUnique).toHaveBeenCalledOnce();
  });

  it.each([
    ["a token of another shape", () => `${"a".repeat(40)}=.${"b".repeat(43)}`, "malformed"],
    ["a token signed with another key", () => tokenOf({ key: randomBytes(32) }), "bad-signature"],
  ])("refuses %s at warn, without the token and without asking for the grant", async (_case, token, reason) => {
    const value = token();

    await expect(read(value)).resolves.toBeNull();

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ reason }, "file link refused");
    expect(mocks.callerOfGrant).not.toHaveBeenCalled();
    expectTokenNotLogged(value);
  });

  it.each([
    ["past its expiry", NOW_SECONDS - 1],
    ["at its expiry", NOW_SECONDS],
    ["further away than the lifetime", NOW_SECONDS + 601],
  ])("refuses a link %s at info, without asking for the grant", async (_case, exp) => {
    const token = tokenOf({ exp });

    await expect(read(token)).resolves.toBeNull();

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { reason: "expired", grantId: GRANT_ID, exp },
      "file link refused",
    );
    expect(mocks.callerOfGrant).not.toHaveBeenCalled();
    expectTokenNotLogged(token);
  });

  it("refuses a link made with a longer lifetime once the lifetime is lowered", async () => {
    const token = tokenOf({ exp: NOW_SECONDS + 3600 });
    mocks.lifetime = 3600;
    await expect(read(token)).resolves.not.toBeNull();

    mocks.lifetime = 600;
    await expect(read(token)).resolves.toBeNull();
  });

  it("refuses a link whose grant is no longer accepted at info", async () => {
    mocks.callerOfGrant.mockResolvedValue(null);
    const token = tokenOf();

    await expect(read(token)).resolves.toBeNull();

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith({ reason: "grant", grantId: GRANT_ID }, "file link refused");
    expect(mocks.getFileContent).not.toHaveBeenCalled();
    expectTokenNotLogged(token);
  });

  it("refuses a valid link while the files are off, at info", async () => {
    mocks.getStore.mockResolvedValue({ on: false, reason: "not-set", dir: null });

    await expect(read(tokenOf())).resolves.toBeNull();

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith({ reason: "files-off", grantId: GRANT_ID }, "file link refused");
    expect(mocks.getFileContent).not.toHaveBeenCalled();
  });

  it("refuses a link to a file that the connected app cannot read at the place, at info", async () => {
    mocks.getFileContent.mockResolvedValue(null);

    await expect(read(tokenOf())).resolves.toBeNull();

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { reason: "file", grantId: GRANT_ID, ...PLACE },
      "file link refused",
    );
  });

  it("refuses a link whose version is no longer the current one, at info, and closes the content", async () => {
    const content = contentOf("9b1d3f5a-7c9e-4b1d-8f5a-7c9e1b3d5f70");
    mocks.getFileContent.mockResolvedValue(content);
    const token = tokenOf();

    await expect(read(token)).resolves.toBeNull();

    expect(content.blob.stream.cancel).toHaveBeenCalledOnce();
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { reason: "version", grantId: GRANT_ID, ...PLACE, version: 3 },
      "file link refused",
    );
    expectTokenNotLogged(token);
  });
});
