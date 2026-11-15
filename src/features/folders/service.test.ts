import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFolder,
  createTab,
  getFolderByName,
  getTab,
  listFolders,
  listTabs,
  renameFolder,
  renameTab,
} from "@/features/folders/service";
import type { BrowserActor, ContentActor } from "@/features/folder-roles/service";
import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  folderFindMany: vi.fn(),
  folderFindUnique: vi.fn(),
  folderFindFirst: vi.fn(),
  folderCreate: vi.fn(),
  folderUpdateMany: vi.fn(),
  tabFindMany: vi.fn(),
  tabFindFirst: vi.fn(),
  tabFindUnique: vi.fn(),
  tabCreate: vi.fn(),
  tabUpdateMany: vi.fn(),
  folderRoleFindFirst: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    folder: {
      findMany: mocks.folderFindMany,
      findUnique: mocks.folderFindUnique,
      findFirst: mocks.folderFindFirst,
      create: mocks.folderCreate,
      updateMany: mocks.folderUpdateMany,
    },
    tab: {
      findMany: mocks.tabFindMany,
      findFirst: mocks.tabFindFirst,
      findUnique: mocks.tabFindUnique,
      create: mocks.tabCreate,
      updateMany: mocks.tabUpdateMany,
    },
    folderRole: { findFirst: mocks.folderRoleFindFirst },
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

const databaseCalls = [
  mocks.folderFindMany,
  mocks.folderFindUnique,
  mocks.folderFindFirst,
  mocks.folderCreate,
  mocks.folderUpdateMany,
  mocks.tabFindMany,
  mocks.tabFindFirst,
  mocks.tabFindUnique,
  mocks.tabCreate,
  mocks.tabUpdateMany,
  mocks.folderRoleFindFirst,
];

/** The calls that write to the database. */
const writeCalls = [mocks.folderCreate, mocks.folderUpdateMany, mocks.tabCreate, mocks.tabUpdateMany];

function expectNothingWritten(): void {
  for (const call of writeCalls) expect(call).not.toHaveBeenCalled();
}

/** How often the database has been read or written. */
function databaseCallCount(): number {
  return databaseCalls.reduce((count, call) => count + call.mock.calls.length, 0);
}

function expectNothingLogged(): void {
  expect(mocks.info).not.toHaveBeenCalled();
  expect(mocks.warn).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  // The actor is Owner of every folder, unless a test says otherwise.
  mocks.folderRoleFindFirst.mockResolvedValue({ role: "owner" });
});

const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const TAB_ID = "5a2c1c0e-3f55-4a55-8a42-5d2f0e6a9b11";
const MALFORMED_ID = "not-a-uuid";
const ACTOR_ID = "9d4b2f6e-1c3a-4e8b-b7d5-2a6c8e0f1b12";

/** The user who makes the writes in the browser, one whose id is malformed, and the same user through MCP. */
const ACTOR: BrowserActor = { id: ACTOR_ID, name: "alice", type: "user", channel: "browser" };
const MALFORMED_ACTOR: BrowserActor = { id: MALFORMED_ID, name: "alice", type: "user", channel: "browser" };
const MCP_ACTOR: ContentActor = { ...ACTOR, channel: "mcp" };

/** The condition and the selection of the actor's role on a folder, as a read of the browser asks for it. */
const ROLE_WHERE = { roles: { some: { userId: ACTOR_ID } } };
const ROLE_SELECT = { roles: { where: { userId: ACTOR_ID }, select: { role: true } } };
/** The selection of a read of MCP, which reads no role. */
const NO_ROLE_SELECT = { roles: { take: 0, select: { role: true } } };

/** Names that are not valid as written: not lowercase, surrounding whitespace, a double hyphen, empty. */
const MALFORMED_NAMES = ["Handbook", " handbook", "handbook ", "release--notes", "-handbook", ""];

const VALID = { name: " handbook " };
const INVALID = { name: "" };

const NAME_TAKEN = { ok: false, error: { code: "name-taken" } };
const FAILED = { ok: false, error: { code: "failed" } };
const FOLDER_NOT_FOUND = { ok: false, error: { code: "folder-not-found" } };
const TAB_NOT_FOUND = { ok: false, error: { code: "tab-not-found" } };
const NAME_REQUIRED = { ok: false, error: { code: "invalid-input", fieldErrors: { name: ["Name is required"] } } };

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

const nameTakenErrors = [
  ["on the name index", uniqueViolation({ index: "Folder_name_key" })],
  ["on the name field", uniqueViolation({ fields: ["name"] })],
] as const;

const otherErrors = [
  ["a unique violation on another index", uniqueViolation({ index: "Folder_other_key" })],
  ["a unique violation on another field", uniqueViolation({ fields: ["other"] })],
  ["a unique violation without details", knownError("P2002")],
  ["another Prisma error", knownError("P2000")],
  ["any other error", new Error("connection lost")],
] as const;

describe("listFolders", () => {
  it("returns the folders with a role of the actor, each with the role", async () => {
    const folder = { id: FOLDER_ID, name: "handbook", updatedAt: new Date() };
    mocks.folderFindMany.mockResolvedValue([
      { ...folder, lastEditedBy: { username: "alice" }, roles: [{ role: "writer" }] },
    ]);

    await expect(listFolders(ACTOR)).resolves.toEqual([{ ...folder, lastEditedBy: { name: "alice" }, role: "writer" }]);
    expect(mocks.folderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: ROLE_WHERE, select: expect.objectContaining(ROLE_SELECT) }),
    );
  });

  it("returns every folder through MCP, without a role", async () => {
    const folder = { id: FOLDER_ID, name: "handbook", updatedAt: new Date() };
    mocks.folderFindMany.mockResolvedValue([{ ...folder, lastEditedBy: { username: "alice" }, roles: [] }]);

    await expect(listFolders(MCP_ACTOR)).resolves.toEqual([{ ...folder, lastEditedBy: { name: "alice" }, role: null }]);
    expect(mocks.folderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, select: expect.objectContaining(NO_ROLE_SELECT) }),
    );
  });

  it("returns no folder for a malformed actor id in the browser, logged, without reading the database", async () => {
    await expect(listFolders(MALFORMED_ACTOR)).resolves.toEqual([]);

    expect(databaseCallCount()).toBe(0);
    expect(mocks.error).toHaveBeenCalledWith({ actorId: MALFORMED_ID }, "malformed actor id");
  });
});

describe("getFolderByName", () => {
  it("returns the folder with the name and the role of the actor on it", async () => {
    mocks.folderFindFirst.mockResolvedValue({ id: FOLDER_ID, name: "handbook", roles: [{ role: "manager" }] });

    await expect(getFolderByName(ACTOR, "handbook")).resolves.toEqual({
      id: FOLDER_ID,
      name: "handbook",
      role: "manager",
    });
    expect(mocks.folderFindFirst).toHaveBeenCalledWith({
      where: { name: "handbook", ...ROLE_WHERE },
      select: { id: true, name: true, ...ROLE_SELECT },
    });
  });

  it("returns the folder through MCP without a role, whatever the roles", async () => {
    mocks.folderFindFirst.mockResolvedValue({ id: FOLDER_ID, name: "handbook", roles: [] });

    await expect(getFolderByName(MCP_ACTOR, "handbook")).resolves.toEqual({
      id: FOLDER_ID,
      name: "handbook",
      role: null,
    });
    expect(mocks.folderFindFirst).toHaveBeenCalledWith({
      where: { name: "handbook" },
      select: { id: true, name: true, ...NO_ROLE_SELECT },
    });
  });

  it("returns null when no folder has the name or the actor has no role on it", async () => {
    mocks.folderFindFirst.mockResolvedValue(null);

    await expect(getFolderByName(ACTOR, "handbook")).resolves.toBeNull();
  });

  it.each(MALFORMED_NAMES)("returns null for the malformed name %j without reading the database", async (name) => {
    await expect(getFolderByName(ACTOR, name)).resolves.toBeNull();
    expect(databaseCallCount()).toBe(0);
  });
});

describe("listTabs", () => {
  it("returns the tabs of the folder", async () => {
    const tab = { id: TAB_ID, name: "guides", updatedAt: new Date() };
    mocks.tabFindMany.mockResolvedValue([{ ...tab, lastEditedBy: { username: "alice" } }]);

    await expect(listTabs(ACTOR, FOLDER_ID)).resolves.toEqual([{ ...tab, lastEditedBy: { name: "alice" } }]);
    expect(mocks.tabFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { folderId: FOLDER_ID } }));
    expect(mocks.folderRoleFindFirst).toHaveBeenCalledWith({
      where: { userId: ACTOR_ID, folder: { id: FOLDER_ID } },
      select: { role: true },
    });
  });

  it("returns null without a role of the actor on the folder, without reading the tabs", async () => {
    mocks.folderRoleFindFirst.mockResolvedValue(null);

    await expect(listTabs(ACTOR, FOLDER_ID)).resolves.toBeNull();
    expect(mocks.tabFindMany).not.toHaveBeenCalled();
  });

  it("returns the tabs through MCP without asking for a role", async () => {
    mocks.tabFindMany.mockResolvedValue([]);

    await expect(listTabs(MCP_ACTOR, FOLDER_ID)).resolves.toEqual([]);
    expect(mocks.folderRoleFindFirst).not.toHaveBeenCalled();
  });

  it("returns no tabs for a malformed folder id without reading the database", async () => {
    await expect(listTabs(ACTOR, MALFORMED_ID)).resolves.toEqual([]);
    expect(databaseCallCount()).toBe(0);
  });
});

describe("getTab", () => {
  it("returns the tab with the name in the folder with the name, with the role of the actor", async () => {
    const tab = { id: TAB_ID, name: "guides", folder: { id: FOLDER_ID, name: "handbook" } };
    mocks.tabFindFirst.mockResolvedValue({ ...tab, folder: { ...tab.folder, roles: [{ role: "reader" }] } });

    await expect(getTab(ACTOR, "handbook", "guides")).resolves.toEqual({ ...tab, role: "reader" });
    expect(mocks.tabFindFirst).toHaveBeenCalledWith({
      where: { name: "guides", folder: { name: "handbook", ...ROLE_WHERE } },
      select: { id: true, name: true, folder: { select: { id: true, name: true, ...ROLE_SELECT } } },
    });
  });

  it("returns the tab through MCP without a role, whatever the roles", async () => {
    const tab = { id: TAB_ID, name: "guides", folder: { id: FOLDER_ID, name: "handbook" } };
    mocks.tabFindFirst.mockResolvedValue({ ...tab, folder: { ...tab.folder, roles: [] } });

    await expect(getTab(MCP_ACTOR, "handbook", "guides")).resolves.toEqual({ ...tab, role: null });
    expect(mocks.tabFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "guides", folder: { name: "handbook" } } }),
    );
  });

  it("returns null when the folder has no tab with the name", async () => {
    mocks.tabFindFirst.mockResolvedValue(null);

    await expect(getTab(ACTOR, "handbook", "guides")).resolves.toBeNull();
  });

  it.each(MALFORMED_NAMES)(
    "returns null for the malformed folder name %j without reading the database",
    async (name) => {
      await expect(getTab(ACTOR, name, "guides")).resolves.toBeNull();
      expect(databaseCallCount()).toBe(0);
    },
  );

  it.each(MALFORMED_NAMES)("returns null for the malformed tab name %j without reading the database", async (name) => {
    await expect(getTab(ACTOR, "handbook", name)).resolves.toBeNull();
    expect(databaseCallCount()).toBe(0);
  });
});

describe("createFolder", () => {
  it("returns the field errors of an invalid name without writing anything", async () => {
    await expect(createFolder(ACTOR, INVALID)).resolves.toEqual(NAME_REQUIRED);
    expect(databaseCallCount()).toBe(0);
    expectNothingLogged();
  });

  it("stores the folder with the trimmed name and its creator as Owner, and returns it as stored", async () => {
    const stored = { id: FOLDER_ID, name: "stored-name" };
    mocks.folderCreate.mockResolvedValue(stored);

    await expect(createFolder(ACTOR, VALID)).resolves.toEqual({ ok: true, value: stored });

    expect(mocks.folderCreate).toHaveBeenCalledWith({
      data: { name: "handbook", lastEditedById: ACTOR_ID, roles: { create: { userId: ACTOR_ID, role: "owner" } } },
      select: { id: true, name: true },
    });
    // A new folder needs no role of its creator.
    expect(mocks.folderRoleFindFirst).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith({ folderId: FOLDER_ID }, "folder created");
  });

  it("stores only the name of the input", async () => {
    mocks.folderCreate.mockResolvedValue({ id: FOLDER_ID, name: "handbook" });

    await createFolder(ACTOR, {
      name: "handbook",
      id: "other",
      createdAt: new Date(0),
      lastEditedById: "other",
    } as { name: string });

    expect(mocks.folderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: "handbook", lastEditedById: ACTOR_ID, roles: { create: { userId: ACTOR_ID, role: "owner" } } },
      }),
    );
  });

  it.each(nameTakenErrors)("returns name-taken for a unique violation %s", async (_name, err) => {
    mocks.folderCreate.mockRejectedValue(err);

    await expect(createFolder(ACTOR, VALID)).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ name: "handbook" }, "name of new folder already in use");
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each(otherErrors)("returns failed for %s", async (_name, err) => {
    mocks.folderCreate.mockRejectedValue(err);

    await expect(createFolder(ACTOR, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err }, "failed to create folder");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

describe("renameFolder", () => {
  it.each([
    ["a valid", VALID],
    ["an invalid", INVALID],
  ])("returns folder-not-found for a malformed id, with %s name", async (_name, input) => {
    await expect(renameFolder(ACTOR, MALFORMED_ID, input)).resolves.toEqual(FOLDER_NOT_FOUND);
    expect(databaseCallCount()).toBe(0);
    expectNothingLogged();
  });

  it("returns the field errors of an invalid name without writing anything", async () => {
    await expect(renameFolder(ACTOR, FOLDER_ID, INVALID)).resolves.toEqual(NAME_REQUIRED);
    expectNothingWritten();
    expectNothingLogged();
  });

  it("stores the trimmed name and returns the folder as stored", async () => {
    mocks.folderUpdateMany.mockResolvedValue({ count: 1 });

    await expect(renameFolder(ACTOR, FOLDER_ID, VALID)).resolves.toEqual({
      ok: true,
      value: { id: FOLDER_ID, name: "handbook" },
    });

    expect(mocks.folderUpdateMany).toHaveBeenCalledWith({
      where: { id: FOLDER_ID },
      data: { name: "handbook", lastEditedById: ACTOR_ID },
    });
    expect(mocks.info).toHaveBeenCalledWith({ folderId: FOLDER_ID }, "folder renamed");
  });

  it("returns folder-not-found for a folder that no longer exists", async () => {
    mocks.folderUpdateMany.mockResolvedValue({ count: 0 });

    await expect(renameFolder(ACTOR, FOLDER_ID, VALID)).resolves.toEqual(FOLDER_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ folderId: FOLDER_ID }, "folder to rename not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each(nameTakenErrors)("returns name-taken for a unique violation %s", async (_name, err) => {
    mocks.folderUpdateMany.mockRejectedValue(err);

    await expect(renameFolder(ACTOR, FOLDER_ID, VALID)).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith(
      { folderId: FOLDER_ID, name: "handbook" },
      "name of renamed folder already in use",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(otherErrors)("returns failed for %s", async (_name, err) => {
    mocks.folderUpdateMany.mockRejectedValue(err);

    await expect(renameFolder(ACTOR, FOLDER_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, folderId: FOLDER_ID }, "failed to rename folder");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

const tabNameTakenErrors = [
  ["on the name index", uniqueViolation({ index: "Tab_folderId_name_key" })],
  ["on the folder and name fields", uniqueViolation({ fields: ["folderId", "name"] })],
] as const;

const otherTabErrors = [
  ["a unique violation on another index", uniqueViolation({ index: "Tab_id_folderId_key" })],
  ["another Prisma error", knownError("P2000")],
  ["any other error", new Error("connection lost")],
] as const;

const TAB_VALID = { name: " guides " };
const STORED_TAB_SELECT = { id: true, name: true, folder: { select: { name: true } } };

describe("createTab", () => {
  it.each([
    ["a valid", TAB_VALID],
    ["an invalid", INVALID],
  ])("returns folder-not-found for a malformed folder id, with %s name", async (_name, input) => {
    await expect(createTab(ACTOR, MALFORMED_ID, input)).resolves.toEqual(FOLDER_NOT_FOUND);
    expect(databaseCallCount()).toBe(0);
    expectNothingLogged();
  });

  it("returns the field errors of an invalid name without writing anything", async () => {
    await expect(createTab(ACTOR, FOLDER_ID, INVALID)).resolves.toEqual(NAME_REQUIRED);
    expectNothingWritten();
    expectNothingLogged();
  });

  it("stores the tab in the folder and returns it as stored", async () => {
    const stored = { id: TAB_ID, name: "stored-tab", folder: { name: "stored-folder" } };
    mocks.tabCreate.mockResolvedValue(stored);

    await expect(createTab(ACTOR, FOLDER_ID, TAB_VALID)).resolves.toEqual({ ok: true, value: stored });

    expect(mocks.tabCreate).toHaveBeenCalledWith({
      data: { name: "guides", folderId: FOLDER_ID, lastEditedById: ACTOR_ID },
      select: STORED_TAB_SELECT,
    });
    expect(mocks.info).toHaveBeenCalledWith({ tabId: TAB_ID }, "tab created");
  });

  it.each(tabNameTakenErrors)("returns name-taken for a unique violation %s", async (_name, err) => {
    mocks.tabCreate.mockRejectedValue(err);

    await expect(createTab(ACTOR, FOLDER_ID, TAB_VALID)).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ folderId: FOLDER_ID, name: "guides" }, "name of new tab already in use");
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each([
    ["without details", knownError("P2003")],
    ["on the folder key", foreignKeyViolation({ index: "Tab_folderId_fkey" })],
    ["on the folder field", foreignKeyViolation({ fields: ["folderId"] })],
  ])("returns folder-not-found for a foreign key violation %s", async (_name, err) => {
    mocks.tabCreate.mockRejectedValue(err);

    await expect(createTab(ACTOR, FOLDER_ID, TAB_VALID)).resolves.toEqual(FOLDER_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ folderId: FOLDER_ID }, "folder of new tab not found");
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(otherTabErrors)("returns failed for %s", async (_name, err) => {
    mocks.tabCreate.mockRejectedValue(err);

    await expect(createTab(ACTOR, FOLDER_ID, TAB_VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, folderId: FOLDER_ID }, "failed to create tab");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

describe("renameTab", () => {
  it.each([
    ["a valid", TAB_VALID],
    ["an invalid", INVALID],
  ])("returns tab-not-found for a malformed id, with %s name", async (_name, input) => {
    await expect(renameTab(ACTOR, MALFORMED_ID, input)).resolves.toEqual(TAB_NOT_FOUND);
    expect(databaseCallCount()).toBe(0);
    expectNothingLogged();
  });

  it("returns the field errors of an invalid name without writing anything", async () => {
    await expect(renameTab(ACTOR, TAB_ID, INVALID)).resolves.toEqual(NAME_REQUIRED);
    expectNothingWritten();
    expectNothingLogged();
  });

  it("stores the trimmed name and returns the tab as stored", async () => {
    const stored = { id: TAB_ID, name: "stored-tab", folder: { name: "stored-folder" } };
    mocks.tabUpdateMany.mockResolvedValue({ count: 1 });
    mocks.tabFindUnique.mockResolvedValue(stored);

    await expect(renameTab(ACTOR, TAB_ID, TAB_VALID)).resolves.toEqual({ ok: true, value: stored });

    expect(mocks.tabUpdateMany).toHaveBeenCalledWith({
      where: { id: TAB_ID },
      data: { name: "guides", lastEditedById: ACTOR_ID },
    });
    expect(mocks.tabFindUnique).toHaveBeenCalledWith({ where: { id: TAB_ID }, select: STORED_TAB_SELECT });
    expect(mocks.info).toHaveBeenCalledWith({ tabId: TAB_ID }, "tab renamed");
  });

  it("returns tab-not-found for a tab that no longer exists", async () => {
    mocks.tabUpdateMany.mockResolvedValue({ count: 0 });

    await expect(renameTab(ACTOR, TAB_ID, TAB_VALID)).resolves.toEqual(TAB_NOT_FOUND);

    expect(mocks.tabFindUnique).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ tabId: TAB_ID }, "tab to rename not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns tab-not-found for a tab that disappears right after the update", async () => {
    mocks.tabUpdateMany.mockResolvedValue({ count: 1 });
    mocks.tabFindUnique.mockResolvedValue(null);

    await expect(renameTab(ACTOR, TAB_ID, TAB_VALID)).resolves.toEqual(TAB_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ tabId: TAB_ID }, "tab to rename not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each(tabNameTakenErrors)("returns name-taken for a unique violation %s", async (_name, err) => {
    mocks.tabUpdateMany.mockRejectedValue(err);

    await expect(renameTab(ACTOR, TAB_ID, TAB_VALID)).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ tabId: TAB_ID, name: "guides" }, "name of renamed tab already in use");
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(otherTabErrors)("returns failed for %s", async (_name, err) => {
    mocks.tabUpdateMany.mockRejectedValue(err);

    await expect(renameTab(ACTOR, TAB_ID, TAB_VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, tabId: TAB_ID }, "failed to rename tab");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

/** Every write, called by the given actor with valid input, the database call it writes with, and its editor key. */
const writes = [
  [
    "createFolder",
    (actor: BrowserActor) => createFolder(actor, VALID),
    mocks.folderCreate,
    "Folder_lastEditedById_fkey",
  ],
  [
    "renameFolder",
    (actor: BrowserActor) => renameFolder(actor, FOLDER_ID, VALID),
    mocks.folderUpdateMany,
    "Folder_lastEditedById_fkey",
  ],
  [
    "createTab",
    (actor: BrowserActor) => createTab(actor, FOLDER_ID, TAB_VALID),
    mocks.tabCreate,
    "Tab_lastEditedById_fkey",
  ],
  [
    "renameTab",
    (actor: BrowserActor) => renameTab(actor, TAB_ID, TAB_VALID),
    mocks.tabUpdateMany,
    "Tab_lastEditedById_fkey",
  ],
] as const;

describe("the actor of a write", () => {
  it.each(writes)("%s returns failed for a malformed actor id without touching the database", async (_name, write) => {
    await expect(write(MALFORMED_ACTOR)).resolves.toEqual(FAILED);

    expect(databaseCallCount()).toBe(0);
    expect(mocks.error).toHaveBeenCalledWith({ actorId: MALFORMED_ID }, "malformed actor id");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each(
    writes.flatMap(([name, write, call, constraint]) => [
      [name, "on the editor key", write, call, foreignKeyViolation({ index: constraint })] as const,
      [name, "on the editor field", write, call, foreignKeyViolation({ fields: ["lastEditedById"] })] as const,
    ]),
  )("%s returns failed for a foreign key violation %s", async (_name, _kind, write, call, err) => {
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
    ["listFolders", () => listFolders(ADMIN)],
    ["getFolderByName", () => getFolderByName(ADMIN, "handbook")],
    ["listTabs", () => listTabs(ADMIN, FOLDER_ID)],
    ["getTab", () => getTab(ADMIN, "handbook", "guides")],
    ["listFolders through MCP", () => listFolders(MCP_ADMIN)],
    ["getFolderByName through MCP", () => getFolderByName(MCP_ADMIN, "handbook")],
    ["listTabs through MCP", () => listTabs(MCP_ADMIN, FOLDER_ID)],
    ["getTab through MCP", () => getTab(MCP_ADMIN, "handbook", "guides")],
  ])("gets null from %s, without asking the database", async (_name, read) => {
    await expect(read()).resolves.toBeNull();

    expect(databaseCallCount()).toBe(0);
    expectNothingLogged();
  });

  const MESSAGES = {
    createFolder: "folder not created: the actor is an admin",
    renameFolder: "folder not renamed: the actor is an admin",
    createTab: "tab not created: the actor is an admin",
    renameTab: "tab not renamed: the actor is an admin",
  };

  it.each(writes)("gets not-allowed from %s, logged, without touching the database", async (name, write) => {
    await expect(write(ADMIN)).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });

    expect(databaseCallCount()).toBe(0);
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ actorId: ACTOR_ID }, MESSAGES[name]);
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("is refused before the ids and the input are checked", async () => {
    const results = [
      await createFolder(ADMIN, INVALID),
      await renameFolder(ADMIN, MALFORMED_ID, INVALID),
      await createTab(ADMIN, MALFORMED_ID, INVALID),
      await renameTab(ADMIN, MALFORMED_ID, INVALID),
      await createFolder({ ...ADMIN, id: MALFORMED_ID }, VALID),
    ];

    for (const result of results) expect(result).toEqual({ ok: false, error: { code: "not-allowed" } });
    expect(databaseCallCount()).toBe(0);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each([
    ["listFolders", () => listFolders(ACTOR), mocks.folderFindMany, []],
    ["getFolderByName", () => getFolderByName(ACTOR, "handbook"), mocks.folderFindFirst, null],
    ["listTabs", () => listTabs(ACTOR, FOLDER_ID), mocks.tabFindMany, []],
    ["getTab", () => getTab(ACTOR, "handbook", "guides"), mocks.tabFindFirst, null],
  ])("does not change %s for a user", async (_name, read, call, value) => {
    call.mockResolvedValue(value);

    await read();

    expect(call).toHaveBeenCalledOnce();
  });
});

describe("a user without a role on the folder", () => {
  beforeEach(() => {
    mocks.folderRoleFindFirst.mockResolvedValue(null);
  });

  it.each([
    [
      "renameFolder",
      () => renameFolder(ACTOR, FOLDER_ID, VALID),
      { folderId: FOLDER_ID },
      "folder not renamed: the actor has no role on the folder",
      { id: FOLDER_ID },
    ],
    [
      "createTab",
      () => createTab(ACTOR, FOLDER_ID, TAB_VALID),
      { folderId: FOLDER_ID },
      "tab not created: the actor has no role on the folder",
      { id: FOLDER_ID },
    ],
    [
      "renameTab",
      () => renameTab(ACTOR, TAB_ID, TAB_VALID),
      { tabId: TAB_ID },
      "tab not renamed: the actor has no role on the folder",
      { tabs: { some: { id: TAB_ID } } },
    ],
  ] as const)(
    "gets not-allowed from %s, logged, and nothing is written",
    async (_name, write, target, message, folder) => {
      await expect(write()).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });

      expect(mocks.folderRoleFindFirst).toHaveBeenCalledExactlyOnceWith({
        where: { userId: ACTOR_ID, folder },
        select: { role: true },
      });
      expectNothingWritten();
      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ actorId: ACTOR_ID, ...target }, message);
      expect(mocks.info).not.toHaveBeenCalled();
    },
  );

  it("is refused before the input is checked", async () => {
    await expect(renameFolder(ACTOR, FOLDER_ID, INVALID)).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });
    await expect(createTab(ACTOR, FOLDER_ID, INVALID)).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });
    await expect(renameTab(ACTOR, TAB_ID, INVALID)).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });
  });

  it("still creates a folder, which needs no role", async () => {
    mocks.folderCreate.mockResolvedValue({ id: FOLDER_ID, name: "handbook" });

    await expect(createFolder(ACTOR, VALID)).resolves.toMatchObject({ ok: true });
  });
});

describe("the lowest role of each function", () => {
  const ROLES = ["reader", "writer", "manager", "owner"] as const;

  const functions = [
    [
      "renameFolder",
      () => renameFolder(ACTOR, FOLDER_ID, VALID),
      "owner",
      { folderId: FOLDER_ID },
      "folder not renamed",
    ],
    ["createTab", () => createTab(ACTOR, FOLDER_ID, TAB_VALID), "manager", { folderId: FOLDER_ID }, "tab not created"],
    ["renameTab", () => renameTab(ACTOR, TAB_ID, TAB_VALID), "manager", { tabId: TAB_ID }, "tab not renamed"],
  ] as const;

  const cases = functions.flatMap(([name, write, lowest, target, what]) =>
    ROLES.map((role) => [name, role, write, ROLES.indexOf(role) >= ROLES.indexOf(lowest), target, what] as const),
  );

  it.each(cases)("%s as %s", async (_name, role, write, allowed, target, what) => {
    mocks.folderRoleFindFirst.mockResolvedValue({ role });
    mocks.folderUpdateMany.mockResolvedValue({ count: 1 });
    mocks.tabCreate.mockResolvedValue({ id: TAB_ID, name: "guides", folder: { name: "handbook" } });
    mocks.tabUpdateMany.mockResolvedValue({ count: 1 });
    mocks.tabFindUnique.mockResolvedValue({ id: TAB_ID, name: "guides", folder: { name: "handbook" } });

    const result = await write();

    if (allowed) {
      expect(result).toMatchObject({ ok: true });
    } else {
      expect(result).toEqual({ ok: false, error: { code: "not-allowed" } });
      expectNothingWritten();
      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
        { actorId: ACTOR_ID, ...target, role },
        `${what}: the role of the actor does not allow it`,
      );
    }
  });
});
