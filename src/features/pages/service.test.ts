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
import type { Actor } from "@/features/users/service";
import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
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
    $transaction: mocks.transaction,
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

/** How often the database has been read. */
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

/** The user who makes the writes, and one whose id is malformed. */
const ACTOR: Actor = { id: ACTOR_ID, name: "alice" };
const MALFORMED_ACTOR: Actor = { id: MALFORMED_ID, name: "alice" };

/** Names that are not valid as written: not lowercase, surrounding whitespace, a double hyphen, empty. */
const MALFORMED_NAMES = ["Overview", " overview", "overview ", "release--notes", "-overview", ""];

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
    ["listFolderPages", () => listFolderPages(FOLDER_ID), { folderId: FOLDER_ID, tabId: null, deletedAt: null }],
    ["listTabPages", () => listTabPages(TAB_ID), { tabId: TAB_ID, deletedAt: null }],
    ["listAllFolderPages", () => listAllFolderPages(FOLDER_ID), { folderId: FOLDER_ID, deletedAt: null }],
  ])("%s leaves out deleted pages", async (_name, query, where) => {
    await query();
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
  });
});

describe("the lists of a folder or tab", () => {
  it.each([
    ["listFolderPages", () => listFolderPages(MALFORMED_ID)],
    ["listTabPages", () => listTabPages(MALFORMED_ID)],
    ["listAllFolderPages", () => listAllFolderPages(MALFORMED_ID)],
    ["listDeletedPages", () => listDeletedPages(MALFORMED_ID)],
  ])("%s returns no pages for a malformed id without reading the database", async (_name, read) => {
    await expect(read()).resolves.toEqual([]);
    expect(readCount()).toBe(0);
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
      expect.objectContaining({
        where: { name: "overview", folder: { name: "handbook" }, deletedAt: null, tabId: null },
      }),
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
      expect.objectContaining({
        where: { name: "overview", folder: { name: "handbook" }, deletedAt: null, tab: { name: "guides" } },
      }),
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

describe("listDeletedPages", () => {
  it("lists only the deleted pages of the folder", async () => {
    const deletedAt = new Date("2026-11-12T10:00:00Z");
    mocks.findMany.mockResolvedValue([{ id: PAGE_ID, name: "overview", title: "Overview", deletedAt }]);

    await expect(listDeletedPages(FOLDER_ID)).resolves.toEqual([
      { id: PAGE_ID, name: "overview", title: "Overview", deletedAt },
    ]);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { folderId: FOLDER_ID, deletedAt: { not: null } } }),
    );
  });
});

describe("getDeletedPage", () => {
  it("looks for a deleted page with the id in the folder of that name", async () => {
    const stored = { id: PAGE_ID, deletedAt: new Date(), folder: { id: FOLDER_ID, name: "handbook" } };
    mocks.findFirst.mockResolvedValue(stored);

    await expect(getDeletedPage("handbook", PAGE_ID)).resolves.toEqual(stored);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PAGE_ID, folder: { name: "handbook" }, deletedAt: { not: null } } }),
    );
  });

  it("returns null when there is no such deleted page", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(getDeletedPage("handbook", PAGE_ID)).resolves.toBeNull();
  });

  it.each(MALFORMED_NAMES)(
    "returns null for the malformed folder name %j without reading the database",
    async (name) => {
      await expect(getDeletedPage(name, PAGE_ID)).resolves.toBeNull();
      expect(readCount()).toBe(0);
    },
  );

  it.each(["not-a-uuid", "", `${PAGE_ID}0`, PAGE_ID.replaceAll("-", ""), "overview"])(
    "returns null for the malformed id %j without reading the database",
    async (id) => {
      await expect(getDeletedPage("handbook", id)).resolves.toBeNull();
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
  const VALID = { content: CONTENT };
  const INVALID = { content: "No heading" };

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

  it("stores content and derived title only and returns the page as stored", async () => {
    const stored = { id: PAGE_ID, name: "stored-name", folder: { name: "stored-folder" }, tab: null };
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(stored);

    const input = { ...VALID, title: "Given title", name: "given-name" };
    await expect(updatePageContent(ACTOR, PAGE_ID, input)).resolves.toEqual({ ok: true, value: stored });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null },
      data: { title: "My page", content: CONTENT, lastEditedById: ACTOR_ID },
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null },
      select: STORED_PAGE_SELECT,
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page updated");
  });

  // The update only matches a page that is not deleted, so a deleted page counts as missing as well.
  it("returns page-not-found for a page that no longer exists or is deleted", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to update not found");
    expect(mocks.info).not.toHaveBeenCalled();
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
});

describe("moveOrRenamePage", () => {
  const VALID = { name: " new-name ", tabId: TAB_ID };

  it.each([
    ["valid input", VALID],
    ["the folder as place", { name: "new-name", tabId: null }],
    ["invalid input", { name: "", tabId: MALFORMED_ID }],
  ])("returns page-not-found for a malformed page id, with %s", async (_name, input) => {
    await expect(moveOrRenamePage(ACTOR, MALFORMED_ID, input)).resolves.toEqual(PAGE_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it.each([MALFORMED_ID, "guides", " ", ""])(
    "returns tab-not-found for the malformed tab id %j without writing anything",
    async (tabId) => {
      await expect(moveOrRenamePage(ACTOR, PAGE_ID, { name: "new-name", tabId })).resolves.toEqual(TAB_NOT_FOUND);
      await expect(moveOrRenamePage(ACTOR, PAGE_ID, { name: "", tabId })).resolves.toEqual(TAB_NOT_FOUND);
      expectDatabaseUntouched();
    },
  );

  it("returns the field errors of an invalid name without writing anything", async () => {
    await expect(moveOrRenamePage(ACTOR, PAGE_ID, { name: "", tabId: TAB_ID })).resolves.toEqual(NAME_REQUIRED);
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
      where: { id: PAGE_ID, deletedAt: null },
      data: { name: "new-name", tabId: TAB_ID, lastEditedById: ACTOR_ID },
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

    await moveOrRenamePage(ACTOR, PAGE_ID, { name: "new-name", tabId: null });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null },
      data: { name: "new-name", tabId: null, lastEditedById: ACTOR_ID },
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

  // The update only matches a page that is not deleted, so a deleted page counts as missing as well.
  it("returns page-not-found for a page that no longer exists or is deleted", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to move or rename not found");
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
  it("returns page-not-found for a malformed id", async () => {
    await expect(deletePage(ACTOR, MALFORMED_ID)).resolves.toEqual(PAGE_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it("marks the page as deleted, forgets its tab and returns the place it was in", async () => {
    const place = { folder: { name: "stored-folder" }, tab: { name: "stored-tab" } };
    mocks.findFirst.mockResolvedValue(place);
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(deletePage(ACTOR, PAGE_ID)).resolves.toEqual({ ok: true, value: place });

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: PAGE_ID, deletedAt: null } }));
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null },
      data: { deletedAt: expect.any(Date), tabId: null, lastEditedById: ACTOR_ID },
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page deleted");
  });

  it("returns the folder as the place of a page placed directly in it", async () => {
    const place = { folder: { name: "stored-folder" }, tab: null };
    mocks.findFirst.mockResolvedValue(place);
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(deletePage(ACTOR, PAGE_ID)).resolves.toEqual({ ok: true, value: place });
  });

  it("returns page-not-found for a page that no longer exists or is already deleted", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(deletePage(ACTOR, PAGE_ID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to delete not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns page-not-found for a page that was deleted between reading and updating it", async () => {
    mocks.findFirst.mockResolvedValue({ folder: { name: "stored-folder" }, tab: null });
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(deletePage(ACTOR, PAGE_ID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to delete not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each(otherErrors)("returns failed for %s", async (_name, err) => {
    mocks.transaction.mockRejectedValue(err);

    await expect(deletePage(ACTOR, PAGE_ID)).resolves.toEqual(FAILED);

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
      data: { deletedAt: null, name: "new-name", tabId: TAB_ID, lastEditedById: ACTOR_ID },
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
      expect.objectContaining({ data: { deletedAt: null, name: "new-name", tabId: null, lastEditedById: ACTOR_ID } }),
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
    (actor: Actor) => createPage(actor, FOLDER_ID, { name: "my-page", content: CONTENT, tabId: TAB_ID }),
    mocks.create,
  ],
  ["updatePageContent", (actor: Actor) => updatePageContent(actor, PAGE_ID, { content: CONTENT }), mocks.updateMany],
  [
    "moveOrRenamePage",
    (actor: Actor) => moveOrRenamePage(actor, PAGE_ID, { name: "new-name", tabId: TAB_ID }),
    mocks.updateMany,
  ],
  ["deletePage", (actor: Actor) => deletePage(actor, PAGE_ID), mocks.updateMany],
  ["restorePage", (actor: Actor) => restorePage(actor, PAGE_ID, { name: "new-name", tabId: TAB_ID }), mocks.updateMany],
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
