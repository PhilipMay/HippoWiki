// Runs the folder and tab service against the test database, to check its reads and writes on real data.
import { beforeEach, describe, expect, it } from "vitest";

import * as folderService from "@/features/folders/service";
import { inBrowser, inMcp, type BrowserActor } from "@/features/folder-roles/service";
import type { User } from "@/generated/prisma/client";

import { createFolder, createFolderRole, createPage, createTab, createUser, getTestDb } from "../e2e/support/database";
import { KNOWN_USER } from "../prisma/known-users";

/**
 * The user who makes the writes, unless a test says otherwise; created anew for every test. It is the known user
 * `alice`, whom `createFolder()` makes Owner of every folder a test creates without roles of its own.
 */
let user: User;
/** That user as the actor of the browser. */
let actor: BrowserActor;

beforeEach(async () => {
  user = await createUser({ id: KNOWN_USER.id, name: "alice" });
  actor = inBrowser(user);
});

/** An actor that does not exist: a well-formed id that no user has. */
const UNKNOWN_ACTOR = {
  id: "8f7e6d5c-4b3a-4291-8f7e-6d5c4b3a2910",
  name: "ghost",
  type: "user" as const,
  channel: "browser" as const,
};

const FAILED = { ok: false, error: { code: "failed" } };
const NOT_ALLOWED = { ok: false, error: { code: "not-allowed" } };

/** The id of the last editor of the folder, the tab or the page with the given id. */
async function lastEditorOfFolder(id: string): Promise<string> {
  return (await getTestDb().folder.findUniqueOrThrow({ where: { id } })).lastEditedById;
}
async function lastEditorOfTab(id: string): Promise<string> {
  return (await getTestDb().tab.findUniqueOrThrow({ where: { id } })).lastEditedById;
}
async function lastEditorOfPage(id: string): Promise<string> {
  return (await getTestDb().page.findUniqueOrThrow({ where: { id } })).lastEditedById;
}

describe("folder reads", () => {
  it("lists all folders by name", async () => {
    await createFolder({ name: "zeta" });
    await createFolder({ name: "alpha" });

    expect((await folderService.listFolders(actor))?.map(({ name }) => name)).toEqual(["alpha", "zeta"]);
  });

  it("finds a folder by name, and null for an unknown or malformed name", async () => {
    const folder = await createFolder({ name: "docs" });

    await expect(folderService.getFolderByName(actor, "docs")).resolves.toMatchObject({ id: folder.id });
    await expect(folderService.getFolderByName(actor, "other")).resolves.toBeNull();
    await expect(folderService.getFolderByName(actor, "Not A Name")).resolves.toBeNull();
  });

  it("returns exactly the declared fields of a folder", async () => {
    const folder = await createFolder({ name: "docs" });

    // `toStrictEqual` fails on any further column, such as `createdAt`.
    await expect(folderService.getFolderByName(actor, "docs")).resolves.toStrictEqual({
      id: folder.id,
      name: "docs",
      role: "owner",
    });
  });
});

describe("tab reads", () => {
  it("lists the tabs of a folder by name, without those of other folders", async () => {
    const folder = await createFolder();
    await createTab({ folder, name: "zeta" });
    await createTab({ folder, name: "alpha" });
    await createTab({ name: "other" });

    expect((await folderService.listTabs(actor, folder.id))?.map(({ name }) => name)).toEqual(["alpha", "zeta"]);
  });

  it("lists no tabs for a malformed folder id", async () => {
    await createTab();

    await expect(folderService.listTabs(actor, "not-a-uuid")).resolves.toEqual([]);
  });

  it("finds a tab by folder and tab name, and null for a tab of another folder", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    await createTab({ folder: await createFolder({ name: "other" }), name: "news" });

    await expect(folderService.getTab(actor, "docs", "guides")).resolves.toMatchObject({
      id: tab.id,
      folder: { name: "docs" },
    });
    await expect(folderService.getTab(actor, "docs", "news")).resolves.toBeNull();
  });

  it("returns exactly the declared fields of a tab", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });

    await expect(folderService.getTab(actor, "docs", "guides")).resolves.toStrictEqual({
      id: tab.id,
      name: "guides",
      folder: { id: folder.id, name: "docs" },
      role: "owner",
    });
  });
});

describe("folder writes", () => {
  it("stores a folder and returns it as stored", async () => {
    const result = await folderService.createFolder(actor, { name: " docs " });

    const stored = await getTestDb().folder.findUniqueOrThrow({ where: { name: "docs" } });
    expect(result).toStrictEqual({ ok: true, value: { id: stored.id, name: "docs" } });
  });

  it("returns name-taken for the name of another folder", async () => {
    await createFolder({ name: "docs" });
    const other = await createFolder({ name: "other" });

    await expect(folderService.createFolder(actor, { name: "docs" })).resolves.toEqual({
      ok: false,
      error: { code: "name-taken" },
    });
    await expect(folderService.renameFolder(actor, other.id, { name: "docs" })).resolves.toEqual({
      ok: false,
      error: { code: "name-taken" },
    });
    expect(await getTestDb().folder.count()).toBe(2);
  });

  it("renames a folder and returns it as stored", async () => {
    const folder = await createFolder({ name: "docs" });

    await expect(folderService.renameFolder(actor, folder.id, { name: "handbook" })).resolves.toStrictEqual({
      ok: true,
      value: { id: folder.id, name: "handbook" },
    });
    expect((await getTestDb().folder.findUniqueOrThrow({ where: { id: folder.id } })).name).toBe("handbook");
  });

  // A folder that does not exist has no role of the actor either, so it answers like a folder the actor cannot see.
  it("returns not-allowed for a folder that does not exist", async () => {
    await expect(folderService.renameFolder(actor, crypto.randomUUID(), { name: "docs" })).resolves.toEqual(
      NOT_ALLOWED,
    );
  });

  it("returns the field errors of an invalid name and stores nothing", async () => {
    await expect(folderService.createFolder(actor, { name: "Not A Name" })).resolves.toEqual({
      ok: false,
      error: { code: "invalid-input", fieldErrors: { name: ["Use lowercase letters, digits and single hyphens"] } },
    });
    expect(await getTestDb().folder.count()).toBe(0);
  });
});

describe("tab writes", () => {
  it("stores a tab in its folder and returns it as stored", async () => {
    const folder = await createFolder({ name: "docs" });

    const result = await folderService.createTab(actor, folder.id, { name: " guides " });

    const stored = await getTestDb().tab.findFirstOrThrow({ where: { folderId: folder.id } });
    expect(stored.name).toBe("guides");
    expect(result).toStrictEqual({ ok: true, value: { id: stored.id, name: "guides", folder: { name: "docs" } } });
  });

  it("returns name-taken for the name of another tab of the folder", async () => {
    const folder = await createFolder();
    await createTab({ folder, name: "guides" });
    const other = await createTab({ folder, name: "other" });

    await expect(folderService.createTab(actor, folder.id, { name: "guides" })).resolves.toEqual({
      ok: false,
      error: { code: "name-taken" },
    });
    await expect(folderService.renameTab(actor, other.id, { name: "guides" })).resolves.toEqual({
      ok: false,
      error: { code: "name-taken" },
    });
  });

  it("allows the same tab name in another folder", async () => {
    await createTab({ folder: await createFolder({ name: "docs" }), name: "guides" });
    const other = await createFolder({ name: "other" });
    const news = await createTab({ folder: other, name: "news" });

    await expect(folderService.createTab(actor, other.id, { name: "guides" })).resolves.toMatchObject({
      ok: true,
      value: { name: "guides", folder: { name: "other" } },
    });
    const elsewhere = await createFolder({ name: "elsewhere" });
    const renamed = await createTab({ folder: elsewhere, name: "old" });
    await expect(folderService.renameTab(actor, renamed.id, { name: "guides" })).resolves.toStrictEqual({
      ok: true,
      value: { id: renamed.id, name: "guides", folder: { name: "elsewhere" } },
    });
    // The tab that was not renamed keeps its name.
    expect((await getTestDb().tab.findUniqueOrThrow({ where: { id: news.id } })).name).toBe("news");
  });

  // A folder or tab that does not exist has no role of the actor either, so it answers like one the actor cannot see.
  it("returns not-allowed for a tab in a folder that does not exist", async () => {
    await expect(folderService.createTab(actor, crypto.randomUUID(), { name: "guides" })).resolves.toEqual(NOT_ALLOWED);
    expect(await getTestDb().tab.count()).toBe(0);
  });

  it("returns not-allowed for a tab that does not exist", async () => {
    await expect(folderService.renameTab(actor, crypto.randomUUID(), { name: "guides" })).resolves.toEqual(NOT_ALLOWED);
  });
});

describe("the last editor of folders", () => {
  it("is the actor of the creation, and the actor of a rename replaces it", async () => {
    const bob = await createUser({ name: "bob" });

    const created = await folderService.createFolder(actor, { name: "docs" });
    if (!created.ok) throw new Error("expected the folder to be created");
    expect(await lastEditorOfFolder(created.value.id)).toBe(actor.id);

    await createFolderRole({ folder: created.value, user: bob, role: "owner" });
    await folderService.renameFolder(inBrowser(bob), created.value.id, { name: "handbook" });
    expect(await lastEditorOfFolder(created.value.id)).toBe(bob.id);
  });

  it("stays as it was when a rename fails", async () => {
    const bob = await createUser({ name: "bob" });
    await createFolder({ name: "taken" });
    const folder = await createFolder({ name: "docs", editor: user, roles: [{ user: bob, role: "owner" }] });

    await folderService.renameFolder(inBrowser(bob), folder.id, { name: "taken" });
    await folderService.renameFolder(inBrowser(bob), folder.id, { name: "Not A Name" });

    expect(await lastEditorOfFolder(folder.id)).toBe(actor.id);
  });

  it("is not touched by renaming the folder for its tabs, its pages and its deleted pages", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "docs", editor: user, roles: [{ user: bob, role: "owner" }] });
    const tab = await createTab({ folder, editor: user });
    const pageInTab = await createPage({ tab, editor: user });
    const page = await createPage({ folder, editor: user });
    const deleted = await createPage({ folder, editor: user, deletedAt: new Date() });

    await folderService.renameFolder(inBrowser(bob), folder.id, { name: "handbook" });

    expect(await lastEditorOfTab(tab.id)).toBe(actor.id);
    for (const { id } of [pageInTab, page, deleted]) expect(await lastEditorOfPage(id)).toBe(actor.id);
  });

  // An actor that does not exist has no role on any folder, so a write of an existing folder is refused before it.
  it("gives failed, or not-allowed on an existing folder, for an actor that does not exist, and writes nothing", async () => {
    const folder = await createFolder({ name: "docs", editor: user });
    const before = await getTestDb().folder.findUniqueOrThrow({ where: { id: folder.id } });

    await expect(folderService.createFolder(UNKNOWN_ACTOR, { name: "other" })).resolves.toEqual(FAILED);
    await expect(folderService.renameFolder(UNKNOWN_ACTOR, folder.id, { name: "other" })).resolves.toEqual(NOT_ALLOWED);

    expect(await getTestDb().folder.findMany()).toStrictEqual([before]);
  });
});

describe("the last editor of tabs", () => {
  it("is the actor of the creation, and the actor of a rename replaces it", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({
      roles: [
        { user: KNOWN_USER, role: "owner" },
        { user: bob, role: "owner" },
      ],
    });

    const created = await folderService.createTab(actor, folder.id, { name: "guides" });
    if (!created.ok) throw new Error("expected the tab to be created");
    expect(await lastEditorOfTab(created.value.id)).toBe(actor.id);

    await folderService.renameTab(inBrowser(bob), created.value.id, { name: "news" });
    expect(await lastEditorOfTab(created.value.id)).toBe(bob.id);
  });

  it("stays as it was when a rename fails", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ roles: [{ user: bob, role: "owner" }] });
    await createTab({ folder, name: "taken" });
    const tab = await createTab({ folder, name: "guides", editor: user });

    await folderService.renameTab(inBrowser(bob), tab.id, { name: "taken" });
    await folderService.renameTab(inBrowser(bob), tab.id, { name: "Not A Name" });

    expect(await lastEditorOfTab(tab.id)).toBe(actor.id);
  });

  it("is not touched for the folder by creating a tab in it", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ editor: user, roles: [{ user: bob, role: "owner" }] });

    await folderService.createTab(inBrowser(bob), folder.id, { name: "guides" });

    const stored = await getTestDb().folder.findUniqueOrThrow({ where: { id: folder.id } });
    expect(stored.lastEditedById).toBe(actor.id);
    expect(stored.updatedAt).toEqual(folder.updatedAt);
  });

  // An actor that does not exist has no role on any folder, so the writes are refused before they reach the tabs.
  it("gives not-allowed, not a missing folder or tab, for an actor that does not exist, and writes nothing", async () => {
    const folder = await createFolder();
    const tab = await createTab({ folder, name: "guides", editor: user });
    const before = await getTestDb().tab.findUniqueOrThrow({ where: { id: tab.id } });

    await expect(folderService.createTab(UNKNOWN_ACTOR, folder.id, { name: "news" })).resolves.toEqual(NOT_ALLOWED);
    await expect(folderService.renameTab(UNKNOWN_ACTOR, tab.id, { name: "news" })).resolves.toEqual(NOT_ALLOWED);

    expect(await getTestDb().tab.findMany()).toStrictEqual([before]);
  });
});

describe("the last editor in the folder and tab reads", () => {
  it("is the user name of the last editor in the folder list and the tab list", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "docs", editor: user });
    await createFolder({ name: "news", editor: bob });
    await createTab({ folder, name: "guides", editor: bob });

    // `toStrictEqual` fails on any further field of the user.
    expect(
      (await folderService.listFolders(actor))?.map(({ name, lastEditedBy }) => [name, lastEditedBy]),
    ).toStrictEqual([
      ["docs", { name: "alice" }],
      ["news", { name: "bob" }],
    ]);
    expect((await folderService.listTabs(actor, folder.id))?.map(({ lastEditedBy }) => lastEditedBy)).toStrictEqual([
      { name: "bob" },
    ]);
  });

  it("is the user who changed the folder or tab last, after a write through the service", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({
      name: "docs",
      editor: user,
      roles: [
        { user: KNOWN_USER, role: "owner" },
        { user: bob, role: "owner" },
      ],
    });
    const tab = await createTab({ folder, name: "guides", editor: user });

    await folderService.renameFolder(inBrowser(bob), folder.id, { name: "handbook" });
    await folderService.renameTab(inBrowser(bob), tab.id, { name: "news" });

    expect((await folderService.listFolders(actor))?.[0]?.lastEditedBy).toEqual({ name: "bob" });
    expect((await folderService.listTabs(actor, folder.id))?.[0]?.lastEditedBy).toEqual({ name: "bob" });
  });
});

describe("an admin", () => {
  it("reads no folder, not even one that exists, and changes nothing", async () => {
    const admin = await createUser({ name: "maria", type: "admin" });
    const folder = await createFolder({ name: "handbook", editor: user });
    await createTab({ folder, name: "guides", editor: user });
    const before = await getTestDb().folder.findMany({ include: { tabs: true } });

    await expect(folderService.listFolders(inBrowser(admin))).resolves.toBeNull();
    await expect(folderService.getFolderByName(inBrowser(admin), "handbook")).resolves.toBeNull();
    await expect(folderService.listTabs(inBrowser(admin), folder.id)).resolves.toBeNull();
    await expect(folderService.getTab(inBrowser(admin), "handbook", "guides")).resolves.toBeNull();
    const notAllowed = { ok: false, error: { code: "not-allowed" } };
    await expect(folderService.createFolder(inBrowser(admin), { name: "other" })).resolves.toEqual(notAllowed);
    await expect(folderService.renameFolder(inBrowser(admin), folder.id, { name: "other" })).resolves.toEqual(
      notAllowed,
    );
    await expect(folderService.createTab(inBrowser(admin), folder.id, { name: "news" })).resolves.toEqual(notAllowed);

    expect(await getTestDb().folder.findMany({ include: { tabs: true } })).toStrictEqual(before);
  });
});

describe("roles", () => {
  it("lists only the folders with a role of the actor, by name, each with the role", async () => {
    const bob = await createUser({ name: "bob" });
    await createFolder({ name: "zeta", roles: [{ user: user, role: "reader" }] });
    await createFolder({ name: "alpha", roles: [{ user: user, role: "manager" }] });
    await createFolder({ name: "hidden", roles: [{ user: bob, role: "owner" }] });
    await createFolder({ name: "nobody", roles: [] });

    expect((await folderService.listFolders(actor))?.map(({ name, role }) => [name, role])).toEqual([
      ["alpha", "manager"],
      ["zeta", "reader"],
    ]);
  });

  it("reads no folder and no tab without a role of the actor", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "hidden", roles: [{ user: bob, role: "owner" }] });
    await createTab({ folder, name: "guides" });

    await expect(folderService.getFolderByName(actor, "hidden")).resolves.toBeNull();
    await expect(folderService.getTab(actor, "hidden", "guides")).resolves.toBeNull();
    await expect(folderService.listTabs(actor, folder.id)).resolves.toBeNull();
  });

  it("makes the creator of a folder its Owner, and gives nobody else a role", async () => {
    await createUser({ name: "bob" });

    const created = await folderService.createFolder(actor, { name: "docs" });
    if (!created.ok) throw new Error("expected the folder to be created");

    expect(
      await getTestDb().folderRole.findMany({
        where: { folderId: created.value.id },
        select: { userId: true, role: true },
      }),
    ).toEqual([{ userId: user.id, role: "owner" }]);
    await expect(folderService.getFolderByName(actor, "docs")).resolves.toMatchObject({ role: "owner" });
  });

  it("refuses a taken name also for a folder the actor cannot see", async () => {
    const bob = await createUser({ name: "bob" });
    await createFolder({ name: "hidden", roles: [{ user: bob, role: "owner" }] });

    await expect(folderService.createFolder(actor, { name: "hidden" })).resolves.toEqual({
      ok: false,
      error: { code: "name-taken" },
    });
  });

  it("changes nothing on a write without a role", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "hidden", roles: [{ user: bob, role: "owner" }] });
    const tab = await createTab({ folder, name: "guides" });
    const [folderBefore, tabsBefore] = [
      await getTestDb().folder.findMany(),
      await getTestDb().tab.findMany({ orderBy: { name: "asc" } }),
    ];

    await expect(folderService.renameFolder(actor, folder.id, { name: "mine" })).resolves.toEqual(NOT_ALLOWED);
    await expect(folderService.createTab(actor, folder.id, { name: "news" })).resolves.toEqual(NOT_ALLOWED);
    await expect(folderService.renameTab(actor, tab.id, { name: "news" })).resolves.toEqual(NOT_ALLOWED);

    expect(await getTestDb().folder.findMany()).toStrictEqual(folderBefore);
    expect(await getTestDb().tab.findMany({ orderBy: { name: "asc" } })).toStrictEqual(tabsBefore);
  });

  it("reads every folder through MCP, whatever the roles, without a role", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "hidden", roles: [{ user: bob, role: "owner" }] });
    await createTab({ folder, name: "guides" });
    await createFolder({ name: "mine" });
    const mcp = inMcp(user);

    expect((await folderService.listFolders(mcp))?.map(({ name, role }) => [name, role])).toEqual([
      ["hidden", null],
      ["mine", null],
    ]);
    await expect(folderService.getFolderByName(mcp, "hidden")).resolves.toEqual({
      id: folder.id,
      name: "hidden",
      role: null,
    });
    await expect(folderService.getTab(mcp, "hidden", "guides")).resolves.toMatchObject({ role: null });
    expect((await folderService.listTabs(mcp, folder.id))?.map(({ name }) => name)).toEqual(["guides"]);
  });
});

describe("the lowest role of each function", () => {
  it("lets a Manager create and rename tabs but not rename the folder", async () => {
    const folder = await createFolder({ name: "docs", roles: [{ user, role: "manager" }] });

    const created = await folderService.createTab(actor, folder.id, { name: "guides" });
    if (!created.ok) throw new Error("expected the tab to be created");
    await expect(folderService.renameTab(actor, created.value.id, { name: "news" })).resolves.toMatchObject({
      ok: true,
    });
    await expect(folderService.renameFolder(actor, folder.id, { name: "mine" })).resolves.toEqual(NOT_ALLOWED);
    expect((await getTestDb().folder.findUniqueOrThrow({ where: { id: folder.id } })).name).toBe("docs");
  });

  it("lets a Writer neither create nor rename a tab", async () => {
    const folder = await createFolder({ name: "docs", roles: [{ user, role: "writer" }] });
    const tab = await createTab({ folder, name: "guides" });

    await expect(folderService.createTab(actor, folder.id, { name: "news" })).resolves.toEqual(NOT_ALLOWED);
    await expect(folderService.renameTab(actor, tab.id, { name: "news" })).resolves.toEqual(NOT_ALLOWED);
    expect((await getTestDb().tab.findMany()).map(({ name }) => name)).toEqual(["guides"]);
  });

  it("lets an Owner rename the folder", async () => {
    const folder = await createFolder({ name: "docs", roles: [{ user, role: "owner" }] });

    await expect(folderService.renameFolder(actor, folder.id, { name: "handbook" })).resolves.toMatchObject({
      ok: true,
    });
  });
});
