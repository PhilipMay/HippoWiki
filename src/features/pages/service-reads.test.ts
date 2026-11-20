// The unit tests of the pages service: the reads of pages and deleted pages. The mocked database and logger are those of
// `src/test/pages-service.ts`; the integration tests in `integration/page-service.test.ts` prove the queries.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  directPageFirstPerName,
  getDeletedPage,
  getPage,
  listAllFolderPages,
  listDeletedPages,
  listFolderPages,
  listTabPages,
  resolveWikiLinks,
} from "@/features/pages/service";
import { mocks, readCount, MALFORMED_NAMES, EDITOR, EDITOR_ROW, resetPagesServiceMocks } from "@/test/pages-service";
import { FOLDER_ID, TAB_ID, PAGE_ID, MALFORMED_ID, ACTOR } from "@/test/unit";

vi.mock("@/lib/db", async () => ({ getDb: (await import("@/test/pages-service")).pagesDb }));
vi.mock("@/lib/logger", async () => ({ logger: (await import("@/test/pages-service")).logger }));

beforeEach(resetPagesServiceMocks);

function page(name: string, tab: string | null) {
  return { name, tab: tab === null ? null : { name: tab } };
}

/** The pages as "name" or "tab/name", in their order. */
function places(pages: ReturnType<typeof page>[]): string[] {
  return pages.map(({ name, tab }) => (tab ? `${tab.name}/${name}` : name));
}

describe("the lists of a folder or tab", () => {
  it.each([
    ["listFolderPages", () => listFolderPages(ACTOR, MALFORMED_ID)],
    ["listTabPages", () => listTabPages(ACTOR, MALFORMED_ID)],
    ["listAllFolderPages", () => listAllFolderPages(ACTOR, MALFORMED_ID)],
    ["listDeletedPages", () => listDeletedPages(ACTOR, MALFORMED_ID)],
  ])("%s returns no pages for a malformed id without reading the database", async (_name, read) => {
    await expect(read()).resolves.toEqual([]);
    expect(readCount()).toBe(0);
  });
});

describe("listAllFolderPages", () => {
  it("returns the pages of the database with the page without a tab before those of the same name in tabs", async () => {
    // As the database returns them: by name, then by tab name, a missing tab last.
    mocks.findMany.mockResolvedValue(
      [page("overview", "guides"), page("overview", "meetings"), page("overview", null)].map((entry) => ({
        ...entry,
        ...EDITOR_ROW,
      })),
    );

    const pages = (await listAllFolderPages(ACTOR, FOLDER_ID)) ?? [];

    expect(places(pages)).toEqual(["overview", "guides/overview", "meetings/overview"]);
    for (const entry of pages) expect(entry.lastEditedBy).toEqual(EDITOR.lastEditedBy);
  });
});

describe("getPage", () => {
  it("returns a page placed directly in the folder with the role of the actor and its last editor", async () => {
    const stored = {
      id: "page-id",
      name: "overview",
      version: 3,
      folder: { id: FOLDER_ID, name: "handbook" },
      tab: null,
    };
    mocks.findFirst.mockResolvedValue({
      ...stored,
      folder: { ...stored.folder, roles: [{ role: "writer" }] },
      ...EDITOR_ROW,
    });

    // The page comes with the role of the actor on its folder, so that the view offers only what the role includes.
    await expect(getPage(ACTOR, "handbook", null, "overview")).resolves.toEqual({
      ...stored,
      ...EDITOR,
      role: "writer",
    });
  });

  it("returns a page in a tab with the role of the actor and its last editor", async () => {
    const stored = {
      id: "page-id",
      name: "overview",
      folder: { id: FOLDER_ID, name: "handbook" },
      tab: { id: TAB_ID },
    };
    mocks.findFirst.mockResolvedValue({
      ...stored,
      folder: { ...stored.folder, roles: [{ role: "reader" }] },
      ...EDITOR_ROW,
    });

    await expect(getPage(ACTOR, "handbook", "guides", "overview")).resolves.toEqual({
      ...stored,
      ...EDITOR,
      role: "reader",
    });
  });

  it("returns null when there is no such page", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(getPage(ACTOR, "handbook", "guides", "overview")).resolves.toBeNull();
  });

  it.each(MALFORMED_NAMES)(
    "returns null for the malformed folder name %j without reading the database",
    async (name) => {
      await expect(getPage(ACTOR, name, null, "overview")).resolves.toBeNull();
      expect(readCount()).toBe(0);
    },
  );

  it.each(MALFORMED_NAMES)("returns null for the malformed page name %j without reading the database", async (name) => {
    await expect(getPage(ACTOR, "handbook", "guides", name)).resolves.toBeNull();
    expect(readCount()).toBe(0);
  });

  // A malformed tab name must not be treated like no tab: the address would then show the page placed directly in the
  // folder.
  it.each(MALFORMED_NAMES)("returns null for the malformed tab name %j without reading the database", async (name) => {
    await expect(getPage(ACTOR, "handbook", name, "overview")).resolves.toBeNull();
    expect(readCount()).toBe(0);
  });
});

describe("listDeletedPages", () => {
  it("returns the deleted pages with their last editor", async () => {
    const deletedAt = new Date("2026-11-12T10:00:00Z");
    mocks.findMany.mockResolvedValue([{ id: PAGE_ID, name: "overview", title: "Overview", deletedAt, ...EDITOR_ROW }]);

    await expect(listDeletedPages(ACTOR, FOLDER_ID)).resolves.toEqual([
      { id: PAGE_ID, name: "overview", title: "Overview", deletedAt, ...EDITOR },
    ]);
  });
});

describe("getDeletedPage", () => {
  it("returns the deleted page with its last editor", async () => {
    const stored = { id: PAGE_ID, deletedAt: new Date(), folder: { id: FOLDER_ID, name: "handbook" } };
    mocks.findFirst.mockResolvedValue({ ...stored, ...EDITOR_ROW });

    await expect(getDeletedPage(ACTOR, "handbook", PAGE_ID)).resolves.toEqual({ ...stored, ...EDITOR });
  });

  it("returns null when there is no such deleted page", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(getDeletedPage(ACTOR, "handbook", PAGE_ID)).resolves.toBeNull();
  });

  it.each(MALFORMED_NAMES)(
    "returns null for the malformed folder name %j without reading the database",
    async (name) => {
      await expect(getDeletedPage(ACTOR, name, PAGE_ID)).resolves.toBeNull();
      expect(readCount()).toBe(0);
    },
  );

  it.each(["not-a-uuid", "", `${PAGE_ID}0`, PAGE_ID.replaceAll("-", ""), "overview"])(
    "returns null for the malformed id %j without reading the database",
    async (id) => {
      await expect(getDeletedPage(ACTOR, "handbook", id)).resolves.toBeNull();
      expect(readCount()).toBe(0);
    },
  );
});

describe("directPageFirstPerName", () => {
  it("moves the page without a tab before the pages of the same name in tabs", () => {
    // As the database returns them: by name, then by tab name, a missing tab last.
    const pages = [
      page("alpha", "guides"),
      page("overview", "guides"),
      page("overview", "meetings"),
      page("overview", null),
      page("zeta", null),
    ];

    expect(places(directPageFirstPerName(pages))).toEqual([
      "guides/alpha",
      "overview",
      "guides/overview",
      "meetings/overview",
      "zeta",
    ]);
  });

  it("keeps an order that is already right", () => {
    const pages = [page("a", null), page("a", "guides"), page("b", "guides"), page("c", null)];
    expect(places(directPageFirstPerName(pages))).toEqual(["a", "guides/a", "guides/b", "c"]);
  });

  it("keeps pages of different names apart", () => {
    const pages = [page("a", "guides"), page("b", null), page("c", "guides"), page("d", null)];
    expect(places(directPageFirstPerName(pages))).toEqual(["guides/a", "b", "guides/c", "d"]);
  });

  it("returns an empty list for no pages", () => {
    expect(directPageFirstPerName([])).toEqual([]);
  });
});

describe("resolveWikiLinks", () => {
  it("returns the titles of the pages and the tabs that the database finds for the targets", async () => {
    mocks.findMany.mockResolvedValue([
      { name: "setup", title: "Setup", tab: null },
      { name: "setup", title: "Setup guide", tab: { name: "guides" } },
      // A page that no target names, as the read of every name in every named tab can find.
      { name: "faq", title: "FAQ", tab: { name: "guides" } },
    ]);
    mocks.tabFindMany.mockResolvedValue([{ name: "guides" }]);

    const resolution = await resolveWikiLinks(ACTOR, FOLDER_ID, "[[setup]] [[guides/setup]] [[faq]] [[docs/faq]]");

    expect(resolution).toEqual({
      titles: new Map([
        ["setup", "Setup"],
        ["guides/setup", "Setup guide"],
      ]),
      tabs: new Set(["guides"]),
    });
  });

  it("reads nothing for a content without valid targets or for a malformed folder id", async () => {
    const empty = { titles: new Map(), tabs: new Set() };
    await expect(resolveWikiLinks(ACTOR, FOLDER_ID, "# T\n\n[[Setup Guide]] `[[setup]]`")).resolves.toEqual(empty);
    await expect(resolveWikiLinks(ACTOR, MALFORMED_ID, "[[setup]]")).resolves.toEqual(empty);
    expect(readCount()).toBe(0);
  });

  it("reads no tabs when no target names one", async () => {
    await resolveWikiLinks(ACTOR, FOLDER_ID, "[[setup]]");
    expect(mocks.findMany).toHaveBeenCalledOnce();
    expect(mocks.tabFindMany).not.toHaveBeenCalled();
  });

  it("throws a database error", async () => {
    mocks.findMany.mockRejectedValue(new Error("connection lost"));
    await expect(resolveWikiLinks(ACTOR, FOLDER_ID, "[[setup]]")).rejects.toThrow("connection lost");
  });
});
