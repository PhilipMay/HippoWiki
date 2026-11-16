import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPage,
  deletePage,
  directPagesFirst,
  getDeletedPage,
  getPage,
  listAllFolderPages,
  listDeletedPages,
  listFolderPages,
  listTabPages,
  moveOrRenamePage,
  restorePage,
  updatePageContent,
} from "@/features/pages/service";
import type { BrowserActor, ContentActor } from "@/features/folder-roles/service";
import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  roleFindFirst: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    page: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
      create: mocks.create,
      updateMany: mocks.updateMany,
    },
    folderRole: { findFirst: mocks.roleFindFirst },
    $transaction: mocks.transaction,
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

/** How often the pages have been read; the role of the actor is not counted. */
function readCount(): number {
  return mocks.findMany.mock.calls.length + mocks.findFirst.mock.calls.length;
}

const databaseWrites = [mocks.create, mocks.updateMany, mocks.findUnique, mocks.transaction];

/** A write that stops before the database neither reads nor writes it, and logs nothing. */
function expectDatabaseUntouched(): void {
  for (const call of databaseWrites) expect(call).not.toHaveBeenCalled();
  expect(readCount()).toBe(0);
  expect(mocks.info).not.toHaveBeenCalled();
  expect(mocks.warn).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([]);
  // The actor is Owner of every folder, unless a test says otherwise.
  mocks.roleFindFirst.mockResolvedValue({ role: "owner" });
  // An interactive transaction runs its callback with a client of its own.
  mocks.transaction.mockImplementation((run: (tx: unknown) => Promise<unknown>) =>
    run({ page: { findFirst: mocks.findFirst, updateMany: mocks.updateMany } }),
  );
});

const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const TAB_ID = "5a2c1c0e-3f55-4a55-8a42-5d2f0e6a9b11";
const PAGE_ID = "9c4d2b7e-1a3f-4c5d-8e6f-7a8b9c0d1e22";
const MALFORMED_ID = "not-a-uuid";
const ACTOR_ID = "9d4b2f6e-1c3a-4e8b-b7d5-2a6c8e0f1b12";

/** The user who makes the writes in the browser, one whose id is malformed, and the same user through MCP. */
const ACTOR: BrowserActor = { id: ACTOR_ID, name: "alice", type: "user", channel: "browser" };
const MALFORMED_ACTOR: BrowserActor = { id: MALFORMED_ID, name: "alice", type: "user", channel: "browser" };
const MCP_ACTOR: ContentActor = { ...ACTOR, channel: "mcp" };

/** The condition on the folder of a read of the browser: a role of the actor on it. */
const WITH_ROLE = { roles: { some: { userId: ACTOR_ID } } };

/** Names that are not valid as written: not lowercase, surrounding whitespace, a double hyphen, empty. */
const MALFORMED_NAMES = ["Overview", " overview", "overview ", "release--notes", "-overview", ""];

/** The last editor as the database returns it for a read, and as the service returns it. */
const EDITOR_ROW = { lastEditedBy: { username: "alice" } };
const EDITOR = { lastEditedBy: { name: "alice" } };

function page(name: string, tab: string | null) {
  return { name, tab: tab === null ? null : { name: tab } };
}

/** The pages as "name" or "tab/name", in their order. */
function places(pages: ReturnType<typeof page>[]): string[] {
  return pages.map(({ name, tab }) => (tab ? `${tab.name}/${name}` : name));
}

describe("the page lists", () => {
  // A deleted page keeps its folder, so only `deletedAt: null` keeps it out of the folder's lists.
  it.each([
    ["listFolderPages", () => listFolderPages(ACTOR, FOLDER_ID), { folderId: FOLDER_ID, tabId: null, deletedAt: null }],
    ["listTabPages", () => listTabPages(ACTOR, TAB_ID), { tabId: TAB_ID, deletedAt: null }],
    ["listAllFolderPages", () => listAllFolderPages(ACTOR, FOLDER_ID), { folderId: FOLDER_ID, deletedAt: null }],
  ])("%s leaves out deleted pages", async (_name, query, where) => {
    await query();
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
  });
});

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
  it("looks for a page without a tab when no tab is given", async () => {
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
    // `tabId: null` keeps a page of the same name in a tab of the folder from being returned.
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: "overview", folder: { name: "handbook", ...WITH_ROLE }, deletedAt: null, tabId: null },
      }),
    );
    // The version is read, so that a change of the page can state the version it is based on.
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ version: true }) }),
    );
  });

  it("looks for the page in the tab with the given name", async () => {
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
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          name: "overview",
          folder: { name: "handbook", ...WITH_ROLE },
          deletedAt: null,
          tab: { name: "guides" },
        },
      }),
    );
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
  it("lists only the deleted pages of the folder", async () => {
    const deletedAt = new Date("2026-11-12T10:00:00Z");
    mocks.findMany.mockResolvedValue([{ id: PAGE_ID, name: "overview", title: "Overview", deletedAt, ...EDITOR_ROW }]);

    await expect(listDeletedPages(ACTOR, FOLDER_ID)).resolves.toEqual([
      { id: PAGE_ID, name: "overview", title: "Overview", deletedAt, ...EDITOR },
    ]);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { folderId: FOLDER_ID, deletedAt: { not: null } } }),
    );
  });
});

describe("getDeletedPage", () => {
  it("looks for a deleted page with the id in the folder of that name", async () => {
    const stored = { id: PAGE_ID, deletedAt: new Date(), folder: { id: FOLDER_ID, name: "handbook" } };
    mocks.findFirst.mockResolvedValue({ ...stored, ...EDITOR_ROW });

    await expect(getDeletedPage(ACTOR, "handbook", PAGE_ID)).resolves.toEqual({ ...stored, ...EDITOR });
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        // Only a Manager or an Owner reads the deleted pages.
        where: {
          id: PAGE_ID,
          folder: { name: "handbook", roles: { some: { userId: ACTOR_ID, role: { in: ["manager", "owner"] } } } },
          deletedAt: { not: null },
        },
      }),
    );
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

const CONTENT = "# My page\n\nText";
/** What a write reads back of a page: what its address is built from. */
const STORED_PAGE_SELECT = {
  id: true,
  name: true,
  folder: { select: { name: true } },
  tab: { select: { name: true } },
};

const NAME_TAKEN = { ok: false, error: { code: "name-taken" } };
const FAILED = { ok: false, error: { code: "failed" } };
const FOLDER_NOT_FOUND = { ok: false, error: { code: "folder-not-found" } };
const TAB_NOT_FOUND = { ok: false, error: { code: "tab-not-found" } };
const PAGE_NOT_FOUND = { ok: false, error: { code: "page-not-found" } };
const NAME_REQUIRED = { ok: false, error: { code: "invalid-input", fieldErrors: { name: ["Name is required"] } } };
const TITLE_MISSING = {
  ok: false,
  error: {
    code: "invalid-input",
    fieldErrors: { content: ["Content must start with a title heading: # Title"] },
  },
};

/** A Prisma error as the client reports it, e.g. `P2002` for a unique violation. */
function knownError(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("database error", { code, clientVersion: "test", meta });
}

/** A unique violation as reported with the `pg` adapter, on the given index or fields. */
function uniqueViolation(constraint: { index?: string; fields?: string[] }): Prisma.PrismaClientKnownRequestError {
  return knownError("P2002", { driverAdapterError: { cause: { constraint } } });
}

/** A foreign key violation as reported with the `pg` adapter, on the given constraint or fields. */
function foreignKeyViolation(constraint: { index?: string; fields?: string[] }): Prisma.PrismaClientKnownRequestError {
  return knownError("P2003", { driverAdapterError: { cause: { constraint } } });
}

/** Foreign key violations of a folder or tab key, which the writes report as a missing folder or tab. */
const placeKeyErrors = [
  ["without details", knownError("P2003")],
  ["on the folder key", foreignKeyViolation({ index: "Page_folderId_fkey" })],
  ["on the tab key", foreignKeyViolation({ index: "Page_tabId_folderId_fkey" })],
  ["on the tab field", foreignKeyViolation({ fields: ["tabId"] })],
] as const;

const nameTakenErrors = [
  ["on the index of pages placed directly in a folder", uniqueViolation({ index: "Page_folderId_name_key" })],
  ["on the index of pages in a tab", uniqueViolation({ index: "Page_tabId_name_key" })],
  ["on the folder and name fields", uniqueViolation({ fields: ["folderId", "name"] })],
  ["on the tab and name fields", uniqueViolation({ fields: ["tabId", "name"] })],
] as const;

const otherErrors = [
  ["a unique violation on another constraint", uniqueViolation({ index: "Page_other_key" })],
  ["another Prisma error", knownError("P2000")],
  ["any other error", new Error("connection lost")],
] as const;

describe("createPage", () => {
  const VALID = { name: " my-page ", content: CONTENT, tabId: null };
  const IN_TAB = { ...VALID, tabId: TAB_ID };

  it.each([
    ["valid", VALID],
    ["invalid", { name: "", content: CONTENT, tabId: null }],
  ])("returns folder-not-found for a malformed folder id, with %s input", async (_name, input) => {
    await expect(createPage(ACTOR, MALFORMED_ID, input)).resolves.toEqual(FOLDER_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it.each([
    ["valid", { ...VALID, tabId: MALFORMED_ID }],
    ["an empty tab id and valid", { ...VALID, tabId: "" }],
    ["invalid", { name: "", content: CONTENT, tabId: MALFORMED_ID }],
  ])("returns tab-not-found for a malformed tab id, with %s input", async (_name, input) => {
    await expect(createPage(ACTOR, FOLDER_ID, input)).resolves.toEqual(TAB_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it("returns the field errors of invalid input without writing anything", async () => {
    await expect(createPage(ACTOR, FOLDER_ID, { name: "", content: CONTENT, tabId: null })).resolves.toEqual(
      NAME_REQUIRED,
    );
    await expect(createPage(ACTOR, FOLDER_ID, { name: "a", content: "Text", tabId: null })).resolves.toEqual(
      TITLE_MISSING,
    );
    expectDatabaseUntouched();
  });

  it("stores the page directly in the folder with the derived title and returns it as stored", async () => {
    const stored = { id: PAGE_ID, name: "stored-name", folder: { name: "stored-folder" }, tab: null };
    mocks.create.mockResolvedValue(stored);

    // A title is never part of the input; the content is its only source.
    const input = { ...VALID, title: "Given title" };
    await expect(createPage(ACTOR, FOLDER_ID, input)).resolves.toEqual({ ok: true, value: stored });

    // No version: a new page gets the default of the database, 1.
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        title: "My page",
        name: "my-page",
        content: CONTENT,
        folderId: FOLDER_ID,
        tabId: null,
        lastEditedById: ACTOR_ID,
      },
      select: STORED_PAGE_SELECT,
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page created");
  });

  it("stores the content with plain line feeds", async () => {
    mocks.create.mockResolvedValue({ id: PAGE_ID, name: "n", folder: { name: "f" }, tab: null });

    await createPage(ACTOR, FOLDER_ID, { ...VALID, content: "# My page\r\n\r\nText" });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: CONTENT }) }),
    );
  });

  it("stores a page in a tab and returns it as stored", async () => {
    const stored = { id: PAGE_ID, name: "stored-name", folder: { name: "stored-folder" }, tab: { name: "stored-tab" } };
    mocks.create.mockResolvedValue(stored);

    await expect(createPage(ACTOR, FOLDER_ID, IN_TAB)).resolves.toEqual({ ok: true, value: stored });

    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        title: "My page",
        name: "my-page",
        content: CONTENT,
        folderId: FOLDER_ID,
        tabId: TAB_ID,
        lastEditedById: ACTOR_ID,
      },
      select: STORED_PAGE_SELECT,
    });
  });

  it.each(nameTakenErrors)("returns name-taken for a unique violation %s", async (_name, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createPage(ACTOR, FOLDER_ID, VALID)).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith(
      { folderId: FOLDER_ID, tabId: null, name: "my-page" },
      "name of new page already in use",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("returns name-taken for a taken name in a tab", async () => {
    mocks.create.mockRejectedValue(uniqueViolation({ index: "Page_tabId_name_key" }));

    await expect(createPage(ACTOR, FOLDER_ID, IN_TAB)).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith(
      { folderId: FOLDER_ID, tabId: TAB_ID, name: "my-page" },
      "name of new page already in use",
    );
  });

  it.each(placeKeyErrors)("returns folder-not-found for a foreign key violation %s without a tab", async (_n, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createPage(ACTOR, FOLDER_ID, VALID)).resolves.toEqual(FOLDER_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith(
      { folderId: FOLDER_ID, tabId: null },
      "folder or tab of new page not found",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(placeKeyErrors)("returns tab-not-found for a foreign key violation %s with a tab", async (_n, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createPage(ACTOR, FOLDER_ID, IN_TAB)).resolves.toEqual(TAB_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith(
      { folderId: FOLDER_ID, tabId: TAB_ID },
      "folder or tab of new page not found",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(otherErrors)("returns failed for %s", async (_name, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createPage(ACTOR, FOLDER_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, folderId: FOLDER_ID, tabId: null }, "failed to create page");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

describe("updatePageContent", () => {
  const VERSION = 4;
  const VALID = { content: CONTENT, version: VERSION };
  const INVALID = { content: "No heading", version: VERSION };
  const STORED = { id: PAGE_ID, name: "stored-name", folder: { name: "stored-folder" }, tab: null };

  it.each([
    ["valid", VALID],
    ["invalid", INVALID],
  ])("returns page-not-found for a malformed id, with %s input", async (_name, input) => {
    await expect(updatePageContent(ACTOR, MALFORMED_ID, input)).resolves.toEqual(PAGE_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it("returns the field errors of invalid content without writing anything", async () => {
    await expect(updatePageContent(ACTOR, PAGE_ID, INVALID)).resolves.toEqual(TITLE_MISSING);
    expectDatabaseUntouched();
  });

  // Invalid content is reported before the version, so that a stale editor shows the error of its content first.
  it("reports invalid content before a missing version", async () => {
    await expect(updatePageContent(ACTOR, PAGE_ID, { ...INVALID, version: null })).resolves.toEqual(TITLE_MISSING);
    expectDatabaseUntouched();
  });

  it("stores content and derived title only, if the page has the given version, and returns the page as stored", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(STORED);

    const input = { ...VALID, title: "Given title", name: "given-name" };
    await expect(updatePageContent(ACTOR, PAGE_ID, input)).resolves.toEqual({ ok: true, value: STORED });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null, version: VERSION },
      data: { title: "My page", content: CONTENT, lastEditedById: ACTOR_ID, version: { increment: 1 } },
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null },
      select: STORED_PAGE_SELECT,
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page updated");
  });

  // The update matches neither a deleted page nor one with another version; the page as stored tells them apart.
  it("returns page-changed with the page as stored when the update matches no page but the page is stored", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null },
      select: STORED_PAGE_SELECT,
    });
    expect(mocks.warn).toHaveBeenCalledWith(
      { pageId: PAGE_ID, version: VERSION },
      "page to update changed after the version the write is based on",
    );
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns page-not-found for a page that no longer exists or is deleted", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to update not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  // A change that states no version, or a malformed one, is based on no known state of the page (R6, R14).
  it.each([null, 0, -1, 1.5, Number.NaN, 2_147_483_648])(
    "writes nothing and returns page-changed for the version %j",
    async (version) => {
      mocks.findUnique.mockResolvedValue(STORED);

      await expect(updatePageContent(ACTOR, PAGE_ID, { ...VALID, version })).resolves.toEqual({
        ok: false,
        error: { code: "page-changed", page: STORED },
      });

      expect(mocks.updateMany).not.toHaveBeenCalled();
      expect(mocks.warn).toHaveBeenCalledWith(
        { pageId: PAGE_ID, version },
        "page to update changed after the version the write is based on",
      );
    },
  );

  it("returns page-not-found for a missing version of a page that no longer exists", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(updatePageContent(ACTOR, PAGE_ID, { ...VALID, version: null })).resolves.toEqual(PAGE_NOT_FOUND);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns page-not-found for a page that disappears right after the update", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to update not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each(otherErrors)("returns failed for %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID }, "failed to update page");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns failed when the stored page cannot be read", async () => {
    const err = new Error("connection lost");
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockRejectedValue(err);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID }, "failed to update page");
  });

  it("returns failed when the page of a refused update cannot be read", async () => {
    const err = new Error("connection lost");
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockRejectedValue(err);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID }, "failed to update page");
  });
});

describe("moveOrRenamePage", () => {
  const VERSION = 4;
  const VALID = { name: " new-name ", tabId: TAB_ID, version: VERSION };
  const STORED = { id: PAGE_ID, name: "stored-name", folder: { name: "stored-folder" }, tab: null };

  it.each([
    ["valid input", VALID],
    ["the folder as place", { name: "new-name", tabId: null, version: VERSION }],
    ["invalid input", { name: "", tabId: MALFORMED_ID, version: VERSION }],
  ])("returns page-not-found for a malformed page id, with %s", async (_name, input) => {
    await expect(moveOrRenamePage(ACTOR, MALFORMED_ID, input)).resolves.toEqual(PAGE_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it.each([MALFORMED_ID, "guides", " ", ""])(
    "returns tab-not-found for the malformed tab id %j without writing anything",
    async (tabId) => {
      await expect(moveOrRenamePage(ACTOR, PAGE_ID, { name: "new-name", tabId, version: VERSION })).resolves.toEqual(
        TAB_NOT_FOUND,
      );
      await expect(moveOrRenamePage(ACTOR, PAGE_ID, { name: "", tabId, version: VERSION })).resolves.toEqual(
        TAB_NOT_FOUND,
      );
      expectDatabaseUntouched();
    },
  );

  it("returns the field errors of an invalid name without writing anything", async () => {
    await expect(moveOrRenamePage(ACTOR, PAGE_ID, { name: "", tabId: TAB_ID, version: VERSION })).resolves.toEqual(
      NAME_REQUIRED,
    );
    expectDatabaseUntouched();
  });

  it("stores name and tab only and returns the page as stored", async () => {
    const stored = { id: PAGE_ID, name: "stored-name", folder: { name: "stored-folder" }, tab: { name: "stored-tab" } };
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(stored);

    // Content and other fields are ignored: no content rule can block a move.
    const input = { ...VALID, content: "No heading", title: "Given title", folderId: crypto.randomUUID() };
    await expect(moveOrRenamePage(ACTOR, PAGE_ID, input)).resolves.toEqual({ ok: true, value: stored });

    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null, version: VERSION },
      data: { name: "new-name", tabId: TAB_ID, lastEditedById: ACTOR_ID, version: { increment: 1 } },
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null },
      select: STORED_PAGE_SELECT,
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: PAGE_ID, tabId: TAB_ID }, "page moved or renamed");
  });

  it("places the page directly in its folder without a tab", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({ id: PAGE_ID, name: "n", folder: { name: "f" }, tab: null });

    await moveOrRenamePage(ACTOR, PAGE_ID, { name: "new-name", tabId: null, version: VERSION });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null, version: VERSION },
      data: { name: "new-name", tabId: null, lastEditedById: ACTOR_ID, version: { increment: 1 } },
    });
  });

  it.each(nameTakenErrors)("returns name-taken for a unique violation %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith(
      { pageId: PAGE_ID, tabId: TAB_ID, name: "new-name" },
      "name of moved or renamed page already in use at the target",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(placeKeyErrors)("returns tab-not-found for a foreign key violation %s", async (_n, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(TAB_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith(
      { pageId: PAGE_ID, tabId: TAB_ID },
      "target tab of moved or renamed page not found in the page's folder",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  // The update matches neither a deleted page nor one with another version; the page as stored tells them apart.
  it("returns page-not-found for a page that no longer exists or is deleted", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to move or rename not found");
  });

  // A stale version matches no row, so a name taken at the target is never checked: the result is page-changed.
  it("returns page-changed with the page as stored when the update matches no page but the page is stored", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });

    expect(mocks.warn).toHaveBeenCalledWith(
      { pageId: PAGE_ID, version: VERSION },
      "page to move or rename changed after the version the write is based on",
    );
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each([null, 0, -1, 1.5])("writes nothing and returns page-changed for the version %j", async (version) => {
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, { ...VALID, version })).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });

    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns page-not-found for a missing version of a page that no longer exists", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, { ...VALID, version: null })).resolves.toEqual(PAGE_NOT_FOUND);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns page-not-found for a page that disappears right after the update", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to move or rename not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each(otherErrors)("returns failed for %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID, tabId: TAB_ID }, "failed to move or rename page");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

describe("deletePage", () => {
  const VERSION = 4;
  const VALID = { version: VERSION };
  const STORED = { id: PAGE_ID, name: "stored-name", folder: { name: "stored-folder" }, tab: null };

  it("returns page-not-found for a malformed id", async () => {
    await expect(deletePage(ACTOR, MALFORMED_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it("marks the page as deleted, if it has the given version, forgets its tab and returns the place it was in", async () => {
    const place = { folder: { name: "stored-folder" }, tab: { name: "stored-tab" } };
    mocks.findFirst.mockResolvedValue(place);
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(deletePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual({ ok: true, value: place });

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PAGE_ID, deletedAt: null, version: VERSION } }),
    );
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null, version: VERSION },
      data: { deletedAt: expect.any(Date), tabId: null, lastEditedById: ACTOR_ID, version: { increment: 1 } },
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page deleted");
  });

  it("returns the folder as the place of a page placed directly in it", async () => {
    const place = { folder: { name: "stored-folder" }, tab: null };
    mocks.findFirst.mockResolvedValue(place);
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(deletePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual({ ok: true, value: place });
  });

  it("returns page-not-found for a page that no longer exists or is already deleted", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue(null);

    await expect(deletePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to delete not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns page-not-found for a page that was deleted between reading and updating it", async () => {
    mocks.findFirst.mockResolvedValue({ folder: { name: "stored-folder" }, tab: null });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(deletePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to delete not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  // The read and the update match neither a deleted page nor one with another version; the page as stored tells them
  // apart.
  it.each([
    ["matches no page", () => mocks.findFirst.mockResolvedValue(null)],
    [
      "was changed between reading and updating it",
      () => {
        mocks.findFirst.mockResolvedValue({ folder: { name: "stored-folder" }, tab: null });
        mocks.updateMany.mockResolvedValue({ count: 0 });
      },
    ],
  ])(
    "returns page-changed with the page as stored when the delete %s but the page is stored",
    async (_name, arrange) => {
      arrange();
      mocks.findUnique.mockResolvedValue(STORED);

      await expect(deletePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual({
        ok: false,
        error: { code: "page-changed", page: STORED },
      });

      expect(mocks.warn).toHaveBeenCalledWith(
        { pageId: PAGE_ID, version: VERSION },
        "page to delete changed after the version the write is based on",
      );
      expect(mocks.info).not.toHaveBeenCalled();
    },
  );

  it.each([null, 0, -1, 1.5])("deletes nothing and returns page-changed for the version %j", async (version) => {
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(deletePage(ACTOR, PAGE_ID, { version })).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns page-not-found for a missing version of a page that no longer exists", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(deletePage(ACTOR, PAGE_ID, { version: null })).resolves.toEqual(PAGE_NOT_FOUND);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(otherErrors)("returns failed for %s", async (_name, err) => {
    mocks.transaction.mockRejectedValue(err);

    await expect(deletePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID }, "failed to delete page");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

describe("restorePage", () => {
  const VALID = { name: " new-name ", tabId: TAB_ID };

  it.each([
    ["valid input", VALID],
    ["invalid input", { name: "", tabId: MALFORMED_ID }],
  ])("returns page-not-found for a malformed page id, with %s", async (_name, input) => {
    await expect(restorePage(ACTOR, MALFORMED_ID, input)).resolves.toEqual(PAGE_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it.each([MALFORMED_ID, "guides", " ", ""])(
    "returns tab-not-found for the malformed tab id %j without writing anything",
    async (tabId) => {
      await expect(restorePage(ACTOR, PAGE_ID, { name: "new-name", tabId })).resolves.toEqual(TAB_NOT_FOUND);
      await expect(restorePage(ACTOR, PAGE_ID, { name: "", tabId })).resolves.toEqual(TAB_NOT_FOUND);
      expectDatabaseUntouched();
    },
  );

  it("returns the field errors of an invalid name without writing anything", async () => {
    await expect(restorePage(ACTOR, PAGE_ID, { name: "", tabId: null })).resolves.toEqual(NAME_REQUIRED);
    expectDatabaseUntouched();
  });

  it("restores the page with name and tab and returns it as stored", async () => {
    const stored = { id: PAGE_ID, name: "stored-name", folder: { name: "stored-folder" }, tab: { name: "stored-tab" } };
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(stored);

    const input = { ...VALID, content: "No heading", title: "Given title" };
    await expect(restorePage(ACTOR, PAGE_ID, input)).resolves.toEqual({ ok: true, value: stored });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: { not: null } },
      data: { deletedAt: null, name: "new-name", tabId: TAB_ID, lastEditedById: ACTOR_ID, version: { increment: 1 } },
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null },
      select: STORED_PAGE_SELECT,
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: PAGE_ID, tabId: TAB_ID }, "page restored");
  });

  it("restores the page directly into its folder without a tab", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({ id: PAGE_ID, name: "n", folder: { name: "f" }, tab: null });

    await restorePage(ACTOR, PAGE_ID, { name: "new-name", tabId: null });

    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { deletedAt: null, name: "new-name", tabId: null, lastEditedById: ACTOR_ID, version: { increment: 1 } },
      }),
    );
  });

  it.each(nameTakenErrors)("returns name-taken for a unique violation %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(restorePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith(
      { pageId: PAGE_ID, tabId: TAB_ID, name: "new-name" },
      "name of restored page already in use at the target",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(placeKeyErrors)("returns tab-not-found for a foreign key violation %s", async (_n, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(restorePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(TAB_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith(
      { pageId: PAGE_ID, tabId: TAB_ID },
      "target tab of restored page not found in the page's folder",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  // The update only matches a deleted page, so a page that is not deleted counts as missing as well.
  it("returns page-not-found for a page that no longer exists or is not deleted", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(restorePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "deleted page to restore not found");
  });

  it("returns page-not-found for a page that disappears right after the update", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(restorePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "deleted page to restore not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each(otherErrors)("returns failed for %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(restorePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID, tabId: TAB_ID }, "failed to restore page");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

/** Every write, called by the given actor with valid input, and the database call it writes with. */
const writes = [
  [
    "createPage",
    (actor: BrowserActor) => createPage(actor, FOLDER_ID, { name: "my-page", content: CONTENT, tabId: TAB_ID }),
    mocks.create,
  ],
  [
    "updatePageContent",
    (actor: BrowserActor) => updatePageContent(actor, PAGE_ID, { content: CONTENT, version: 1 }),
    mocks.updateMany,
  ],
  [
    "moveOrRenamePage",
    (actor: BrowserActor) => moveOrRenamePage(actor, PAGE_ID, { name: "new-name", tabId: TAB_ID, version: 1 }),
    mocks.updateMany,
  ],
  ["deletePage", (actor: BrowserActor) => deletePage(actor, PAGE_ID, { version: 1 }), mocks.updateMany],
  [
    "restorePage",
    (actor: BrowserActor) => restorePage(actor, PAGE_ID, { name: "new-name", tabId: TAB_ID }),
    mocks.updateMany,
  ],
] as const;

describe("the actor of a write", () => {
  it.each(writes)("%s returns failed for a malformed actor id without touching the database", async (_name, write) => {
    await expect(write(MALFORMED_ACTOR)).resolves.toEqual(FAILED);

    for (const call of databaseWrites) expect(call).not.toHaveBeenCalled();
    expect(readCount()).toBe(0);
    expect(mocks.error).toHaveBeenCalledWith({ actorId: MALFORMED_ID }, "malformed actor id");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  // Also in the writes that report other foreign key violations as a missing folder or tab.
  it.each(
    writes.flatMap(([name, write, call]) => [
      [name, "on the editor key", write, call, foreignKeyViolation({ index: "Page_lastEditedById_fkey" })] as const,
      [name, "on the editor field", write, call, foreignKeyViolation({ fields: ["lastEditedById"] })] as const,
    ]),
  )("%s returns failed for a foreign key violation %s", async (_name, _kind, write, call, err) => {
    // `deletePage` reads the page before it writes.
    mocks.findFirst.mockResolvedValue({ folder: { name: "handbook" }, tab: null });
    call.mockRejectedValue(err);

    await expect(write(ACTOR)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, actorId: ACTOR_ID }, "actor of write not found");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

describe("an admin", () => {
  /** An admin, who sees and changes no content; named like a user, so that only the type decides. */
  const ADMIN: BrowserActor = { id: ACTOR_ID, name: "alice", type: "admin", channel: "browser" };
  const MCP_ADMIN: ContentActor = { ...ADMIN, channel: "mcp" };

  it.each([
    ["listFolderPages", () => listFolderPages(ADMIN, FOLDER_ID)],
    ["listTabPages", () => listTabPages(ADMIN, TAB_ID)],
    ["listAllFolderPages", () => listAllFolderPages(ADMIN, FOLDER_ID)],
    ["getPage", () => getPage(ADMIN, "handbook", null, "overview")],
    ["listDeletedPages", () => listDeletedPages(ADMIN, FOLDER_ID)],
    ["getDeletedPage", () => getDeletedPage(ADMIN, "handbook", PAGE_ID)],
    ["listFolderPages through MCP", () => listFolderPages(MCP_ADMIN, FOLDER_ID)],
    ["listTabPages through MCP", () => listTabPages(MCP_ADMIN, TAB_ID)],
    ["getPage through MCP", () => getPage(MCP_ADMIN, "handbook", null, "overview")],
  ])("gets null from %s, without asking the database", async (_name, read) => {
    await expect(read()).resolves.toBeNull();

    expectDatabaseUntouched();
    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
  });

  const MESSAGES = {
    createPage: "page not created: the actor is an admin",
    updatePageContent: "page not saved: the actor is an admin",
    moveOrRenamePage: "page not moved or renamed: the actor is an admin",
    deletePage: "page not deleted: the actor is an admin",
    restorePage: "page not restored: the actor is an admin",
  };

  it.each(writes)("gets not-allowed from %s, logged, without touching the database", async (name, write) => {
    await expect(write(ADMIN)).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });

    for (const call of databaseWrites) expect(call).not.toHaveBeenCalled();
    expect(readCount()).toBe(0);
    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ actorId: ACTOR_ID }, MESSAGES[name]);
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("is refused before the ids and the input are checked", async () => {
    const results = [
      await createPage(ADMIN, MALFORMED_ID, { name: "", content: "", tabId: MALFORMED_ID }),
      await updatePageContent(ADMIN, MALFORMED_ID, { content: "", version: null }),
      await moveOrRenamePage(ADMIN, MALFORMED_ID, { name: "", tabId: MALFORMED_ID, version: null }),
      await deletePage(ADMIN, MALFORMED_ID, { version: 1 }),
      await restorePage(ADMIN, MALFORMED_ID, { name: "", tabId: MALFORMED_ID }),
      await deletePage({ ...ADMIN, id: MALFORMED_ID }, PAGE_ID, { version: 1 }),
    ];

    for (const result of results) expect(result).toEqual({ ok: false, error: { code: "not-allowed" } });
    for (const call of databaseWrites) expect(call).not.toHaveBeenCalled();
    expect(readCount()).toBe(0);
    expect(mocks.error).not.toHaveBeenCalled();
  });
});

describe("the role of the actor", () => {
  it.each([
    ["listFolderPages", () => listFolderPages(ACTOR, FOLDER_ID), { id: FOLDER_ID }],
    ["listTabPages", () => listTabPages(ACTOR, TAB_ID), { tabs: { some: { id: TAB_ID } } }],
    ["listAllFolderPages", () => listAllFolderPages(ACTOR, FOLDER_ID), { id: FOLDER_ID }],
    ["listDeletedPages", () => listDeletedPages(ACTOR, FOLDER_ID), { id: FOLDER_ID }],
  ] as const)("%s returns null without a role, without reading the pages", async (_name, read, folder) => {
    mocks.roleFindFirst.mockResolvedValue(null);

    await expect(read()).resolves.toBeNull();

    expect(mocks.roleFindFirst).toHaveBeenCalledExactlyOnceWith({
      where: { userId: ACTOR_ID, folder },
      select: { role: true },
    });
    expect(readCount()).toBe(0);
  });

  it.each([
    ["listFolderPages", () => listFolderPages(MCP_ACTOR, FOLDER_ID)],
    ["listTabPages", () => listTabPages(MCP_ACTOR, TAB_ID)],
    ["listAllFolderPages", () => listAllFolderPages(MCP_ACTOR, FOLDER_ID)],
    ["listDeletedPages", () => listDeletedPages(MCP_ACTOR, FOLDER_ID)],
  ])("%s through MCP reads the pages without asking for a role", async (_name, read) => {
    await expect(read()).resolves.toEqual([]);

    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
    expect(mocks.findMany).toHaveBeenCalledOnce();
  });

  it("getPage and getDeletedPage through MCP read the folder whatever the roles", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await getPage(MCP_ACTOR, "handbook", null, "overview");
    await getDeletedPage(MCP_ACTOR, "handbook", PAGE_ID);

    expect(mocks.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ folder: { name: "handbook" } }) }),
    );
    expect(mocks.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ folder: { name: "handbook" } }) }),
    );
  });

  it("getPage returns null for a malformed actor id in the browser, logged, without reading the database", async () => {
    await expect(getPage(MALFORMED_ACTOR, "handbook", null, "overview")).resolves.toBeNull();

    expect(readCount()).toBe(0);
    expect(mocks.error).toHaveBeenCalledWith({ actorId: MALFORMED_ID }, "malformed actor id");
  });

  const refusals = [
    [
      "createPage",
      () => createPage(ACTOR, FOLDER_ID, { name: "my-page", content: CONTENT, tabId: TAB_ID }),
      { id: FOLDER_ID },
      { folderId: FOLDER_ID },
      "page not created: the actor has no role on the folder",
    ],
    [
      "updatePageContent",
      () => updatePageContent(ACTOR, PAGE_ID, { content: CONTENT, version: 1 }),
      { pages: { some: { id: PAGE_ID } } },
      { pageId: PAGE_ID },
      "page not saved: the actor has no role on the folder",
    ],
    [
      "moveOrRenamePage",
      () => moveOrRenamePage(ACTOR, PAGE_ID, { name: "new-name", tabId: TAB_ID, version: 1 }),
      { pages: { some: { id: PAGE_ID } } },
      { pageId: PAGE_ID },
      "page not moved or renamed: the actor has no role on the folder",
    ],
    [
      "deletePage",
      () => deletePage(ACTOR, PAGE_ID, { version: 1 }),
      { pages: { some: { id: PAGE_ID } } },
      { pageId: PAGE_ID },
      "page not deleted: the actor has no role on the folder",
    ],
    [
      "restorePage",
      () => restorePage(ACTOR, PAGE_ID, { name: "new-name", tabId: TAB_ID }),
      { pages: { some: { id: PAGE_ID } } },
      { pageId: PAGE_ID },
      "page not restored: the actor has no role on the folder",
    ],
  ] as const;

  it.each(refusals)(
    "%s without a role gets not-allowed, logged, and touches no page",
    async (_name, write, folder, target, message) => {
      mocks.roleFindFirst.mockResolvedValue(null);

      await expect(write()).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });

      expect(mocks.roleFindFirst).toHaveBeenCalledExactlyOnceWith({
        where: { userId: ACTOR_ID, folder },
        select: { role: true },
      });
      for (const call of databaseWrites) expect(call).not.toHaveBeenCalled();
      expect(readCount()).toBe(0);
      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ actorId: ACTOR_ID, ...target }, message);
      expect(mocks.info).not.toHaveBeenCalled();
    },
  );
});

describe("the lowest role of each function", () => {
  const ROLES = ["reader", "writer", "manager", "owner"] as const;
  type Role = (typeof ROLES)[number];

  /** Every write, the lowest role that may do it, the id it is checked on and the start of its log line. */
  const functions = [
    [
      "createPage",
      () => createPage(ACTOR, FOLDER_ID, { name: "my-page", content: CONTENT, tabId: null }),
      "writer",
      { folderId: FOLDER_ID },
      "page not created",
    ],
    [
      "updatePageContent",
      () => updatePageContent(ACTOR, PAGE_ID, { content: CONTENT, version: 1 }),
      "writer",
      { pageId: PAGE_ID },
      "page not saved",
    ],
    [
      "moveOrRenamePage",
      () => moveOrRenamePage(ACTOR, PAGE_ID, { name: "new-name", tabId: null, version: 1 }),
      "writer",
      { pageId: PAGE_ID },
      "page not moved or renamed",
    ],
    [
      "deletePage",
      () => deletePage(ACTOR, PAGE_ID, { version: 1 }),
      "manager",
      { pageId: PAGE_ID },
      "page not deleted",
    ],
    [
      "restorePage",
      () => restorePage(ACTOR, PAGE_ID, { name: "new-name", tabId: null }),
      "manager",
      { pageId: PAGE_ID },
      "page not restored",
    ],
  ] as const;

  const cases = functions.flatMap(([name, write, lowest, target, what]) =>
    ROLES.map((role) => [name, role, write, ROLES.indexOf(role) >= ROLES.indexOf(lowest), target, what] as const),
  );

  it.each(cases)("%s as %s", async (_name, role: Role, write, allowed, target, what) => {
    mocks.roleFindFirst.mockResolvedValue({ role });
    // A write that is allowed goes on to the database; these answers end it as a missing page.
    mocks.create.mockRejectedValue(new Error("stop"));
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValue(null);

    const result = await write();

    if (allowed) {
      expect(result).not.toEqual({ ok: false, error: { code: "not-allowed" } });
      expect(mocks.warn).not.toHaveBeenCalledWith(
        expect.anything(),
        `${what}: the role of the actor does not allow it`,
      );
    } else {
      expect(result).toEqual({ ok: false, error: { code: "not-allowed" } });
      for (const call of databaseWrites) expect(call).not.toHaveBeenCalled();
      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
        { actorId: ACTOR_ID, ...target, role },
        `${what}: the role of the actor does not allow it`,
      );
    }
  });

  it.each(ROLES)("listDeletedPages as %s", async (role) => {
    mocks.roleFindFirst.mockResolvedValue({ role });

    const pages = await listDeletedPages(ACTOR, FOLDER_ID);

    if (role === "manager" || role === "owner") expect(pages).toEqual([]);
    else {
      expect(pages).toBeNull();
      expect(readCount()).toBe(0);
    }
  });

  it.each(ROLES)("listFolderPages, listTabPages, listAllFolderPages and getPage as %s", async (role) => {
    mocks.roleFindFirst.mockResolvedValue({ role });

    await expect(listFolderPages(ACTOR, FOLDER_ID)).resolves.toEqual([]);
    await expect(listTabPages(ACTOR, TAB_ID)).resolves.toEqual([]);
    await expect(listAllFolderPages(ACTOR, FOLDER_ID)).resolves.toEqual([]);
  });
});
