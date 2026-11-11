// Runs the queries of the features against the test database, to check their conditions and order on real data.
import { describe, expect, it } from "vitest";

import { getFolderByName, getTab, listFolders, listTabs } from "@/features/folders/queries";
import { getPage, listAllFolderPages, listFolderPages, listTabPages } from "@/features/pages/queries";

import { createFolder, createPage, createTab } from "../e2e/support/database";

describe("folder queries", () => {
  it("lists all folders by name", async () => {
    await createFolder({ name: "zeta" });
    await createFolder({ name: "alpha" });

    expect((await listFolders()).map(({ name }) => name)).toEqual(["alpha", "zeta"]);
  });

  it("finds a folder by name, and null for an unknown or malformed name", async () => {
    const folder = await createFolder({ name: "docs" });

    await expect(getFolderByName("docs")).resolves.toMatchObject({ id: folder.id });
    await expect(getFolderByName("other")).resolves.toBeNull();
    await expect(getFolderByName("Not A Name")).resolves.toBeNull();
  });

  it("lists the tabs of a folder by name, without those of other folders", async () => {
    const folder = await createFolder();
    await createTab({ folder, name: "zeta" });
    await createTab({ folder, name: "alpha" });
    await createTab({ name: "other" });

    expect((await listTabs(folder.id)).map(({ name }) => name)).toEqual(["alpha", "zeta"]);
  });

  it("finds a tab by folder and tab name, and null for a tab of another folder", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    await createTab({ folder: await createFolder({ name: "other" }), name: "news" });

    await expect(getTab("docs", "guides")).resolves.toMatchObject({ id: tab.id, folder: { name: "docs" } });
    await expect(getTab("docs", "news")).resolves.toBeNull();
  });
});

describe("page queries", () => {
  it("lists the pages placed directly in a folder by name, without the pages of its tabs", async () => {
    const folder = await createFolder();
    await createPage({ folder, name: "zeta" });
    await createPage({ folder, name: "alpha" });
    await createPage({ tab: await createTab({ folder }), name: "in-tab" });

    expect((await listFolderPages(folder.id)).map(({ name }) => name)).toEqual(["alpha", "zeta"]);
  });

  it("lists the pages of a tab by name, without the other pages of its folder", async () => {
    const folder = await createFolder();
    const tab = await createTab({ folder });
    await createPage({ tab, name: "zeta" });
    await createPage({ tab, name: "alpha" });
    await createPage({ folder, name: "direct" });
    await createPage({ tab: await createTab({ folder }), name: "other-tab" });

    expect((await listTabPages(tab.id)).map(({ name }) => name)).toEqual(["alpha", "zeta"]);
  });

  it("lists all pages of a folder by name and tab, the page placed directly in the folder first", async () => {
    const folder = await createFolder();
    const [b, a] = [await createTab({ folder, name: "b" }), await createTab({ folder, name: "a" })];
    await createPage({ tab: b, name: "intro" });
    await createPage({ tab: a, name: "intro" });
    await createPage({ folder, name: "intro" });
    await createPage({ folder, name: "about" });
    await createPage({ name: "other-folder" });

    const pages = await listAllFolderPages(folder.id);

    expect(pages.map(({ name, tab }) => [name, tab?.name ?? null])).toEqual([
      ["about", null],
      ["intro", null],
      ["intro", "a"],
      ["intro", "b"],
    ]);
  });

  it("finds a page by its place: directly in the folder or in a tab", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    const direct = await createPage({ folder, name: "intro" });
    const inTab = await createPage({ tab, name: "intro" });

    await expect(getPage("docs", null, "intro")).resolves.toMatchObject({ id: direct.id, tab: null });
    await expect(getPage("docs", "guides", "intro")).resolves.toMatchObject({
      id: inTab.id,
      tab: { name: "guides" },
    });
  });

  it("returns null for a page in another place or with a malformed name", async () => {
    const folder = await createFolder({ name: "docs" });
    await createTab({ folder, name: "guides" });
    await createPage({ tab: await createTab({ folder, name: "news" }), name: "only-in-news" });
    await createPage({ folder, name: "direct" });

    await expect(getPage("docs", null, "only-in-news")).resolves.toBeNull();
    await expect(getPage("docs", "guides", "only-in-news")).resolves.toBeNull();
    await expect(getPage("docs", "guides", "direct")).resolves.toBeNull();
    await expect(getPage("docs", null, "Not A Name")).resolves.toBeNull();
  });
});
