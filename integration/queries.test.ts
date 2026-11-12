// Runs the queries of the pages against the test database, to check their conditions and order on real data.
import { describe, expect, it } from "vitest";

import {
  getDeletedPage,
  getPage,
  listAllFolderPages,
  listDeletedPages,
  listFolderPages,
  listTabPages,
} from "@/features/pages/queries";

import { createFolder, createPage, createTab } from "../e2e/support/database";

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

  it("leaves deleted pages out of every list of their folder", async () => {
    const folder = await createFolder();
    const tab = await createTab({ folder });
    await createPage({ folder, name: "direct" });
    await createPage({ tab, name: "in-tab" });
    await createPage({ folder, name: "deleted", deletedAt: new Date() });

    expect((await listFolderPages(folder.id)).map(({ name }) => name)).toEqual(["direct"]);
    expect((await listTabPages(tab.id)).map(({ name }) => name)).toEqual(["in-tab"]);
    expect((await listAllFolderPages(folder.id)).map(({ name }) => name)).toEqual(["direct", "in-tab"]);
  });

  it("returns null for the old name of a deleted page", async () => {
    const folder = await createFolder({ name: "docs" });
    await createPage({ folder, name: "intro", deletedAt: new Date() });

    await expect(getPage("docs", null, "intro")).resolves.toBeNull();
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

describe("deleted page queries", () => {
  it("lists only the deleted pages of the folder, newest first", async () => {
    const folder = await createFolder();
    await createPage({ folder, name: "older", deletedAt: new Date("2026-11-01T10:00:00Z") });
    await createPage({ folder, name: "newest", deletedAt: new Date("2026-11-03T10:00:00Z") });
    await createPage({ folder, name: "middle", deletedAt: new Date("2026-11-02T10:00:00Z") });
    await createPage({ folder, name: "not-deleted" });
    await createPage({ name: "other-folder", deletedAt: new Date("2026-11-04T10:00:00Z") });

    expect((await listDeletedPages(folder.id)).map(({ name }) => name)).toEqual(["newest", "middle", "older"]);
  });

  it("finds a deleted page of the folder by its id", async () => {
    const folder = await createFolder({ name: "docs" });
    const page = await createPage({ folder, name: "intro", deletedAt: new Date() });

    await expect(getDeletedPage("docs", page.id)).resolves.toMatchObject({
      id: page.id,
      name: "intro",
      folder: { id: folder.id, name: "docs" },
    });
  });

  it("returns null for a page that is not deleted and for a deleted page of another folder", async () => {
    const folder = await createFolder({ name: "docs" });
    const kept = await createPage({ folder });
    const elsewhere = await createPage({ folder: await createFolder({ name: "other" }), deletedAt: new Date() });

    await expect(getDeletedPage("docs", kept.id)).resolves.toBeNull();
    await expect(getDeletedPage("docs", elsewhere.id)).resolves.toBeNull();
  });
});
