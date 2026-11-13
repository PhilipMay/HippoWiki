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
import type { Actor } from "@/features/users/service";
import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  folderFindMany: vi.fn(),
  folderFindUnique: vi.fn(),
  folderCreate: vi.fn(),
  folderUpdateMany: vi.fn(),
  tabFindMany: vi.fn(),
  tabFindFirst: vi.fn(),
  tabFindUnique: vi.fn(),
  tabCreate: vi.fn(),
  tabUpdateMany: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    folder: {
      findMany: mocks.folderFindMany,
      findUnique: mocks.folderFindUnique,
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
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

const databaseCalls = [
  mocks.folderFindMany,
  mocks.folderFindUnique,
  mocks.folderCreate,
  mocks.folderUpdateMany,
  mocks.tabFindMany,
  mocks.tabFindFirst,
  mocks.tabFindUnique,
  mocks.tabCreate,
  mocks.tabUpdateMany,
];

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
});

const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const TAB_ID = "5a2c1c0e-3f55-4a55-8a42-5d2f0e6a9b11";
const MALFORMED_ID = "not-a-uuid";
const ACTOR_ID = "9d4b2f6e-1c3a-4e8b-b7d5-2a6c8e0f1b12";

/** The user who makes the writes, and one whose id is malformed. */
const ACTOR: Actor = { id: ACTOR_ID, name: "alice" };
const MALFORMED_ACTOR: Actor = { id: MALFORMED_ID, name: "alice" };

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
  it("returns the folders of the database", async () => {
    const folder = { id: FOLDER_ID, name: "handbook", updatedAt: new Date() };
    mocks.folderFindMany.mockResolvedValue([{ ...folder, lastEditedBy: { username: "alice" } }]);

    await expect(listFolders()).resolves.toEqual([{ ...folder, lastEditedBy: { name: "alice" } }]);
  });
});

describe("getFolderByName", () => {
  it("returns the folder with the name", async () => {
    const folder = { id: FOLDER_ID, name: "handbook" };
    mocks.folderFindUnique.mockResolvedValue(folder);

    await expect(getFolderByName("handbook")).resolves.toBe(folder);
    expect(mocks.folderFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { name: "handbook" } }));
  });

  it("returns null when no folder has the name", async () => {
    mocks.folderFindUnique.mockResolvedValue(null);

    await expect(getFolderByName("handbook")).resolves.toBeNull();
  });

  it.each(MALFORMED_NAMES)("returns null for the malformed name %j without reading the database", async (name) => {
    await expect(getFolderByName(name)).resolves.toBeNull();
    expect(databaseCallCount()).toBe(0);
  });
});

describe("listTabs", () => {
  it("returns the tabs of the folder", async () => {
    const tab = { id: TAB_ID, name: "guides", updatedAt: new Date() };
    mocks.tabFindMany.mockResolvedValue([{ ...tab, lastEditedBy: { username: "alice" } }]);

    await expect(listTabs(FOLDER_ID)).resolves.toEqual([{ ...tab, lastEditedBy: { name: "alice" } }]);
    expect(mocks.tabFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { folderId: FOLDER_ID } }));
  });

  it("returns no tabs for a malformed folder id without reading the database", async () => {
    await expect(listTabs(MALFORMED_ID)).resolves.toEqual([]);
    expect(databaseCallCount()).toBe(0);
  });
});

describe("getTab", () => {
  it("returns the tab with the name in the folder with the name", async () => {
    const tab = { id: TAB_ID, name: "guides", folder: { id: FOLDER_ID, name: "handbook" } };
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
      expect(databaseCallCount()).toBe(0);
    },
  );

  it.each(MALFORMED_NAMES)("returns null for the malformed tab name %j without reading the database", async (name) => {
    await expect(getTab("handbook", name)).resolves.toBeNull();
    expect(databaseCallCount()).toBe(0);
  });
});

describe("createFolder", () => {
  it("returns the field errors of an invalid name without writing anything", async () => {
    await expect(createFolder(ACTOR, INVALID)).resolves.toEqual(NAME_REQUIRED);
    expect(databaseCallCount()).toBe(0);
    expectNothingLogged();
  });

  it("stores the folder with the trimmed name and returns it as stored", async () => {
    const stored = { id: FOLDER_ID, name: "stored-name" };
    mocks.folderCreate.mockResolvedValue(stored);

    await expect(createFolder(ACTOR, VALID)).resolves.toEqual({ ok: true, value: stored });

    expect(mocks.folderCreate).toHaveBeenCalledWith({
      data: { name: "handbook", lastEditedById: ACTOR_ID },
      select: { id: true, name: true },
    });
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
      expect.objectContaining({ data: { name: "handbook", lastEditedById: ACTOR_ID } }),
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
    expect(databaseCallCount()).toBe(0);
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
    expect(databaseCallCount()).toBe(0);
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
    expect(databaseCallCount()).toBe(0);
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
  ["createFolder", (actor: Actor) => createFolder(actor, VALID), mocks.folderCreate, "Folder_lastEditedById_fkey"],
  [
    "renameFolder",
    (actor: Actor) => renameFolder(actor, FOLDER_ID, VALID),
    mocks.folderUpdateMany,
    "Folder_lastEditedById_fkey",
  ],
  ["createTab", (actor: Actor) => createTab(actor, FOLDER_ID, TAB_VALID), mocks.tabCreate, "Tab_lastEditedById_fkey"],
  ["renameTab", (actor: Actor) => renameTab(actor, TAB_ID, TAB_VALID), mocks.tabUpdateMany, "Tab_lastEditedById_fkey"],
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
