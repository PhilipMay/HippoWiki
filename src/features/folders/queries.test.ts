import { beforeEach, describe, expect, it, vi } from "vitest";

import { getFolderByName, getTab, listFolders, listTabs } from "@/features/folders/queries";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  folderFindMany: vi.fn(),
  folderFindUnique: vi.fn(),
  tabFindMany: vi.fn(),
  tabFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    folder: { findMany: mocks.folderFindMany, findUnique: mocks.folderFindUnique },
    tab: { findMany: mocks.tabFindMany, findFirst: mocks.tabFindFirst },
  }),
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));

const databaseReads = [mocks.folderFindMany, mocks.folderFindUnique, mocks.tabFindMany, mocks.tabFindFirst];

/** How often the database has been read. */
function readCount(): number {
  return databaseReads.reduce((count, read) => count + read.mock.calls.length, 0);
}

beforeEach(() => {
  vi.resetAllMocks();
});

const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";

/** Names that are not valid as written: not lowercase, surrounding whitespace, a double hyphen, empty. */
const MALFORMED_NAMES = ["Handbook", " handbook", "handbook ", "release--notes", "-handbook", ""];

describe("every query", () => {
  // Without `connection()` Next.js would prerender the calling route at build time and serve a stale snapshot. The
  // end-to-end tests run the development server, which never prerenders, so only these tests notice a missing call.
  it.each([
    ["listFolders", () => listFolders()],
    ["listTabs", () => listTabs(FOLDER_ID)],
    ["getFolderByName", () => getFolderByName("handbook")],
    ["getTab", () => getTab("handbook", "guides")],
  ])("%s waits for connection() before it reads the database", async (_name, query) => {
    let release = () => {};
    mocks.connection.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));

    const result = query();
    // Lets everything run that does not wait for the connection.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.connection).toHaveBeenCalledOnce();
    expect(readCount()).toBe(0);

    release();
    await result;
    expect(readCount()).toBe(1);
  });
});

describe("getFolderByName", () => {
  it("returns the folder with the name", async () => {
    const folder = { id: FOLDER_ID, name: "handbook" };
    mocks.folderFindUnique.mockResolvedValue(folder);

    await expect(getFolderByName("handbook")).resolves.toBe(folder);
    expect(mocks.folderFindUnique).toHaveBeenCalledWith({ where: { name: "handbook" } });
  });

  it("returns null when no folder has the name", async () => {
    mocks.folderFindUnique.mockResolvedValue(null);

    await expect(getFolderByName("handbook")).resolves.toBeNull();
  });

  it.each(MALFORMED_NAMES)("returns null for the malformed name %j without reading the database", async (name) => {
    await expect(getFolderByName(name)).resolves.toBeNull();
    expect(readCount()).toBe(0);
  });
});

describe("getTab", () => {
  it("returns the tab with the name in the folder with the name", async () => {
    const tab = { id: "tab-id", name: "guides", folder: { id: FOLDER_ID, name: "handbook" } };
    mocks.tabFindFirst.mockResolvedValue(tab);

    await expect(getTab("handbook", "guides")).resolves.toBe(tab);
    expect(mocks.tabFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "guides", folder: { name: "handbook" } } }),
    );
  });

  it("returns null when the folder has no tab with the name", async () => {
    mocks.tabFindFirst.mockResolvedValue(null);

    await expect(getTab("handbook", "guides")).resolves.toBeNull();
  });

  it.each(MALFORMED_NAMES)(
    "returns null for the malformed folder name %j without reading the database",
    async (name) => {
      await expect(getTab(name, "guides")).resolves.toBeNull();
      expect(readCount()).toBe(0);
    },
  );

  it.each(MALFORMED_NAMES)("returns null for the malformed tab name %j without reading the database", async (name) => {
    await expect(getTab("handbook", name)).resolves.toBeNull();
    expect(readCount()).toBe(0);
  });
});
