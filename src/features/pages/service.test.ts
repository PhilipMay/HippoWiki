import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPage,
  deletePage,
  directPagesFirst,
  getDeletedPage,
  getPage,
  getPageRevision,
  getRevisionComparison,
  listAllFolderPages,
  listDeletedPages,
  listFolderPages,
  listPageRevisions,
  listTabPages,
  moveOrRenamePage,
  restorePage,
  revertPage,
  updatePageContent,
} from "@/features/pages/service";
import type { BrowserActor, ContentActor } from "@/features/folder-roles/service";
import { CONTENT_MAX_TABLE_CELLS } from "@/features/pages/limits";
import { CONTENT_TABLE_CELLS_MESSAGE } from "@/features/pages/schema";
import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  revisionFindFirst: vi.fn(),
  revisionCreate: vi.fn(),
  revisionFindMany: vi.fn(),
  revisionFindUnique: vi.fn(),
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
    pageRevision: {
      findMany: mocks.revisionFindMany,
      findFirst: mocks.revisionFindFirst,
      findUnique: mocks.revisionFindUnique,
    },
    folderRole: { findFirst: mocks.roleFindFirst },
    $transaction: mocks.transaction,
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

/** How often the pages and their revisions have been read; the role of the actor is not counted. */
function readCount(): number {
  return [mocks.findMany, mocks.findFirst, mocks.revisionFindMany, mocks.revisionFindUnique].reduce(
    (count, read) => count + read.mock.calls.length,
    0,
  );
}

const databaseWrites = [
  mocks.create,
  mocks.updateMany,
  mocks.findUnique,
  mocks.transaction,
  mocks.revisionFindFirst,
  mocks.revisionCreate,
];

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
    run({
      page: { findFirst: mocks.findFirst, updateMany: mocks.updateMany },
      pageRevision: { findFirst: mocks.revisionFindFirst, create: mocks.revisionCreate },
    }),
  );
  // The newest revision of a page has the number 3, unless a test says otherwise.
  mocks.revisionFindFirst.mockResolvedValue({ number: 3 });
});

const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const TAB_ID = "5a2c1c0e-3f55-4a55-8a42-5d2f0e6a9b11";
const PAGE_ID = "9c4d2b7e-1a3f-4c5d-8e6f-7a8b9c0d1e22";
const MALFORMED_ID = "not-a-uuid";
const ACTOR_ID = "9d4b2f6e-1c3a-4e8b-b7d5-2a6c8e0f1b12";

/** The user who makes the writes in the browser, one whose id is malformed, and the same user through MCP. */
const ACTOR: BrowserActor = { id: ACTOR_ID, name: "alice", type: "user", channel: "browser" };
const MALFORMED_ACTOR: BrowserActor = { id: MALFORMED_ID, name: "alice", type: "user", channel: "browser" };
/** The same user through MCP, with a Writer connection to the folder `FOLDER_ID`. */
const MCP_ACTOR: ContentActor = {
  ...ACTOR,
  channel: "mcp",
  connection: { grantId: "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01", folderId: FOLDER_ID, role: "writer" },
};

/** The condition on the folder of a read of the browser: a role of the actor on it. */
const WITH_ROLE = { roles: { some: { userId: ACTOR_ID } } };

/** Names that are not valid as written: not lowercase, surrounding whitespace, a double hyphen, empty. */
const MALFORMED_NAMES = ["Overview", " overview", "overview ", "release--notes", "-overview", ""];

/** The last editor as the database returns it for a read, and as the service returns it. */
const EDITOR_ROW = { lastEditedBy: { username: "alice" }, lastEditedVia: "web" };
const EDITOR = { lastEditedBy: { name: "alice", via: "web" } };

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

describe("listPageRevisions", () => {
  /** The condition on the folder of a page whose deleted pages the actor may read: Manager or Owner. */
  const WITH_DELETED_PAGES_ROLE = { roles: { some: { userId: ACTOR_ID, role: { in: ["manager", "owner"] } } } };
  const createdAt = new Date("2026-11-12T10:00:00Z");
  const ROW = { number: 5, title: "Intro", createdAt, user: { username: "mike" }, via: "mcp", revertedTo: 2 };

  it("reads a page that is not deleted with a role on its folder, and a deleted one with Manager or Owner", async () => {
    mocks.findFirst.mockResolvedValue({ revisions: [{ number: 5 }] });
    mocks.revisionFindMany.mockResolvedValue([ROW]);

    await expect(listPageRevisions(ACTOR, PAGE_ID, { before: null })).resolves.toEqual({
      newest: 5,
      revisions: [{ number: 5, title: "Intro", createdAt, madeBy: { name: "mike", via: "mcp" }, revertedTo: 2 }],
    });
    expect(mocks.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: PAGE_ID,
        OR: [
          { deletedAt: null, folder: WITH_ROLE },
          { deletedAt: { not: null }, folder: WITH_DELETED_PAGES_ROLE },
        ],
      },
      select: { content: true, revisions: { orderBy: { number: "desc" }, take: 1, select: { number: true } } },
    });
  });

  it("lists at most 100 revisions newest first, without their content", async () => {
    mocks.findFirst.mockResolvedValue({ revisions: [{ number: 250 }] });
    mocks.revisionFindMany.mockResolvedValue([]);

    await listPageRevisions(ACTOR, PAGE_ID, { before: null });

    expect(mocks.revisionFindMany).toHaveBeenCalledExactlyOnceWith({
      where: { pageId: PAGE_ID },
      orderBy: { number: "desc" },
      take: 100,
      select: {
        number: true,
        title: true,
        createdAt: true,
        user: { select: { username: true } },
        via: true,
        revertedTo: true,
      },
    });
  });

  it("lists the revisions before the given number", async () => {
    mocks.findFirst.mockResolvedValue({ revisions: [{ number: 250 }] });
    mocks.revisionFindMany.mockResolvedValue([]);

    await listPageRevisions(ACTOR, PAGE_ID, { before: 151 });

    expect(mocks.revisionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pageId: PAGE_ID, number: { lt: 151 } } }),
    );
  });

  it("returns null and lists nothing for a page that the actor may not read or that does not exist", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(listPageRevisions(ACTOR, PAGE_ID, { before: null })).resolves.toBeNull();
    expect(mocks.revisionFindMany).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed id", () => listPageRevisions(ACTOR, MALFORMED_ID, { before: null })],
    ["a revision number that is no whole number", () => listPageRevisions(ACTOR, PAGE_ID, { before: 1.5 })],
    ["a revision number below 1", () => listPageRevisions(ACTOR, PAGE_ID, { before: 0 })],
    ["an admin", () => listPageRevisions({ ...ACTOR, type: "admin" }, PAGE_ID, { before: null })],
    ["a malformed actor id", () => listPageRevisions(MALFORMED_ACTOR, PAGE_ID, { before: null })],
  ])("returns null for %s without reading the database", async (_name, read) => {
    await expect(read()).resolves.toBeNull();
    expect(readCount()).toBe(0);
  });
});

describe("getPageRevision", () => {
  const createdAt = new Date("2026-11-12T10:00:00Z");
  const ROW = {
    number: 3,
    title: "Intro",
    createdAt,
    user: { username: "mike" },
    via: "web",
    revertedTo: null,
    content: "# Intro\n\nOld",
  };

  it("returns the revision with its content, the newest number and whether it is the content of the page now", async () => {
    mocks.findFirst.mockResolvedValue({ content: "# Intro\n\nNew", revisions: [{ number: 5 }] });
    mocks.revisionFindUnique.mockResolvedValue(ROW);

    await expect(getPageRevision(ACTOR, PAGE_ID, 3)).resolves.toEqual({
      number: 3,
      title: "Intro",
      createdAt,
      madeBy: { name: "mike", via: "web" },
      revertedTo: null,
      content: "# Intro\n\nOld",
      newest: 5,
      isCurrent: false,
    });
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: PAGE_ID }) }),
    );
    expect(mocks.revisionFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: { pageId_number: { pageId: PAGE_ID, number: 3 } },
      select: {
        number: true,
        title: true,
        createdAt: true,
        user: { select: { username: true } },
        via: true,
        revertedTo: true,
        content: true,
      },
    });
  });

  it("says whether the content of the revision is the content of the page now", async () => {
    mocks.findFirst.mockResolvedValue({ content: "# Intro\n\nOld", revisions: [{ number: 5 }] });
    mocks.revisionFindUnique.mockResolvedValue(ROW);

    await expect(getPageRevision(ACTOR, PAGE_ID, 3)).resolves.toMatchObject({ isCurrent: true });
  });

  it("returns null for a revision the page does not have", async () => {
    mocks.findFirst.mockResolvedValue({ content: "# Intro", revisions: [{ number: 5 }] });
    mocks.revisionFindUnique.mockResolvedValue(null);

    await expect(getPageRevision(ACTOR, PAGE_ID, 6)).resolves.toBeNull();
  });

  it("returns null and reads no revision for a page that the actor may not read or that does not exist", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(getPageRevision(ACTOR, PAGE_ID, 1)).resolves.toBeNull();
    expect(mocks.revisionFindUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed id", () => getPageRevision(ACTOR, MALFORMED_ID, 1)],
    ["a number below 1", () => getPageRevision(ACTOR, PAGE_ID, 0)],
    ["a number that is no whole number", () => getPageRevision(ACTOR, PAGE_ID, 2.5)],
    ["a number too large for the column", () => getPageRevision(ACTOR, PAGE_ID, 2_147_483_648)],
    ["an admin", () => getPageRevision({ ...ACTOR, type: "admin" }, PAGE_ID, 1)],
  ])("returns null for %s without reading the database", async (_name, read) => {
    await expect(read()).resolves.toBeNull();
    expect(readCount()).toBe(0);
  });
});

describe("getRevisionComparison", () => {
  const createdAt = new Date("2026-11-12T10:00:00Z");
  /** A revision as the database returns it, with its content. */
  function row(number: number) {
    return {
      number,
      title: "Intro",
      createdAt,
      user: { username: "mike" },
      via: "web",
      revertedTo: null,
      content: `# Intro\n\n${number}`,
    };
  }
  /** The same revision as the service returns it. */
  function revision(number: number) {
    const { title, content, revertedTo } = row(number);
    return { number, title, createdAt, madeBy: { name: "mike", via: "web" }, revertedTo, content };
  }

  it.each([
    [2, 5],
    [5, 2],
  ])("returns the revisions %d and %d older first, with the number of the newest revision", async (a, b) => {
    mocks.findFirst.mockResolvedValue({ content: "# Intro", revisions: [{ number: 7 }] });
    // The database returns them in any order.
    mocks.revisionFindMany.mockResolvedValue([row(5), row(2)]);

    await expect(getRevisionComparison(ACTOR, PAGE_ID, a, b)).resolves.toEqual({
      newest: 7,
      older: revision(2),
      newer: revision(5),
    });
    expect(mocks.revisionFindMany).toHaveBeenCalledExactlyOnceWith({
      where: { pageId: PAGE_ID, number: { in: [2, 5] } },
      select: {
        number: true,
        title: true,
        createdAt: true,
        user: { select: { username: true } },
        via: true,
        revertedTo: true,
        content: true,
      },
    });
  });

  it("returns a revision compared with itself on both sides", async () => {
    mocks.findFirst.mockResolvedValue({ content: "# Intro", revisions: [{ number: 7 }] });
    mocks.revisionFindMany.mockResolvedValue([row(3)]);

    await expect(getRevisionComparison(ACTOR, PAGE_ID, 3, 3)).resolves.toEqual({
      newest: 7,
      older: revision(3),
      newer: revision(3),
    });
  });

  it("returns null when the page does not have one of the revisions", async () => {
    mocks.findFirst.mockResolvedValue({ content: "# Intro", revisions: [{ number: 7 }] });
    mocks.revisionFindMany.mockResolvedValue([row(2)]);

    await expect(getRevisionComparison(ACTOR, PAGE_ID, 2, 8)).resolves.toBeNull();
  });

  it("returns null and reads no revision for a page that the actor may not read or that does not exist", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(getRevisionComparison(ACTOR, PAGE_ID, 1, 2)).resolves.toBeNull();
    expect(mocks.revisionFindMany).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed id", () => getRevisionComparison(ACTOR, MALFORMED_ID, 1, 2)],
    ["a first number below 1", () => getRevisionComparison(ACTOR, PAGE_ID, 0, 2)],
    ["a second number that is no whole number", () => getRevisionComparison(ACTOR, PAGE_ID, 1, 1.5)],
    ["an admin", () => getRevisionComparison({ ...ACTOR, type: "admin" }, PAGE_ID, 1, 2)],
  ])("returns null for %s without reading the database", async (_name, read) => {
    await expect(read()).resolves.toBeNull();
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

const CONTENT = "# My page\n\nText";
/** What a write reads back of a page: what its address is built from, and its version. */
const STORED_PAGE_SELECT = {
  id: true,
  name: true,
  version: true,
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

describe("a write through MCP", () => {
  const STORED = { id: PAGE_ID, name: "plan", version: 2, folder: { name: "projects" }, tab: null };

  it("logs the channel mcp and the grant of the connection, and stores the user as the last editor", async () => {
    mocks.create.mockResolvedValue({ ...STORED, version: 1 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(STORED);
    const grantId = "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01";

    await expect(
      createPage(MCP_ACTOR, FOLDER_ID, { name: "plan", content: CONTENT, tabId: null }),
    ).resolves.toMatchObject({ ok: true });
    await expect(updatePageContent(MCP_ACTOR, PAGE_ID, { content: CONTENT, version: 1 })).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      moveOrRenamePage(MCP_ACTOR, PAGE_ID, { name: "plan", tabId: null, version: 2 }),
    ).resolves.toMatchObject({ ok: true });

    expect(mocks.info.mock.calls).toEqual([
      [{ pageId: PAGE_ID, channel: "mcp", grantId }, "page created"],
      [{ pageId: PAGE_ID, channel: "mcp", grantId }, "page updated"],
      [{ pageId: PAGE_ID, tabId: null, channel: "mcp", grantId }, "page moved or renamed"],
    ]);
    expect(mocks.create.mock.calls[0]?.[0].data).toMatchObject({
      lastEditedById: ACTOR_ID,
      lastEditedVia: "mcp",
      revisions: { create: { number: 1, userId: ACTOR_ID, via: "mcp" } },
    });
    expect(mocks.updateMany.mock.calls[0]?.[0].data).toMatchObject({ lastEditedById: ACTOR_ID, lastEditedVia: "mcp" });
    expect(mocks.revisionCreate.mock.calls[0]?.[0].data).toMatchObject({ number: 4, userId: ACTOR_ID, via: "mcp" });
  });

  it("is not allowed for a Reader connection, for another folder and without a role, and writes nothing", async () => {
    const reader: ContentActor = {
      ...MCP_ACTOR,
      connection: { ...MCP_ACTOR.connection, role: "reader" },
    } as ContentActor;

    mocks.roleFindFirst.mockResolvedValue({ role: "owner" });
    await expect(createPage(reader, FOLDER_ID, { name: "plan", content: CONTENT, tabId: null })).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });
    await expect(
      createPage(MCP_ACTOR, "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e55", { name: "plan", content: CONTENT, tabId: null }),
    ).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });
    mocks.roleFindFirst.mockResolvedValue({ role: "reader" });
    await expect(updatePageContent(MCP_ACTOR, PAGE_ID, { content: CONTENT, version: 1 })).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("deletes a page through a Manager connection and logs the channel mcp and the grant", async () => {
    const manager = { ...MCP_ACTOR, connection: { ...MCP_ACTOR.connection, role: "manager" } } as ContentActor;
    mocks.findFirst.mockResolvedValue({ folder: { name: "projects" }, tab: null });
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(deletePage(manager, PAGE_ID, { version: 2 })).resolves.toMatchObject({ ok: true });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { pageId: PAGE_ID, channel: "mcp", grantId: "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01" },
      "page deleted",
    );
    expect(mocks.updateMany.mock.calls[0]?.[0].data).toMatchObject({ lastEditedById: ACTOR_ID, lastEditedVia: "mcp" });
  });

  it("refuses a delete through a Writer connection of an Owner and writes nothing", async () => {
    await expect(deletePage(MCP_ACTOR, PAGE_ID, { version: 2 })).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });

    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

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
        lastEditedVia: "web",
        revisions: { create: { number: 1, title: "My page", content: CONTENT, userId: ACTOR_ID, via: "web" } },
      },
      select: STORED_PAGE_SELECT,
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: PAGE_ID, channel: "browser" }, "page created");
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
        lastEditedVia: "web",
        revisions: { create: { number: 1, title: "My page", content: CONTENT, userId: ACTOR_ID, via: "web" } },
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

    // A page with the same content matches no row, so that a save without a change stores nothing.
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null, version: VERSION, content: { not: CONTENT } },
      data: {
        title: "My page",
        content: CONTENT,
        lastEditedById: ACTOR_ID,
        lastEditedVia: "web",
        version: { increment: 1 },
      },
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null },
      select: STORED_PAGE_SELECT,
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: PAGE_ID, channel: "browser" }, "page updated");
  });

  it("records a revision with the next number, the title, the content, the actor and the channel in the same transaction", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual({ ok: true, value: STORED });

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.revisionFindFirst).toHaveBeenCalledWith({
      where: { pageId: PAGE_ID },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    expect(mocks.revisionCreate).toHaveBeenCalledExactlyOnceWith({
      data: {
        pageId: PAGE_ID,
        number: 4,
        title: "My page",
        content: CONTENT,
        userId: ACTOR_ID,
        via: "web",
        revertedTo: null,
      },
    });
    // The page is updated before the newest revision is read, so that the row of the page is locked first.
    expect(mocks.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.revisionFindFirst.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("records revision 1 for a page without revisions", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(STORED);
    mocks.revisionFindFirst.mockResolvedValue(null);

    await updatePageContent(ACTOR, PAGE_ID, VALID);

    expect(mocks.revisionCreate.mock.calls[0]?.[0].data).toMatchObject({ number: 1 });
  });

  // A content save is stored once its content differs from the stored content, whatever the newest revision holds.
  it("records a revision also when the newest revision has the content of the save", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(STORED);
    mocks.revisionFindFirst.mockResolvedValue({ number: 3 });

    await updatePageContent(ACTOR, PAGE_ID, VALID);

    expect(mocks.revisionCreate.mock.calls[0]?.[0].data).toMatchObject({ number: 4, revertedTo: null });
  });

  // A save of the stored content, based on the version of the page, leaves the page as it is (R1, R2, R8).
  it.each([
    ["in the browser", ACTOR, { channel: "browser" }],
    ["through MCP", MCP_ACTOR, { channel: "mcp", grantId: MCP_ACTOR.connection?.grantId }],
  ] as const)(
    "stores nothing and records no revision for the stored content %s, and logs it apart",
    async (_name, actor, channel) => {
      const unchanged = { ...STORED, version: VERSION };
      mocks.updateMany.mockResolvedValue({ count: 0 });
      mocks.findFirst.mockResolvedValue(unchanged);

      await expect(updatePageContent(actor, PAGE_ID, VALID)).resolves.toEqual({ ok: true, value: unchanged });

      expect(mocks.findFirst).toHaveBeenCalledExactlyOnceWith({
        where: { id: PAGE_ID, deletedAt: null, version: VERSION, content: CONTENT },
        select: STORED_PAGE_SELECT,
      });
      expect(mocks.revisionFindFirst).not.toHaveBeenCalled();
      expect(mocks.revisionCreate).not.toHaveBeenCalled();
      // The page is returned as found in the transaction, not read again after it.
      expect(mocks.findUnique).not.toHaveBeenCalled();
      expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
        { pageId: PAGE_ID, ...channel },
        "page not changed: content is the same",
      );
      expect(mocks.warn).not.toHaveBeenCalled();
    },
  );

  // Line endings are made uniform before the comparison, as the content is stored (R3).
  it("compares the content with uniform line endings", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValue(STORED);

    await updatePageContent(ACTOR, PAGE_ID, { ...VALID, content: CONTENT.replaceAll("\n", "\r\n") });

    expect(mocks.findFirst.mock.calls[0]?.[0].where).toMatchObject({ content: CONTENT });
  });

  // The stored content based on another version is refused like every other save (R4).
  it("returns page-changed for the stored content when the page has another version", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });

    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns page-not-found for the stored content of a deleted page", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue(null);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);
    expect(mocks.info).not.toHaveBeenCalled();
  });

  // Content over a limit is refused before the version is looked at, also when it is the stored content (R4, R7).
  it("returns the field errors of stored content that breaks a limit now, without reading the page", async () => {
    const table = `# Table\n\n| a |\n| - |\n${"| x |\n".repeat(CONTENT_MAX_TABLE_CELLS)}`;

    await expect(updatePageContent(ACTOR, PAGE_ID, { content: table, version: VERSION })).resolves.toEqual({
      ok: false,
      error: { code: "invalid-input", fieldErrors: { content: [CONTENT_TABLE_CELLS_MESSAGE] } },
    });
    expectDatabaseUntouched();
  });

  it("records no revision when the update matches no page", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(STORED);

    await updatePageContent(ACTOR, PAGE_ID, VALID);

    expect(mocks.revisionFindFirst).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
  });

  it("returns failed and logs it when the revision cannot be stored", async () => {
    const err = new Error("connection lost");
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.revisionCreate.mockRejectedValue(err);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID }, "failed to update page");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  // The row lock keeps this from happening; if another write took the number all the same, it changed the page.
  it("returns page-changed when another write took the number of the revision", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.revisionCreate.mockRejectedValue(uniqueViolation({ index: "PageRevision_pageId_number_key" }));
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });

    expect(mocks.error).not.toHaveBeenCalled();
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

describe("revertPage", () => {
  const VERSION = 4;
  const VALID = { revision: 2, version: VERSION };
  const OLD = "# Old title\n\nOld text";
  const STORED = { id: PAGE_ID, name: "stored-name", version: 5, folder: { name: "stored-folder" }, tab: null };
  const REVISION_NOT_FOUND = { ok: false, error: { code: "revision-not-found" } };
  const NOT_ALLOWED = { ok: false, error: { code: "not-allowed" } };

  /** The page as the revert reads it: its content now and the content of the chosen revision, if it has it. */
  function pageWith(revision: string | null, content = CONTENT) {
    return { content, revisions: revision === null ? [] : [{ content: revision }] };
  }

  /** Nothing is stored: no update of the page and no revision. */
  function expectNothingStored(): void {
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
  }

  it("stores the content of the revision and records a new revision that names it, in one transaction", async () => {
    mocks.findFirst.mockResolvedValue(pageWith(OLD));
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual({ ok: true, value: STORED });

    expect(mocks.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { id: PAGE_ID, deletedAt: null },
      select: { content: true, revisions: { where: { number: 2 }, select: { content: true } } },
    });
    expect(mocks.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: PAGE_ID, deletedAt: null, version: VERSION },
      data: {
        title: "Old title",
        content: OLD,
        lastEditedById: ACTOR_ID,
        lastEditedVia: "web",
        version: { increment: 1 },
      },
    });
    expect(mocks.revisionCreate).toHaveBeenCalledExactlyOnceWith({
      data: {
        pageId: PAGE_ID,
        number: 4,
        title: "Old title",
        content: OLD,
        userId: ACTOR_ID,
        via: "web",
        revertedTo: 2,
      },
    });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { pageId: PAGE_ID, revision: 2, channel: "browser" },
      "page reverted",
    );
  });

  // A revert always records a revision, also when the newest revision has the same content as the chosen one.
  it("records a revision also when the newest revision has the content of the chosen one", async () => {
    mocks.findFirst.mockResolvedValue(pageWith(OLD));
    mocks.revisionFindFirst.mockResolvedValue({ number: 3, content: OLD });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(STORED);

    await revertPage(ACTOR, PAGE_ID, VALID);

    expect(mocks.revisionCreate.mock.calls[0]?.[0].data).toMatchObject({ number: 4, revertedTo: 2 });
  });

  it("is not allowed for an admin, without a role and for a Reader, before anything else is read", async () => {
    await expect(
      revertPage({ ...ACTOR, type: "admin" }, MALFORMED_ID, { revision: 0, version: null }),
    ).resolves.toEqual(NOT_ALLOWED);
    expect(mocks.roleFindFirst).not.toHaveBeenCalled();

    mocks.roleFindFirst.mockResolvedValue(null);
    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(NOT_ALLOWED);
    mocks.roleFindFirst.mockResolvedValue({ role: "reader" });
    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(NOT_ALLOWED);

    expect(mocks.findFirst).not.toHaveBeenCalled();
    expectNothingStored();
    expect(mocks.warn).toHaveBeenLastCalledWith(
      { actorId: ACTOR_ID, pageId: PAGE_ID, role: "reader" },
      "page not reverted: the role of the actor does not allow it",
    );
  });

  it("returns page-not-found for a malformed id without reading the database", async () => {
    await expect(revertPage(ACTOR, MALFORMED_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it.each([0, -1, 1.5, Number.NaN, 2_147_483_648])(
    "returns revision-not-found for the malformed revision number %j without reading the page",
    async (revision) => {
      await expect(revertPage(ACTOR, PAGE_ID, { ...VALID, revision })).resolves.toEqual(REVISION_NOT_FOUND);
      expect(mocks.findFirst).not.toHaveBeenCalled();
      expectNothingStored();
    },
  );

  it("returns revision-not-found for a revision the page does not have", async () => {
    mocks.findFirst.mockResolvedValue(pageWith(null));

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(REVISION_NOT_FOUND);
    expectNothingStored();
  });

  it("returns revision-not-found for a revision with the content of the page now", async () => {
    mocks.findFirst.mockResolvedValue(pageWith(CONTENT));

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(REVISION_NOT_FOUND);
    expectNothingStored();
  });

  it("returns page-not-found for a page that does not exist or is deleted", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);
    expectNothingStored();
    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to revert not found");
  });

  // The limits in force now apply, which a revision stored before a limit existed may break (R16).
  it("returns the field errors of content that breaks a limit now, and stores nothing", async () => {
    const table = `# Table\n\n| a |\n| - |\n${"| x |\n".repeat(CONTENT_MAX_TABLE_CELLS)}`;
    mocks.findFirst.mockResolvedValue(pageWith(table));

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-input", fieldErrors: { content: [CONTENT_TABLE_CELLS_MESSAGE] } },
    });
    expectNothingStored();
  });

  it.each([null, 0, 1.5])("stores nothing and returns page-changed for the version %j", async (version) => {
    mocks.findFirst.mockResolvedValue(pageWith(OLD));
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(revertPage(ACTOR, PAGE_ID, { ...VALID, version })).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });
    expectNothingStored();
  });

  it("returns page-changed with the page as stored for an older version, and records nothing", async () => {
    mocks.findFirst.mockResolvedValue(pageWith(OLD));
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    // A revert always changes the content, so it never looks for a page with the same content.
    expect(mocks.findFirst).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledWith(
      { pageId: PAGE_ID, version: VERSION },
      "page to revert changed after the version the write is based on",
    );
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns failed and logs it for an error in the transaction", async () => {
    const err = new Error("connection lost");
    mocks.findFirst.mockResolvedValue(pageWith(OLD));
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.revisionCreate.mockRejectedValue(err);

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID }, "failed to revert page");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns failed and logs it when the page cannot be read", async () => {
    const err = new Error("connection lost");
    mocks.findFirst.mockRejectedValue(err);

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID }, "failed to revert page");
    expectNothingStored();
  });

  it("returns failed for an actor that does not exist", async () => {
    mocks.findFirst.mockResolvedValue(pageWith(OLD));
    mocks.updateMany.mockRejectedValue(foreignKeyViolation({ index: "Page_lastEditedById_fkey" }));

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR_ID }),
      "actor of write not found",
    );
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
      data: {
        name: "new-name",
        tabId: TAB_ID,
        lastEditedById: ACTOR_ID,
        lastEditedVia: "web",
        version: { increment: 1 },
      },
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null },
      select: STORED_PAGE_SELECT,
    });
    expect(mocks.info).toHaveBeenCalledWith(
      { pageId: PAGE_ID, tabId: TAB_ID, channel: "browser" },
      "page moved or renamed",
    );
  });

  it("places the page directly in its folder without a tab", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({ id: PAGE_ID, name: "n", folder: { name: "f" }, tab: null });

    await moveOrRenamePage(ACTOR, PAGE_ID, { name: "new-name", tabId: null, version: VERSION });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null, version: VERSION },
      data: {
        name: "new-name",
        tabId: null,
        lastEditedById: ACTOR_ID,
        lastEditedVia: "web",
        version: { increment: 1 },
      },
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
      data: {
        deletedAt: expect.any(Date),
        tabId: null,
        lastEditedById: ACTOR_ID,
        lastEditedVia: "web",
        version: { increment: 1 },
      },
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: PAGE_ID, channel: "browser" }, "page deleted");
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
      data: {
        deletedAt: null,
        name: "new-name",
        tabId: TAB_ID,
        lastEditedById: ACTOR_ID,
        lastEditedVia: "web",
        version: { increment: 1 },
      },
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: PAGE_ID, deletedAt: null },
      select: STORED_PAGE_SELECT,
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: PAGE_ID, tabId: TAB_ID, channel: "browser" }, "page restored");
  });

  it("restores the page directly into its folder without a tab", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({ id: PAGE_ID, name: "n", folder: { name: "f" }, tab: null });

    await restorePage(ACTOR, PAGE_ID, { name: "new-name", tabId: null });

    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          deletedAt: null,
          name: "new-name",
          tabId: null,
          lastEditedById: ACTOR_ID,
          lastEditedVia: "web",
          version: { increment: 1 },
        },
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
  const MCP_ADMIN: ContentActor = { ...MCP_ACTOR, type: "admin" };

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
  ])(
    "%s through MCP reads the pages with a role on the folder of the connection, and nothing without one",
    async (_name, read) => {
      mocks.roleFindFirst.mockResolvedValueOnce({ role: "owner" }).mockResolvedValueOnce(null);

      await expect(read()).resolves.toEqual([]);
      await expect(read()).resolves.toBeNull();

      expect(mocks.roleFindFirst).toHaveBeenCalledTimes(2);
      expect(mocks.findMany).toHaveBeenCalledOnce();
    },
  );

  it("listDeletedPages through MCP reads nothing, because the role of a connection is at most Writer", async () => {
    mocks.roleFindFirst.mockResolvedValue({ role: "owner" });

    await expect(listDeletedPages(MCP_ACTOR, FOLDER_ID)).resolves.toBeNull();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("listFolderPages through MCP reads every other folder as one without a role, without asking the database", async () => {
    await expect(listFolderPages(MCP_ACTOR, "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e55")).resolves.toBeNull();

    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("getPage and getDeletedPage through MCP read only the folder of the connection, with a role on it", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await getPage(MCP_ACTOR, "handbook", null, "overview");
    await getDeletedPage(MCP_ACTOR, "handbook", PAGE_ID);

    expect(mocks.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ folder: { name: "handbook", id: FOLDER_ID, ...WITH_ROLE } }),
      }),
    );
    // Deleted pages are a function of a Manager, which no connection has.
    expect(mocks.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ folder: { name: "handbook", id: { in: [] } } }) }),
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
