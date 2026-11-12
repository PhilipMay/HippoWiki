import { beforeEach, describe, expect, it, vi } from "vitest";

import { getFolderByName, getTab, listFolders, listTabs } from "@/features/folders/queries";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  listFolders: vi.fn(),
  getFolderByName: vi.fn(),
  listTabs: vi.fn(),
  getTab: vi.fn(),
}));

vi.mock("@/features/folders/service", () => ({
  listFolders: mocks.listFolders,
  getFolderByName: mocks.getFolderByName,
  listTabs: mocks.listTabs,
  getTab: mocks.getTab,
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));

const serviceReads = [mocks.listFolders, mocks.getFolderByName, mocks.listTabs, mocks.getTab];

/** How often the service has been called. */
function readCount(): number {
  return serviceReads.reduce((count, read) => count + read.mock.calls.length, 0);
}

beforeEach(() => {
  vi.resetAllMocks();
});

const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";

describe("every query", () => {
  // Without `connection()` Next.js would prerender the calling route at build time and serve a stale snapshot. The
  // end-to-end tests run the development server, which never prerenders, so only these tests notice a missing call.
  it.each([
    ["listFolders", () => listFolders(), mocks.listFolders, []],
    ["listTabs", () => listTabs(FOLDER_ID), mocks.listTabs, [FOLDER_ID]],
    ["getFolderByName", () => getFolderByName("handbook"), mocks.getFolderByName, ["handbook"]],
    ["getTab", () => getTab("handbook", "guides"), mocks.getTab, ["handbook", "guides"]],
  ])(
    "%s waits for connection() before it calls the service read of the same name",
    async (_name, query, read, args) => {
      let release = () => {};
      mocks.connection.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
      const found = { id: FOLDER_ID };
      read.mockResolvedValue(found);

      const result = query();
      // Lets everything run that does not wait for the connection.
      await new Promise((resolve) => setImmediate(resolve));
      expect(mocks.connection).toHaveBeenCalledOnce();
      expect(readCount()).toBe(0);

      release();
      await expect(result).resolves.toBe(found);
      expect(readCount()).toBe(1);
      expect(read).toHaveBeenCalledWith(...args);
    },
  );
});
