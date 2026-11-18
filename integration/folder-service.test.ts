// Runs the folder and tab service against the test database, to check its reads and writes on real data.
import { beforeEach, describe, expect, it } from "vitest";

import * as folderService from "@/features/folders/service";
import * as pageService from "@/features/pages/service";
import { inBrowser, type BrowserActor } from "@/features/folder-roles/service";
import type { User } from "@/generated/prisma/client";

import { createFolder, createFolderRole, createPage, createTab, createUser, getTestDb } from "../e2e/support/database";
import { KNOWN_USER } from "../prisma/known-users";
import { createBob, FAILED, NOT_ALLOWED, storedPage, UNKNOWN_ACTOR, mcpActorOf } from "./helpers";

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

  // A rename of a folder or tab is no write of its pages (optimistic-locking.md, "The version of a page").
  it("leaves the versions of the pages as they are when their folder and their tab are renamed", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const pages = [
      await createPage({ folder, version: 3 }),
      await createPage({ tab, version: 5 }),
      await createPage({ folder, version: 2, deletedAt: new Date() }),
    ];
    const versions = async () =>
      (
        await getTestDb().page.findMany({
          where: { id: { in: pages.map(({ id }) => id) } },
          orderBy: { version: "asc" },
        })
      ).map(({ version }) => version);

    await expect(folderService.renameFolder(actor, folder.id, { name: "handbook" })).resolves.toMatchObject({
      ok: true,
    });
    await expect(folderService.renameTab(actor, tab.id, { name: "how-to" })).resolves.toMatchObject({ ok: true });

    expect(await versions()).toEqual([2, 3, 5]);
  });
});

describe("the last editor of folders", () => {
  it("is the actor of the creation, and the actor of a rename replaces it", async () => {
    const bob = await createBob();

    const created = await folderService.createFolder(actor, { name: "docs" });
    if (!created.ok) throw new Error("expected the folder to be created");
    expect(await lastEditorOfFolder(created.value.id)).toBe(actor.id);

    await createFolderRole({ folder: created.value, user: bob, role: "owner" });
    await folderService.renameFolder(inBrowser(bob), created.value.id, { name: "handbook" });
    expect(await lastEditorOfFolder(created.value.id)).toBe(bob.id);
  });

  it("stays as it was when a rename fails", async () => {
    const bob = await createBob();
    await createFolder({ name: "taken" });
    const folder = await createFolder({ name: "docs", editor: user, roles: [{ user: bob, role: "owner" }] });

    await folderService.renameFolder(inBrowser(bob), folder.id, { name: "taken" });
    await folderService.renameFolder(inBrowser(bob), folder.id, { name: "Not A Name" });

    expect(await lastEditorOfFolder(folder.id)).toBe(actor.id);
  });

  it("is not touched by renaming the folder for its tabs, its pages and its deleted pages", async () => {
    const bob = await createBob();
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
    const bob = await createBob();
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
    const bob = await createBob();
    const folder = await createFolder({ roles: [{ user: bob, role: "owner" }] });
    await createTab({ folder, name: "taken" });
    const tab = await createTab({ folder, name: "guides", editor: user });

    await folderService.renameTab(inBrowser(bob), tab.id, { name: "taken" });
    await folderService.renameTab(inBrowser(bob), tab.id, { name: "Not A Name" });

    expect(await lastEditorOfTab(tab.id)).toBe(actor.id);
  });

  it("is not touched for the folder by creating a tab in it", async () => {
    const bob = await createBob();
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
  it("is the user name of the last editor and the channel in the folder list and the tab list", async () => {
    const bob = await createBob();
    const folder = await createFolder({ name: "docs", editor: user });
    await createFolder({ name: "news", editor: bob, via: "mcp" });
    await createTab({ folder, name: "guides", editor: bob, via: "mcp" });

    // `toStrictEqual` fails on any further field of the user.
    expect(
      (await folderService.listFolders(actor))?.map(({ name, lastEditedBy }) => [name, lastEditedBy]),
    ).toStrictEqual([
      ["docs", { name: "alice", via: "web" }],
      ["news", { name: "bob", via: "mcp" }],
    ]);
    expect((await folderService.listTabs(actor, folder.id))?.map(({ lastEditedBy }) => lastEditedBy)).toStrictEqual([
      { name: "bob", via: "mcp" },
    ]);
  });

  it("is the user who changed the folder or tab last, after a write through the service", async () => {
    const bob = await createBob();
    const folder = await createFolder({
      name: "docs",
      editor: user,
      roles: [
        { user: KNOWN_USER, role: "owner" },
        { user: bob, role: "owner" },
      ],
    });
    const tab = await createTab({ folder, name: "guides", editor: user, via: "mcp" });

    await folderService.renameFolder(inBrowser(bob), folder.id, { name: "handbook" });
    await folderService.renameTab(inBrowser(bob), tab.id, { name: "news" });

    expect((await folderService.listFolders(actor))?.[0]?.lastEditedBy).toEqual({ name: "bob", via: "web" });
    expect((await folderService.listTabs(actor, folder.id))?.[0]?.lastEditedBy).toEqual({ name: "bob", via: "web" });
  });
});

describe("the channel of folders and tabs", () => {
  /** The channel of the folder, the tab or the page with the given id, as stored. */
  async function channelOfFolder(id: string) {
    return (await getTestDb().folder.findUniqueOrThrow({ where: { id } })).lastEditedVia;
  }
  async function channelOfTab(id: string) {
    return (await getTestDb().tab.findUniqueOrThrow({ where: { id } })).lastEditedVia;
  }

  it("is web after creating and renaming a folder in the browser", async () => {
    const created = await folderService.createFolder(actor, { name: "docs" });
    if (!created.ok) throw new Error("expected the folder to be created");
    expect(await channelOfFolder(created.value.id)).toBe("web");

    await getTestDb().folder.update({ where: { id: created.value.id }, data: { lastEditedVia: "mcp" } });
    await folderService.renameFolder(actor, created.value.id, { name: "handbook" });
    expect(await channelOfFolder(created.value.id)).toBe("web");
  });

  it("is the channel of the actor after creating and renaming a tab", async () => {
    const folder = await createFolder({ name: "docs", roles: [{ user, role: "manager" }] });
    const manager = mcpActorOf(user, folder, "manager");

    const inWeb = await folderService.createTab(actor, folder.id, { name: "guides" });
    const throughMcp = await folderService.createTab(manager, folder.id, { name: "news" });
    if (!inWeb.ok || !throughMcp.ok) throw new Error("expected the tabs to be created");
    expect(await channelOfTab(inWeb.value.id)).toBe("web");
    expect(await channelOfTab(throughMcp.value.id)).toBe("mcp");

    await folderService.renameTab(manager, inWeb.value.id, { name: "manuals" });
    await folderService.renameTab(actor, throughMcp.value.id, { name: "updates" });
    expect(await channelOfTab(inWeb.value.id)).toBe("mcp");
    expect(await channelOfTab(throughMcp.value.id)).toBe("web");
  });

  it("is the channel of the actor for each page deleted with a tab, and the folder keeps its own", async () => {
    const folder = await createFolder({ name: "docs", roles: [{ user, role: "manager" }] });
    const manager = mcpActorOf(user, folder, "manager");
    const viaMcp = await createTab({ folder, name: "drafts" });
    const inWeb = await createTab({ folder, name: "notes", via: "mcp" });
    const first = await createPage({ tab: viaMcp, name: "first" });
    const second = await createPage({ tab: viaMcp, name: "second" });
    const third = await createPage({ tab: inWeb, name: "third", via: "mcp" });

    await folderService.deleteTab(manager, folder.id, viaMcp.id);
    await folderService.deleteTab(actor, folder.id, inWeb.id);

    const channels = await getTestDb().page.findMany({
      select: { id: true, lastEditedVia: true },
      orderBy: { name: "asc" },
    });
    expect(channels).toEqual([
      { id: first.id, lastEditedVia: "mcp" },
      { id: second.id, lastEditedVia: "mcp" },
      { id: third.id, lastEditedVia: "web" },
    ]);
    expect(await channelOfFolder(folder.id)).toBe("web");
  });

  it("is not touched for the folder by creating a tab in it through MCP", async () => {
    const folder = await createFolder({ name: "docs", roles: [{ user, role: "manager" }] });
    const manager = mcpActorOf(user, folder, "manager");

    await expect(folderService.createTab(manager, folder.id, { name: "news" })).resolves.toMatchObject({ ok: true });

    expect(await channelOfFolder(folder.id)).toBe("web");
  });

  it("stays as it was when a write is refused for a taken name or a role too low", async () => {
    const folder = await createFolder({ name: "docs", via: "mcp", roles: [{ user, role: "owner" }] });
    await createFolder({ name: "taken" });
    await createTab({ folder, name: "taken" });
    const tab = await createTab({ folder, name: "guides", via: "mcp" });
    const writer = mcpActorOf(user, folder, "writer");

    await folderService.renameFolder(actor, folder.id, { name: "taken" });
    await folderService.renameTab(actor, tab.id, { name: "taken" });
    await folderService.renameTab(writer, tab.id, { name: "news" });
    await folderService.deleteTab(writer, folder.id, tab.id);

    expect(await channelOfFolder(folder.id)).toBe("mcp");
    expect(await channelOfTab(tab.id)).toBe("mcp");
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
    const bob = await createBob();
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
    const bob = await createBob();
    const folder = await createFolder({ name: "hidden", roles: [{ user: bob, role: "owner" }] });
    await createTab({ folder, name: "guides" });

    await expect(folderService.getFolderByName(actor, "hidden")).resolves.toBeNull();
    await expect(folderService.getTab(actor, "hidden", "guides")).resolves.toBeNull();
    await expect(folderService.listTabs(actor, folder.id)).resolves.toBeNull();
  });

  it("makes the creator of a folder its Owner, and gives nobody else a role", async () => {
    await createBob();

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
    const bob = await createBob();
    await createFolder({ name: "hidden", roles: [{ user: bob, role: "owner" }] });

    await expect(folderService.createFolder(actor, { name: "hidden" })).resolves.toEqual({
      ok: false,
      error: { code: "name-taken" },
    });
  });

  it("changes nothing on a write without a role", async () => {
    const bob = await createBob();
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

  it("reads through MCP only the folder of the connection, with the lower of the two roles", async () => {
    const projects = await createFolder({ name: "projects", roles: [{ user, role: "owner" }] });
    await createTab({ folder: projects, name: "guides" });
    const notes = await createFolder({ name: "notes", roles: [{ user, role: "owner" }] });
    await createTab({ folder: notes, name: "drafts" });
    const mcp = mcpActorOf(user, projects, "writer");

    expect((await folderService.listFolders(mcp))?.map(({ name, role }) => [name, role])).toEqual([
      ["projects", "writer"],
    ]);
    await expect(folderService.getFolderByName(mcp, "projects")).resolves.toEqual({
      id: projects.id,
      name: "projects",
      role: "writer",
    });
    await expect(folderService.getFolderById(mcp, projects.id)).resolves.toMatchObject({ role: "writer" });
    await expect(folderService.getTab(mcp, "projects", "guides")).resolves.toMatchObject({ role: "writer" });
    expect((await folderService.listTabs(mcp, projects.id))?.map(({ name }) => name)).toEqual(["guides"]);

    // Another folder on which the user has a role reads like one that does not exist.
    await expect(folderService.getFolderByName(mcp, "notes")).resolves.toBeNull();
    await expect(folderService.getFolderById(mcp, notes.id)).resolves.toBeNull();
    await expect(folderService.getTab(mcp, "notes", "drafts")).resolves.toBeNull();
    await expect(folderService.listTabs(mcp, notes.id)).resolves.toBeNull();
  });

  it("gives a Reader connection of an Owner the role Reader", async () => {
    const projects = await createFolder({ name: "projects", roles: [{ user, role: "owner" }] });
    const mcp = mcpActorOf(user, projects, "reader");

    await expect(folderService.getFolderById(mcp, projects.id)).resolves.toMatchObject({ role: "reader" });
  });

  it("reads nothing through MCP for a user without a role on the folder of the connection", async () => {
    const bob = await createBob();
    const hidden = await createFolder({ name: "hidden", roles: [{ user: bob, role: "owner" }] });
    await createTab({ folder: hidden, name: "guides" });
    const mcp = mcpActorOf(user, hidden, "reader");

    await expect(folderService.listFolders(mcp)).resolves.toEqual([]);
    await expect(folderService.getFolderByName(mcp, "hidden")).resolves.toBeNull();
    await expect(folderService.getFolderById(mcp, hidden.id)).resolves.toBeNull();
    await expect(folderService.getTab(mcp, "hidden", "guides")).resolves.toBeNull();
    await expect(folderService.listTabs(mcp, hidden.id)).resolves.toBeNull();
  });
});

describe("a rename to the stored name", () => {
  const LONG_AGO = new Date("2026-01-01T10:00:00Z");

  /** What a rename that stores something would change: the name, the time, the last editor and the channel. */
  async function storedFolder(id: string) {
    const { name, updatedAt, lastEditedById, lastEditedVia } = await getTestDb().folder.findUniqueOrThrow({
      where: { id },
    });
    return { name, updatedAt, lastEditedById, lastEditedVia };
  }
  async function storedTab(id: string) {
    const { name, updatedAt, lastEditedById, lastEditedVia } = await getTestDb().tab.findUniqueOrThrow({
      where: { id },
    });
    return { name, updatedAt, lastEditedById, lastEditedVia };
  }

  /** A folder and a tab last changed long ago by bob through MCP, so that a write by alice in the browser would show. */
  async function changedByBob() {
    const bob = await createBob();
    const folder = await createFolder({
      name: "handbook",
      editor: bob,
      via: "mcp",
      updatedAt: LONG_AGO,
      roles: [{ user, role: "owner" }],
    });
    const tab = await createTab({ folder, name: "guides", editor: bob, via: "mcp", updatedAt: LONG_AGO });
    return { bob, folder, tab };
  }

  it.each(["handbook", " handbook "])("stores nothing for a folder renamed to %j and returns it", async (name) => {
    const { bob, folder } = await changedByBob();

    await expect(folderService.renameFolder(actor, folder.id, { name })).resolves.toStrictEqual({
      ok: true,
      value: { id: folder.id, name: "handbook" },
    });

    expect(await storedFolder(folder.id)).toStrictEqual({
      name: "handbook",
      updatedAt: LONG_AGO,
      lastEditedById: bob.id,
      lastEditedVia: "mcp",
    });
  });

  it.each(["guides", " guides "])(
    "stores nothing for a tab renamed to %j in the browser and returns it",
    async (name) => {
      const { bob, tab } = await changedByBob();

      await expect(folderService.renameTab(actor, tab.id, { name })).resolves.toStrictEqual({
        ok: true,
        value: { id: tab.id, name: "guides", folder: { name: "handbook" } },
      });

      expect(await storedTab(tab.id)).toStrictEqual({
        name: "guides",
        updatedAt: LONG_AGO,
        lastEditedById: bob.id,
        lastEditedVia: "mcp",
      });
    },
  );

  it("stores nothing for a tab renamed to its name through MCP", async () => {
    const bob = await createBob();
    const folder = await createFolder({ name: "handbook", roles: [{ user, role: "owner" }] });
    const tab = await createTab({ folder, name: "guides", editor: bob, via: "web", updatedAt: LONG_AGO });
    const manager = mcpActorOf(user, folder, "manager");

    await expect(folderService.renameTab(manager, tab.id, { name: "guides" })).resolves.toStrictEqual({
      ok: true,
      value: { id: tab.id, name: "guides", folder: { name: "handbook" } },
    });

    expect(await storedTab(tab.id)).toStrictEqual({
      name: "guides",
      updatedAt: LONG_AGO,
      lastEditedById: bob.id,
      lastEditedVia: "web",
    });
  });

  it("compares with the name stored at the moment of the save, not with the name of the open dialog", async () => {
    const { bob, folder, tab } = await changedByBob();
    // Another Manager renamed the tab from `guides` to `news` while the dialog for `guides` was open.
    await getTestDb().tab.update({ where: { id: tab.id }, data: { name: "news", updatedAt: LONG_AGO } });

    await expect(folderService.renameTab(actor, tab.id, { name: "news" })).resolves.toStrictEqual({
      ok: true,
      value: { id: tab.id, name: "news", folder: { name: folder.name } },
    });

    expect(await storedTab(tab.id)).toStrictEqual({
      name: "news",
      updatedAt: LONG_AGO,
      lastEditedById: bob.id,
      lastEditedVia: "mcp",
    });
  });

  it("is refused as any other rename: a Writer, an admin, and a tab that does not exist", async () => {
    const { folder, tab } = await changedByBob();
    const admin = await createUser({ name: "maria", type: "admin" });
    const writer = mcpActorOf(user, folder, "writer");
    const manager = mcpActorOf(user, folder, "manager");
    const before = [await storedFolder(folder.id), await storedTab(tab.id)];

    // A tab that does not exist has no role either, in the browser as through MCP, also for an Owner.
    await expect(folderService.renameTab(actor, crypto.randomUUID(), { name: "guides" })).resolves.toEqual(NOT_ALLOWED);
    await expect(folderService.renameTab(manager, crypto.randomUUID(), { name: "guides" })).resolves.toEqual(
      NOT_ALLOWED,
    );
    await expect(folderService.renameTab(writer, tab.id, { name: "guides" })).resolves.toEqual(NOT_ALLOWED);
    await expect(folderService.renameFolder(inBrowser(admin), folder.id, { name: "handbook" })).resolves.toEqual(
      NOT_ALLOWED,
    );
    await expect(folderService.renameTab(inBrowser(admin), tab.id, { name: "guides" })).resolves.toEqual(NOT_ALLOWED);
    await getTestDb().folderRole.updateMany({ where: { folderId: folder.id }, data: { role: "writer" } });
    await expect(folderService.renameTab(actor, tab.id, { name: "guides" })).resolves.toEqual(NOT_ALLOWED);

    expect([await storedFolder(folder.id), await storedTab(tab.id)]).toStrictEqual(before);
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

describe("deleting a tab", () => {
  const TAB_NOT_FOUND = { ok: false, error: { code: "tab-not-found" } };
  const PAGE_NOT_FOUND = { ok: false, error: { code: "page-not-found" } };

  /** Everything a tab deletion could change: the folders, the tabs and the pages, in a stable order. */
  async function snapshot() {
    const db = getTestDb();
    return {
      folders: await db.folder.findMany({ orderBy: { id: "asc" } }),
      tabs: await db.tab.findMany({ orderBy: { id: "asc" } }),
      pages: await db.page.findMany({ orderBy: { id: "asc" } }),
    };
  }

  it.each(["manager", "owner"] as const)(
    "lets a %s delete a tab with its pages, which become deleted pages of the actor",
    async (role) => {
      const bob = await createBob();
      const folder = await createFolder({ name: "docs", roles: [{ user, role }] });
      const tab = await createTab({ folder, name: "meetngs", editor: bob });
      const second = await createPage({ tab, name: "second", editor: bob, version: 4, content: "# Second page" });
      const first = await createPage({ tab, name: "first", editor: bob, content: "# First page" });

      await expect(folderService.deleteTab(actor, folder.id, tab.id)).resolves.toStrictEqual({
        ok: true,
        value: {
          folder: { id: folder.id, name: "docs" },
          pageCount: 2,
          pages: [
            { name: "first", title: "First page" },
            { name: "second", title: "Second page" },
          ],
        },
      });

      await expect(getTestDb().tab.findUnique({ where: { id: tab.id } })).resolves.toBeNull();
      const pages = await getTestDb().page.findMany({ where: { folderId: folder.id }, orderBy: { name: "asc" } });
      expect(
        pages.map(({ name, tabId, lastEditedById, version }) => ({ name, tabId, lastEditedById, version })),
      ).toEqual([
        { name: "first", tabId: null, lastEditedById: user.id, version: first.version + 1 },
        { name: "second", tabId: null, lastEditedById: user.id, version: second.version + 1 },
      ]);
      // Both deleted at the same time.
      const times = pages.map(({ deletedAt }) => deletedAt?.getTime());
      expect(times[0]).toEqual(expect.any(Number));
      expect(new Set(times).size).toBe(1);
      // The pages keep their content.
      expect(pages.map(({ content }) => content)).toEqual([first.content, second.content]);

      const deleted = await pageService.listDeletedPages(actor, folder.id);
      expect(deleted?.map(({ name, lastEditedBy }) => [name, lastEditedBy.name]).sort()).toEqual([
        ["first", "alice"],
        ["second", "alice"],
      ]);
    },
  );

  it("deletes a tab without pages", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "empty" });

    await expect(folderService.deleteTab(actor, folder.id, tab.id)).resolves.toMatchObject({
      ok: true,
      value: { pageCount: 0, pages: [] },
    });
    expect(await getTestDb().tab.count()).toBe(0);
  });

  it("touches no page outside the tab", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "old" });
    const other = await createTab({ folder, name: "other" });
    await createPage({ tab, name: "inside" });
    const direct = await createPage({ folder, name: "direct" });
    const inOther = await createPage({ tab: other, name: "elsewhere" });
    const alreadyDeleted = await createPage({ folder, name: "gone", deletedAt: new Date("2026-01-01T00:00:00Z") });
    const before = await getTestDb().page.findMany({
      where: { id: { in: [direct.id, inOther.id, alreadyDeleted.id] } },
      orderBy: { id: "asc" },
    });

    await expect(folderService.deleteTab(actor, folder.id, tab.id)).resolves.toMatchObject({
      ok: true,
      value: { pageCount: 1, pages: [{ name: "inside", title: "Test page" }] },
    });

    expect(
      await getTestDb().page.findMany({
        where: { id: { in: [direct.id, inOther.id, alreadyDeleted.id] } },
        orderBy: { id: "asc" },
      }),
    ).toStrictEqual(before);
    await expect(getTestDb().tab.findUnique({ where: { id: other.id } })).resolves.not.toBeNull();
  });

  it.each(["reader", "writer", null] as const)("refuses the role %s and changes nothing", async (role) => {
    const bob = await createBob();
    const folder = await createFolder({
      name: "docs",
      roles: role
        ? [
            { user, role },
            { user: bob, role: "owner" },
          ]
        : [{ user: bob, role: "owner" }],
    });
    const tab = await createTab({ folder, name: "guides" });
    await createPage({ tab, name: "intro" });
    const before = await snapshot();

    await expect(folderService.deleteTab(actor, folder.id, tab.id)).resolves.toEqual(NOT_ALLOWED);

    expect(await snapshot()).toStrictEqual(before);
  });

  it("refuses an admin and changes nothing", async () => {
    const admin = await createUser({ name: "maria", type: "admin" });
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    await createPage({ tab, name: "intro" });
    const before = await snapshot();

    await expect(folderService.deleteTab(inBrowser(admin), folder.id, tab.id)).resolves.toEqual(NOT_ALLOWED);

    expect(await snapshot()).toStrictEqual(before);
  });

  it("returns tab-not-found for a tab that does not exist or was deleted before, and changes nothing", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    await createPage({ tab, name: "intro" });
    await expect(folderService.deleteTab(actor, folder.id, tab.id)).resolves.toMatchObject({ ok: true });
    const before = await snapshot();

    await expect(folderService.deleteTab(actor, folder.id, tab.id)).resolves.toEqual(TAB_NOT_FOUND);
    await expect(folderService.deleteTab(actor, folder.id, crypto.randomUUID())).resolves.toEqual(TAB_NOT_FOUND);

    expect(await snapshot()).toStrictEqual(before);
  });

  it("returns tab-not-found for a tab of another folder of the actor, and changes nothing", async () => {
    const folder = await createFolder({ name: "docs", roles: [{ user, role: "manager" }] });
    const other = await createFolder({ name: "other", roles: [{ user, role: "manager" }] });
    const tab = await createTab({ folder: other, name: "guides" });
    await createPage({ tab, name: "intro" });
    const before = await snapshot();

    await expect(folderService.deleteTab(actor, folder.id, tab.id)).resolves.toEqual(TAB_NOT_FOUND);

    expect(await snapshot()).toStrictEqual(before);
  });

  it("refuses a user without a role on the given folder also for a tab that is gone", async () => {
    const bob = await createBob();
    const folder = await createFolder({ name: "docs", roles: [{ user: bob, role: "owner" }] });

    await expect(folderService.deleteTab(actor, folder.id, crypto.randomUUID())).resolves.toEqual(NOT_ALLOWED);
  });

  it("deletes a renamed tab by its id, with its pages", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "meetngs" });
    await createPage({ tab, name: "intro" });
    await expect(folderService.renameTab(actor, tab.id, { name: "meetings" })).resolves.toMatchObject({ ok: true });

    await expect(folderService.deleteTab(actor, folder.id, tab.id)).resolves.toMatchObject({
      ok: true,
      value: { pageCount: 1 },
    });
    expect(await getTestDb().tab.count()).toBe(0);
  });

  it("deletes a tab of 300 pages with all of them", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "archive" });
    await getTestDb().page.createMany({
      data: Array.from({ length: 300 }, (_, i) => ({
        name: `page-${i}`,
        title: `Page ${i}`,
        content: `# Page ${i}`,
        folderId: folder.id,
        tabId: tab.id,
        lastEditedById: user.id,
        lastEditedVia: "web",
      })),
    });

    const deleted = await folderService.deleteTab(actor, folder.id, tab.id);
    expect(deleted).toMatchObject({ ok: true, value: { pageCount: 300 } });
    // Every page is listed, without a limit.
    expect(deleted.ok && deleted.value.pages).toHaveLength(300);
    expect(await getTestDb().page.count({ where: { folderId: folder.id, deletedAt: { not: null } } })).toBe(300);
  });

  it("frees the name of the tab at once", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "archive" });
    await createPage({ tab, name: "intro" });
    await expect(folderService.deleteTab(actor, folder.id, tab.id)).resolves.toMatchObject({ ok: true });

    await expect(folderService.createTab(actor, folder.id, { name: "archive" })).resolves.toMatchObject({
      ok: true,
      value: { name: "archive" },
    });
  });

  it("leaves the time of the last change and the last editor of the folder as they are", async () => {
    const bob = await createBob();
    const folder = await createFolder({ name: "docs", editor: bob, updatedAt: new Date("2026-01-01T00:00:00Z") });
    const tab = await createTab({ folder, name: "guides" });
    await createPage({ tab, name: "intro" });
    const before = await getTestDb().folder.findUniqueOrThrow({ where: { id: folder.id } });

    await expect(folderService.deleteTab(actor, folder.id, tab.id)).resolves.toMatchObject({ ok: true });

    expect(await getTestDb().folder.findUniqueOrThrow({ where: { id: folder.id } })).toStrictEqual(before);
    expect(await lastEditorOfFolder(folder.id)).toBe(bob.id);
  });

  it("deletes all or nothing: a failing delete of the tab leaves the tab and all its pages as they were", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    await createPage({ tab, name: "first" });
    await createPage({ tab, name: "second" });
    const before = await snapshot();
    const db = getTestDb();
    await db.$executeRawUnsafe(`
      CREATE FUNCTION refuse_tab_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'tab delete refused by the test'; END $$`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER refuse_tab_delete BEFORE DELETE ON "Tab" FOR EACH ROW EXECUTE FUNCTION refuse_tab_delete()`,
    );
    try {
      await expect(folderService.deleteTab(actor, folder.id, tab.id)).resolves.toEqual(FAILED);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER refuse_tab_delete ON "Tab"`);
      await db.$executeRawUnsafe(`DROP FUNCTION refuse_tab_delete()`);
    }

    expect(await snapshot()).toStrictEqual(before);
  });

  /** How many sessions of the test database wait for a lock. */
  async function waitingForLocks(): Promise<number> {
    const rows = await getTestDb().$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Runs the given write of a page into the tab and the delete of the tab against each other, expects the delete to
   * succeed and returns the result of the write. A transaction of the test holds the row of the tab, so that the
   * write and the delete both have to wait for it; when it ends, they run against each other.
   */
  async function againstDeleteOfTab<T>(folder: { id: string }, tab: { id: string }, write: () => Promise<T>) {
    let deletion: ReturnType<typeof folderService.deleteTab> | undefined;
    let written: Promise<T> | undefined;
    await getTestDb().$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "Tab" WHERE "id" = ${tab.id}::uuid FOR UPDATE`;
        written = write();
        deletion = folderService.deleteTab(actor, folder.id, tab.id);
        await expect.poll(waitingForLocks, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
      },
      { timeout: 20_000 },
    );
    await expect(deletion).resolves.toMatchObject({ ok: true });
    return written;
  }

  /** Expects no page in a tab and no tab: the tab is deleted, and no page slipped into it. */
  async function expectNoTabAndNoPageInOne(): Promise<void> {
    expect(await getTestDb().page.count({ where: { tabId: { not: null } } })).toBe(0);
    expect(await getTestDb().tab.count()).toBe(0);
  }

  // The timeout of these tests is above the 20 seconds of the transaction and the 10 of the poll of
  // `againstDeleteOfTab()`, so that a slow run fails with their message.
  it("never leaves a page created at the same time in a missing tab", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });

    const created = await againstDeleteOfTab(folder, tab, () =>
      pageService.createPage(actor, folder.id, { name: "late", content: "# Late", tabId: tab.id }),
    );

    if (created?.ok) {
      const page = await storedPage(created.value.id);
      expect(page).toMatchObject({ tabId: null, deletedAt: expect.any(Date) });
    } else {
      expect(created).toEqual(TAB_NOT_FOUND);
    }
    await expectNoTabAndNoPageInOne();
  }, 30_000);

  it("never leaves a page moved at the same time in a missing tab", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ folder, name: "late" });
    const before = await storedPage(page.id);

    const moved = await againstDeleteOfTab(folder, tab, () =>
      pageService.moveOrRenamePage(actor, page.id, { name: "late", tabId: tab.id, version: 1 }),
    );

    const after = await storedPage(page.id);
    if (moved?.ok === false && moved.error.code === "tab-not-found") {
      expect(after).toStrictEqual(before);
    } else {
      // The move came first and the page went with the tab; the page it returns may already be deleted.
      expect(moved).toSatisfy((result) => result?.ok === true || result?.error.code === "page-not-found");
      expect(after).toMatchObject({ tabId: null, deletedAt: expect.any(Date), version: 3 });
    }
    await expectNoTabAndNoPageInOne();
  }, 30_000);

  it("never leaves a page restored at the same time in a missing tab", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ folder, name: "late", deletedAt: new Date() });
    const before = await storedPage(page.id);

    const restored = await againstDeleteOfTab(folder, tab, () =>
      pageService.restorePage(actor, page.id, { name: "late", tabId: tab.id }),
    );

    const after = await storedPage(page.id);
    if (restored?.ok === false && restored.error.code === "tab-not-found") {
      expect(after).toStrictEqual(before);
    } else {
      // The restore came first and the page went with the tab; the page it returns may already be deleted.
      expect(restored).toSatisfy((result) => result?.ok === true || result?.error.code === "page-not-found");
      expect(after).toMatchObject({ tabId: null, deletedAt: expect.any(Date), version: 3 });
    }
    await expectNoTabAndNoPageInOne();
  }, 30_000);

  it("answers the writes of a page of the deleted tab with page-not-found", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ tab, name: "intro" });
    await expect(folderService.deleteTab(actor, folder.id, tab.id)).resolves.toMatchObject({ ok: true });
    const before = await snapshot();

    await expect(
      pageService.updatePageContent(actor, page.id, { content: "# Changed", version: page.version }),
    ).resolves.toEqual(PAGE_NOT_FOUND);
    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "moved", tabId: null, version: page.version }),
    ).resolves.toEqual(PAGE_NOT_FOUND);
    await expect(pageService.deletePage(actor, page.id, { version: page.version })).resolves.toEqual(PAGE_NOT_FOUND);

    expect(await snapshot()).toStrictEqual(before);
  });

  it("is gone for MCP: neither the tab nor its pages are listed, and no page is created in it", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    await createPage({ tab, name: "intro" });
    await createPage({ folder, name: "direct" });
    await expect(folderService.deleteTab(actor, folder.id, tab.id)).resolves.toMatchObject({ ok: true });
    const mcp = mcpActorOf(user, folder, "writer");

    await expect(folderService.listTabs(mcp, folder.id)).resolves.toEqual([]);
    expect((await pageService.listAllFolderPages(mcp, folder.id))?.map(({ name }) => name)).toEqual(["direct"]);
    await expect(
      pageService.createPage(mcp, folder.id, { name: "new", content: "# New", tabId: tab.id }),
    ).resolves.toEqual(TAB_NOT_FOUND);
  });
});

describe("tab writes through MCP", () => {
  /** Everything a tab write could change: the tabs and the pages, in a stable order. */
  async function snapshot() {
    const db = getTestDb();
    return {
      tabs: await db.tab.findMany({ orderBy: { id: "asc" } }),
      pages: await db.page.findMany({ orderBy: { id: "asc" } }),
    };
  }

  it("refuses create, rename and delete of a tab through a Writer connection of an Owner, and changes nothing", async () => {
    const folder = await createFolder({ name: "projects", roles: [{ user, role: "owner" }] });
    const tab = await createTab({ folder, name: "guides" });
    await createPage({ tab, name: "intro" });
    const writer = mcpActorOf(user, folder, "writer");
    const before = await snapshot();

    await expect(folderService.createTab(writer, folder.id, { name: "news" })).resolves.toEqual(NOT_ALLOWED);
    await expect(folderService.renameTab(writer, tab.id, { name: "news" })).resolves.toEqual(NOT_ALLOWED);
    await expect(folderService.deleteTab(writer, folder.id, tab.id)).resolves.toEqual(NOT_ALLOWED);

    expect(await snapshot()).toStrictEqual(before);
  });

  it("refuses the tab writes on a folder that is not the one of the connection, and changes nothing", async () => {
    const folder = await createFolder({ name: "projects", roles: [{ user, role: "owner" }] });
    const other = await createFolder({ name: "notes", roles: [{ user, role: "owner" }] });
    const tab = await createTab({ folder: other, name: "guides" });
    await createPage({ tab, name: "intro" });
    const mcp = mcpActorOf(user, folder, "writer");
    const before = await snapshot();

    await expect(folderService.createTab(mcp, other.id, { name: "news" })).resolves.toEqual(NOT_ALLOWED);
    await expect(folderService.renameTab(mcp, tab.id, { name: "news" })).resolves.toEqual(NOT_ALLOWED);
    await expect(folderService.deleteTab(mcp, other.id, tab.id)).resolves.toEqual(NOT_ALLOWED);

    expect(await snapshot()).toStrictEqual(before);
  });

  it("creates and renames tabs through a Manager connection with the user as the last editor", async () => {
    const bob = await createBob();
    const folder = await createFolder({ name: "projects", roles: [{ user, role: "manager" }] });
    const old = await createTab({ folder, name: "misc", editor: bob });
    const manager = mcpActorOf(user, folder, "manager");

    const created = await folderService.createTab(manager, folder.id, { name: "meetings" });
    if (!created.ok) throw new Error(`not created: ${created.error.code}`);
    await expect(folderService.renameTab(manager, old.id, { name: "archive" })).resolves.toStrictEqual({
      ok: true,
      value: { id: old.id, name: "archive", folder: { name: "projects" } },
    });

    expect(await lastEditorOfTab(created.value.id)).toBe(user.id);
    expect(await lastEditorOfTab(old.id)).toBe(user.id);
  });

  it("refuses create and rename through a Manager connection after the user was lowered to Writer", async () => {
    const folder = await createFolder({ name: "projects", roles: [{ user, role: "manager" }] });
    const tab = await createTab({ folder, name: "misc" });
    const manager = mcpActorOf(user, folder, "manager");
    await getTestDb().folderRole.update({
      where: { folderId_userId: { folderId: folder.id, userId: user.id } },
      data: { role: "writer" },
    });
    const before = await snapshot();

    await expect(folderService.createTab(manager, folder.id, { name: "news" })).resolves.toEqual(NOT_ALLOWED);
    await expect(folderService.renameTab(manager, tab.id, { name: "news" })).resolves.toEqual(NOT_ALLOWED);

    expect(await snapshot()).toStrictEqual(before);
  });

  it("deletes a tab through a Manager connection with all its pages, with the user as the user who deleted them", async () => {
    const bob = await createBob();
    const folder = await createFolder({ name: "projects", roles: [{ user, role: "manager" }] });
    const tab = await createTab({ folder, name: "drafts", editor: bob });
    await createPage({ tab, name: "first", editor: bob, content: "# First" });
    await createPage({ tab, name: "second", editor: bob, content: "# Second" });
    const manager = mcpActorOf(user, folder, "manager");

    await expect(folderService.deleteTab(manager, folder.id, tab.id)).resolves.toStrictEqual({
      ok: true,
      value: {
        folder: { id: folder.id, name: "projects" },
        pageCount: 2,
        pages: [
          { name: "first", title: "First" },
          { name: "second", title: "Second" },
        ],
      },
    });

    await expect(getTestDb().tab.findUnique({ where: { id: tab.id } })).resolves.toBeNull();
    const deleted = await pageService.listDeletedPages(inBrowser(user), folder.id);
    expect(deleted?.map(({ name, lastEditedBy }) => [name, lastEditedBy.name]).sort()).toEqual([
      ["first", "alice"],
      ["second", "alice"],
    ]);
  });

  it("refuses a tab deletion through a Manager connection after the user was lowered to Writer", async () => {
    const folder = await createFolder({ name: "projects", roles: [{ user, role: "manager" }] });
    const tab = await createTab({ folder, name: "drafts" });
    await createPage({ tab, name: "intro" });
    const manager = mcpActorOf(user, folder, "manager");
    await getTestDb().folderRole.update({
      where: { folderId_userId: { folderId: folder.id, userId: user.id } },
      data: { role: "writer" },
    });
    const before = await snapshot();

    await expect(folderService.deleteTab(manager, folder.id, tab.id)).resolves.toEqual(NOT_ALLOWED);

    expect(await snapshot()).toStrictEqual(before);
  });
});
