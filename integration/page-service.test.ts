// Runs the page service against the test database, to check its reads and writes on real data.
import { beforeEach, describe, expect, it } from "vitest";

import * as folderService from "@/features/folders/service";
import { CONTENT_MAX_LENGTH, CONTENT_MAX_TABLE_CELLS } from "@/features/pages/limits";
import { CONTENT_TABLE_CELLS_MESSAGE } from "@/features/pages/schema";
import * as historyService from "@/features/pages/history-service";
import * as pageService from "@/features/pages/service";
import { inBrowser, type BrowserActor } from "@/features/folder-roles/actors";
import type { Page, User } from "@/generated/prisma/client";

import {
  createFile,
  createFolder,
  createPage,
  createRevisions,
  createTab,
  createUser,
  getTestDb,
} from "../e2e/support/database";
import { KNOWN_USER } from "../prisma/known-users";
import { createBob, NOT_ALLOWED, owners, revisionsOf, storedPage, UNKNOWN_ACTOR, mcpActorOf } from "./helpers";

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

/** The id of the last editor of the page with the given id. */
async function lastEditorOf(pageId: string): Promise<string> {
  return (await storedPage(pageId)).lastEditedById;
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
      lastEditedBy: { name: "alice", via: "web" },
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
      lastEditedBy: { name: "alice", via: "web" },
      version: 1,
      folder: { id: folder.id, name: "docs" },
      tab: null,
      role: "owner",
    });
  });

  it("returns exactly the declared fields of a deleted page", async () => {
    const folder = await createFolder({ name: "docs" });
    const deletedAt = new Date("2026-11-03T10:00:00Z");
    const page = await createPage({ folder, name: "intro", content: "# Intro", deletedAt, editor: user, via: "mcp" });

    await expect(pageService.getDeletedPage(actor, "docs", page.id)).resolves.toStrictEqual({
      id: page.id,
      name: "intro",
      title: "Intro",
      content: "# Intro",
      deletedAt,
      lastEditedBy: { name: "alice", via: "mcp" },
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
      value: { id: stored.id, name: "intro", title: "Intro", version: 1, folder: { name: "docs" }, tab: null },
    });
  });

  it("stores a page in a tab and returns it as stored", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });

    const result = await pageService.createPage(actor, folder.id, { name: "intro", content: "# Intro", tabId: tab.id });

    const stored = await getTestDb().page.findFirstOrThrow({ where: { tabId: tab.id } });
    expect(result).toStrictEqual({
      ok: true,
      value: {
        id: stored.id,
        name: "intro",
        title: "Intro",
        version: 1,
        folder: { name: "docs" },
        tab: { name: "guides" },
      },
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
    ).resolves.toEqual({ ok: false, error: { code: "name-taken", name: "direct" } });
    await expect(
      pageService.createPage(actor, folder.id, { name: "in-tab", content: "# Intro", tabId: tab.id }),
    ).resolves.toEqual({ ok: false, error: { code: "name-taken", name: "in-tab" } });
    expect(await getTestDb().page.count()).toBe(2);
  });

  it("stores a page without a name under the name derived from its title", async () => {
    const folder = await createFolder({ name: "docs" });

    const result = await pageService.createPage(actor, folder.id, { content: "# Release Notes", tabId: null });

    const stored = await getTestDb().page.findFirstOrThrow({ where: { folderId: folder.id } });
    expect(stored).toMatchObject({ name: "release-notes", title: "Release Notes" });
    expect(result).toStrictEqual({
      ok: true,
      value: {
        id: stored.id,
        name: "release-notes",
        title: "Release Notes",
        version: 1,
        folder: { name: "docs" },
        tab: null,
      },
    });
  });

  it("returns no-suggested-name for a title that suggests no name, and stores nothing", async () => {
    const folder = await createFolder();

    await expect(pageService.createPage(actor, folder.id, { content: "# 日本語", tabId: null })).resolves.toEqual({
      ok: false,
      error: { code: "no-suggested-name" },
    });
    expect(await getTestDb().page.count()).toBe(0);
    expect(await getTestDb().pageRevision.count()).toBe(0);
  });

  it("returns name-taken with the derived name, and stores nothing", async () => {
    const folder = await createFolder();
    await createPage({ folder, name: "intro" });

    await expect(pageService.createPage(actor, folder.id, { content: "# Intro", tabId: null })).resolves.toEqual({
      ok: false,
      error: { code: "name-taken", name: "intro" },
    });
    expect(await getTestDb().page.count()).toBe(1);
  });

  it("refuses a user without a role before the content is looked at, also without a name", async () => {
    const bob = await createBob();
    const folder = await createFolder({ roles: [{ user: bob, role: "owner" }] });

    await expect(
      pageService.createPage(actor, folder.id, { content: "No title heading", tabId: null }),
    ).resolves.toEqual(NOT_ALLOWED);
    await expect(pageService.createPage(actor, folder.id, { content: "# 日本語", tabId: null })).resolves.toEqual(
      NOT_ALLOWED,
    );
    expect(await getTestDb().page.count()).toBe(0);
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
      value: {
        id: page.id,
        name: "intro",
        title: "New title",
        version: 2,
        folder: { name: "docs" },
        tab: { name: "guides" },
      },
    });

    expect(await storedPage(page.id)).toMatchObject({
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
    expect((await storedPage(page.id)).content).toBe("# Old");
  });

  it("stores the content only if the page has the version given", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "intro", content: "# Old", version: 3 });

    await expect(
      pageService.updatePageContent(actor, page.id, { content: "# New", version: 3 }),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(await storedPage(page.id)).toMatchObject({
      content: "# New",
      version: 4,
    });
  });

  // A save based on an older version, or on none, changes nothing.
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
        page: {
          id: page.id,
          name: "intro",
          title: "Old",
          version: 3,
          folder: { name: "docs" },
          tab: { name: "guides" },
        },
      },
    });
    expect(await storedPage(page.id)).toStrictEqual(page);
  });

  // A rename counts as a change, and the refusal names the page with its new name.
  it("refuses a save based on the version from before a rename, with the new name", async () => {
    const bob = await createBob();
    const folder = await createFolder({ name: "docs", roles: owners(user, bob) });
    const page = await createPage({ folder, name: "intro", content: "# Old" });

    await expect(
      pageService.moveOrRenamePage(inBrowser(bob), page.id, { name: "start", tabId: null, version: 1 }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      pageService.updatePageContent(actor, page.id, { content: "# New", version: 1 }),
    ).resolves.toStrictEqual({
      ok: false,
      error: {
        code: "page-changed",
        page: { id: page.id, name: "start", title: "Old", version: 2, folder: { name: "docs" }, tab: null },
      },
    });
    expect((await storedPage(page.id)).content).toBe("# Old");
  });

  // A page deleted after the editor was opened is missing, whatever the version.
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
      value: {
        id: page.id,
        name: "intro",
        title: "Intro",
        version: 2,
        folder: { name: "docs" },
        tab: { name: "guides" },
        updatedPages: [],
      },
    });
    expect(await storedPage(page.id)).toMatchObject({
      name: "intro",
      tabId: tab.id,
    });

    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "start", tabId: null, version: 2 }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        id: page.id,
        name: "start",
        title: "Intro",
        version: 3,
        folder: { name: "docs" },
        tab: null,
        updatedPages: [],
      },
    });
    // The content is not touched by a move or rename.
    expect(await storedPage(page.id)).toMatchObject({
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
    expect((await storedPage(page.id)).tabId).toBeNull();
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
    expect(await storedPage(page.id)).toMatchObject({
      name: "start",
      version: 4,
    });
  });

  // A move to the name and place the page has stores nothing, also with spaces around the name.
  it.each([
    ["in a tab", true, "intro"],
    ["directly in the folder", false, "intro"],
    ["with spaces around the name", true, " intro "],
  ])("stores nothing for the name and place the page has, %s", async (_name, inTab, name) => {
    const bob = await createBob();
    const folder = await createFolder({ name: "docs", roles: owners(user, bob) });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({
      ...(inTab ? { tab } : { folder }),
      name: "intro",
      editor: bob,
      via: "mcp",
      version: 3,
      updatedAt: new Date("2026-01-02T03:04:05Z"),
    });

    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name, tabId: inTab ? tab.id : null, version: 3 }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        id: page.id,
        name: "intro",
        title: page.title,
        version: 3,
        folder: { name: "docs" },
        tab: inTab ? { name: "guides" } : null,
        updatedPages: [],
      },
    });
    expect(await storedPage(page.id)).toStrictEqual(page);
    expect(await getTestDb().pageRevision.count({ where: { pageId: page.id } })).toBe(1);
  });

  // A content save based on the version read before the unchanged move is not refused.
  it("keeps the version for a content save based on the version from before an unchanged move", async () => {
    const bob = await createBob();
    const folder = await createFolder({ name: "docs", roles: owners(user, bob) });
    const page = await createPage({ folder, name: "intro", content: "# Old" });

    await expect(
      pageService.moveOrRenamePage(inBrowser(bob), page.id, { name: "intro", tabId: null, version: 1 }),
    ).resolves.toMatchObject({ ok: true, value: { version: 1 } });
    await expect(
      pageService.updatePageContent(actor, page.id, { content: "# New", version: 1 }),
    ).resolves.toMatchObject({ ok: true, value: { version: 2 } });
    expect(await storedPage(page.id)).toMatchObject({
      content: "# New",
      lastEditedById: user.id,
    });
  });

  // An unchanged move based on an older version is refused like every other move.
  it("refuses a move to the name and place the page has, based on an older version, as page-changed", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "intro", version: 3 });

    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "intro", tabId: null, version: 2 }),
    ).resolves.toStrictEqual({
      ok: false,
      error: {
        code: "page-changed",
        page: { id: page.id, name: "intro", title: "Test page", version: 3, folder: { name: "docs" }, tab: null },
      },
    });
    expect(await storedPage(page.id)).toStrictEqual(page);
  });

  it("stores a move that changes only the name or only the place and counts the version up", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ tab, name: "intro", version: 3 });

    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "start", tabId: tab.id, version: 3 }),
    ).resolves.toMatchObject({ ok: true, value: { name: "start", version: 4, tab: { name: "guides" } } });
    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "start", tabId: null, version: 4 }),
    ).resolves.toMatchObject({ ok: true, value: { name: "start", version: 5, tab: null } });
    expect(await lastEditorOf(page.id)).toBe(user.id);
  });

  // A move based on an older version, or on none, changes nothing.
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
      error: {
        code: "page-changed",
        page: { id: page.id, name: "intro", title: "Test page", version: 3, folder: { name: "docs" }, tab: null },
      },
    });
    expect(await storedPage(page.id)).toStrictEqual(page);
  });

  // A content save counts as a change.
  it("refuses a move based on the version from before a content save", async () => {
    const bob = await createBob();
    const folder = await createFolder({ name: "docs", roles: owners(user, bob) });
    const page = await createPage({ folder, name: "intro" });

    await expect(
      pageService.updatePageContent(inBrowser(bob), page.id, { content: "# New", version: 1 }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "start", tabId: null, version: 1 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "page-changed", page: { name: "intro" } } });
    expect((await storedPage(page.id)).name).toBe("intro");
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
    expect(await storedPage(page.id)).toStrictEqual(page);
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

    const stored = await storedPage(page.id);
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

  it("lets a page be created under the name and in the place of a deleted page, which stays deleted", async () => {
    const folder = await createFolder();
    const tab = await createTab({ folder });
    const inTab = await createPage({ tab, name: "intro" });
    const direct = await createPage({ folder, name: "intro" });
    await pageService.deletePage(actor, inTab.id, { version: 1 });
    await pageService.deletePage(actor, direct.id, { version: 1 });

    for (const tabId of [tab.id, null]) {
      const created = await pageService.createPage(actor, folder.id, { name: "intro", content: "# New", tabId });
      expect(created).toMatchObject({ ok: true, value: { name: "intro" } });
    }
    expect((await storedPage(inTab.id)).deletedAt).toBeInstanceOf(Date);
    expect((await storedPage(direct.id)).deletedAt).toBeInstanceOf(Date);
    expect(await pageService.listAllFolderPages(actor, folder.id)).toHaveLength(2);
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
    const stored = await storedPage(page.id);
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.version).toBe(4);
  });

  // A delete based on an older version, or on none, deletes nothing.
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
        page: {
          id: page.id,
          name: "intro",
          title: "Test page",
          version: 3,
          folder: { name: "docs" },
          tab: { name: "guides" },
        },
      },
    });
    expect(await storedPage(page.id)).toStrictEqual(page);
  });

  // A page deleted after the dialog was opened is missing, as before.
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
      value: { id: direct.id, name: "first", title: "Test page", version: 2, folder: { name: "docs" }, tab: null },
    });
    await expect(pageService.restorePage(actor, inTab.id, { name: "renamed", tabId: tab.id })).resolves.toStrictEqual({
      ok: true,
      value: {
        id: inTab.id,
        name: "renamed",
        title: "Test page",
        version: 2,
        folder: { name: "docs" },
        tab: { name: "guides" },
      },
    });

    expect(await storedPage(direct.id)).toMatchObject({
      deletedAt: null,
      tabId: null,
    });
    expect(await storedPage(inTab.id)).toMatchObject({
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
    expect((await storedPage(page.id)).deletedAt).not.toBeNull();
  });

  it("returns tab-not-found for a tab of another folder", async () => {
    const page = await createPage({ deletedAt: new Date() });
    const foreignTab = await createTab();

    await expect(pageService.restorePage(actor, page.id, { name: "intro", tabId: foreignTab.id })).resolves.toEqual(
      TAB_NOT_FOUND,
    );
  });

  // Restoring is not checked against a change in the meantime; it counts the version up like every write.
  it("needs no version and counts the version up", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "old", deletedAt: new Date(), version: 5 });

    await expect(pageService.restorePage(actor, page.id, { name: "old", tabId: null })).resolves.toMatchObject({
      ok: true,
    });
    expect((await storedPage(page.id)).version).toBe(6);
  });

  it("returns page-not-found for a page that is not deleted", async () => {
    const page = await createPage({ name: "intro" });

    await expect(pageService.restorePage(actor, page.id, { name: "other", tabId: null })).resolves.toEqual(
      PAGE_NOT_FOUND,
    );
    expect((await storedPage(page.id)).name).toBe("intro");
  });
});

// The content is neither validated nor touched by these writes (pages.md, "Content and title"), so a page stored before
// a limit keeps all of them.
describe("a page whose stored content breaks a limit now", () => {
  it.each([
    ["the length limit", `# Intro\n\n${"x".repeat(CONTENT_MAX_LENGTH)}`],
    ["the table cell limit", `# Intro\n\n| a |\n| - |\n${"| x |\n".repeat(CONTENT_MAX_TABLE_CELLS)}`],
  ])("is moved, renamed, deleted and restored past %s, with its content as it is", async (_name, content) => {
    const folder = await createFolder({ name: "docs", roles: owners(user) });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ folder, name: "intro", content, editor: user });

    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "intro", tabId: tab.id, version: 1 }),
    ).resolves.toMatchObject({ ok: true, value: { tab: { name: "guides" }, version: 2 } });
    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "start", tabId: tab.id, version: 2 }),
    ).resolves.toMatchObject({ ok: true, value: { name: "start", version: 3 } });
    await expect(pageService.deletePage(actor, page.id, { version: 3 })).resolves.toMatchObject({ ok: true });
    await expect(pageService.restorePage(actor, page.id, { name: "start", tabId: null })).resolves.toMatchObject({
      ok: true,
      value: { name: "start", tab: null, version: 5 },
    });

    expect(await storedPage(page.id)).toMatchObject({
      content,
      deletedAt: null,
    });
  });
});

describe("the last editor of pages", () => {
  it("is the actor of each write, which replaces the one before", async () => {
    const [bob, carol] = [await createBob(), await createUser({ name: "carol" })];
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
    const bob = await createBob();
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
    const bob = await createBob();
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
  return (await storedPage(pageId)).version;
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
    const bob = await createBob();
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
    const bob = await createBob();
    const folder = await createFolder({ name: "docs", roles: owners(user, bob) });
    const page = await createPage({ folder, name: "intro", editor: user });

    await pageService.updatePageContent(inBrowser(bob), page.id, { content: "# New", version: 1 });

    await expect(pageService.getPage(actor, "docs", null, "intro")).resolves.toMatchObject({
      lastEditedBy: { name: "bob" },
    });
    expect((await pageService.listFolderPages(actor, folder.id))?.[0]?.lastEditedBy).toEqual({
      name: "bob",
      via: "web",
    });
  });

  it("is the user who deleted the page in the deleted pages and the deleted page view", async () => {
    const bob = await createBob();
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

    expect(summary?.lastEditedBy).toStrictEqual({ name: "alice", via: "web" });
  });

  it("returns the channel with the last editor in every list, the page view and the deleted pages", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    await createPage({ folder, name: "direct", editor: user, via: "mcp" });
    await createPage({ tab, name: "in-tab", editor: user });
    const deleted = await createPage({ folder, name: "old", editor: user, deletedAt: new Date(), via: "mcp" });

    const channels = (pages: { name: string; lastEditedBy: { via: string } }[]) =>
      pages.map(({ name, lastEditedBy }) => [name, lastEditedBy.via]);
    expect(channels((await pageService.listFolderPages(actor, folder.id)) ?? [])).toEqual([["direct", "mcp"]]);
    expect(channels((await pageService.listTabPages(actor, tab.id)) ?? [])).toEqual([["in-tab", "web"]]);
    expect(channels((await pageService.listAllFolderPages(actor, folder.id)) ?? [])).toEqual([
      ["direct", "mcp"],
      ["in-tab", "web"],
    ]);
    expect(channels((await pageService.listDeletedPages(actor, folder.id)) ?? [])).toEqual([["old", "mcp"]]);
    await expect(pageService.getPage(actor, "docs", null, "direct")).resolves.toMatchObject({
      lastEditedBy: { name: "alice", via: "mcp" },
    });
    await expect(pageService.getDeletedPage(actor, "docs", deleted.id)).resolves.toMatchObject({
      lastEditedBy: { name: "alice", via: "mcp" },
    });
  });
});

describe("the channel of pages", () => {
  /** The channel of the page with the given id, as stored. */
  async function channelOf(pageId: string) {
    return (await storedPage(pageId)).lastEditedVia;
  }

  it("is the channel of the actor of each write, which replaces the one before", async () => {
    const folder = await createFolder({ roles: owners(user) });
    const tab = await createTab({ folder });
    const manager = mcpActorOf(user, folder, "manager");

    const inWeb = await pageService.createPage(actor, folder.id, { name: "web", content: "# Web", tabId: null });
    const viaMcp = await pageService.createPage(manager, folder.id, { name: "mcp", content: "# Mcp", tabId: null });
    if (!inWeb.ok || !viaMcp.ok) throw new Error("expected the pages to be created");
    const [web, mcp] = [inWeb.value.id, viaMcp.value.id];
    expect([await channelOf(web), await channelOf(mcp)]).toEqual(["web", "mcp"]);

    await pageService.updatePageContent(manager, web, { content: "# Web 2", version: 1 });
    await pageService.updatePageContent(actor, mcp, { content: "# Mcp 2", version: 1 });
    expect([await channelOf(web), await channelOf(mcp)]).toEqual(["mcp", "web"]);

    await pageService.moveOrRenamePage(actor, web, { name: "web", tabId: tab.id, version: 2 });
    await pageService.moveOrRenamePage(manager, mcp, { name: "mcp-2", tabId: null, version: 2 });
    expect([await channelOf(web), await channelOf(mcp)]).toEqual(["web", "mcp"]);

    await pageService.deletePage(manager, web, { version: 3 });
    await pageService.deletePage(actor, mcp, { version: 3 });
    expect([await channelOf(web), await channelOf(mcp)]).toEqual(["mcp", "web"]);

    // Only the browser restores; a page deleted through MCP gets web.
    await pageService.restorePage(actor, web, { name: "web", tabId: null });
    expect(await channelOf(web)).toBe("web");
  });

  it("stays as it was, with the last editor and the time, when a write is based on an older version", async () => {
    const bob = await createBob();
    const folder = await createFolder({ roles: owners(user, bob) });
    const page = await createPage({ folder, name: "intro", editor: user, via: "mcp", version: 2 });
    const before = await storedPage(page.id);

    await pageService.updatePageContent(inBrowser(bob), page.id, { content: "# New", version: 1 });
    await pageService.moveOrRenamePage(inBrowser(bob), page.id, { name: "start", tabId: null, version: 1 });
    await pageService.moveOrRenamePage(inBrowser(bob), page.id, { name: "intro", tabId: null, version: 1 });
    await pageService.deletePage(inBrowser(bob), page.id, { version: 1 });

    const after = await storedPage(page.id);
    expect([after.lastEditedVia, after.lastEditedById, after.updatedAt]).toEqual(["mcp", user.id, before.updatedAt]);
  });

  it("of the folder and the tab is not touched by creating or moving a page into the tab through MCP", async () => {
    const folder = await createFolder({ roles: owners(user) });
    const tab = await createTab({ folder });
    const page = await createPage({ folder, name: "intro" });
    const writer = mcpActorOf(user, folder, "writer");

    await expect(
      pageService.createPage(writer, folder.id, { name: "new", content: "# New", tabId: tab.id }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      pageService.moveOrRenamePage(writer, page.id, { name: "intro", tabId: tab.id, version: 1 }),
    ).resolves.toMatchObject({ ok: true });

    const storedFolder = await getTestDb().folder.findUniqueOrThrow({ where: { id: folder.id } });
    const storedTab = await getTestDb().tab.findUniqueOrThrow({ where: { id: tab.id } });
    expect([storedFolder.lastEditedVia, storedTab.lastEditedVia]).toEqual(["web", "web"]);
  });
});

describe("an admin", () => {
  it("reads no page, page list or history, not even of a page that exists, and changes nothing", async () => {
    const admin = await createUser({ name: "maria", type: "admin" });
    const folder = await createFolder({ name: "docs", editor: user });
    const tab = await createTab({ folder, name: "guides", editor: user });
    const page = await createPage({ folder, name: "intro", editor: user });
    await createRevisions({ page, count: 1 });
    const deleted = await createPage({ folder, name: "old", editor: user, deletedAt: new Date() });
    const before = await getTestDb().page.findMany({ orderBy: { name: "asc" } });
    const revisionsBefore = await getTestDb().pageRevision.findMany({
      orderBy: [{ pageId: "asc" }, { number: "asc" }],
    });

    await expect(pageService.listFolderPages(inBrowser(admin), folder.id)).resolves.toBeNull();
    await expect(pageService.listTabPages(inBrowser(admin), tab.id)).resolves.toBeNull();
    await expect(historyService.listPageRevisions(inBrowser(admin), page.id, { before: null })).resolves.toBeNull();
    await expect(historyService.getPageRevision(inBrowser(admin), page.id, 1)).resolves.toBeNull();
    await expect(historyService.getRevisionComparison(inBrowser(admin), page.id, 1, 2)).resolves.toBeNull();
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
    await expect(
      pageService.moveOrRenamePage(inBrowser(admin), page.id, { name: "moved", tabId: tab.id, version: 1 }),
    ).resolves.toEqual(notAllowed);
    await expect(pageService.deletePage(inBrowser(admin), page.id, { version: 1 })).resolves.toEqual(notAllowed);
    await expect(pageService.restorePage(inBrowser(admin), deleted.id, { name: "old", tabId: null })).resolves.toEqual(
      notAllowed,
    );
    await expect(pageService.revertPage(inBrowser(admin), page.id, { revision: 1, version: 1 })).resolves.toEqual(
      notAllowed,
    );

    expect(await getTestDb().page.findMany({ orderBy: { name: "asc" } })).toStrictEqual(before);
    expect(await getTestDb().pageRevision.findMany({ orderBy: [{ pageId: "asc" }, { number: "asc" }] })).toStrictEqual(
      revisionsBefore,
    );
  });
});

describe("roles", () => {
  it("reads no page, page list or deleted page of a folder without a role of the actor", async () => {
    const bob = await createBob();
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
    const bob = await createBob();
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

  // The role is checked before the version and the input (optimistic-locking.md, "Which changes are refused"): a
  // refusal for the role tells nothing about the stored page, not even with an old version.
  it.each([
    ["no role", null],
    ["the role Reader", "reader"],
  ] as const)(
    "refuses a user with %s before an old version and invalid input, and changes nothing",
    async (_name, role) => {
      const bob = await createBob();
      const folder = await createFolder({
        name: "hidden",
        roles: [...owners(bob), ...(role ? [{ user, role }] : [])],
      });
      const page = await createPage({ folder, name: "intro", content: "# Intro", version: 2 });
      await createRevisions({ page, count: 1 });
      const before = await getTestDb().page.findMany({ orderBy: { name: "asc" } });

      for (const result of [
        await pageService.updatePageContent(actor, page.id, { content: "No heading", version: 1 }),
        await pageService.moveOrRenamePage(actor, page.id, { name: "Not A Name", tabId: null, version: 1 }),
        await pageService.deletePage(actor, page.id, { version: 1 }),
        await pageService.revertPage(actor, page.id, { revision: 99, version: 1 }),
      ]) {
        expect(result).toEqual(NOT_ALLOWED);
      }
      expect(await getTestDb().page.findMany({ orderBy: { name: "asc" } })).toStrictEqual(before);
    },
  );

  it("reads through MCP the pages of the folder of the connection, with the lower of the two roles", async () => {
    const projects = await createFolder({ name: "projects", roles: [{ user, role: "owner" }] });
    await createPage({ folder: projects, name: "intro" });
    const notes = await createFolder({ name: "notes", roles: [{ user, role: "owner" }] });
    await createPage({ folder: notes, name: "draft" });
    const mcp = mcpActorOf(user, projects, "reader");

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
    const bob = await createBob();
    const folder = await createFolder({ name: "hidden", roles: owners(bob) });
    await createPage({ folder, name: "intro" });
    const mcp = mcpActorOf(user, folder, "reader");

    await expect(pageService.listAllFolderPages(mcp, folder.id)).resolves.toBeNull();
    await expect(pageService.getPage(mcp, "hidden", null, "intro")).resolves.toBeNull();
  });

  it("gives a Writer connection no deleted pages, not even one of an Owner", async () => {
    const folder = await createFolder({ name: "projects", roles: [{ user, role: "owner" }] });
    const deleted = await createPage({ folder, name: "old", deletedAt: new Date() });
    const mcp = mcpActorOf(user, folder, "writer");

    await expect(pageService.listDeletedPages(mcp, folder.id)).resolves.toBeNull();
    await expect(pageService.getDeletedPage(mcp, "projects", deleted.id)).resolves.toBeNull();
  });

  // No tool lists or reads deleted pages (page-deletion.md, "Deleting"); only the list of tools holds that rule, and
  // the service would answer a Manager connection.
  it("gives a Manager connection the deleted pages at the level of the service, which no tool calls", async () => {
    const folder = await createFolder({ name: "projects", roles: [{ user, role: "owner" }] });
    const deleted = await createPage({ folder, name: "old", deletedAt: new Date() });
    const mcp = mcpActorOf(user, folder, "manager");

    await expect(pageService.listDeletedPages(mcp, folder.id)).resolves.toMatchObject([{ id: deleted.id }]);
    await expect(pageService.getDeletedPage(mcp, "projects", deleted.id)).resolves.toMatchObject({ id: deleted.id });
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
    expect((await storedPage(page.id)).deletedAt).toBeNull();
    expect((await storedPage(deleted.id)).deletedAt).not.toBeNull();
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

describe("writes through MCP", () => {
  it("create, save and move pages in the folder of the connection, with the user as the last editor", async () => {
    const folder = await createFolder({ name: "projects", roles: [{ user, role: "writer" }] });
    const tab = await createTab({ folder, name: "guides" });
    const mcp = mcpActorOf(user, folder, "writer");

    const created = await pageService.createPage(mcp, folder.id, { name: "plan", content: "# Plan", tabId: null });
    if (!created.ok) throw new Error(`not created: ${created.error.code}`);
    expect(created.value).toMatchObject({ name: "plan", version: 1 });
    const saved = await pageService.updatePageContent(mcp, created.value.id, { content: "# Plan 2", version: 1 });
    expect(saved).toMatchObject({ ok: true, value: { version: 2 } });
    const moved = await pageService.moveOrRenamePage(mcp, created.value.id, {
      name: "roadmap",
      tabId: tab.id,
      version: 2,
    });
    expect(moved).toMatchObject({ ok: true, value: { name: "roadmap", tab: { name: "guides" }, version: 3 } });

    const stored = await storedPage(created.value.id);
    expect(stored).toMatchObject({ title: "Plan 2", content: "# Plan 2", lastEditedById: user.id, version: 3 });
  });

  it("give page-changed with the page as stored for a page moved meanwhile, and change nothing", async () => {
    const folder = await createFolder({ name: "projects", roles: [{ user, role: "writer" }] });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ folder, name: "plan", content: "# Plan" });
    const mcp = mcpActorOf(user, folder, "writer");
    await expect(
      pageService.moveOrRenamePage(actor, page.id, { name: "roadmap", tabId: tab.id, version: 1 }),
    ).resolves.toMatchObject({ ok: true });
    const before = await storedPage(page.id);

    await expect(pageService.updatePageContent(mcp, page.id, { content: "# Plan 2", version: 1 })).resolves.toEqual({
      ok: false,
      error: {
        code: "page-changed",
        page: {
          id: page.id,
          name: "roadmap",
          title: "Plan",
          version: 2,
          folder: { name: "projects" },
          tab: { name: "guides" },
        },
      },
    });

    expect(await storedPage(page.id)).toStrictEqual(before);
  });

  it("give not-allowed and change nothing for a Reader connection, another folder and a lowered role", async () => {
    const folder = await createFolder({ name: "projects", roles: [{ user, role: "owner" }] });
    const other = await createFolder({ name: "notes", roles: [{ user, role: "owner" }] });
    const page = await createPage({ folder, name: "plan" });
    const otherPage = await createPage({ folder: other, name: "draft" });
    const reader = mcpActorOf(user, folder, "reader");
    const writer = mcpActorOf(user, folder, "writer");
    const before = await getTestDb().page.findMany({ orderBy: { name: "asc" } });

    for (const result of [
      await pageService.createPage(reader, folder.id, { name: "new", content: "# New", tabId: null }),
      await pageService.updatePageContent(reader, page.id, { content: "# New", version: 1 }),
      await pageService.moveOrRenamePage(reader, page.id, { name: "new", tabId: null, version: 1 }),
      await pageService.createPage(writer, other.id, { name: "new", content: "# New", tabId: null }),
      await pageService.updatePageContent(writer, otherPage.id, { content: "# New", version: 1 }),
      await pageService.moveOrRenamePage(writer, otherPage.id, { name: "new", tabId: null, version: 1 }),
    ]) {
      expect(result).toEqual(NOT_ALLOWED);
    }

    await getTestDb().folderRole.update({
      where: { folderId_userId: { folderId: folder.id, userId: user.id } },
      data: { role: "reader" },
    });
    await expect(pageService.updatePageContent(writer, page.id, { content: "# New", version: 1 })).resolves.toEqual(
      NOT_ALLOWED,
    );

    expect(await getTestDb().page.findMany({ orderBy: { name: "asc" } })).toStrictEqual(before);
  });

  it("refuse a delete through a Writer connection, which keeps the page undeleted with its version", async () => {
    const folder = await createFolder({ name: "projects", roles: [{ user, role: "owner" }] });
    const page = await createPage({ folder, name: "plan", version: 3 });
    const writer = mcpActorOf(user, folder, "writer");
    const before = await storedPage(page.id);

    await expect(pageService.deletePage(writer, page.id, { version: 3 })).resolves.toEqual(NOT_ALLOWED);

    const after = await storedPage(page.id);
    expect(after).toStrictEqual(before);
    expect(after).toMatchObject({ deletedAt: null, version: 3 });
  });

  it("delete a page through a Manager connection with the user as the user who deleted it", async () => {
    const bob = await createBob();
    const folder = await createFolder({ name: "projects", roles: [{ user, role: "manager" }] });
    const page = await createPage({ folder, name: "plan", editor: bob });
    const manager = mcpActorOf(user, folder, "manager");

    await expect(pageService.deletePage(manager, page.id, { version: 1 })).resolves.toStrictEqual({
      ok: true,
      value: { folder: { name: "projects" }, tab: null },
    });

    const deleted = await pageService.listDeletedPages(inBrowser(user), folder.id);
    expect(deleted?.map(({ name, lastEditedBy }) => [name, lastEditedBy.name])).toEqual([["plan", "alice"]]);
  });

  it("refuse a delete through a Manager connection after the user was lowered to Writer, and change nothing", async () => {
    const folder = await createFolder({ name: "projects", roles: [{ user, role: "manager" }] });
    const page = await createPage({ folder, name: "plan" });
    const manager = mcpActorOf(user, folder, "manager");
    await getTestDb().folderRole.update({
      where: { folderId_userId: { folderId: folder.id, userId: user.id } },
      data: { role: "writer" },
    });
    const before = await storedPage(page.id);

    await expect(pageService.deletePage(manager, page.id, { version: 1 })).resolves.toEqual(NOT_ALLOWED);

    expect(await storedPage(page.id)).toStrictEqual(before);
  });
});

describe("the revisions of pages", () => {
  /** Expects the newest revision of the page to have the content and the title of the page. */
  async function expectNewestRevisionIsThePage(pageId: string): Promise<void> {
    const page = await storedPage(pageId);
    const revisions = await revisionsOf(pageId);
    expect(revisions.at(-1)).toMatchObject({ content: page.content, title: page.title });
  }

  // Creating and saving in the browser and through MCP.
  it("records revision 1 on creation and one per content save, with the users and the channels", async () => {
    const bob = await createBob();
    const folder = await createFolder({ roles: [...owners(user), { user: bob, role: "writer" }] });
    const viaMcp = mcpActorOf(bob, folder, "writer");

    const created = await pageService.createPage(actor, folder.id, { name: "intro", content: "# Intro", tabId: null });
    if (!created.ok) throw new Error("expected the page to be created");
    const id = created.value.id;
    await pageService.updatePageContent(actor, id, { content: "# Intro\n\nIn the browser", version: 1 });
    await pageService.updatePageContent(viaMcp, id, { content: "# Start\n\nThrough MCP", version: 2 });

    expect(await revisionsOf(id)).toEqual([
      {
        number: 1,
        title: "Intro",
        content: "# Intro",
        userId: user.id,
        via: "web",
        revertedTo: null,
        linksUpdated: false,
      },
      {
        number: 2,
        title: "Intro",
        content: "# Intro\n\nIn the browser",
        userId: user.id,
        via: "web",
        revertedTo: null,
        linksUpdated: false,
      },
      {
        number: 3,
        title: "Start",
        content: "# Start\n\nThrough MCP",
        userId: bob.id,
        via: "mcp",
        revertedTo: null,
        linksUpdated: false,
      },
    ]);
    await expectNewestRevisionIsThePage(id);
  });

  // A refused save records nothing; every stored change has its revision.
  it("leaves the revisions as they were when a save is refused for an older version or invalid content", async () => {
    const page = await createPage({ folder: await createFolder(), editor: user, content: "# Intro" });
    const before = await revisionsOf(page.id);

    await expect(
      pageService.updatePageContent(actor, page.id, { content: "# Older", version: 0 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "page-changed" } });
    await expect(
      pageService.updatePageContent(actor, page.id, { content: "No heading", version: 1 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(await revisionsOf(page.id)).toEqual(before);

    await expect(
      pageService.updatePageContent(actor, page.id, { content: "# Intro\n\nNew", version: 1 }),
    ).resolves.toMatchObject({ ok: true });
    await expectNewestRevisionIsThePage(page.id);
    await expect(
      pageService.updatePageContent(actor, page.id, { content: "# Intro\n\nOld", version: 1 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "page-changed" } });
    expect(await revisionsOf(page.id)).toHaveLength(2);
    await expectNewestRevisionIsThePage(page.id);
  });

  // A save without a change records nothing and leaves the page as it is.
  it("records no revision for a save without a change, which leaves the page as it is", async () => {
    const bob = await createBob();
    const folder = await createFolder({ roles: owners(user, bob) });
    const page = await createPage({ folder, editor: user, content: "# Intro" });

    await expect(
      pageService.updatePageContent(inBrowser(bob), page.id, { content: "# Intro", version: 1 }),
    ).resolves.toMatchObject({ ok: true, value: { version: 1 } });

    expect(await revisionsOf(page.id)).toHaveLength(1);
    expect(await lastEditorOf(page.id)).toBe(user.id);
  });

  // Moves, renames, deletes and restores are not part of the history.
  it("are not changed by moving, renaming, deleting and restoring a page, and by deleting its tab", async () => {
    const folder = await createFolder({ roles: owners(user) });
    const [tab, other] = [await createTab({ folder }), await createTab({ folder })];
    const page = await createPage({ folder, editor: user });
    await createRevisions({ page, count: 2 });
    const inTab = await createPage({ tab: other, editor: user });
    const before = await revisionsOf(page.id);

    await pageService.moveOrRenamePage(actor, page.id, { name: "moved", tabId: tab.id, version: 1 });
    await pageService.moveOrRenamePage(actor, page.id, { name: "renamed", tabId: tab.id, version: 2 });
    await pageService.deletePage(actor, page.id, { version: 3 });
    await pageService.restorePage(actor, page.id, { name: "restored", tabId: null });
    await expect(folderService.deleteTab(actor, folder.id, other.id)).resolves.toMatchObject({ ok: true });

    expect(await revisionsOf(page.id)).toEqual(before);
    expect(await revisionsOf(inTab.id)).toHaveLength(1);
  });
});

describe("a content save and its revision", () => {
  /** The page with the given id and its revisions, as stored. */
  async function snapshotOf(pageId: string) {
    const db = getTestDb();
    return {
      page: await storedPage(pageId),
      revisions: await db.pageRevision.findMany({ where: { pageId }, orderBy: { number: "asc" } }),
    };
  }

  /** Runs the given write while a trigger of the test refuses every new revision, and drops the trigger after. */
  async function whileRevisionsAreRefused<T>(write: () => Promise<T>): Promise<T> {
    const db = getTestDb();
    await db.$executeRawUnsafe(`
      CREATE FUNCTION refuse_revision() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'revision refused by the test'; END $$`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER refuse_revision BEFORE INSERT ON "PageRevision" FOR EACH ROW EXECUTE FUNCTION refuse_revision()`,
    );
    try {
      return await write();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER refuse_revision ON "PageRevision"`);
      await db.$executeRawUnsafe(`DROP FUNCTION refuse_revision()`);
    }
  }

  // The page and its revision are stored in one transaction (page-history.md, "Revisions").
  it.each([
    ["a save", (id: string) => pageService.updatePageContent(actor, id, { content: "# Intro\n\nNew", version: 1 })],
    ["a revert", (id: string) => pageService.revertPage(actor, id, { revision: 1, version: 1 })],
  ])("%s stores nothing when its revision cannot be stored", async (_name, write) => {
    const page = await createPage({ folder: await createFolder({ roles: owners(user) }), editor: user });
    await createRevisions({ page, count: 1 });
    const before = await snapshotOf(page.id);

    await expect(whileRevisionsAreRefused(() => write(page.id))).resolves.toEqual({
      ok: false,
      error: { code: "failed" },
    });

    expect(await snapshotOf(page.id)).toStrictEqual(before);
  });

  /**
   * The writes of a page with a version, each based on version 1 of a page named `intro` with the revisions 1 and 2,
   * whether the page as stored is the one the write stored, and whether the write records a revision.
   */
  const WRITES = {
    save: {
      write: (id: string, n: number) =>
        pageService.updatePageContent(actor, id, { content: `# Intro\n\nSave ${n}`, version: 1 }),
      stored: (page: Page, n: number) => page.content === `# Intro\n\nSave ${n}`,
      recordsRevision: true,
    },
    revert: {
      write: (id: string) => pageService.revertPage(actor, id, { revision: 1, version: 1 }),
      stored: (page: Page) => page.content === "# Intro",
      recordsRevision: true,
    },
    move: {
      write: (id: string, n: number) =>
        pageService.moveOrRenamePage(actor, id, { name: `moved-${n}`, tabId: null, version: 1 }),
      stored: (page: Page, n: number) => page.name === `moved-${n}`,
      recordsRevision: false,
    },
    delete: {
      write: (id: string) => pageService.deletePage(actor, id, { version: 1 }),
      stored: (page: Page) => page.deletedAt !== null,
      recordsRevision: false,
    },
  } as const;
  type Kind = keyof typeof WRITES;
  const KINDS = Object.keys(WRITES) as Kind[];
  const PAIRS = KINDS.flatMap((first, index) => KINDS.slice(index).map((second) => [first, second] as const));

  // Of two writes with the same version, exactly one is stored (optimistic-locking.md, "Which changes are refused").
  // The other is page-changed, or page-not-found when the one stored deleted the page.
  it.each(PAIRS)("of a %s and a %s at the same time with the same version, exactly one wins", async (first, second) => {
    const page = await createPage({
      folder: await createFolder({ roles: owners(user) }),
      editor: user,
      name: "intro",
      content: "# Intro",
    });
    await createRevisions({ page, count: 1 });

    const results = await Promise.all([WRITES[first].write(page.id, 1), WRITES[second].write(page.id, 2)]);

    const winners = results.flatMap((result, index) => (result.ok ? [index] : []));
    expect(winners).toHaveLength(1);
    const winner = winners[0] === 0 ? { kind: first, n: 1 } : { kind: second, n: 2 };
    expect(results[winners[0] === 0 ? 1 : 0]).toMatchObject({
      ok: false,
      error: { code: winner.kind === "delete" ? "page-not-found" : "page-changed" },
    });
    const { page: stored, revisions } = await snapshotOf(page.id);
    expect(stored.version).toBe(2);
    expect(WRITES[winner.kind].stored(stored, winner.n)).toBe(true);
    if (WRITES[winner.kind].recordsRevision) {
      expect(revisions.map(({ number }) => number)).toEqual([1, 2, 3]);
      expect(revisions.at(-1)).toMatchObject({ content: stored.content, title: stored.title });
    } else {
      expect(revisions.map(({ number }) => number)).toEqual([1, 2]);
    }
  });

  it("of two restores at the same time, exactly one wins; the other finds no deleted page", async () => {
    const page = await createPage({ folder: await createFolder({ roles: owners(user) }), deletedAt: new Date() });

    const results = await Promise.all([
      pageService.restorePage(actor, page.id, { name: "first", tabId: null }),
      pageService.restorePage(actor, page.id, { name: "second", tabId: null }),
    ]);

    const restored = results.flatMap((result) => (result.ok ? [result.value] : []));
    expect(restored).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: { code: "page-not-found" } }]);
    expect(await storedPage(page.id)).toMatchObject({
      deletedAt: null,
      version: 2,
      name: restored[0]?.name,
    });
  });
});

describe("reverting a page", () => {
  /** A page of the actor with four revisions, whose content is that of revision 4, at version 1. */
  async function pageWithFourRevisions() {
    const page = await createPage({ folder: await createFolder(), editor: user, content: "# Intro\n\nOne" });
    await createRevisions({ page, count: 3, content: (number) => `# Intro\n\nRevision ${number}` });
    return page;
  }

  it("records a new revision with the content of the chosen one, the reverting user, web and its mark", async () => {
    const bob = await createBob();
    const page = await createPage({
      folder: await createFolder({ roles: owners(user, bob) }),
      editor: user,
      via: "mcp",
      content: "# Intro\n\nOne",
    });
    await createRevisions({ page, count: 3, content: (number) => `# Start\n\nRevision ${number}`, via: "mcp" });

    const result = await pageService.revertPage(inBrowser(bob), page.id, { revision: 2, version: 1 });

    expect(result).toMatchObject({ ok: true, value: { id: page.id, version: 2 } });
    const revisions = await getTestDb().pageRevision.findMany({
      where: { pageId: page.id },
      orderBy: { number: "asc" },
    });
    expect(revisions).toHaveLength(5);
    expect(revisions[4]).toMatchObject({
      number: 5,
      title: "Start",
      content: "# Start\n\nRevision 2",
      userId: bob.id,
      via: "web",
      revertedTo: 2,
      linksUpdated: false,
    });
    const stored = await storedPage(page.id);
    expect(stored).toMatchObject({
      content: "# Start\n\nRevision 2",
      title: "Start",
      lastEditedById: bob.id,
      lastEditedVia: "web",
      version: 2,
    });
  });

  it("changes nothing when it is based on an older version", async () => {
    const page = await pageWithFourRevisions();
    await getTestDb().page.update({ where: { id: page.id }, data: { version: 2 } });

    await expect(pageService.revertPage(actor, page.id, { revision: 2, version: 1 })).resolves.toMatchObject({
      ok: false,
      error: { code: "page-changed" },
    });

    expect(await getTestDb().pageRevision.count({ where: { pageId: page.id } })).toBe(4);
    const stored = await storedPage(page.id);
    expect([stored.content, stored.version]).toEqual(["# Intro\n\nRevision 4", 2]);
  });

  it("refuses a revision past the table cell limit and changes nothing", async () => {
    const page = await pageWithFourRevisions();
    const table = `# Intro\n\n| a |\n| - |\n${"| x |\n".repeat(CONTENT_MAX_TABLE_CELLS)}`;
    await getTestDb().pageRevision.update({
      where: { pageId_number: { pageId: page.id, number: 2 } },
      data: { content: table },
    });

    await expect(pageService.revertPage(actor, page.id, { revision: 2, version: 1 })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-input", fieldErrors: { content: [CONTENT_TABLE_CELLS_MESSAGE] } },
    });

    expect(await getTestDb().pageRevision.count({ where: { pageId: page.id } })).toBe(4);
    const stored = await storedPage(page.id);
    expect([stored.content, stored.version]).toEqual(["# Intro\n\nRevision 4", 1]);
  });

  it("gives revision-not-found for the newest revision, one with the content of the page and one that does not exist", async () => {
    const page = await pageWithFourRevisions();
    await createRevisions({ page, count: 1, content: () => "# Intro\n\nRevision 3" });

    for (const revision of [5, 3, 6]) {
      await expect(pageService.revertPage(actor, page.id, { revision, version: 1 })).resolves.toEqual({
        ok: false,
        error: { code: "revision-not-found" },
      });
    }
  });

  it("is allowed for a Writer", async () => {
    const writer = await createUser({ name: "writer" });
    const page = await createPage({
      folder: await createFolder({ roles: [...owners(user), { user: writer, role: "writer" }] }),
      editor: user,
      content: "# Intro\n\nOne",
    });
    await createRevisions({ page, count: 1 });

    await expect(
      pageService.revertPage(inBrowser(writer), page.id, { revision: 1, version: 1 }),
    ).resolves.toMatchObject({
      ok: true,
      value: { id: page.id, version: 2 },
    });
    expect(await storedPage(page.id)).toMatchObject({
      content: "# Intro\n\nOne",
      lastEditedById: writer.id,
    });
  });

  it("is not allowed for a Reader and gives page-not-found for a deleted page", async () => {
    const reader = await createUser({ name: "reader" });
    const folder = await createFolder({ roles: [...owners(user), { user: reader, role: "reader" }] });
    const page = await createPage({ folder, editor: user, content: "# Intro" });
    await createRevisions({ page, count: 1 });
    const deleted = await createPage({ folder, editor: user, content: "# Gone", deletedAt: new Date() });
    await createRevisions({ page: deleted, count: 1 });

    await expect(pageService.revertPage(inBrowser(reader), page.id, { revision: 1, version: 1 })).resolves.toEqual(
      NOT_ALLOWED,
    );
    await expect(pageService.revertPage(actor, deleted.id, { revision: 1, version: 1 })).resolves.toEqual({
      ok: false,
      error: { code: "page-not-found" },
    });
  });
});

describe("content saves without a change", () => {
  const CONTENT = "# Intro\n\nFirst line\nSecond line";
  /** When the page was last changed: an hour ago, so that a new write would show. */
  const UPDATED_AT = new Date(Date.now() - 60 * 60 * 1000);

  /** The fields of the page that a save without a change must leave as they are. */
  async function stateOf(pageId: string) {
    const { lastEditedById, lastEditedVia, updatedAt, version, content, title } = await storedPage(pageId);
    return { lastEditedById, lastEditedVia, updatedAt, version, content, title };
  }

  /** Bob, who saves; a folder with Owner roles of alice and bob; a page last changed by alice via mcp. */
  async function setUp(data: { content?: string; title?: string; version?: number; deletedAt?: Date } = {}) {
    const bob = await createBob();
    const folder = await createFolder({ roles: owners(user, bob) });
    const page = await createPage({
      folder,
      editor: user,
      via: "mcp",
      content: CONTENT,
      updatedAt: UPDATED_AT,
      version: 3,
      ...data,
    });
    return { bob: inBrowser(bob), bobId: bob.id, page };
  }

  // The page keeps its last editor, channel, time and version, and its revisions.
  it("leaves the page and its revisions as they are, and returns the page with its version", async () => {
    const { bob, page } = await setUp();
    const before = { page: await stateOf(page.id), revisions: await revisionsOf(page.id) };

    await expect(pageService.updatePageContent(bob, page.id, { content: CONTENT, version: 3 })).resolves.toEqual({
      ok: true,
      value: { id: page.id, name: page.name, title: page.title, version: 3, folder: expect.anything(), tab: null },
    });

    expect(await stateOf(page.id)).toEqual(before.page);
    expect(await revisionsOf(page.id)).toEqual(before.revisions);
    expect(before.page).toMatchObject({ lastEditedById: user.id, lastEditedVia: "mcp", updatedAt: UPDATED_AT });
  });

  it("keeps the stored title, also one that the content would not give", async () => {
    const { bob, page } = await setUp({ title: "Stored title" });
    const before = await stateOf(page.id);

    await expect(pageService.updatePageContent(bob, page.id, { content: CONTENT, version: 3 })).resolves.toMatchObject({
      ok: true,
      value: { version: 3 },
    });

    expect(before.title).toBe("Stored title");
    expect(await stateOf(page.id)).toEqual(before);
  });

  // The line endings are made uniform first; any other difference is a change.
  it("counts content with other line endings as the same, and one more space as a change", async () => {
    const { bob, page } = await setUp();
    const before = { page: await stateOf(page.id), revisions: await revisionsOf(page.id) };

    await pageService.updatePageContent(bob, page.id, { content: CONTENT.replaceAll("\n", "\r\n"), version: 3 });
    expect(await stateOf(page.id)).toEqual(before.page);
    expect(await revisionsOf(page.id)).toEqual(before.revisions);

    const changed = CONTENT.replace("First line", "First line ");
    await expect(pageService.updatePageContent(bob, page.id, { content: changed, version: 3 })).resolves.toMatchObject({
      ok: true,
      value: { version: 4 },
    });
    expect(await stateOf(page.id)).toMatchObject({ content: changed, version: 4, lastEditedVia: "web" });
    expect((await revisionsOf(page.id)).map(({ number, content }) => [number, content])).toEqual([
      [1, CONTENT],
      [2, changed],
    ]);
  });

  // The version is checked like for every save, also when the content is the same.
  it.each([1, 2, 4, null])("refuses the stored content based on the version %j as page-changed", async (version) => {
    const { bob, page } = await setUp();
    const before = { page: await stateOf(page.id), revisions: await revisionsOf(page.id) };

    await expect(pageService.updatePageContent(bob, page.id, { content: CONTENT, version })).resolves.toMatchObject({
      ok: false,
      error: { code: "page-changed", page: { id: page.id, version: 3 } },
    });

    expect(await stateOf(page.id)).toEqual(before.page);
    expect(await revisionsOf(page.id)).toEqual(before.revisions);
  });

  it("refuses the stored content of a deleted page as page-not-found", async () => {
    const { bob, page } = await setUp({ deletedAt: new Date() });
    const before = await stateOf(page.id);

    await expect(pageService.updatePageContent(bob, page.id, { content: CONTENT, version: 3 })).resolves.toEqual({
      ok: false,
      error: { code: "page-not-found" },
    });
    expect(await stateOf(page.id)).toEqual(before);
  });

  // The limits in force are checked also for the stored content.
  it("refuses stored content over the length limit as invalid-input and leaves the page as it is", async () => {
    const content = `# Big\n\n${"x".repeat(CONTENT_MAX_LENGTH)}`;
    const { bob, page } = await setUp({ content });
    const before = await stateOf(page.id);

    await expect(pageService.updatePageContent(bob, page.id, { content, version: 3 })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-input", fieldErrors: { content: [expect.any(String)] } },
    });
    expect(await stateOf(page.id)).toEqual(before);
  });

  // The scenario of Anna and Bob: an empty save based on an old version is refused; a change after an empty save is not.
  it("refuses the same content after a stored change, and stores a change after a save without a change", async () => {
    const { bob, bobId, page } = await setUp();
    const anna = actor;

    // Anna's change is stored; Bob's empty save, based on the version before it, is refused.
    await expect(
      pageService.updatePageContent(anna, page.id, { content: `${CONTENT}\nThird line`, version: 3 }),
    ).resolves.toMatchObject({ ok: true, value: { version: 4 } });
    await expect(pageService.updatePageContent(bob, page.id, { content: CONTENT, version: 3 })).resolves.toMatchObject({
      ok: false,
      error: { code: "page-changed" },
    });

    // Anna saves without a change; Bob's change, based on the same version, is stored.
    await expect(
      pageService.updatePageContent(anna, page.id, { content: `${CONTENT}\nThird line`, version: 4 }),
    ).resolves.toMatchObject({ ok: true, value: { version: 4 } });
    await expect(
      pageService.updatePageContent(bob, page.id, { content: `${CONTENT}\nBob's line`, version: 4 }),
    ).resolves.toMatchObject({ ok: true, value: { version: 5 } });

    expect(await stateOf(page.id)).toMatchObject({ content: `${CONTENT}\nBob's line`, lastEditedById: bobId });
    expect((await revisionsOf(page.id)).map(({ number }) => number)).toEqual([1, 2, 3]);
  });
});

describe("the resolution of wiki links", () => {
  it("resolves [[setup]] to the page directly in the folder and [[guides/setup]] to the page in the tab", async () => {
    const folder = await createFolder();
    const guides = await createTab({ folder, name: "guides" });
    await createPage({ folder, name: "setup", content: "# Setup" });
    await createPage({ tab: guides, name: "setup", content: "# Setup guide" });
    await createTab({ folder, name: "empty" });

    expect(
      await pageService.resolveWikiLinks(
        actor,
        folder.id,
        "[[setup]] [[guides/setup]] [[empty/setup]] [[faq]] [[x/y]]",
      ),
    ).toEqual({
      titles: new Map([
        ["setup", "Setup"],
        ["guides/setup", "Setup guide"],
      ]),
      files: new Map(),
      tabs: new Set(["guides", "empty"]),
    });
  });

  it("resolves the targets of files to the type, width and height of their current version, and no deleted file", async () => {
    const folder = await createFolder();
    const guides = await createTab({ folder, name: "guides" });
    await createFile({
      tab: guides,
      name: "diagram.png",
      versions: [
        { width: 10, height: 20 },
        { width: 30, height: 40 },
      ],
    });
    await createFile({ folder, name: "report.pdf" });
    await createFile({ folder, name: "gone.png", deletedAt: new Date() });
    // A page of the name without the extension is no file.
    await createPage({ tab: guides, name: "diagram", content: "# Diagram page" });

    expect(
      await pageService.resolveWikiLinks(
        actor,
        folder.id,
        "![[guides/diagram.png]] [[report.pdf]] [[gone.png]] [[diagram.png]] [[guides/report.pdf]]",
      ),
    ).toEqual({
      titles: new Map(),
      files: new Map([
        ["guides/diagram.png", { type: "png", width: 30, height: 40 }],
        ["report.pdf", { type: "pdf", width: null, height: null }],
      ]),
      tabs: new Set(["guides"]),
    });
  });

  it("finds nothing of another folder", async () => {
    const folder = await createFolder();
    const other = await createFolder({ roles: owners(user) });
    await createPage({ folder: other, name: "setup", content: "# Elsewhere" });
    await createTab({ folder: other, name: "guides" });

    await createFile({ folder: other, name: "diagram.png" });

    expect(await pageService.resolveWikiLinks(actor, folder.id, "[[setup]] [[guides/setup]] ![[diagram.png]]")).toEqual(
      { titles: new Map(), files: new Map(), tabs: new Set() },
    );
  });

  it("finds no deleted page and no deleted tab, and a restored page again", async () => {
    const folder = await createFolder();
    const guides = await createTab({ folder, name: "guides" });
    const setup = await createPage({ tab: guides, name: "setup", content: "# Setup guide" });
    const direct = await createPage({ folder, name: "faq", content: "# FAQ" });
    const links = "[[guides/setup]] [[faq]]";

    await pageService.deletePage(actor, direct.id, { version: direct.version });
    await folderService.deleteTab(actor, folder.id, guides.id);
    expect(await pageService.resolveWikiLinks(actor, folder.id, links)).toEqual({
      titles: new Map(),
      files: new Map(),
      tabs: new Set(),
    });

    await pageService.restorePage(actor, direct.id, { name: "faq", tabId: null });
    const docs = await createTab({ folder, name: "guides" });
    await pageService.restorePage(actor, setup.id, { name: "setup", tabId: docs.id });
    expect(await pageService.resolveWikiLinks(actor, folder.id, links)).toEqual({
      titles: new Map([
        ["guides/setup", "Setup guide"],
        ["faq", "FAQ"],
      ]),
      files: new Map(),
      tabs: new Set(["guides"]),
    });
  });

  it("returns null for a user without a role and for an admin", async () => {
    const folder = await createFolder();
    const bob = await createBob();
    const admin = await createUser({ type: "admin" });

    expect(await pageService.resolveWikiLinks(inBrowser(bob), folder.id, "[[setup]]")).toBeNull();
    expect(await pageService.resolveWikiLinks(inBrowser(admin), folder.id, "[[setup]]")).toBeNull();
  });
});
