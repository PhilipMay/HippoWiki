import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  folderRoleOf,
  inBrowser,
  inMcp,
  listFolderRoles,
  mayReadFolder,
  mayReadTab,
  readableFolderWhere,
  readerOf,
  roleOf,
  roleOnFolderOfPage,
  roleOnFolderOfTab,
  roleSelection,
  type ContentActor,
} from "@/features/folder-roles/service";

const mocks = vi.hoisted(() => ({
  roleFindFirst: vi.fn(),
  roleFindMany: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ folderRole: { findFirst: mocks.roleFindFirst, findMany: mocks.roleFindMany } }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

beforeEach(() => {
  vi.resetAllMocks();
});

const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const TAB_ID = "5a2c1c0e-3f55-4a55-8a42-5d2f0e6a9b11";
const PAGE_ID = "9c4d2b7e-1a3f-4c5d-8e6f-7a8b9c0d1e22";
const ACTOR_ID = "9d4b2f6e-1c3a-4e8b-b7d5-2a6c8e0f1b12";
const MALFORMED_ID = "not-a-uuid";

const USER = { id: ACTOR_ID, name: "alice", type: "user" as const };
const ADMIN = { id: ACTOR_ID, name: "alice", type: "admin" as const };
const BROWSER: ContentActor = { ...USER, channel: "browser" };
const MCP: ContentActor = { ...USER, channel: "mcp" };

describe("inBrowser and inMcp", () => {
  it("give the user the channel, and nothing else of the session", () => {
    const sessionUser = { ...USER, mustChangePassword: false, email: "alice@users.hippowiki.invalid" };

    expect(inBrowser(sessionUser)).toStrictEqual({ ...USER, channel: "browser" });
    expect(inMcp(sessionUser)).toStrictEqual({ ...USER, channel: "mcp" });
  });
});

describe("the role of the actor", () => {
  it.each([
    ["folderRoleOf", () => folderRoleOf(USER, FOLDER_ID), { id: FOLDER_ID }],
    ["roleOnFolderOfTab", () => roleOnFolderOfTab(USER, TAB_ID), { tabs: { some: { id: TAB_ID } } }],
    ["roleOnFolderOfPage", () => roleOnFolderOfPage(USER, PAGE_ID), { pages: { some: { id: PAGE_ID } } }],
  ] as const)("%s reads the role of the actor on the folder from the database", async (_name, read, folder) => {
    mocks.roleFindFirst.mockResolvedValue({ role: "manager" });

    await expect(read()).resolves.toBe("manager");

    expect(mocks.roleFindFirst).toHaveBeenCalledExactlyOnceWith({
      where: { userId: ACTOR_ID, folder },
      select: { role: true },
    });
  });

  it.each([
    ["folderRoleOf", () => folderRoleOf(USER, FOLDER_ID)],
    ["roleOnFolderOfTab", () => roleOnFolderOfTab(USER, TAB_ID)],
    ["roleOnFolderOfPage", () => roleOnFolderOfPage(USER, PAGE_ID)],
  ])("%s returns null without a role", async (_name, read) => {
    mocks.roleFindFirst.mockResolvedValue(null);

    await expect(read()).resolves.toBeNull();
  });

  it("reads the role anew on every call, so that a change takes effect at once", async () => {
    mocks.roleFindFirst.mockResolvedValueOnce({ role: "owner" }).mockResolvedValueOnce(null);

    await expect(folderRoleOf(USER, FOLDER_ID)).resolves.toBe("owner");
    await expect(folderRoleOf(USER, FOLDER_ID)).resolves.toBeNull();
    expect(mocks.roleFindFirst).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["folderRoleOf for an admin", () => folderRoleOf(ADMIN, FOLDER_ID)],
    ["roleOnFolderOfTab for an admin", () => roleOnFolderOfTab(ADMIN, TAB_ID)],
    ["roleOnFolderOfPage for an admin", () => roleOnFolderOfPage(ADMIN, PAGE_ID)],
    ["folderRoleOf for a malformed folder id", () => folderRoleOf(USER, MALFORMED_ID)],
    ["roleOnFolderOfTab for a malformed tab id", () => roleOnFolderOfTab(USER, MALFORMED_ID)],
    ["roleOnFolderOfPage for a malformed page id", () => roleOnFolderOfPage(USER, MALFORMED_ID)],
  ])("%s returns null without asking the database", async (_name, read) => {
    await expect(read()).resolves.toBeNull();

    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
  });

  it("returns null for a malformed actor id, logged, without asking the database", async () => {
    await expect(folderRoleOf({ ...USER, id: MALFORMED_ID }, FOLDER_ID)).resolves.toBeNull();

    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith({ actorId: MALFORMED_ID }, "malformed actor id");
  });
});

describe("readerOf and readableFolderWhere", () => {
  it("in the browser need a role of the actor on the folder", () => {
    expect(readerOf(BROWSER)).toBe(ACTOR_ID);
    expect(readableFolderWhere(BROWSER)).toEqual({ roles: { some: { userId: ACTOR_ID } } });
  });

  it("through MCP ignore the roles", () => {
    expect(readerOf(MCP)).toBe("any");
    expect(readableFolderWhere(MCP)).toEqual({});
  });

  it("give an admin nothing, in either channel", () => {
    for (const channel of ["browser", "mcp"] as const) {
      expect(readerOf({ ...ADMIN, channel })).toBeNull();
      expect(readableFolderWhere({ ...ADMIN, channel })).toBeNull();
    }
  });

  it("give a malformed actor id nothing in the browser, logged", () => {
    expect(readableFolderWhere({ ...BROWSER, id: MALFORMED_ID })).toBeNull();
    expect(mocks.error).toHaveBeenCalledWith({ actorId: MALFORMED_ID }, "malformed actor id");
  });
});

describe("mayReadFolder and mayReadTab", () => {
  it.each([
    ["mayReadFolder", (actor: ContentActor) => mayReadFolder(actor, FOLDER_ID)],
    ["mayReadTab", (actor: ContentActor) => mayReadTab(actor, TAB_ID)],
  ])("%s allows the browser exactly with a role", async (_name, check) => {
    mocks.roleFindFirst.mockResolvedValueOnce({ role: "reader" }).mockResolvedValueOnce(null);

    await expect(check(BROWSER)).resolves.toBe(true);
    await expect(check(BROWSER)).resolves.toBe(false);
  });

  it.each([
    ["mayReadFolder", (actor: ContentActor) => mayReadFolder(actor, FOLDER_ID)],
    ["mayReadTab", (actor: ContentActor) => mayReadTab(actor, TAB_ID)],
  ])("%s allows MCP without asking for a role, and never an admin", async (_name, check) => {
    await expect(check(MCP)).resolves.toBe(true);
    await expect(check({ ...ADMIN, channel: "browser" })).resolves.toBe(false);
    await expect(check({ ...ADMIN, channel: "mcp" })).resolves.toBe(false);

    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
  });

  it("lets a malformed id pass to the read, which answers it without the database", async () => {
    await expect(mayReadFolder(BROWSER, MALFORMED_ID)).resolves.toBe(true);
    await expect(mayReadTab(BROWSER, MALFORMED_ID)).resolves.toBe(true);

    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
  });
});

describe("a function beyond reading", () => {
  it("readableFolderWhere needs a role that allows the function", () => {
    expect(readableFolderWhere(BROWSER, "deletedPages")).toEqual({
      roles: { some: { userId: ACTOR_ID, role: { in: ["manager", "owner"] } } },
    });
    expect(readableFolderWhere(MCP, "deletedPages")).toEqual({});
  });

  it("mayReadFolder allows the function from its lowest role up", async () => {
    for (const [role, allowed] of [
      ["reader", false],
      ["writer", false],
      ["manager", true],
      ["owner", true],
    ] as const) {
      mocks.roleFindFirst.mockResolvedValueOnce({ role });
      await expect(mayReadFolder(BROWSER, FOLDER_ID, "deletedPages"), role).resolves.toBe(allowed);
    }
  });
});

describe("roleSelection and roleOf", () => {
  it("select the role of the reader in the browser and none through MCP", () => {
    expect(roleSelection(ACTOR_ID)).toEqual({ where: { userId: ACTOR_ID }, select: { role: true } });
    expect(roleSelection("any")).toEqual({ take: 0, select: { role: true } });
    expect(roleOf({ roles: [{ role: "writer" }] })).toBe("writer");
    expect(roleOf({ roles: [] })).toBeNull();
  });
});

describe("listFolderRoles", () => {
  it("lists every user with a role on the folder, Owners first and by name, for a user with a role", async () => {
    mocks.roleFindFirst.mockResolvedValue({ role: "reader" });
    mocks.roleFindMany.mockResolvedValue([
      { role: "owner", user: { id: ACTOR_ID, username: "alice" } },
      { role: "reader", user: { id: FOLDER_ID, username: "bob" } },
    ]);

    await expect(listFolderRoles(USER, FOLDER_ID)).resolves.toEqual([
      { user: { id: ACTOR_ID, name: "alice" }, role: "owner" },
      { user: { id: FOLDER_ID, name: "bob" }, role: "reader" },
    ]);
    expect(mocks.roleFindMany).toHaveBeenCalledExactlyOnceWith({
      where: { folderId: FOLDER_ID },
      select: { role: true, user: { select: { id: true, username: true } } },
      orderBy: [{ role: "desc" }, { user: { username: "asc" } }],
    });
  });

  it("returns null for a user without a role on the folder, without reading the roles", async () => {
    mocks.roleFindFirst.mockResolvedValue(null);

    await expect(listFolderRoles(USER, FOLDER_ID)).resolves.toBeNull();
    expect(mocks.roleFindMany).not.toHaveBeenCalled();
  });

  it.each([
    ["an admin", () => listFolderRoles(ADMIN, FOLDER_ID)],
    ["a malformed folder id", () => listFolderRoles(USER, MALFORMED_ID)],
  ])("returns null for %s without asking the database", async (_name, read) => {
    await expect(read()).resolves.toBeNull();
    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
    expect(mocks.roleFindMany).not.toHaveBeenCalled();
  });
});
