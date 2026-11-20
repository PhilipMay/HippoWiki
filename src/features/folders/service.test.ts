import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFolder,
  createTab,
  deleteTab,
  getFolderById,
  getFolderByName,
  getTab,
  listFolders,
  listTabs,
  renameFolder,
  renameTab,
} from "@/features/folders/service";
import type { ContentActor } from "@/features/folder-roles/actors";
import { allows, contentWritesOf, ROLES } from "@/test/content-writes";
import {
  ACTOR,
  ACTOR_ID,
  ADMIN,
  dataOf,
  FOLDER_ID,
  foreignKeyViolation,
  knownError,
  MALFORMED_ACTOR,
  MALFORMED_ID,
  MCP_ACTOR,
  mcpActor,
  TAB_ID,
  uniqueViolation,
} from "@/test/unit";

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
  queryRaw: vi.fn(),
  pageUpdateManyAndReturn: vi.fn(),
  tabDelete: vi.fn(),
  txTabFindFirst: vi.fn(),
  pageLinkFindMany: vi.fn(),
  pageUpdate: vi.fn(),
  pageLinkDeleteMany: vi.fn(),
  pageLinkCreateMany: vi.fn(),
  revisionFindFirst: vi.fn(),
  revisionCreate: vi.fn(),
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
    // An interactive transaction runs its callback with a client of its own; here with the mocks of the deletion and
    // of the rename of a tab, whose folder and name before the rename `txTabFindFirst` gives.
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $queryRaw: mocks.queryRaw,
        $executeRaw: vi.fn(),
        page: { updateManyAndReturn: mocks.pageUpdateManyAndReturn, update: mocks.pageUpdate },
        pageLink: {
          findMany: mocks.pageLinkFindMany,
          deleteMany: mocks.pageLinkDeleteMany,
          createMany: mocks.pageLinkCreateMany,
        },
        pageRevision: { findFirst: mocks.revisionFindFirst, create: mocks.revisionCreate },
        tab: {
          delete: mocks.tabDelete,
          findFirst: mocks.txTabFindFirst,
          findUnique: mocks.tabFindUnique,
          updateMany: mocks.tabUpdateMany,
        },
      }),
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
  mocks.queryRaw,
  mocks.pageUpdateManyAndReturn,
  mocks.tabDelete,
];

/** The calls that write to the database. */
const writeCalls = [
  mocks.folderCreate,
  mocks.folderUpdateMany,
  mocks.tabCreate,
  mocks.tabUpdateMany,
  mocks.pageUpdateManyAndReturn,
  mocks.tabDelete,
];

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
  // The tab of a rename is in the folder of the tests, and no page links into it.
  mocks.txTabFindFirst.mockResolvedValue({ folderId: FOLDER_ID, name: "old-name" });
  mocks.pageLinkFindMany.mockResolvedValue([]);
  // The locked row of the tab that a deletion reads, unless a test says otherwise.
  mocks.queryRaw.mockResolvedValue([{ folderId: FOLDER_ID, folderName: "handbook" }]);
});

/** Names that are not valid as written: not lowercase, surrounding whitespace, a double hyphen, empty. */
const MALFORMED_NAMES = ["Handbook", " handbook", "handbook ", "release--notes", "-handbook", ""];

const VALID = { name: " handbook " };
const INVALID = { name: "" };

const NAME_TAKEN = { ok: false, error: { code: "name-taken" } };
const FAILED = { ok: false, error: { code: "failed" } };
const FOLDER_NOT_FOUND = { ok: false, error: { code: "folder-not-found" } };
const TAB_NOT_FOUND = { ok: false, error: { code: "tab-not-found" } };
const NAME_REQUIRED = { ok: false, error: { code: "invalid-input", fieldErrors: { name: ["Name is required"] } } };

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
      { ...folder, lastEditedBy: { username: "alice" }, lastEditedVia: "web", roles: [{ role: "writer" }] },
    ]);

    await expect(listFolders(ACTOR)).resolves.toEqual([
      { ...folder, lastEditedBy: { name: "alice", via: "web" }, role: "writer" },
    ]);
  });

  it("returns the folder of the connection through MCP with the lower of the two roles", async () => {
    const folder = { id: FOLDER_ID, name: "handbook", updatedAt: new Date() };
    mocks.folderFindMany.mockResolvedValue([
      { ...folder, lastEditedBy: { username: "alice" }, lastEditedVia: "web", roles: [{ role: "owner" }] },
    ]);

    await expect(listFolders(MCP_ACTOR)).resolves.toEqual([
      { ...folder, lastEditedBy: { name: "alice", via: "web" }, role: "writer" },
    ]);
  });

  it("returns null for a malformed actor id in the browser, as every read, logged, without reading the database", async () => {
    await expect(listFolders(MALFORMED_ACTOR)).resolves.toBeNull();

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
  });

  it("returns the folder through MCP with the lower of the two roles", async () => {
    mocks.folderFindFirst.mockResolvedValue({ id: FOLDER_ID, name: "handbook", roles: [{ role: "manager" }] });

    await expect(getFolderByName(MCP_ACTOR, "handbook")).resolves.toEqual({
      id: FOLDER_ID,
      name: "handbook",
      role: "writer",
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

describe("getFolderById", () => {
  it("returns the folder with the id and the role of the actor on it", async () => {
    mocks.folderFindFirst.mockResolvedValue({ id: FOLDER_ID, name: "handbook", roles: [{ role: "reader" }] });

    await expect(getFolderById(ACTOR, FOLDER_ID)).resolves.toEqual({ id: FOLDER_ID, name: "handbook", role: "reader" });
  });

  it("returns the folder through MCP with the lower of the two roles", async () => {
    mocks.folderFindFirst.mockResolvedValue({ id: FOLDER_ID, name: "handbook", roles: [{ role: "owner" }] });

    await expect(getFolderById(MCP_ACTOR, FOLDER_ID)).resolves.toEqual({
      id: FOLDER_ID,
      name: "handbook",
      role: "writer",
    });
  });

  it("returns null when no folder has the id or the actor has no role on it", async () => {
    mocks.folderFindFirst.mockResolvedValue(null);

    await expect(getFolderById(ACTOR, FOLDER_ID)).resolves.toBeNull();
  });

  it("returns null for a malformed id without reading the database", async () => {
    await expect(getFolderById(ACTOR, MALFORMED_ID)).resolves.toBeNull();
    expect(databaseCallCount()).toBe(0);
  });
});

describe("listTabs", () => {
  it("returns the tabs of the folder", async () => {
    const tab = { id: TAB_ID, name: "guides", updatedAt: new Date() };
    mocks.tabFindMany.mockResolvedValue([{ ...tab, lastEditedBy: { username: "alice" }, lastEditedVia: "web" }]);

    await expect(listTabs(ACTOR, FOLDER_ID)).resolves.toEqual([
      { ...tab, lastEditedBy: { name: "alice", via: "web" } },
    ]);
  });

  it("returns null without a role of the actor on the folder, without reading the tabs", async () => {
    mocks.folderRoleFindFirst.mockResolvedValue(null);

    await expect(listTabs(ACTOR, FOLDER_ID)).resolves.toBeNull();
  });

  it("returns the tabs through MCP only of the folder of the connection, with a role on it", async () => {
    mocks.tabFindMany.mockResolvedValue([]);

    await expect(listTabs(MCP_ACTOR, FOLDER_ID)).resolves.toEqual([]);
    // Another folder reads like one without a role, without asking the database.
    await expect(listTabs(MCP_ACTOR, "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e55")).resolves.toBeNull();
    expect(mocks.folderRoleFindFirst).toHaveBeenCalledOnce();
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
  });

  it("returns the tab through MCP with the lower of the two roles", async () => {
    const tab = { id: TAB_ID, name: "guides", folder: { id: FOLDER_ID, name: "handbook" } };
    mocks.tabFindFirst.mockResolvedValue({ ...tab, folder: { ...tab.folder, roles: [{ role: "owner" }] } });

    await expect(getTab(MCP_ACTOR, "handbook", "guides")).resolves.toEqual({ ...tab, role: "writer" });
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

    expect(dataOf(mocks.folderCreate)).toEqual({
      name: "handbook",
      lastEditedById: ACTOR_ID,
      lastEditedVia: "web",
      roles: { create: { userId: ACTOR_ID, role: "owner" } },
    });
    // A new folder needs no role of its creator.
    expect(mocks.folderRoleFindFirst).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith({ folderId: FOLDER_ID, channel: "web" }, "folder created");
  });

  it("stores only the name of the input", async () => {
    mocks.folderCreate.mockResolvedValue({ id: FOLDER_ID, name: "handbook" });

    await createFolder(ACTOR, {
      name: "handbook",
      id: "other",
      createdAt: new Date(0),
      lastEditedById: "other",
      lastEditedVia: "mcp",
    } as { name: string });

    expect(dataOf(mocks.folderCreate)).toEqual({
      name: "handbook",
      lastEditedById: ACTOR_ID,
      lastEditedVia: "web",
      roles: { create: { userId: ACTOR_ID, role: "owner" } },
    });
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

    expect(dataOf(mocks.folderUpdateMany)).toEqual({
      name: "handbook",
      lastEditedById: ACTOR_ID,
      lastEditedVia: "web",
    });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith({ folderId: FOLDER_ID, channel: "web" }, "folder renamed");
  });

  it.each([
    ["the stored name", { name: "handbook" }],
    ["the stored name with surrounding spaces", VALID],
  ])("stores nothing for %s and returns the folder as stored", async (_name, input) => {
    mocks.folderUpdateMany.mockResolvedValue({ count: 0 });
    mocks.folderFindUnique.mockResolvedValue({ id: FOLDER_ID, name: "handbook" });

    await expect(renameFolder(ACTOR, FOLDER_ID, input)).resolves.toEqual({
      ok: true,
      value: { id: FOLDER_ID, name: "handbook" },
    });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { folderId: FOLDER_ID, channel: "web" },
      "folder not changed: name is the same",
    );
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  // The rename between the update and the read cannot be timed against the database, so this case needs the mock.
  it("stores the name once more without the condition for a folder renamed meanwhile to another name", async () => {
    mocks.folderUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    mocks.folderFindUnique.mockResolvedValue({ id: FOLDER_ID, name: "other" });

    await expect(renameFolder(ACTOR, FOLDER_ID, VALID)).resolves.toEqual({
      ok: true,
      value: { id: FOLDER_ID, name: "handbook" },
    });

    const data = { name: "handbook", lastEditedById: ACTOR_ID, lastEditedVia: "web" };
    expect(mocks.folderUpdateMany.mock.calls).toEqual([
      [{ where: { id: FOLDER_ID, name: { not: "handbook" } }, data }],
      [{ where: { id: FOLDER_ID }, data }],
    ]);
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith({ folderId: FOLDER_ID, channel: "web" }, "folder renamed");
  });

  it("returns folder-not-found for a folder that no longer exists", async () => {
    mocks.folderUpdateMany.mockResolvedValue({ count: 0 });
    mocks.folderFindUnique.mockResolvedValue(null);

    await expect(renameFolder(ACTOR, FOLDER_ID, VALID)).resolves.toEqual(FOLDER_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ folderId: FOLDER_ID }, "folder to rename not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns folder-not-found for a folder renamed meanwhile and then deleted", async () => {
    mocks.folderUpdateMany.mockResolvedValue({ count: 0 });
    mocks.folderFindUnique.mockResolvedValue({ id: FOLDER_ID, name: "other" });

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

    expect(dataOf(mocks.tabCreate)).toEqual({
      name: "guides",
      folderId: FOLDER_ID,
      lastEditedById: ACTOR_ID,
      lastEditedVia: "web",
    });
    expect(mocks.info).toHaveBeenCalledWith({ tabId: TAB_ID, channel: "web" }, "tab created");
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

  it("returns the pages whose links into the tab the rename updated, and reads them for the old name", async () => {
    const stored = { id: TAB_ID, name: "guides", folder: { name: "handbook" } };
    mocks.tabUpdateMany.mockResolvedValue({ count: 1 });
    mocks.tabFindUnique.mockResolvedValue(stored);
    mocks.pageLinkFindMany.mockResolvedValue([{ pageId: "p1" }]);
    mocks.queryRaw.mockResolvedValue([{ id: "p1", title: "Linking", content: "# Linking\n\n[[old-name/setup]]" }]);
    const updated = { id: "p1", name: "linking", title: "Linking", tab: null };
    const update = vi.fn().mockResolvedValue(updated);
    mocks.pageUpdate.mockImplementation(update);

    await expect(renameTab(ACTOR, TAB_ID, TAB_VALID)).resolves.toEqual({
      ok: true,
      value: { ...stored, updatedPages: [updated] },
    });
    expect(mocks.pageLinkFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ folderId: FOLDER_ID, tabName: "old-name" }) }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: "# Linking\n\n[[guides/setup]]" }) }),
    );
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { tabId: TAB_ID, linkingPages: 1, channel: "web" },
      "tab renamed",
    );
  });

  it("fails as a whole when the update of the links fails", async () => {
    const err = new Error("connection lost");
    mocks.tabUpdateMany.mockResolvedValue({ count: 1 });
    mocks.pageLinkFindMany.mockRejectedValue(err);

    await expect(renameTab(ACTOR, TAB_ID, TAB_VALID)).resolves.toEqual(FAILED);
    expect(mocks.error).toHaveBeenCalledWith({ err, tabId: TAB_ID }, "failed to rename tab");
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

    await expect(renameTab(ACTOR, TAB_ID, TAB_VALID)).resolves.toEqual({
      ok: true,
      value: { ...stored, updatedPages: [] },
    });

    expect(dataOf(mocks.tabUpdateMany)).toEqual({ name: "guides", lastEditedById: ACTOR_ID, lastEditedVia: "web" });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { tabId: TAB_ID, linkingPages: 0, channel: "web" },
      "tab renamed",
    );
  });

  it.each([
    ["the stored name", { name: "guides" }],
    ["the stored name with surrounding spaces", TAB_VALID],
  ])("stores nothing for %s and returns the tab as stored", async (_name, input) => {
    const stored = { id: TAB_ID, name: "guides", folder: { name: "handbook" } };
    mocks.tabUpdateMany.mockResolvedValue({ count: 0 });
    mocks.tabFindUnique.mockResolvedValue(stored);

    await expect(renameTab(ACTOR, TAB_ID, input)).resolves.toEqual({
      ok: true,
      value: { ...stored, updatedPages: [] },
    });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { tabId: TAB_ID, channel: "web" },
      "tab not changed: name is the same",
    );
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  // The rename between the update and the read cannot be timed against the database, so this case needs the mock.
  it("stores the name once more without the condition for a tab renamed meanwhile to another name", async () => {
    const stored = { id: TAB_ID, name: "guides", folder: { name: "handbook" } };
    mocks.tabUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    mocks.tabFindUnique.mockResolvedValueOnce({ ...stored, name: "other" }).mockResolvedValueOnce(stored);

    await expect(renameTab(ACTOR, TAB_ID, TAB_VALID)).resolves.toEqual({
      ok: true,
      value: { ...stored, updatedPages: [] },
    });

    const data = { name: "guides", lastEditedById: ACTOR_ID, lastEditedVia: "web" };
    expect(mocks.tabUpdateMany.mock.calls).toEqual([
      [{ where: { id: TAB_ID, name: { not: "guides" } }, data }],
      [{ where: { id: TAB_ID }, data }],
    ]);
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { tabId: TAB_ID, linkingPages: 0, channel: "web" },
      "tab renamed",
    );
  });

  it("returns tab-not-found for a tab that no longer exists", async () => {
    mocks.tabUpdateMany.mockResolvedValue({ count: 0 });
    mocks.tabFindUnique.mockResolvedValue(null);

    await expect(renameTab(ACTOR, TAB_ID, TAB_VALID)).resolves.toEqual(TAB_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ tabId: TAB_ID }, "tab to rename not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns tab-not-found for a tab renamed meanwhile and then deleted", async () => {
    mocks.tabUpdateMany.mockResolvedValue({ count: 0 });
    mocks.tabFindUnique.mockResolvedValue({ id: TAB_ID, name: "other", folder: { name: "handbook" } });

    await expect(renameTab(ACTOR, TAB_ID, TAB_VALID)).resolves.toEqual(TAB_NOT_FOUND);

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

describe("a rename to the stored name", () => {
  const NOT_ALLOWED = { ok: false, error: { code: "not-allowed" } };

  beforeEach(() => {
    // The stored names: a write that got past the checks would find them unchanged.
    mocks.folderUpdateMany.mockResolvedValue({ count: 0 });
    mocks.folderFindUnique.mockResolvedValue({ id: FOLDER_ID, name: "handbook" });
    mocks.tabUpdateMany.mockResolvedValue({ count: 0 });
    mocks.tabFindUnique.mockResolvedValue({ id: TAB_ID, name: "guides", folder: { name: "handbook" } });
  });

  it.each([
    ["of a folder by an admin", () => renameFolder(ADMIN, FOLDER_ID, { name: "handbook" }), NOT_ALLOWED, null],
    ["of a tab by an admin", () => renameTab(ADMIN, TAB_ID, { name: "guides" }), NOT_ALLOWED, null],
    ["of a folder without a role", () => renameFolder(ACTOR, FOLDER_ID, { name: "handbook" }), NOT_ALLOWED, null],
    ["of a tab without a role", () => renameTab(ACTOR, TAB_ID, { name: "guides" }), NOT_ALLOWED, null],
    ["of a folder by a Manager", () => renameFolder(ACTOR, FOLDER_ID, { name: "handbook" }), NOT_ALLOWED, "manager"],
    ["of a tab by a Writer", () => renameTab(ACTOR, TAB_ID, { name: "guides" }), NOT_ALLOWED, "writer"],
    ["of a folder with a malformed id", () => renameFolder(ACTOR, MALFORMED_ID, VALID), FOLDER_NOT_FOUND, "owner"],
    ["of a tab with a malformed id", () => renameTab(ACTOR, MALFORMED_ID, TAB_VALID), TAB_NOT_FOUND, "owner"],
  ] as const)("is refused %s as any other rename, without a write", async (_name, write, expected, role) => {
    mocks.folderRoleFindFirst.mockResolvedValue(role === null ? null : { role });

    await expect(write()).resolves.toEqual(expected);

    expectNothingWritten();
    expect(mocks.folderFindUnique).not.toHaveBeenCalled();
    expect(mocks.tabFindUnique).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each([
    ["of a folder", () => renameFolder(ACTOR, FOLDER_ID, { name: "Handbook" })],
    ["of a tab", () => renameTab(ACTOR, TAB_ID, { name: "Guides" })],
  ])("checks the name rule %s before comparing", async (_name, write) => {
    await expect(write()).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } });

    expectNothingWritten();
    expect(mocks.folderFindUnique).not.toHaveBeenCalled();
    expect(mocks.tabFindUnique).not.toHaveBeenCalled();
  });
});

describe("a tab write through MCP", () => {
  const GRANT_ID = "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01";
  const MANAGER = mcpActor("manager");

  it("logs the channel mcp and the grant for a Manager connection, with the user as the last editor", async () => {
    const stored = { id: TAB_ID, name: "guides", folder: { name: "handbook" } };
    mocks.tabCreate.mockResolvedValue(stored);
    mocks.tabUpdateMany.mockResolvedValue({ count: 1 });
    mocks.tabFindUnique.mockResolvedValue(stored);

    await expect(createTab(MANAGER, FOLDER_ID, TAB_VALID)).resolves.toMatchObject({ ok: true });
    await expect(renameTab(MANAGER, TAB_ID, TAB_VALID)).resolves.toMatchObject({ ok: true });

    expect(mocks.info.mock.calls).toEqual([
      [{ tabId: TAB_ID, channel: "mcp", grantId: GRANT_ID }, "tab created"],
      [{ tabId: TAB_ID, linkingPages: 0, channel: "mcp", grantId: GRANT_ID }, "tab renamed"],
    ]);
    expect(dataOf(mocks.tabCreate)).toMatchObject({ lastEditedById: ACTOR_ID, lastEditedVia: "mcp" });
    expect(dataOf(mocks.tabUpdateMany)).toMatchObject({
      lastEditedById: ACTOR_ID,
      lastEditedVia: "mcp",
    });
  });

  it("logs a rename to the stored name through a Manager connection with the channel mcp and the grant", async () => {
    const stored = { id: TAB_ID, name: "guides", folder: { name: "handbook" } };
    mocks.tabUpdateMany.mockResolvedValue({ count: 0 });
    mocks.tabFindUnique.mockResolvedValue(stored);

    await expect(renameTab(MANAGER, TAB_ID, TAB_VALID)).resolves.toEqual({
      ok: true,
      value: { ...stored, updatedPages: [] },
    });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { tabId: TAB_ID, channel: "mcp", grantId: GRANT_ID },
      "tab not changed: name is the same",
    );
  });

  it("logs a tab deletion through a Manager connection with the channel mcp, the grant and the number of pages", async () => {
    mocks.pageUpdateManyAndReturn.mockResolvedValue([{ name: "intro", title: "Intro" }]);

    await expect(deleteTab(MANAGER, FOLDER_ID, TAB_ID)).resolves.toMatchObject({ ok: true, value: { pageCount: 1 } });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { actorId: ACTOR_ID, folderId: FOLDER_ID, tabId: TAB_ID, pageCount: 1, channel: "mcp", grantId: GRANT_ID },
      "tab deleted",
    );
    expect(dataOf(mocks.pageUpdateManyAndReturn)).toMatchObject({
      lastEditedById: ACTOR_ID,
      lastEditedVia: "mcp",
    });
  });

  it("refuses a Writer connection of an Owner and writes nothing", async () => {
    const NOT_ALLOWED = { ok: false, error: { code: "not-allowed" } };

    await expect(createTab(MCP_ACTOR, FOLDER_ID, TAB_VALID)).resolves.toEqual(NOT_ALLOWED);
    await expect(renameTab(MCP_ACTOR, TAB_ID, TAB_VALID)).resolves.toEqual(NOT_ALLOWED);
    await expect(deleteTab(MCP_ACTOR, FOLDER_ID, TAB_ID)).resolves.toEqual(NOT_ALLOWED);

    expectNothingWritten();
  });
});

describe("deleteTab", () => {
  it.each([
    ["tab", FOLDER_ID, MALFORMED_ID],
    ["folder", MALFORMED_ID, TAB_ID],
  ])("returns tab-not-found for a malformed %s id without touching the database", async (_name, folderId, tabId) => {
    await expect(deleteTab(ACTOR, folderId, tabId)).resolves.toEqual(TAB_NOT_FOUND);
    expect(databaseCallCount()).toBe(0);
    expectNothingLogged();
  });

  it("soft deletes the pages of the tab, deletes the tab and returns the folder and the pages by name", async () => {
    mocks.pageUpdateManyAndReturn.mockResolvedValue([
      { name: "second", title: "Second" },
      { name: "first", title: "First" },
    ]);
    mocks.tabDelete.mockResolvedValue({ id: TAB_ID });

    await expect(deleteTab(ACTOR, FOLDER_ID, TAB_ID)).resolves.toEqual({
      ok: true,
      value: {
        folder: { id: FOLDER_ID, name: "handbook" },
        pageCount: 2,
        pages: [
          { name: "first", title: "First" },
          { name: "second", title: "Second" },
        ],
      },
    });

    expect(dataOf(mocks.pageUpdateManyAndReturn)).toEqual({
      deletedAt: expect.any(Date),
      tabId: null,
      lastEditedById: ACTOR_ID,
      lastEditedVia: "web",
      version: { increment: 1 },
    });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { actorId: ACTOR_ID, folderId: FOLDER_ID, tabId: TAB_ID, pageCount: 2, channel: "web" },
      "tab deleted",
    );
  });

  it("deletes a tab without pages", async () => {
    mocks.pageUpdateManyAndReturn.mockResolvedValue([]);

    await expect(deleteTab(ACTOR, FOLDER_ID, TAB_ID)).resolves.toMatchObject({
      ok: true,
      value: { pageCount: 0, pages: [] },
    });
  });

  it("returns tab-not-found when the locked row is missing, without writing anything", async () => {
    mocks.queryRaw.mockResolvedValue([]);

    await expect(deleteTab(ACTOR, FOLDER_ID, TAB_ID)).resolves.toEqual(TAB_NOT_FOUND);

    expectNothingWritten();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { folderId: FOLDER_ID, tabId: TAB_ID },
      "tab to delete not found",
    );
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each([
    ["an error of the lock", mocks.queryRaw],
    ["an error of the update of the pages", mocks.pageUpdateManyAndReturn],
    ["an error of the delete of the tab", mocks.tabDelete],
  ])("returns failed for %s and logs it", async (_name, call) => {
    mocks.pageUpdateManyAndReturn.mockResolvedValue([{ name: "intro", title: "Intro" }]);
    const err = new Error("connection lost");
    call.mockRejectedValue(err);

    await expect(deleteTab(ACTOR, FOLDER_ID, TAB_ID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, tabId: TAB_ID }, "failed to delete tab");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

/** Every write, called by the given actor with valid input, the database call it writes with, and its editor key. */
/** The content writes of the folders service, from the table of all content writes. */
const WRITES = contentWritesOf("folders");

/** The call of the database that each write stores with, so that a test can make it fail. */
const STORING_CALL: Record<string, ReturnType<typeof vi.fn>> = {
  createFolder: mocks.folderCreate,
  renameFolder: mocks.folderUpdateMany,
  createTab: mocks.tabCreate,
  renameTab: mocks.tabUpdateMany,
  deleteTab: mocks.pageUpdateManyAndReturn,
};

/** The writes that need a role on the folder: all but creating a folder. */
const WRITES_WITH_ROLE = WRITES.filter(({ lowest }) => lowest !== null);

describe("the actor of a write", () => {
  it.each(WRITES)("$name returns failed for a malformed actor id without touching the database", async ({ call }) => {
    await expect(call(MALFORMED_ACTOR)).resolves.toEqual(FAILED);

    expect(databaseCallCount()).toBe(0);
    expect(mocks.error).toHaveBeenCalledWith({ actorId: MALFORMED_ID }, "malformed actor id");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each(
    WRITES.flatMap(({ name, call, editorKey }) => [
      [name, "on the editor key", call, foreignKeyViolation({ index: editorKey })] as const,
      [name, "on the editor field", call, foreignKeyViolation({ fields: ["lastEditedById"] })] as const,
    ]),
  )("%s returns failed for a foreign key violation %s", async (name, _kind, write, err) => {
    STORING_CALL[name]?.mockRejectedValue(err);

    await expect(write(ACTOR)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, actorId: ACTOR_ID }, "actor of write not found");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each(WRITES_WITH_ROLE)(
    "$name returns failed for an error of the database while the role is read, logged with the ids",
    async ({ name, call, target, failure }) => {
      const err = new Error("connection lost");
      mocks.folderRoleFindFirst.mockRejectedValue(err);

      await expect(call(ACTOR)).resolves.toEqual(FAILED);

      expect(STORING_CALL[name]).not.toHaveBeenCalled();
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, ...target }, failure);
      expect(mocks.info).not.toHaveBeenCalled();
    },
  );
});

describe("an admin", () => {
  const MCP_ADMIN: ContentActor = { ...MCP_ACTOR, type: "admin" };

  it.each([
    ["listFolders", () => listFolders(ADMIN)],
    ["getFolderByName", () => getFolderByName(ADMIN, "handbook")],
    ["listTabs", () => listTabs(ADMIN, FOLDER_ID)],
    ["getTab", () => getTab(ADMIN, "handbook", "guides")],
    ["listFolders through MCP", () => listFolders(MCP_ADMIN)],
    ["getFolderByName through MCP", () => getFolderByName(MCP_ADMIN, "handbook")],
    ["getFolderById", () => getFolderById(ADMIN, FOLDER_ID)],
    ["getFolderById through MCP", () => getFolderById(MCP_ADMIN, FOLDER_ID)],
    ["listTabs through MCP", () => listTabs(MCP_ADMIN, FOLDER_ID)],
    ["getTab through MCP", () => getTab(MCP_ADMIN, "handbook", "guides")],
  ])("gets null from %s, without asking the database", async (_name, read) => {
    await expect(read()).resolves.toBeNull();

    expect(databaseCallCount()).toBe(0);
    expectNothingLogged();
  });

  it.each(WRITES)("gets not-allowed from $name, logged, without touching the database", async ({ call, what }) => {
    await expect(call(ADMIN)).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });

    expect(databaseCallCount()).toBe(0);
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ actorId: ACTOR_ID }, `${what}: the actor is an admin`);
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("is refused before the ids and the input are checked", async () => {
    const results = [
      await createFolder(ADMIN, INVALID),
      await renameFolder(ADMIN, MALFORMED_ID, INVALID),
      await createTab(ADMIN, MALFORMED_ID, INVALID),
      await renameTab(ADMIN, MALFORMED_ID, INVALID),
      await deleteTab(ADMIN, MALFORMED_ID, MALFORMED_ID),
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
  ])("leaves %s to read the database as usual for a user", async (_name, read, call, value) => {
    call.mockResolvedValue(value);

    await expect(read()).resolves.toEqual(value);

    expect(call).toHaveBeenCalledOnce();
  });
});

describe("a user without a role on the folder", () => {
  beforeEach(() => {
    mocks.folderRoleFindFirst.mockResolvedValue(null);
  });

  it.each(WRITES_WITH_ROLE)(
    "gets not-allowed from $name, logged, and nothing is written",
    async ({ call, target, what }) => {
      await expect(call(ACTOR)).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });

      expectNothingWritten();
      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
        { actorId: ACTOR_ID, ...target },
        `${what}: the actor has no role on the folder`,
      );
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
  const cases = WRITES_WITH_ROLE.flatMap((write) =>
    ROLES.map((role) => [write.name, role, write.call, allows(write, role), write.target, write.what] as const),
  );

  it.each(cases)("%s as %s", async (_name, role, write, allowed, target, what) => {
    mocks.folderRoleFindFirst.mockResolvedValue({ role });
    mocks.folderUpdateMany.mockResolvedValue({ count: 1 });
    mocks.tabCreate.mockResolvedValue({ id: TAB_ID, name: "guides", folder: { name: "handbook" } });
    mocks.tabUpdateMany.mockResolvedValue({ count: 1 });
    mocks.tabFindUnique.mockResolvedValue({ id: TAB_ID, name: "guides", folder: { name: "handbook" } });
    mocks.pageUpdateManyAndReturn.mockResolvedValue([]);

    const result = await write(ACTOR);

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
