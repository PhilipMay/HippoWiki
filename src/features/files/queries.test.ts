import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { getFile, getUploadSettings, listFolderFiles, listTabFiles } from "@/features/files/queries";
import { RedirectError } from "@/test/unit";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  requireUser: vi.fn(),
  listFolderFiles: vi.fn(),
  listTabFiles: vi.fn(),
  getFile: vi.fn(),
  uploadSettings: vi.fn(),
}));

vi.mock("@/features/files/service", () => ({
  listFolderFiles: mocks.listFolderFiles,
  listTabFiles: mocks.listTabFiles,
  getFile: mocks.getFile,
  uploadSettings: mocks.uploadSettings,
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));

const serviceReads = [mocks.listFolderFiles, mocks.listTabFiles, mocks.getFile, mocks.uploadSettings];

/** How often the service has been called. */
function readCount(): number {
  return serviceReads.reduce((count, read) => count + read.mock.calls.length, 0);
}

const USER = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", type: "user", mustChangePassword: false };
const ACTOR = { id: USER.id, name: USER.name, type: USER.type, channel: "web" };
const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const TAB_ID = "5a2c1c0e-3f55-4a55-8a42-5d2f0e6a9b11";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue(USER);
});

/** Every query with a call of it, the service read it calls and the arguments that read gets after the actor. */
const QUERIES: [string, () => Promise<unknown>, Mock, unknown[] | null][] = [
  ["listFolderFiles", () => listFolderFiles(FOLDER_ID), mocks.listFolderFiles, [FOLDER_ID]],
  ["listTabFiles", () => listTabFiles(TAB_ID), mocks.listTabFiles, [TAB_ID]],
  ["getFile", () => getFile("handbook", "guides", "diagram.png"), mocks.getFile, ["handbook", "guides", "diagram.png"]],
  // The settings are no read of content: they need a login, but no actor.
  ["getUploadSettings", () => getUploadSettings(), mocks.uploadSettings, null],
];

describe("every query", () => {
  it.each(QUERIES)("%s waits for connection() and requireUser() before it reads", async (_name, query, read, args) => {
    let release = () => {};
    mocks.connection.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    const found = { id: "found" };
    read.mockResolvedValue(found);

    const result = query();
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(readCount()).toBe(0);

    release();
    await expect(result).resolves.toBe(found);
    expect(read).toHaveBeenCalledWith(...(args === null ? [] : [ACTOR, ...args]));
  });

  it.each(QUERIES)("%s does not read without a logged-in user", async (_name, query) => {
    mocks.requireUser.mockRejectedValue(new RedirectError("/login"));

    await expect(query()).rejects.toBeInstanceOf(RedirectError);
    expect(readCount()).toBe(0);
  });
});
