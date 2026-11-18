import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  changeRole,
  folderRoleOf,
  giveRole,
  listAllFolderRoles,
  listFolderRoles,
  listRoleCandidates,
  mayReadFolder,
  mayReadTab,
  readableFolderWhere,
  readerOf,
  removeRole,
  roleOf,
  roleOnFolderOfPage,
  roleOnFolderOfTab,
  roleSelection,
} from "@/features/folder-roles/service";
import type { ContentActor } from "@/features/folder-roles/actors";
import {
  ACTOR,
  ACTOR_ID,
  dataOf,
  FOLDER_ID,
  knownError,
  MALFORMED_ID,
  MCP_ACTOR,
  mcpActor,
  OTHER_FOLDER_ID,
  PAGE_ID,
  TAB_ID,
  USER,
} from "@/test/unit";

const mocks = vi.hoisted(() => ({
  roleFindFirst: vi.fn(),
  roleFindMany: vi.fn(),
  roleCreate: vi.fn(),
  userFindMany: vi.fn(),
  userFindFirst: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  roleUpdate: vi.fn(),
  roleDelete: vi.fn(),
  folderFindUniqueOrThrow: vi.fn(),
  folderFindMany: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    folderRole: { findFirst: mocks.roleFindFirst, findMany: mocks.roleFindMany, create: mocks.roleCreate },
    user: { findMany: mocks.userFindMany, findFirst: mocks.userFindFirst },
    folder: { findMany: mocks.folderFindMany },
    $transaction: mocks.transaction,
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

beforeEach(() => {
  vi.resetAllMocks();
});

/** An admin without a channel, as the writes of roles take it. */
const ADMIN = { ...USER, type: "admin" as const };
const BROWSER: ContentActor = ACTOR;
/** An actor of MCP with a Writer connection to the folder `FOLDER_ID`. */
const MCP: ContentActor = MCP_ACTOR;
/** An actor of MCP with a Reader connection to the folder `FOLDER_ID`. */
const MCP_READER: ContentActor = mcpActor("reader");

describe("the role of an actor of MCP", () => {
  it.each([
    ["the user's role is higher", "owner", "writer"],
    ["the user's role is the same", "writer", "writer"],
    ["the user's role is lower", "reader", "reader"],
  ] as const)("is the lower of the two roles on the folder of the connection when %s", async (_case, role, lower) => {
    mocks.roleFindFirst.mockResolvedValue({ role });

    await expect(folderRoleOf(MCP, FOLDER_ID)).resolves.toBe(lower);
    await expect(roleOnFolderOfTab(MCP, TAB_ID)).resolves.toBe(lower);
    await expect(roleOnFolderOfPage(MCP, PAGE_ID)).resolves.toBe(lower);
  });

  it("is Reader for a Reader connection of an Owner", async () => {
    mocks.roleFindFirst.mockResolvedValue({ role: "owner" });

    await expect(folderRoleOf(MCP_READER, FOLDER_ID)).resolves.toBe("reader");
  });

  it("is null on every other folder, without asking the database", async () => {
    await expect(folderRoleOf(MCP, OTHER_FOLDER_ID)).resolves.toBeNull();

    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
  });

  it("is null without a role of the user on the folder of the connection", async () => {
    mocks.roleFindFirst.mockResolvedValue(null);

    await expect(folderRoleOf(MCP, FOLDER_ID)).resolves.toBeNull();
  });

  it("is the user's own role for a plain actor, without a channel", async () => {
    mocks.roleFindFirst.mockResolvedValue({ role: "owner" });

    await expect(folderRoleOf(USER, OTHER_FOLDER_ID)).resolves.toBe("owner");
  });
});

describe("the role of the actor", () => {
  it.each([
    ["folderRoleOf", () => folderRoleOf(USER, FOLDER_ID)],
    ["roleOnFolderOfTab", () => roleOnFolderOfTab(USER, TAB_ID)],
    ["roleOnFolderOfPage", () => roleOnFolderOfPage(USER, PAGE_ID)],
  ] as const)("%s returns the role of the actor on the folder as stored", async (_name, read) => {
    mocks.roleFindFirst.mockResolvedValue({ role: "manager" });

    await expect(read()).resolves.toBe("manager");
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

  it("through MCP need a role of the actor on the folder, and that it is the folder of the connection", () => {
    expect(readerOf(MCP)).toBe(ACTOR_ID);
    expect(readableFolderWhere(MCP)).toEqual({ id: FOLDER_ID, roles: { some: { userId: ACTOR_ID } } });
  });

  it("give an admin nothing, in either channel", () => {
    for (const actor of [
      { ...ADMIN, channel: "web" },
      { ...MCP, ...ADMIN },
    ] as const) {
      expect(readerOf(actor)).toBeNull();
      expect(readableFolderWhere(actor)).toBeNull();
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
  ])("%s allows MCP exactly with a role on the folder of the connection, and never an admin", async (_name, check) => {
    mocks.roleFindFirst.mockResolvedValueOnce({ role: "reader" }).mockResolvedValueOnce(null);

    await expect(check(MCP)).resolves.toBe(true);
    await expect(check(MCP)).resolves.toBe(false);
    await expect(check({ ...ADMIN, channel: "web" })).resolves.toBe(false);
    await expect(check({ ...MCP, ...ADMIN })).resolves.toBe(false);
  });

  it("mayReadFolder reads every other folder through MCP as not readable, without asking the database", async () => {
    await expect(mayReadFolder(MCP, OTHER_FOLDER_ID)).resolves.toBe(false);

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
    // A Writer connection has no function of a Manager.
    expect(readableFolderWhere(MCP, "deletedPages")).toEqual({ id: { in: [] } });
    expect(readableFolderWhere(MCP_READER, "editPage")).toEqual({ id: { in: [] } });
  });

  it("mayReadFolder allows a function through MCP only when both roles allow it", async () => {
    mocks.roleFindFirst.mockResolvedValue({ role: "owner" });

    await expect(mayReadFolder(MCP, FOLDER_ID, "editPage")).resolves.toBe(true);
    await expect(mayReadFolder(MCP, FOLDER_ID, "deletedPages")).resolves.toBe(false);
    await expect(mayReadFolder(MCP_READER, FOLDER_ID, "editPage")).resolves.toBe(false);
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
  it("select the role of the reader, and give through MCP the lower of the two roles on the folder of the connection", () => {
    expect(roleSelection(ACTOR_ID)).toEqual({ where: { userId: ACTOR_ID }, select: { role: true } });
    expect(roleOf({ id: FOLDER_ID, roles: [{ role: "owner" }] }, BROWSER)).toBe("owner");
    expect(roleOf({ id: FOLDER_ID, roles: [] }, BROWSER)).toBeNull();
    expect(roleOf({ id: FOLDER_ID, roles: [{ role: "owner" }] }, MCP)).toBe("writer");
    expect(roleOf({ id: FOLDER_ID, roles: [{ role: "reader" }] }, MCP)).toBe("reader");
    expect(roleOf({ id: OTHER_FOLDER_ID, roles: [{ role: "owner" }] }, MCP)).toBeNull();
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

const BOB_ID = "5a2c1c0e-3f55-4a55-8a42-5d2f0e6a9b99";

describe("listRoleCandidates", () => {
  it("lists the users of the type user without a role on the folder, for an Owner", async () => {
    mocks.roleFindFirst.mockResolvedValue({ role: "owner" });
    mocks.userFindMany.mockResolvedValue([{ id: BOB_ID, username: "bob" }]);

    await expect(listRoleCandidates(USER, FOLDER_ID)).resolves.toEqual([{ id: BOB_ID, name: "bob" }]);
  });

  it.each(["manager", "writer", "reader"])("returns null for a %s without reading the users", async (role) => {
    mocks.roleFindFirst.mockResolvedValue({ role });

    await expect(listRoleCandidates(USER, FOLDER_ID)).resolves.toBeNull();
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });

  it("returns null for an admin and without a role", async () => {
    mocks.roleFindFirst.mockResolvedValue(null);

    await expect(listRoleCandidates(ADMIN, FOLDER_ID)).resolves.toBeNull();
    await expect(listRoleCandidates(USER, FOLDER_ID)).resolves.toBeNull();
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });
});

describe("giveRole", () => {
  const STORED = { role: "writer", folder: { name: "handbook" }, user: { id: BOB_ID, username: "bob" } };
  const NOT_ALLOWED = { ok: false, error: { code: "not-allowed" } };

  beforeEach(() => {
    mocks.roleFindFirst.mockResolvedValue({ role: "owner" });
    mocks.userFindFirst.mockResolvedValue({ id: BOB_ID });
    mocks.roleCreate.mockResolvedValue(STORED);
  });

  it("gives the role, logs it and returns it as stored", async () => {
    await expect(giveRole(USER, FOLDER_ID, { user: " bob ", role: "writer" })).resolves.toEqual({
      ok: true,
      value: { folder: { name: "handbook" }, user: { id: BOB_ID, name: "bob" }, role: "writer" },
    });

    expect(dataOf(mocks.roleCreate)).toEqual({ folderId: FOLDER_ID, userId: BOB_ID, role: "writer" });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { folderId: FOLDER_ID, userId: BOB_ID, oldRole: null, newRole: "writer", ownerId: ACTOR_ID },
      "role given",
    );
  });

  it("gives the role Owner as well", async () => {
    mocks.roleCreate.mockResolvedValue({ ...STORED, role: "owner" });

    await expect(giveRole(USER, FOLDER_ID, { user: "bob", role: "owner" })).resolves.toMatchObject({
      ok: true,
      value: { role: "owner" },
    });
  });

  it("refuses an admin, logged, without asking the database", async () => {
    await expect(giveRole(ADMIN, FOLDER_ID, { user: "bob", role: "writer" })).resolves.toEqual(NOT_ALLOWED);

    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
    expect(mocks.roleCreate).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ actorId: ACTOR_ID }, "role not given: the actor is an admin");
  });

  it.each(["manager", "writer", "reader"])("refuses a %s, logged, before the input is checked", async (role) => {
    mocks.roleFindFirst.mockResolvedValue({ role });

    await expect(giveRole(USER, FOLDER_ID, { user: "", role: "nonsense" })).resolves.toEqual(NOT_ALLOWED);

    expect(mocks.roleCreate).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { actorId: ACTOR_ID, folderId: FOLDER_ID, role },
      "role not given: the actor is not an Owner of the folder",
    );
  });

  it("refuses a user without a role on the folder", async () => {
    mocks.roleFindFirst.mockResolvedValue(null);

    await expect(giveRole(USER, FOLDER_ID, { user: "bob", role: "writer" })).resolves.toEqual(NOT_ALLOWED);
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { actorId: ACTOR_ID, folderId: FOLDER_ID },
      "role not given: the actor is not an Owner of the folder",
    );
  });

  it("returns the field errors of an invalid input", async () => {
    await expect(giveRole(USER, FOLDER_ID, { user: "", role: "admin" })).resolves.toEqual({
      ok: false,
      error: { code: "invalid-input", fieldErrors: { user: ["Choose a user"], role: ["Choose a role"] } },
    });
    expect(mocks.roleCreate).not.toHaveBeenCalled();
  });

  it("returns user-not-found for a name of no user of the type user, an admin included, and gives nothing", async () => {
    mocks.userFindFirst.mockResolvedValue(null);

    await expect(giveRole(USER, FOLDER_ID, { user: "admin", role: "owner" })).resolves.toEqual({
      ok: false,
      error: { code: "user-not-found" },
    });
    expect(mocks.roleCreate).not.toHaveBeenCalled();
  });

  it("returns user-not-found for a malformed name without looking it up", async () => {
    await expect(giveRole(USER, FOLDER_ID, { user: "Not A Name", role: "owner" })).resolves.toEqual({
      ok: false,
      error: { code: "user-not-found" },
    });
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
  });

  it("returns role-taken when the user already has a role", async () => {
    mocks.roleCreate.mockRejectedValue(
      knownError("P2002", {
        driverAdapterError: { cause: { constraint: { index: "FolderRole_folderId_userId_key" } } },
      }),
    );

    await expect(giveRole(USER, FOLDER_ID, { user: "bob", role: "writer" })).resolves.toEqual({
      ok: false,
      error: { code: "role-taken" },
    });
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns user-not-found when the database refuses a role of an admin", async () => {
    const err = knownError("P2039", {
      driverAdapterError: { cause: { code: "23514", message: "an admin cannot have a role on a folder" } },
    });
    mocks.roleCreate.mockRejectedValue(err);

    await expect(giveRole(USER, FOLDER_ID, { user: "bob", role: "writer" })).resolves.toEqual({
      ok: false,
      error: { code: "user-not-found" },
    });
    expect(mocks.error).toHaveBeenCalledOnce();
  });

  it("returns failed for any other error, logged", async () => {
    const err = new Error("connection lost");
    mocks.roleCreate.mockRejectedValue(err);

    await expect(giveRole(USER, FOLDER_ID, { user: "bob", role: "writer" })).resolves.toEqual({
      ok: false,
      error: { code: "failed" },
    });
    expect(mocks.error).toHaveBeenCalledWith(
      { err, folderId: FOLDER_ID, userId: BOB_ID, ownerId: ACTOR_ID },
      "failed to give role",
    );
  });
});

describe("changeRole and removeRole", () => {
  const NOT_ALLOWED = { ok: false, error: { code: "not-allowed" } };

  /** The roles of the folder as the locked read in the transaction returns them. */
  function folderRoles(rows: { userId: string; role: string }[]) {
    mocks.queryRaw.mockResolvedValue(rows);
  }

  beforeEach(() => {
    // An interactive transaction runs its callback with a client of its own.
    mocks.transaction.mockImplementation((run: (tx: unknown) => Promise<unknown>) =>
      run({
        $queryRaw: mocks.queryRaw,
        folderRole: { update: mocks.roleUpdate, delete: mocks.roleDelete },
        folder: { findUniqueOrThrow: mocks.folderFindUniqueOrThrow },
      }),
    );
    mocks.folderFindUniqueOrThrow.mockResolvedValue({ name: "handbook" });
    mocks.roleFindFirst.mockResolvedValue({ role: "owner" });
  });

  it("changes another user's role, logs it and leaves the Owner in the roles view", async () => {
    folderRoles([
      { userId: ACTOR_ID, role: "owner" },
      { userId: BOB_ID, role: "writer" },
    ]);

    await expect(changeRole(USER, FOLDER_ID, BOB_ID, "manager")).resolves.toEqual({
      ok: true,
      value: { folder: { name: "handbook" }, actorRole: "owner" },
    });

    expect(dataOf(mocks.roleUpdate)).toEqual({ role: "manager" });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { folderId: FOLDER_ID, userId: BOB_ID, oldRole: "writer", newRole: "manager", ownerId: ACTOR_ID },
      "role changed",
    );
  });

  it("removes another user's role and logs it", async () => {
    folderRoles([
      { userId: ACTOR_ID, role: "owner" },
      { userId: BOB_ID, role: "reader" },
    ]);

    await expect(removeRole(USER, FOLDER_ID, BOB_ID)).resolves.toEqual({
      ok: true,
      value: { folder: { name: "handbook" }, actorRole: "owner" },
    });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { folderId: FOLDER_ID, userId: BOB_ID, oldRole: "reader", newRole: null, ownerId: ACTOR_ID },
      "role removed",
    );
  });

  it("lowers another Owner and the own role, and returns the role the actor has afterwards", async () => {
    folderRoles([
      { userId: ACTOR_ID, role: "owner" },
      { userId: BOB_ID, role: "owner" },
    ]);

    await expect(changeRole(USER, FOLDER_ID, BOB_ID, "writer")).resolves.toMatchObject({
      value: { actorRole: "owner" },
    });
    await expect(changeRole(USER, FOLDER_ID, ACTOR_ID, "reader")).resolves.toMatchObject({
      value: { actorRole: "reader" },
    });
    await expect(removeRole(USER, FOLDER_ID, ACTOR_ID)).resolves.toMatchObject({ value: { actorRole: null } });
  });

  it.each([
    ["lowering", () => changeRole(USER, FOLDER_ID, ACTOR_ID, "manager"), "manager", "role not changed"],
    ["removing", () => removeRole(USER, FOLDER_ID, ACTOR_ID), null, "role not removed"],
  ] as const)("refuses %s the last Owner, logged, and writes nothing", async (_name, write, newRole, what) => {
    folderRoles([
      { userId: ACTOR_ID, role: "owner" },
      { userId: BOB_ID, role: "manager" },
    ]);

    await expect(write()).resolves.toEqual({ ok: false, error: { code: "last-owner" } });

    expect(mocks.roleUpdate).not.toHaveBeenCalled();
    expect(mocks.roleDelete).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { folderId: FOLDER_ID, userId: ACTOR_ID, oldRole: "owner", newRole, ownerId: ACTOR_ID },
      `${what}: the folder would be left without an Owner`,
    );
  });

  it("lets the last Owner stay Owner, without a write", async () => {
    folderRoles([{ userId: ACTOR_ID, role: "owner" }]);

    await expect(changeRole(USER, FOLDER_ID, ACTOR_ID, "owner")).resolves.toEqual({
      ok: true,
      value: { folder: { name: "handbook" }, actorRole: "owner" },
    });
    expect(mocks.roleUpdate).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { folderId: FOLDER_ID, userId: ACTOR_ID, role: "owner", ownerId: ACTOR_ID },
      "role not changed: the role is the same",
    );
  });

  // A change to the role the user has passes the checks of every change and then writes nothing.
  it.each(["owner", "manager", "writer", "reader"] as const)(
    "writes nothing for a change of another user to the role %s the user has, answered as a change and logged apart",
    async (role) => {
      folderRoles([
        { userId: ACTOR_ID, role: "owner" },
        { userId: BOB_ID, role },
      ]);

      await expect(changeRole(USER, FOLDER_ID, BOB_ID, role)).resolves.toEqual({
        ok: true,
        value: { folder: { name: "handbook" }, actorRole: "owner" },
      });

      expect(mocks.roleUpdate).not.toHaveBeenCalled();
      expect(mocks.roleDelete).not.toHaveBeenCalled();
      expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
        { folderId: FOLDER_ID, userId: BOB_ID, role, ownerId: ACTOR_ID },
        "role not changed: the role is the same",
      );
    },
  );

  // The checks come first, so a change to the same role is refused like every other change.
  it("refuses an admin, a Writer of the folder and a user without a role also for the same role", async () => {
    await expect(changeRole(ADMIN, FOLDER_ID, BOB_ID, "writer")).resolves.toEqual(NOT_ALLOWED);
    expect(mocks.transaction).not.toHaveBeenCalled();

    folderRoles([
      { userId: ACTOR_ID, role: "writer" },
      { userId: BOB_ID, role: "writer" },
    ]);
    await expect(changeRole(USER, FOLDER_ID, BOB_ID, "writer")).resolves.toEqual(NOT_ALLOWED);
    folderRoles([{ userId: BOB_ID, role: "writer" }]);
    await expect(changeRole(USER, FOLDER_ID, BOB_ID, "writer")).resolves.toEqual(NOT_ALLOWED);

    expect(mocks.roleUpdate).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each(["manager", "writer", "reader"])(
    "refuses a %s, read in the locked roles, and writes nothing",
    async (role) => {
      folderRoles([
        { userId: ACTOR_ID, role },
        { userId: BOB_ID, role: "owner" },
      ]);

      await expect(changeRole(USER, FOLDER_ID, BOB_ID, "reader")).resolves.toEqual(NOT_ALLOWED);
      await expect(removeRole(USER, FOLDER_ID, BOB_ID)).resolves.toEqual(NOT_ALLOWED);

      expect(mocks.roleUpdate).not.toHaveBeenCalled();
      expect(mocks.roleDelete).not.toHaveBeenCalled();
      expect(mocks.warn).toHaveBeenCalledWith(
        { actorId: ACTOR_ID, folderId: FOLDER_ID, role },
        "role not changed: the actor is not an Owner of the folder",
      );
    },
  );

  it("refuses a user without a role and an admin, the admin without asking the database", async () => {
    folderRoles([{ userId: BOB_ID, role: "owner" }]);

    await expect(removeRole(USER, FOLDER_ID, BOB_ID)).resolves.toEqual(NOT_ALLOWED);
    await expect(removeRole(ADMIN, FOLDER_ID, BOB_ID)).resolves.toEqual(NOT_ALLOWED);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledWith({ actorId: ACTOR_ID }, "role not removed: the actor is an admin");
  });

  it("refuses a malformed folder id without asking the database", async () => {
    await expect(removeRole(USER, MALFORMED_ID, BOB_ID)).resolves.toEqual(NOT_ALLOWED);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns role-not-found for a user without a role and for a malformed user id", async () => {
    folderRoles([{ userId: ACTOR_ID, role: "owner" }]);

    await expect(changeRole(USER, FOLDER_ID, BOB_ID, "reader")).resolves.toEqual({
      ok: false,
      error: { code: "role-not-found" },
    });
    await expect(removeRole(USER, FOLDER_ID, MALFORMED_ID)).resolves.toEqual({
      ok: false,
      error: { code: "role-not-found" },
    });
    expect(mocks.roleDelete).not.toHaveBeenCalled();
  });

  it("returns invalid-input for an unknown role to an Owner, and not-allowed to anyone else", async () => {
    await expect(changeRole(USER, FOLDER_ID, BOB_ID, "admin")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-input" },
    });
    mocks.roleFindFirst.mockResolvedValue({ role: "manager" });
    await expect(changeRole(USER, FOLDER_ID, BOB_ID, "admin")).resolves.toEqual(NOT_ALLOWED);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns failed for an error of the database, logged", async () => {
    const err = new Error("connection lost");
    mocks.queryRaw.mockRejectedValue(err);

    await expect(removeRole(USER, FOLDER_ID, BOB_ID)).resolves.toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledWith(
      { err, folderId: FOLDER_ID, userId: BOB_ID, ownerId: ACTOR_ID },
      "failed to change role",
    );
  });
});

describe("listAllFolderRoles", () => {
  it("lists every folder by name with its roles in the order of the roles view, for an admin", async () => {
    mocks.folderFindMany.mockResolvedValue([
      { id: FOLDER_ID, name: "handbook", roles: [{ role: "owner", user: { id: BOB_ID, username: "bob" } }] },
      { id: TAB_ID, name: "nobody", roles: [] },
    ]);

    await expect(listAllFolderRoles(ADMIN)).resolves.toEqual([
      { id: FOLDER_ID, name: "handbook", roles: [{ user: { id: BOB_ID, name: "bob" }, role: "owner" }] },
      { id: TAB_ID, name: "nobody", roles: [] },
    ]);
  });

  it("returns null for a user without asking the database", async () => {
    await expect(listAllFolderRoles(USER)).resolves.toBeNull();
    expect(mocks.folderFindMany).not.toHaveBeenCalled();
  });
});
