import { beforeEach, describe, expect, it, vi } from "vitest";

import { directPagesFirst, getPage, listAllFolderPages, listFolderPages, listTabPages } from "@/features/pages/queries";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({ page: { findMany: mocks.findMany, findFirst: mocks.findFirst } }) }));
vi.mock("next/server", () => ({ connection: mocks.connection }));

/** How often the database has been read. */
function readCount(): number {
  return mocks.findMany.mock.calls.length + mocks.findFirst.mock.calls.length;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([]);
});

const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const TAB_ID = "5a2c1c0e-3f55-4a55-8a42-5d2f0e6a9b11";

/** Names that are not valid as written: not lowercase, surrounding whitespace, a double hyphen, empty. */
const MALFORMED_NAMES = ["Overview", " overview", "overview ", "release--notes", "-overview", ""];

function page(name: string, tab: string | null) {
  return { name, tab: tab === null ? null : { name: tab } };
}

/** The pages as "name" or "tab/name", in their order. */
function places(pages: ReturnType<typeof page>[]): string[] {
  return pages.map(({ name, tab }) => (tab ? `${tab.name}/${name}` : name));
}

describe("every query", () => {
  // Without `connection()` Next.js would prerender the calling route at build time and serve a stale snapshot. The
  // end-to-end tests run the development server, which never prerenders, so only these tests notice a missing call.
  it.each([
    ["listFolderPages", () => listFolderPages(FOLDER_ID)],
    ["listTabPages", () => listTabPages(TAB_ID)],
    ["listAllFolderPages", () => listAllFolderPages(FOLDER_ID)],
    ["getPage", () => getPage("handbook", null, "overview")],
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

describe("listAllFolderPages", () => {
  it("returns the pages of the database with the page without a tab before those of the same name in tabs", async () => {
    // As the database returns them: by name, then by tab name, a missing tab last.
    mocks.findMany.mockResolvedValue([
      page("overview", "guides"),
      page("overview", "meetings"),
      page("overview", null),
    ]);

    const pages = await listAllFolderPages(FOLDER_ID);

    expect(places(pages)).toEqual(["overview", "guides/overview", "meetings/overview"]);
  });
});

describe("getPage", () => {
  it("looks for a page without a tab when no tab is given", async () => {
    const stored = { id: "page-id", name: "overview", folder: { id: FOLDER_ID, name: "handbook" }, tab: null };
    mocks.findFirst.mockResolvedValue(stored);

    await expect(getPage("handbook", null, "overview")).resolves.toBe(stored);
    // `tabId: null` keeps a page of the same name in a tab of the folder from being returned.
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "overview", folder: { name: "handbook" }, tabId: null } }),
    );
  });

  it("looks for the page in the tab with the given name", async () => {
    const stored = {
      id: "page-id",
      name: "overview",
      folder: { id: FOLDER_ID, name: "handbook" },
      tab: { id: TAB_ID },
    };
    mocks.findFirst.mockResolvedValue(stored);

    await expect(getPage("handbook", "guides", "overview")).resolves.toBe(stored);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "overview", folder: { name: "handbook" }, tab: { name: "guides" } } }),
    );
  });

  it("returns null when there is no such page", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(getPage("handbook", "guides", "overview")).resolves.toBeNull();
  });

  it.each(MALFORMED_NAMES)(
    "returns null for the malformed folder name %j without reading the database",
    async (name) => {
      await expect(getPage(name, null, "overview")).resolves.toBeNull();
      expect(readCount()).toBe(0);
    },
  );

  it.each(MALFORMED_NAMES)("returns null for the malformed page name %j without reading the database", async (name) => {
    await expect(getPage("handbook", "guides", name)).resolves.toBeNull();
    expect(readCount()).toBe(0);
  });

  // A malformed tab name must not be treated like no tab: the address would then show the page placed directly in the
  // folder.
  it.each(MALFORMED_NAMES)("returns null for the malformed tab name %j without reading the database", async (name) => {
    await expect(getPage("handbook", name, "overview")).resolves.toBeNull();
    expect(readCount()).toBe(0);
  });
});

describe("directPagesFirst", () => {
  it("moves the page without a tab before the pages of the same name in tabs", () => {
    // As the database returns them: by name, then by tab name, a missing tab last.
    const pages = [
      page("alpha", "guides"),
      page("overview", "guides"),
      page("overview", "meetings"),
      page("overview", null),
      page("zeta", null),
    ];

    expect(places(directPagesFirst(pages))).toEqual([
      "guides/alpha",
      "overview",
      "guides/overview",
      "meetings/overview",
      "zeta",
    ]);
  });

  it("keeps an order that is already right", () => {
    const pages = [page("a", null), page("a", "guides"), page("b", "guides"), page("c", null)];
    expect(places(directPagesFirst(pages))).toEqual(["a", "guides/a", "guides/b", "c"]);
  });

  it("keeps pages of different names apart", () => {
    const pages = [page("a", "guides"), page("b", null), page("c", "guides"), page("d", null)];
    expect(places(directPagesFirst(pages))).toEqual(["guides/a", "b", "guides/c", "d"]);
  });

  it("returns an empty list for no pages", () => {
    expect(directPagesFirst([])).toEqual([]);
  });
});
