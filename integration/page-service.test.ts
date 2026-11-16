// Runs the page service against the test database, to check its reads and writes on real data.
import { beforeEach, describe, expect, it } from "vitest";

import * as pageService from "@/features/pages/service";
import { inBrowser, inMcp, type BrowserActor } from "@/features/folder-roles/service";
import type { User } from "@/generated/prisma/client";

import {
  createFolder,
  createPage,
  createTab,
  createUser,
  getTestDb,
  type FolderRoleData,
} from "../e2e/support/database";
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

/** Owner roles for the given users, for `createFolder({ roles })`. */
function owners(...users: { id: string }[]): FolderRoleData[] {
  return users.map((owner) => ({ user: owner, role: "owner" }));
}

const NOT_ALLOWED = { ok: false, error: { code: "not-allowed" } };

/** An actor that does not exist: a well-formed id that no user has. */
const UNKNOWN_ACTOR = {
  id: "8f7e6d5c-4b3a-4291-8f7e-6d5c4b3a2910",
  name: "ghost",
  type: "user" as const,
  channel: "browser" as const,
};

/** The id of the last editor of the page with the given id. */
async function lastEditorOf(pageId: string): Promise<string> {
  return (await getTestDb().page.findUniqueOrThrow({ where: { id: pageId } })).lastEditedById;
}

describe("page reads", () => {
  it("lists the pages placed directly in a folder by name, without the pages of its tabs", async () => {
    const folder = await createFolder();
    await createPage({ folder, name: "zeta" });
    await createPage({ folder, name: "alpha" });
    await createPage({ tab: await createTab({ folder }), name: "in-tab" });

    expect((await pageService.listFolderPages(actor, folder.id))?.map(({ name }) => name)).toEqual(["alpha", "zeta"]);
  });

  it("lists the pages of a tab by name, without the other pages of its folder", async () => {
    const folder = await createFolder();
    const tab = await createTab({ folder });
    await createPage({ tab, name: "zeta" });
    await createPage({ tab, name: "alpha" });
    await createPage({ folder, name: "direct" });
    await createPage({ tab: await createTab({ folder }), name: "other-tab" });

    expect((await pageService.listTabPages(actor, tab.id))?.map(({ name }) => name)).toEqual(["alpha", "zeta"]);
  });

  it("lists all pages of a folder by name and tab, the page placed directly in the folder first", async () => {
    const folder = await createFolder();
    const [b, a] = [await createTab({ folder, name: "b" }), await createTab({ folder, name: "a" })];
    await createPage({ tab: b, name: "intro" });
    await createPage({ tab: a, name: "intro" });
    await createPage({ folder, name: "intro" });
    await createPage({ folder, name: "about" });
    await createPage({ name: "other-folder" });

    const pages = (await pageService.listAllFolderPages(actor, folder.id)) ?? [];

    expect(pages.map(({ name, tab }) => [name, tab?.name ?? null])).toEqual([
      ["about", null],
      ["intro", null],
      ["intro", "a"],
      ["intro", "b"],
    ]);
  });

  it("leaves deleted pages out of every list of their folder", async () => {
    const folder = await createFolder();
    const tab = await createTab({ folder });
    await createPage({ folder, name: "direct" });
    await createPage({ tab, name: "in-tab" });
    await createPage({ folder, name: "deleted", deletedAt: new Date() });

    expect((await pageService.listFolderPages(actor, folder.id))?.map(({ name }) => name)).toEqual(["direct"]);
    expect((await pageService.listTabPages(actor, tab.id))?.map(({ name }) => name)).toEqual(["in-tab"]);
    expect((await pageService.listAllFolderPages(actor, folder.id))?.map(({ name }) => name)).toEqual([
      "direct",
      "in-tab",
    ]);
  });

  it("returns null for the old name of a deleted page", async () => {
    const folder = await createFolder({ name: "docs" });
    await createPage({ folder, name: "intro", deletedAt: new Date() });

    await expect(pageService.getPage(actor, "docs", null, "intro")).resolves.toBeNull();
  });

  it("finds a page by its place: directly in the folder or in a tab", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const direct = await createPage({ folder, name: "intro" });
    const inTab = await createPage({ tab, name: "intro" });

    await expect(pageService.getPage(actor, "docs", null, "intro")).resolves.toMatchObject({
      id: direct.id,
      tab: null,
    });
    await expect(pageService.getPage(actor, "docs", "guides", "intro")).resolves.toMatchObject({
      id: inTab.id,
      tab: { name: "guides" },
    });
  });

  it("returns null for a page in another place or with a malformed name", async () => {
    const folder = await createFolder({ name: "docs" });
    await createTab({ folder, name: "guides" });
    await createPage({ tab: await createTab({ folder, name: "news" }), name: "only-in-news" });
    await createPage({ folder, name: "direct" });

    await expect(pageService.getPage(actor, "docs", null, "only-in-news")).resolves.toBeNull();
    await expect(pageService.getPage(actor, "docs", "guides", "only-in-news")).resolves.toBeNull();
    await expect(pageService.getPage(actor, "docs", "guides", "direct")).resolves.toBeNull();
    await expect(pageService.getPage(actor, "docs", null, "Not A Name")).resolves.toBeNull();
  });
});

describe("the fields of a page", () => {
  // `toStrictEqual` fails on any further column, such as `createdAt`, `folderId` or `deletedAt`.
  it("returns exactly the declared fields of a page in a tab", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ tab, name: "intro", content: "# Intro\n\nText", editor: user });

    await expect(pageService.getPage(actor, "docs", "guides", "intro")).resolves.toStrictEqual({
      id: page.id,
      name: "intro",
      title: "Intro",
      content: "# Intro\n\nText",
      updatedAt: page.updatedAt,
      lastEditedBy: { name: "alice" },
      version: 1,
      folder: { id: folder.id, name: "docs" },
      tab: { id: tab.id, name: "guides" },
      role: "owner",
    });
  });

  it("returns exactly the declared fields of a page placed directly in a folder", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "intro", editor: user });

    await expect(pageService.getPage(actor, "docs", null, "intro")).resolves.toStrictEqual({
      id: page.id,
      name: "intro",
      title: page.title,
      content: page.content,
      updatedAt: page.updatedAt,
      lastEditedBy: { name: "alice" },
      version: 1,
      folder: { id: folder.id, name: "docs" },
      tab: null,
      role: "owner",
    });
  });

  it("returns exactly the declared fields of a deleted page", async () => {
    const folder = await createFolder({ name: "docs" });
    const deletedAt = new Date("2026-11-03T10:00:00Z");
    const page = await createPage({ folder, name: "intro", content: "# Intro", deletedAt, editor: user });

    await expect(pageService.getDeletedPage(actor, "docs", page.id)).resolves.toStrictEqual({
      id: page.id,
      name: "intro",
      title: "Intro",
      content: "# Intro",
      deletedAt,
      lastEditedBy: { name: "alice" },
      folder: { id: folder.id, name: "docs" },
    });
  });
});

describe("the lists for a malformed id", () => {
  it("are empty", async () => {
    await createPage({ tab: await createTab() });
    await createPage({ deletedAt: new Date() });

    await expect(pageService.listFolderPages(actor, "not-a-uuid")).resolves.toEqual([]);
    await expect(pageService.listTabPages(actor, "not-a-uuid")).resolves.toEqual([]);
    await expect(pageService.listAllFolderPages(actor, "not-a-uuid")).resolves.toEqual([]);
    await expect(pageService.listDeletedPages(actor, "not-a-uuid")).resolves.toEqual([]);
  });
});

describe("deleted page reads", () => {
  it("lists only the deleted pages of the folder, newest first", async () => {
    const folder = await createFolder();
    await createPage({ folder, name: "older", deletedAt: new Date("2026-11-01T10:00:00Z") });
    await createPage({ folder, name: "newest", deletedAt: new Date("2026-11-03T10:00:00Z") });
    await createPage({ folder, name: "middle", deletedAt: new Date("2026-11-02T10:00:00Z") });
    await createPage({ folder, name: "not-deleted" });
    await createPage({ name: "other-folder", deletedAt: new Date("2026-11-04T10:00:00Z") });

    expect((await pageService.listDeletedPages(actor, folder.id))?.map(({ name }) => name)).toEqual([
      "newest",
      "middle",
      "older",
    ]);
  });

  it("finds a deleted page of the folder by its id", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "intro", deletedAt: new Date() });

    await expect(pageService.getDeletedPage(actor, "docs", page.id)).resolves.toMatchObject({
      id: page.id,
      name: "intro",
      folder: { id: folder.id, name: "docs" },
    });
  });

  it("returns null for a page that is not deleted and for a deleted page of another folder", async () => {
    const folder = await createFolder({ name: "docs" });
    const kept = await createPage({ folder });
    const elsewhere = await createPage({ folder: await createFolder({ name: "other" }), deletedAt: new Date() });

    await expect(pageService.getDeletedPage(actor, "docs", kept.id)).resolves.toBeNull();
    await expect(pageService.getDeletedPage(actor, "docs", elsewhere.id)).resolves.toBeNull();
  });
});

const NAME_TAKEN = { ok: false, error: { code: "name-taken" } };
const TAB_NOT_FOUND = { ok: false, error: { code: "tab-not-found" } };
const PAGE_NOT_FOUND = { ok: false, error: { code: "page-not-found" } };

describe("createPage", () => {
  it("stores a page directly in a folder and returns it as stored", async () => {
    const folder = await createFolder({ name: "docs" });

    const result = await pageService.createPage(actor, folder.id, {
      name: " intro ",
      content: "# Intro\r\n\r\nText",
      tabId: null,
    });

    const stored = await getTestDb().page.findFirstOrThrow({ where: { folderId: folder.id } });
    expect(stored).toMatchObject({ name: "intro", title: "Intro", content: "# Intro\n\nText", tabId: null });
    expect(result).toStrictEqual({
      ok: true,
      value: { id: stored.id, name: "intro", folder: { name: "docs" }, tab: null },
    });
  });

  it("stores a page in a tab and returns it as stored", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });

    const result = await pageService.createPage(actor, folder.id, { name: "intro", content: "# Intro", tabId: tab.id });

    const stored = await getTestDb().page.findFirstOrThrow({ where: { tabId: tab.id } });
    expect(result).toStrictEqual({
      ok: true,
      value: { id: stored.id, name: "intro", folder: { name: "docs" }, tab: { name: "guides" } },
    });
  });

  it("returns tab-not-found for a tab of another folder and stores nothing", async () => {
    const folder = await createFolder();
    const foreignTab = await createTab();

    await expect(
      pageService.createPage(actor, folder.id, { name: "intro", content: "# Intro", tabId: foreignTab.id }),
    ).resolves.toEqual(TAB_NOT_FOUND);
    await expect(
      pageService.createPage(actor, folder.id, { name: "intro", content: "# Intro", tabId: crypto.randomUUID() }),
    ).resolves.toEqual(TAB_NOT_FOUND);
    expect(await getTestDb().page.count()).toBe(0);
  });

  // A folder that does not exist has no role of the actor either, so it answers like a folder the actor cannot see.
  it("returns not-allowed for a folder that does not exist", async () => {
    await expect(
      pageService.createPage(actor, crypto.randomUUID(), { name: "intro", content: "# Intro", tabId: null }),
    ).resolves.toEqual(NOT_ALLOWED);
  });

  it("returns name-taken for a taken name in the same place", async () => {
    const folder = await createFolder();
    const tab = await createTab({ folder });
    await createPage({ folder, name: "direct" });
    await createPage({ tab, name: "in-tab" });

    await expect(
      pageService.createPage(actor, folder.id, { name: "direct", content: "# Intro", tabId: null }),
    ).resolves.toEqual(NAME_TAKEN);
    await expect(
      pageService.createPage(actor, folder.id, { name: "in-tab", content: "# Intro", tabId: tab.id }),
    ).resolves.toEqual(NAME_TAKEN);
    expect(await getTestDb().page.count()).toBe(2);
  });

  it("allows the same name directly in the folder and in a tab", async () => {
    const folder = await createFolder();
    const tab = await createTab({ folder });

    await expect(
      pageService.createPage(actor, folder.id, { name: "intro", content: "# Intro", tabId: null }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      pageService.createPage(actor, folder.id, { name: "intro", content: "# Intro", tabId: tab.id }),
    ).resolves.toMatchObject({ ok: true });
    expect(await getTestDb().page.count()).toBe(2);
  });
});

describe("updatePageContent", () => {
  it("stores the content with its derived title and returns the page as stored", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ tab, name: "intro", content: "# Old" });

    await expect(
      pageService.updatePageContent(actor, page.id, { content: "# New title\n\nText", version: 1 }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { id: page.id, name: "intro", folder: { name: "docs" }, tab: { name: "guides" } },
    });

    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).toMatchObject({
      title: "New title",
      content: "# New title\n\nText",
      name: "intro",
      tabId: tab.id,
    });
  });

  it("returns page-not-found for a deleted page and leaves it as it is, and not-allowed for no page", async () => {
    const page = await createPage({ content: "# Old", deletedAt: new Date() });

    await expect(pageService.updatePageContent(actor, page.id, { content: "# New", version: 1 })).resolves.toEqual(
      PAGE_NOT_FOUND,
    );
    // A page that does not exist has no folder with a role of the actor, so nothing tells that it does not exist.
    await expect(
      pageService.updatePageContent(actor, crypto.randomUUID(), { content: "# New", version: 1 }),
    ).resolves.toEqual(NOT_ALLOWED);
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).content).toBe("# Old");
  });

  it("stores the content only if the page has the version given", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "intro", content: "# Old", version: 3 });

    await expect(
      pageService.updatePageContent(actor, page.id, { content: "# New", version: 3 }),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).toMatchObject({
      content: "# New",
      version: 4,
    });
  });

  // R1, R6, R14: a save based on an older version, or on none, changes nothing.
  it.each([
    ["an older version", 2],
    ["a newer version", 4],
    ["no version", null],
    ["a malformed version", 0],
  ])("refuses a save with %s as page-changed and changes nothing", async (_name, version) => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ tab, name: "intro", content: "# Old", version: 3 });

    await expect(pageService.updatePageContent(actor, page.id, { content: "# New", version })).resolves.toStrictEqual({
      ok: false,
      error: {
        code: "page-changed",
        page: { id: page.id, name: "intro", folder: { name: "docs" }, tab: { name: "guides" } },
      },
    });
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).toStrictEqual(page);
  });

  // R7, R12: a rename counts as a change, and the refusal names the page with its new name.
  it("refuses a save based on the version from before a rename, with the new name", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "docs", roles: owners(user, bob) });
    const page = await createPage({ folder, name: "intro", content: "# Old" });

    await expect(
      pageService.moveOrRenamePage(inBrowser(bob), page.id, { name: "start", tabId: null, version: 1 }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      pageService.updatePageContent(actor, page.id, { content: "# New", version: 1 }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { code: "page-changed", page: { id: page.id, name: "start", folder: { name: "docs" }, tab: null } },
    });
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).content).toBe("# Old");
  });

  // R11: a page deleted after the editor was opened is missing, whatever the version.
  it("gives page-not-found for a page deleted after the version given", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "intro", content: "# Old" });
    await pageService.deletePage(actor, page.id, { version: 1 });

    await expect(pageService.updatePageContent(actor, page.id, { content: "# New", version: 1 })).resolves.toEqual(
      PAGE_NOT_FOUND,
    );
  });
});

describe("moveOrRenamePage", () => {
  it("moves a page into a tab and back, with and without a new name", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ folder, name: "intro", content: "# Intro" });

    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "intro", tabId: tab.id, version: 1 }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { id: page.id, name: "intro", folder: { name: "docs" }, tab: { name: "guides" } },
    });
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).toMatchObject({
      name: "intro",
      tabId: tab.id,
    });

    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "start", tabId: null, version: 2 }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { id: page.id, name: "start", folder: { name: "docs" }, tab: null },
    });
    // The content is not touched by a move or rename.
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).toMatchObject({
      name: "start",
      tabId: null,
      content: "# Intro",
      title: "Intro",
    });
  });

  it("returns name-taken for a taken name at the target and tab-not-found for a tab of another folder", async () => {
    const folder = await createFolder();
    const tab = await createTab({ folder });
    await createPage({ tab, name: "intro" });
    const page = await createPage({ folder, name: "intro" });
    const foreignTab = await createTab();

    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "intro", tabId: tab.id, version: 1 }),
    ).resolves.toEqual(NAME_TAKEN);
    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "intro", tabId: foreignTab.id, version: 1 }),
    ).resolves.toEqual(TAB_NOT_FOUND);
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).tabId).toBeNull();
  });

  it("returns page-not-found for a deleted page", async () => {
    const page = await createPage({ deletedAt: new Date() });

    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "intro", tabId: null, version: 1 }),
    ).resolves.toEqual(PAGE_NOT_FOUND);
  });

  it("moves the page only if it has the version given", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "intro", version: 3 });

    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "start", tabId: null, version: 3 }),
    ).resolves.toMatchObject({ ok: true });
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).toMatchObject({
      name: "start",
      version: 4,
    });
  });

  // R2, R6, R14: a move based on an older version, or on none, changes nothing.
  it.each([
    ["an older version", 2],
    ["no version", null],
    ["a malformed version", -3],
  ])("refuses a move with %s as page-changed and changes nothing", async (_name, version) => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ folder, name: "intro", version: 3 });

    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "start", tabId: tab.id, version }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { code: "page-changed", page: { id: page.id, name: "intro", folder: { name: "docs" }, tab: null } },
    });
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).toStrictEqual(page);
  });

  // R7: a content save counts as a change.
  it("refuses a move based on the version from before a content save", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "docs", roles: owners(user, bob) });
    const page = await createPage({ folder, name: "intro" });

    await expect(
      pageService.updatePageContent(inBrowser(bob), page.id, { content: "# New", version: 1 }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "start", tabId: null, version: 1 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "page-changed", page: { name: "intro" } } });
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).name).toBe("intro");
  });

  it("gives page-not-found for a page deleted after the version given", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "intro" });
    await pageService.deletePage(actor, page.id, { version: 1 });

    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "start", tabId: null, version: 1 }),
    ).resolves.toEqual(PAGE_NOT_FOUND);
  });

  // The older version matches no row, so the taken name is never checked.
  it("gives page-changed, not name-taken, for an older version and a taken name", async () => {
    const folder = await createFolder({ name: "docs" });
    await createPage({ folder, name: "taken" });
    const page = await createPage({ folder, name: "intro", version: 3 });

    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "taken", tabId: null, version: 2 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "page-changed" } });
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).toStrictEqual(page);
  });
});

describe("deletePage", () => {
  it("forgets the tab, returns the place and frees the name", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ tab, name: "intro" });

    await expect(pageService.deletePage(actor, page.id, { version: 1 })).resolves.toStrictEqual({
      ok: true,
      value: { folder: { name: "docs" }, tab: { name: "guides" } },
    });

    const stored = await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } });
    expect(stored).toMatchObject({ tabId: null, folderId: folder.id, name: "intro" });
    expect(stored.deletedAt).toBeInstanceOf(Date);
    // The name is free again in the tab.
    await expect(
      pageService.createPage(actor, folder.id, { name: "intro", content: "# Intro", tabId: tab.id }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("returns the folder as the place of a page placed directly in it and frees the name there", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "intro" });

    await expect(pageService.deletePage(actor, page.id, { version: 1 })).resolves.toStrictEqual({
      ok: true,
      value: { folder: { name: "docs" }, tab: null },
    });
    await expect(
      pageService.createPage(actor, folder.id, { name: "intro", content: "# Intro", tabId: null }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("returns page-not-found for a page that is already deleted, and not-allowed for one that does not exist", async () => {
    const page = await createPage({ deletedAt: new Date() });

    await expect(pageService.deletePage(actor, page.id, { version: 1 })).resolves.toEqual(PAGE_NOT_FOUND);
    await expect(pageService.deletePage(actor, crypto.randomUUID(), { version: 1 })).resolves.toEqual(NOT_ALLOWED);
  });

  it("deletes the page only if it has the version given", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "intro", version: 3 });

    await expect(pageService.deletePage(actor, page.id, { version: 3 })).resolves.toMatchObject({ ok: true });
    const stored = await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } });
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.version).toBe(4);
  });

  // R3, R6, R14: a delete based on an older version, or on none, deletes nothing.
  it.each([
    ["an older version", 2],
    ["no version", null],
    ["a malformed version", 0],
  ])("refuses a delete with %s as page-changed and deletes nothing", async (_name, version) => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ tab, name: "intro", version: 3 });

    await expect(pageService.deletePage(actor, page.id, { version })).resolves.toStrictEqual({
      ok: false,
      error: {
        code: "page-changed",
        page: { id: page.id, name: "intro", folder: { name: "docs" }, tab: { name: "guides" } },
      },
    });
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).toStrictEqual(page);
  });

  // R11: a page deleted after the dialog was opened is missing, as before.
  it("gives page-not-found for a page deleted after the version given", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "intro" });

    await expect(pageService.deletePage(actor, page.id, { version: 1 })).resolves.toMatchObject({ ok: true });
    await expect(pageService.deletePage(actor, page.id, { version: 1 })).resolves.toEqual(PAGE_NOT_FOUND);
  });
});

describe("restorePage", () => {
  it("restores a page into its folder and into a tab", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const direct = await createPage({ folder, name: "first", deletedAt: new Date() });
    const inTab = await createPage({ folder, name: "second", deletedAt: new Date() });

    await expect(pageService.restorePage(actor, direct.id, { name: "first", tabId: null })).resolves.toStrictEqual({
      ok: true,
      value: { id: direct.id, name: "first", folder: { name: "docs" }, tab: null },
    });
    await expect(pageService.restorePage(actor, inTab.id, { name: "renamed", tabId: tab.id })).resolves.toStrictEqual({
      ok: true,
      value: { id: inTab.id, name: "renamed", folder: { name: "docs" }, tab: { name: "guides" } },
    });

    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: direct.id } })).toMatchObject({
      deletedAt: null,
      tabId: null,
    });
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: inTab.id } })).toMatchObject({
      deletedAt: null,
      tabId: tab.id,
      name: "renamed",
    });
  });

  it("returns name-taken for a taken name and keeps the page deleted", async () => {
    const folder = await createFolder();
    await createPage({ folder, name: "intro" });
    const page = await createPage({ folder, name: "intro", deletedAt: new Date() });

    await expect(pageService.restorePage(actor, page.id, { name: "intro", tabId: null })).resolves.toEqual(NAME_TAKEN);
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).deletedAt).not.toBeNull();
  });

  it("returns tab-not-found for a tab of another folder", async () => {
    const page = await createPage({ deletedAt: new Date() });
    const foreignTab = await createTab();

    await expect(pageService.restorePage(actor, page.id, { name: "intro", tabId: foreignTab.id })).resolves.toEqual(
      TAB_NOT_FOUND,
    );
  });

  // R13: restoring is not checked against a change in the meantime; it counts the version up like every write.
  it("needs no version and counts the version up", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "old", deletedAt: new Date(), version: 5 });

    await expect(pageService.restorePage(actor, page.id, { name: "old", tabId: null })).resolves.toMatchObject({
      ok: true,
    });
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).version).toBe(6);
  });

  it("returns page-not-found for a page that is not deleted", async () => {
    const page = await createPage({ name: "intro" });

    await expect(pageService.restorePage(actor, page.id, { name: "other", tabId: null })).resolves.toEqual(
      PAGE_NOT_FOUND,
    );
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).name).toBe("intro");
  });
});

describe("the last editor of pages", () => {
  it("is the actor of each write, which replaces the one before", async () => {
    const [bob, carol] = [await createUser({ name: "bob" }), await createUser({ name: "carol" })];
    const folder = await createFolder({ roles: owners(user, bob, carol) });
    const tab = await createTab({ folder });

    const created = await pageService.createPage(actor, folder.id, { name: "intro", content: "# Intro", tabId: null });
    if (!created.ok) throw new Error("expected the page to be created");
    const { id } = created.value;
    expect(await lastEditorOf(id)).toBe(actor.id);

    await pageService.updatePageContent(inBrowser(bob), id, { content: "# New", version: 1 });
    expect(await lastEditorOf(id)).toBe(bob.id);

    await pageService.moveOrRenamePage(inBrowser(carol), id, { name: "start", tabId: tab.id, version: 2 });
    expect(await lastEditorOf(id)).toBe(carol.id);

    // For a deleted page, the last editor is the user who deleted it.
    await pageService.deletePage(actor, id, { version: 3 });
    expect(await lastEditorOf(id)).toBe(actor.id);

    await pageService.restorePage(inBrowser(bob), id, { name: "start", tabId: null });
    expect(await lastEditorOf(id)).toBe(bob.id);
  });

  it("stays as it was when a write fails", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ roles: owners(user, bob) });
    const foreignTab = await createTab();
    await createPage({ folder, name: "taken" });
    const page = await createPage({ folder, name: "intro", editor: user });
    const deleted = await createPage({ folder, name: "old", editor: user, deletedAt: new Date() });

    await pageService.updatePageContent(inBrowser(bob), page.id, { content: "No title", version: 1 });
    await pageService.moveOrRenamePage(inBrowser(bob), page.id, { name: "taken", tabId: null, version: 1 });
    await pageService.moveOrRenamePage(inBrowser(bob), page.id, { name: "start", tabId: foreignTab.id, version: 1 });
    await pageService.moveOrRenamePage(inBrowser(bob), page.id, { name: "Not A Name", tabId: null, version: 1 });
    // A deleted page is missing for every write but a restore, and a page that is not deleted for a restore.
    await pageService.updatePageContent(inBrowser(bob), deleted.id, { content: "# New", version: 1 });
    await pageService.moveOrRenamePage(inBrowser(bob), deleted.id, { name: "start", tabId: null, version: 1 });
    await pageService.deletePage(inBrowser(bob), deleted.id, { version: 1 });
    await pageService.restorePage(inBrowser(bob), page.id, { name: "start", tabId: null });
    await pageService.restorePage(inBrowser(bob), deleted.id, { name: "taken", tabId: null });
    await pageService.restorePage(inBrowser(bob), deleted.id, { name: "start", tabId: foreignTab.id });

    expect(await lastEditorOf(page.id)).toBe(actor.id);
    expect(await lastEditorOf(deleted.id)).toBe(actor.id);
  });

  it("of the folder and the tab is not touched by the writes of their pages", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ editor: user, roles: owners(bob) });
    const tab = await createTab({ folder, editor: user });
    const created = await pageService.createPage(inBrowser(bob), folder.id, {
      name: "intro",
      content: "# Intro",
      tabId: tab.id,
    });
    if (!created.ok) throw new Error("expected the page to be created");
    const { id } = created.value;
    await pageService.moveOrRenamePage(inBrowser(bob), id, { name: "intro", tabId: null, version: 1 });
    await pageService.moveOrRenamePage(inBrowser(bob), id, { name: "intro", tabId: tab.id, version: 2 });
    await pageService.deletePage(inBrowser(bob), id, { version: 3 });
    await pageService.restorePage(inBrowser(bob), id, { name: "intro", tabId: tab.id });

    const storedFolder = await getTestDb().folder.findUniqueOrThrow({ where: { id: folder.id } });
    const storedTab = await getTestDb().tab.findUniqueOrThrow({ where: { id: tab.id } });
    expect([storedFolder.lastEditedById, storedTab.lastEditedById]).toEqual([actor.id, actor.id]);
    expect([storedFolder.updatedAt, storedTab.updatedAt]).toEqual([folder.updatedAt, tab.updatedAt]);
  });

  // An actor that does not exist has no role on any folder, so the writes are refused before they reach the pages.
  it("gives not-allowed, not a missing folder, tab or page, for an actor that does not exist, and writes nothing", async () => {
    const folder = await createFolder();
    const tab = await createTab({ folder });
    const page = await createPage({ folder, name: "intro", editor: user });
    const deleted = await createPage({ folder, name: "old", editor: user, deletedAt: new Date() });
    const before = await getTestDb().page.findMany({ orderBy: { name: "asc" } });

    for (const tabId of [null, tab.id]) {
      await expect(
        pageService.createPage(UNKNOWN_ACTOR, folder.id, { name: "new", content: "# New", tabId }),
      ).resolves.toEqual(NOT_ALLOWED);
    }
    await expect(
      pageService.updatePageContent(UNKNOWN_ACTOR, page.id, { content: "# New", version: 1 }),
    ).resolves.toEqual(NOT_ALLOWED);
    await expect(
      pageService.moveOrRenamePage(UNKNOWN_ACTOR, page.id, { name: "new", tabId: tab.id, version: 1 }),
    ).resolves.toEqual(NOT_ALLOWED);
    await expect(pageService.deletePage(UNKNOWN_ACTOR, page.id, { version: 1 })).resolves.toEqual(NOT_ALLOWED);
    await expect(pageService.restorePage(UNKNOWN_ACTOR, deleted.id, { name: "old", tabId: tab.id })).resolves.toEqual(
      NOT_ALLOWED,
    );

    expect(await getTestDb().page.findMany({ orderBy: { name: "asc" } })).toStrictEqual(before);
  });
});

/** The version of the page with the given id. */
async function versionOf(pageId: string): Promise<number> {
  return (await getTestDb().page.findUniqueOrThrow({ where: { id: pageId } })).version;
}

describe("the version of pages", () => {
  it("is 1 for a new page and counted up by one by each write", async () => {
    const folder = await createFolder({ roles: owners(user) });
    const tab = await createTab({ folder });

    const created = await pageService.createPage(actor, folder.id, { name: "intro", content: "# Intro", tabId: null });
    if (!created.ok) throw new Error("expected the page to be created");
    const { id } = created.value;
    expect(await versionOf(id)).toBe(1);

    await pageService.updatePageContent(actor, id, { content: "# New", version: 1 });
    expect(await versionOf(id)).toBe(2);

    await pageService.moveOrRenamePage(actor, id, { name: "start", tabId: tab.id, version: 2 });
    expect(await versionOf(id)).toBe(3);

    await pageService.deletePage(actor, id, { version: 3 });
    expect(await versionOf(id)).toBe(4);

    await pageService.restorePage(actor, id, { name: "start", tabId: null });
    expect(await versionOf(id)).toBe(5);
  });

  it("stays as it was when a write fails", async () => {
    const folder = await createFolder({ roles: owners(user) });
    const foreignTab = await createTab();
    await createPage({ folder, name: "taken" });
    const page = await createPage({ folder, name: "intro", editor: user, version: 7 });
    const deleted = await createPage({ folder, name: "old", editor: user, deletedAt: new Date(), version: 7 });

    await pageService.updatePageContent(actor, page.id, { content: "No title", version: 7 });
    await pageService.moveOrRenamePage(actor, page.id, { name: "taken", tabId: null, version: 7 });
    await pageService.moveOrRenamePage(actor, page.id, { name: "start", tabId: foreignTab.id, version: 7 });
    await pageService.updatePageContent(actor, deleted.id, { content: "# New", version: 7 });
    await pageService.deletePage(actor, deleted.id, { version: 7 });
    await pageService.restorePage(actor, page.id, { name: "start", tabId: null });
    await pageService.restorePage(actor, deleted.id, { name: "taken", tabId: null });
    await pageService.restorePage(actor, deleted.id, { name: "start", tabId: foreignTab.id });

    expect(await versionOf(page.id)).toBe(7);
    expect(await versionOf(deleted.id)).toBe(7);
  });
});

describe("the last editor in the page reads", () => {
  it("is the user name of the last editor in every list and in the page view", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    await createPage({ folder, name: "direct", editor: user });
    await createPage({ tab, name: "in-tab", editor: bob });

    const editors = (pages: { name: string; lastEditedBy: { name: string } }[]) =>
      pages.map(({ name, lastEditedBy }) => [name, lastEditedBy.name]);
    expect(editors((await pageService.listFolderPages(actor, folder.id)) ?? [])).toEqual([["direct", "alice"]]);
    expect(editors((await pageService.listTabPages(actor, tab.id)) ?? [])).toEqual([["in-tab", "bob"]]);
    expect(editors((await pageService.listAllFolderPages(actor, folder.id)) ?? [])).toEqual([
      ["direct", "alice"],
      ["in-tab", "bob"],
    ]);
    await expect(pageService.getPage(actor, "docs", "guides", "in-tab")).resolves.toMatchObject({
      lastEditedBy: { name: "bob" },
    });
  });

  it("is the user who changed the page last, after a write through the service", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "docs", roles: owners(user, bob) });
    const page = await createPage({ folder, name: "intro", editor: user });

    await pageService.updatePageContent(inBrowser(bob), page.id, { content: "# New", version: 1 });

    await expect(pageService.getPage(actor, "docs", null, "intro")).resolves.toMatchObject({
      lastEditedBy: { name: "bob" },
    });
    expect((await pageService.listFolderPages(actor, folder.id))?.[0]?.lastEditedBy).toEqual({ name: "bob" });
  });

  it("is the user who deleted the page in the deleted pages and the deleted page view", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "docs", roles: owners(user, bob) });
    const page = await createPage({ folder, name: "intro", editor: user });

    await pageService.deletePage(inBrowser(bob), page.id, { version: 1 });

    await expect(pageService.listDeletedPages(actor, folder.id)).resolves.toMatchObject([
      { lastEditedBy: { name: "bob" } },
    ]);
    await expect(pageService.getDeletedPage(actor, "docs", page.id)).resolves.toMatchObject({
      lastEditedBy: { name: "bob" },
    });
  });

  it("returns no other field of the user", async () => {
    const folder = await createFolder({ name: "docs" });
    await createPage({ folder, name: "intro", editor: user });

    const [summary] = (await pageService.listFolderPages(actor, folder.id)) ?? [];

    expect(summary?.lastEditedBy).toStrictEqual({ name: "alice" });
  });
});

describe("an admin", () => {
  it("reads no page, not even one that exists, and changes nothing", async () => {
    const admin = await createUser({ name: "maria", type: "admin" });
    const folder = await createFolder({ name: "docs", editor: user });
    const page = await createPage({ folder, name: "intro", editor: user });
    const deleted = await createPage({ folder, name: "old", editor: user, deletedAt: new Date() });
    const before = await getTestDb().page.findMany({ orderBy: { name: "asc" } });

    await expect(pageService.listFolderPages(inBrowser(admin), folder.id)).resolves.toBeNull();
    await expect(pageService.listAllFolderPages(inBrowser(admin), folder.id)).resolves.toBeNull();
    await expect(pageService.getPage(inBrowser(admin), "docs", null, "intro")).resolves.toBeNull();
    await expect(pageService.listDeletedPages(inBrowser(admin), folder.id)).resolves.toBeNull();
    await expect(pageService.getDeletedPage(inBrowser(admin), "docs", deleted.id)).resolves.toBeNull();
    const notAllowed = { ok: false, error: { code: "not-allowed" } };
    await expect(
      pageService.createPage(inBrowser(admin), folder.id, { name: "new", content: "# New", tabId: null }),
    ).resolves.toEqual(notAllowed);
    await expect(
      pageService.updatePageContent(inBrowser(admin), page.id, { content: "# Changed", version: 1 }),
    ).resolves.toEqual(notAllowed);
    await expect(pageService.deletePage(inBrowser(admin), page.id, { version: 1 })).resolves.toEqual(notAllowed);
    await expect(pageService.restorePage(inBrowser(admin), deleted.id, { name: "old", tabId: null })).resolves.toEqual(
      notAllowed,
    );

    expect(await getTestDb().page.findMany({ orderBy: { name: "asc" } })).toStrictEqual(before);
  });
});

describe("roles", () => {
  it("reads no page, page list or deleted page of a folder without a role of the actor", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "hidden", roles: owners(bob) });
    const tab = await createTab({ folder, name: "guides" });
    await createPage({ folder, name: "intro" });
    await createPage({ tab, name: "in-tab" });
    const deleted = await createPage({ folder, name: "old", deletedAt: new Date() });

    await expect(pageService.listFolderPages(actor, folder.id)).resolves.toBeNull();
    await expect(pageService.listTabPages(actor, tab.id)).resolves.toBeNull();
    await expect(pageService.listAllFolderPages(actor, folder.id)).resolves.toBeNull();
    await expect(pageService.getPage(actor, "hidden", null, "intro")).resolves.toBeNull();
    await expect(pageService.getPage(actor, "hidden", "guides", "in-tab")).resolves.toBeNull();
    await expect(pageService.listDeletedPages(actor, folder.id)).resolves.toBeNull();
    await expect(pageService.getDeletedPage(actor, "hidden", deleted.id)).resolves.toBeNull();
  });

  it("changes no page of a folder without a role of the actor", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "hidden", roles: owners(bob) });
    const tab = await createTab({ folder });
    const page = await createPage({ folder, name: "intro" });
    const deleted = await createPage({ folder, name: "old", deletedAt: new Date() });
    const before = await getTestDb().page.findMany({ orderBy: { name: "asc" } });

    for (const result of [
      await pageService.createPage(actor, folder.id, { name: "new", content: "# New", tabId: null }),
      await pageService.updatePageContent(actor, page.id, { content: "# New", version: 1 }),
      await pageService.moveOrRenamePage(actor, page.id, { name: "new", tabId: tab.id, version: 1 }),
      await pageService.deletePage(actor, page.id, { version: 1 }),
      await pageService.restorePage(actor, deleted.id, { name: "old", tabId: null }),
    ]) {
      expect(result).toEqual(NOT_ALLOWED);
    }
    expect(await getTestDb().page.findMany({ orderBy: { name: "asc" } })).toStrictEqual(before);
  });

  it("reads through MCP the pages of the folder of the connection, with the lower of the two roles", async () => {
    const projects = await createFolder({ name: "projects", roles: [{ user, role: "owner" }] });
    await createPage({ folder: projects, name: "intro" });
    const notes = await createFolder({ name: "notes", roles: [{ user, role: "owner" }] });
    await createPage({ folder: notes, name: "draft" });
    const mcp = inMcp(user, { grantId: crypto.randomUUID(), folderId: projects.id, role: "reader" });

    expect((await pageService.listAllFolderPages(mcp, projects.id))?.map(({ name }) => name)).toEqual(["intro"]);
    await expect(pageService.getPage(mcp, "projects", null, "intro")).resolves.toMatchObject({
      name: "intro",
      role: "reader",
      version: 1,
    });

    // Another folder on which the user has a role reads like one that does not exist.
    await expect(pageService.listAllFolderPages(mcp, notes.id)).resolves.toBeNull();
    await expect(pageService.listFolderPages(mcp, notes.id)).resolves.toBeNull();
    await expect(pageService.getPage(mcp, "notes", null, "draft")).resolves.toBeNull();
  });

  it("reads nothing through MCP for a user without a role on the folder of the connection", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "hidden", roles: owners(bob) });
    await createPage({ folder, name: "intro" });
    const mcp = inMcp(user, { grantId: crypto.randomUUID(), folderId: folder.id, role: "reader" });

    await expect(pageService.listAllFolderPages(mcp, folder.id)).resolves.toBeNull();
    await expect(pageService.getPage(mcp, "hidden", null, "intro")).resolves.toBeNull();
  });

  it("gives an MCP connection no deleted pages, not even one of an Owner", async () => {
    const folder = await createFolder({ name: "projects", roles: [{ user, role: "owner" }] });
    const deleted = await createPage({ folder, name: "old", deletedAt: new Date() });
    const mcp = inMcp(user, { grantId: crypto.randomUUID(), folderId: folder.id, role: "writer" });

    await expect(pageService.listDeletedPages(mcp, folder.id)).resolves.toBeNull();
    await expect(pageService.getDeletedPage(mcp, "projects", deleted.id)).resolves.toBeNull();
  });
});

describe("the lowest role of each function", () => {
  it("lets a Reader read but change no page", async () => {
    const folder = await createFolder({ name: "docs", roles: [{ user, role: "reader" }] });
    const tab = await createTab({ folder });
    const page = await createPage({ folder, name: "intro" });
    const deleted = await createPage({ folder, name: "old", deletedAt: new Date() });
    const before = await getTestDb().page.findMany({ orderBy: { name: "asc" } });

    await expect(pageService.getPage(actor, "docs", null, "intro")).resolves.toMatchObject({ role: "reader" });
    for (const result of [
      await pageService.createPage(actor, folder.id, { name: "new", content: "# New", tabId: null }),
      await pageService.updatePageContent(actor, page.id, { content: "# New", version: 1 }),
      await pageService.moveOrRenamePage(actor, page.id, { name: "new", tabId: tab.id, version: 1 }),
      await pageService.deletePage(actor, page.id, { version: 1 }),
      await pageService.restorePage(actor, deleted.id, { name: "old", tabId: null }),
    ]) {
      expect(result).toEqual(NOT_ALLOWED);
    }
    expect(await getTestDb().page.findMany({ orderBy: { name: "asc" } })).toStrictEqual(before);
  });

  it("lets a Writer write pages but neither delete nor restore them, nor see the deleted pages", async () => {
    const folder = await createFolder({ name: "docs", roles: [{ user, role: "writer" }] });
    const page = await createPage({ folder, name: "intro" });
    const deleted = await createPage({ folder, name: "old", deletedAt: new Date() });

    await expect(
      pageService.updatePageContent(actor, page.id, { content: "# New", version: 1 }),
    ).resolves.toMatchObject({
      ok: true,
    });
    await expect(pageService.deletePage(actor, page.id, { version: 1 })).resolves.toEqual(NOT_ALLOWED);
    await expect(pageService.restorePage(actor, deleted.id, { name: "old", tabId: null })).resolves.toEqual(
      NOT_ALLOWED,
    );
    await expect(pageService.listDeletedPages(actor, folder.id)).resolves.toBeNull();
    await expect(pageService.getDeletedPage(actor, "docs", deleted.id)).resolves.toBeNull();
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).deletedAt).toBeNull();
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: deleted.id } })).deletedAt).not.toBeNull();
  });

  it("lets a Manager delete, see and restore pages", async () => {
    const folder = await createFolder({ name: "docs", roles: [{ user, role: "manager" }] });
    const page = await createPage({ folder, name: "intro" });

    await expect(pageService.deletePage(actor, page.id, { version: 1 })).resolves.toMatchObject({ ok: true });
    await expect(pageService.listDeletedPages(actor, folder.id)).resolves.toMatchObject([{ id: page.id }]);
    await expect(pageService.getDeletedPage(actor, "docs", page.id)).resolves.toMatchObject({ id: page.id });
    await expect(pageService.restorePage(actor, page.id, { name: "intro", tabId: null })).resolves.toMatchObject({
      ok: true,
    });
  });
});
