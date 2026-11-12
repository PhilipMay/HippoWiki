// Runs the page service against the test database, to check its reads and writes on real data.
import { describe, expect, it } from "vitest";

import * as pageService from "@/features/pages/service";

import { createFolder, createPage, createTab, getTestDb } from "../e2e/support/database";

describe("page reads", () => {
  it("lists the pages placed directly in a folder by name, without the pages of its tabs", async () => {
    const folder = await createFolder();
    await createPage({ folder, name: "zeta" });
    await createPage({ folder, name: "alpha" });
    await createPage({ tab: await createTab({ folder }), name: "in-tab" });

    expect((await pageService.listFolderPages(folder.id)).map(({ name }) => name)).toEqual(["alpha", "zeta"]);
  });

  it("lists the pages of a tab by name, without the other pages of its folder", async () => {
    const folder = await createFolder();
    const tab = await createTab({ folder });
    await createPage({ tab, name: "zeta" });
    await createPage({ tab, name: "alpha" });
    await createPage({ folder, name: "direct" });
    await createPage({ tab: await createTab({ folder }), name: "other-tab" });

    expect((await pageService.listTabPages(tab.id)).map(({ name }) => name)).toEqual(["alpha", "zeta"]);
  });

  it("lists all pages of a folder by name and tab, the page placed directly in the folder first", async () => {
    const folder = await createFolder();
    const [b, a] = [await createTab({ folder, name: "b" }), await createTab({ folder, name: "a" })];
    await createPage({ tab: b, name: "intro" });
    await createPage({ tab: a, name: "intro" });
    await createPage({ folder, name: "intro" });
    await createPage({ folder, name: "about" });
    await createPage({ name: "other-folder" });

    const pages = await pageService.listAllFolderPages(folder.id);

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

    expect((await pageService.listFolderPages(folder.id)).map(({ name }) => name)).toEqual(["direct"]);
    expect((await pageService.listTabPages(tab.id)).map(({ name }) => name)).toEqual(["in-tab"]);
    expect((await pageService.listAllFolderPages(folder.id)).map(({ name }) => name)).toEqual(["direct", "in-tab"]);
  });

  it("returns null for the old name of a deleted page", async () => {
    const folder = await createFolder({ name: "docs" });
    await createPage({ folder, name: "intro", deletedAt: new Date() });

    await expect(pageService.getPage("docs", null, "intro")).resolves.toBeNull();
  });

  it("finds a page by its place: directly in the folder or in a tab", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const direct = await createPage({ folder, name: "intro" });
    const inTab = await createPage({ tab, name: "intro" });

    await expect(pageService.getPage("docs", null, "intro")).resolves.toMatchObject({ id: direct.id, tab: null });
    await expect(pageService.getPage("docs", "guides", "intro")).resolves.toMatchObject({
      id: inTab.id,
      tab: { name: "guides" },
    });
  });

  it("returns null for a page in another place or with a malformed name", async () => {
    const folder = await createFolder({ name: "docs" });
    await createTab({ folder, name: "guides" });
    await createPage({ tab: await createTab({ folder, name: "news" }), name: "only-in-news" });
    await createPage({ folder, name: "direct" });

    await expect(pageService.getPage("docs", null, "only-in-news")).resolves.toBeNull();
    await expect(pageService.getPage("docs", "guides", "only-in-news")).resolves.toBeNull();
    await expect(pageService.getPage("docs", "guides", "direct")).resolves.toBeNull();
    await expect(pageService.getPage("docs", null, "Not A Name")).resolves.toBeNull();
  });
});

describe("the fields of a page", () => {
  // `toStrictEqual` fails on any further column, such as `createdAt`, `folderId` or `deletedAt`.
  it("returns exactly the declared fields of a page in a tab", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ tab, name: "intro", content: "# Intro\n\nText" });

    await expect(pageService.getPage("docs", "guides", "intro")).resolves.toStrictEqual({
      id: page.id,
      name: "intro",
      title: "Intro",
      content: "# Intro\n\nText",
      updatedAt: page.updatedAt,
      folder: { id: folder.id, name: "docs" },
      tab: { id: tab.id, name: "guides" },
    });
  });

  it("returns exactly the declared fields of a page placed directly in a folder", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "intro" });

    await expect(pageService.getPage("docs", null, "intro")).resolves.toStrictEqual({
      id: page.id,
      name: "intro",
      title: page.title,
      content: page.content,
      updatedAt: page.updatedAt,
      folder: { id: folder.id, name: "docs" },
      tab: null,
    });
  });

  it("returns exactly the declared fields of a deleted page", async () => {
    const folder = await createFolder({ name: "docs" });
    const deletedAt = new Date("2026-11-03T10:00:00Z");
    const page = await createPage({ folder, name: "intro", content: "# Intro", deletedAt });

    await expect(pageService.getDeletedPage("docs", page.id)).resolves.toStrictEqual({
      id: page.id,
      name: "intro",
      title: "Intro",
      content: "# Intro",
      deletedAt,
      folder: { id: folder.id, name: "docs" },
    });
  });
});

describe("the lists for a malformed id", () => {
  it("are empty", async () => {
    await createPage({ tab: await createTab() });
    await createPage({ deletedAt: new Date() });

    await expect(pageService.listFolderPages("not-a-uuid")).resolves.toEqual([]);
    await expect(pageService.listTabPages("not-a-uuid")).resolves.toEqual([]);
    await expect(pageService.listAllFolderPages("not-a-uuid")).resolves.toEqual([]);
    await expect(pageService.listDeletedPages("not-a-uuid")).resolves.toEqual([]);
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

    expect((await pageService.listDeletedPages(folder.id)).map(({ name }) => name)).toEqual([
      "newest",
      "middle",
      "older",
    ]);
  });

  it("finds a deleted page of the folder by its id", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "intro", deletedAt: new Date() });

    await expect(pageService.getDeletedPage("docs", page.id)).resolves.toMatchObject({
      id: page.id,
      name: "intro",
      folder: { id: folder.id, name: "docs" },
    });
  });

  it("returns null for a page that is not deleted and for a deleted page of another folder", async () => {
    const folder = await createFolder({ name: "docs" });
    const kept = await createPage({ folder });
    const elsewhere = await createPage({ folder: await createFolder({ name: "other" }), deletedAt: new Date() });

    await expect(pageService.getDeletedPage("docs", kept.id)).resolves.toBeNull();
    await expect(pageService.getDeletedPage("docs", elsewhere.id)).resolves.toBeNull();
  });
});

const NAME_TAKEN = { ok: false, error: { code: "name-taken" } };
const TAB_NOT_FOUND = { ok: false, error: { code: "tab-not-found" } };
const PAGE_NOT_FOUND = { ok: false, error: { code: "page-not-found" } };

describe("createPage", () => {
  it("stores a page directly in a folder and returns it as stored", async () => {
    const folder = await createFolder({ name: "docs" });

    const result = await pageService.createPage(folder.id, {
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

    const result = await pageService.createPage(folder.id, { name: "intro", content: "# Intro", tabId: tab.id });

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
      pageService.createPage(folder.id, { name: "intro", content: "# Intro", tabId: foreignTab.id }),
    ).resolves.toEqual(TAB_NOT_FOUND);
    await expect(
      pageService.createPage(folder.id, { name: "intro", content: "# Intro", tabId: crypto.randomUUID() }),
    ).resolves.toEqual(TAB_NOT_FOUND);
    expect(await getTestDb().page.count()).toBe(0);
  });

  it("returns folder-not-found for a folder that does not exist", async () => {
    await expect(
      pageService.createPage(crypto.randomUUID(), { name: "intro", content: "# Intro", tabId: null }),
    ).resolves.toEqual({ ok: false, error: { code: "folder-not-found" } });
  });

  it("returns name-taken for a taken name in the same place", async () => {
    const folder = await createFolder();
    const tab = await createTab({ folder });
    await createPage({ folder, name: "direct" });
    await createPage({ tab, name: "in-tab" });

    await expect(
      pageService.createPage(folder.id, { name: "direct", content: "# Intro", tabId: null }),
    ).resolves.toEqual(NAME_TAKEN);
    await expect(
      pageService.createPage(folder.id, { name: "in-tab", content: "# Intro", tabId: tab.id }),
    ).resolves.toEqual(NAME_TAKEN);
    expect(await getTestDb().page.count()).toBe(2);
  });

  it("allows the same name directly in the folder and in a tab", async () => {
    const folder = await createFolder();
    const tab = await createTab({ folder });

    await expect(
      pageService.createPage(folder.id, { name: "intro", content: "# Intro", tabId: null }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      pageService.createPage(folder.id, { name: "intro", content: "# Intro", tabId: tab.id }),
    ).resolves.toMatchObject({ ok: true });
    expect(await getTestDb().page.count()).toBe(2);
  });
});

describe("updatePageContent", () => {
  it("stores the content with its derived title and returns the page as stored", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ tab, name: "intro", content: "# Old" });

    await expect(pageService.updatePageContent(page.id, { content: "# New title\n\nText" })).resolves.toStrictEqual({
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

  it("returns page-not-found for a deleted page and leaves it as it is", async () => {
    const page = await createPage({ content: "# Old", deletedAt: new Date() });

    await expect(pageService.updatePageContent(page.id, { content: "# New" })).resolves.toEqual(PAGE_NOT_FOUND);
    await expect(pageService.updatePageContent(crypto.randomUUID(), { content: "# New" })).resolves.toEqual(
      PAGE_NOT_FOUND,
    );
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).content).toBe("# Old");
  });
});

describe("moveOrRenamePage", () => {
  it("moves a page into a tab and back, with and without a new name", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ folder, name: "intro", content: "# Intro" });

    await expect(pageService.moveOrRenamePage(page.id, { name: "intro", tabId: tab.id })).resolves.toStrictEqual({
      ok: true,
      value: { id: page.id, name: "intro", folder: { name: "docs" }, tab: { name: "guides" } },
    });
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).toMatchObject({
      name: "intro",
      tabId: tab.id,
    });

    await expect(pageService.moveOrRenamePage(page.id, { name: "start", tabId: null })).resolves.toStrictEqual({
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

    await expect(pageService.moveOrRenamePage(page.id, { name: "intro", tabId: tab.id })).resolves.toEqual(NAME_TAKEN);
    await expect(pageService.moveOrRenamePage(page.id, { name: "intro", tabId: foreignTab.id })).resolves.toEqual(
      TAB_NOT_FOUND,
    );
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).tabId).toBeNull();
  });

  it("returns page-not-found for a deleted page", async () => {
    const page = await createPage({ deletedAt: new Date() });

    await expect(pageService.moveOrRenamePage(page.id, { name: "intro", tabId: null })).resolves.toEqual(
      PAGE_NOT_FOUND,
    );
  });
});

describe("deletePage", () => {
  it("forgets the tab, returns the place and frees the name", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const page = await createPage({ tab, name: "intro" });

    await expect(pageService.deletePage(page.id)).resolves.toStrictEqual({
      ok: true,
      value: { folder: { name: "docs" }, tab: { name: "guides" } },
    });

    const stored = await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } });
    expect(stored).toMatchObject({ tabId: null, folderId: folder.id, name: "intro" });
    expect(stored.deletedAt).toBeInstanceOf(Date);
    // The name is free again in the tab.
    await expect(
      pageService.createPage(folder.id, { name: "intro", content: "# Intro", tabId: tab.id }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("returns the folder as the place of a page placed directly in it and frees the name there", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "intro" });

    await expect(pageService.deletePage(page.id)).resolves.toStrictEqual({
      ok: true,
      value: { folder: { name: "docs" }, tab: null },
    });
    await expect(
      pageService.createPage(folder.id, { name: "intro", content: "# Intro", tabId: null }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("returns page-not-found for a page that is already deleted or does not exist", async () => {
    const page = await createPage({ deletedAt: new Date() });

    await expect(pageService.deletePage(page.id)).resolves.toEqual(PAGE_NOT_FOUND);
    await expect(pageService.deletePage(crypto.randomUUID())).resolves.toEqual(PAGE_NOT_FOUND);
  });
});

describe("restorePage", () => {
  it("restores a page into its folder and into a tab", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const direct = await createPage({ folder, name: "first", deletedAt: new Date() });
    const inTab = await createPage({ folder, name: "second", deletedAt: new Date() });

    await expect(pageService.restorePage(direct.id, { name: "first", tabId: null })).resolves.toStrictEqual({
      ok: true,
      value: { id: direct.id, name: "first", folder: { name: "docs" }, tab: null },
    });
    await expect(pageService.restorePage(inTab.id, { name: "renamed", tabId: tab.id })).resolves.toStrictEqual({
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

    await expect(pageService.restorePage(page.id, { name: "intro", tabId: null })).resolves.toEqual(NAME_TAKEN);
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).deletedAt).not.toBeNull();
  });

  it("returns tab-not-found for a tab of another folder", async () => {
    const page = await createPage({ deletedAt: new Date() });
    const foreignTab = await createTab();

    await expect(pageService.restorePage(page.id, { name: "intro", tabId: foreignTab.id })).resolves.toEqual(
      TAB_NOT_FOUND,
    );
  });

  it("returns page-not-found for a page that is not deleted", async () => {
    const page = await createPage({ name: "intro" });

    await expect(pageService.restorePage(page.id, { name: "other", tabId: null })).resolves.toEqual(PAGE_NOT_FOUND);
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } })).name).toBe("intro");
  });
});
