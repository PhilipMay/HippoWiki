// Runs the folder and tab service against the test database, to check its reads and writes on real data.
import { describe, expect, it } from "vitest";

import * as folderService from "@/features/folders/service";

import { createFolder, createTab, getTestDb } from "../e2e/support/database";

describe("folder reads", () => {
  it("lists all folders by name", async () => {
    await createFolder({ name: "zeta" });
    await createFolder({ name: "alpha" });

    expect((await folderService.listFolders()).map(({ name }) => name)).toEqual(["alpha", "zeta"]);
  });

  it("finds a folder by name, and null for an unknown or malformed name", async () => {
    const folder = await createFolder({ name: "docs" });

    await expect(folderService.getFolderByName("docs")).resolves.toMatchObject({ id: folder.id });
    await expect(folderService.getFolderByName("other")).resolves.toBeNull();
    await expect(folderService.getFolderByName("Not A Name")).resolves.toBeNull();
  });

  it("returns exactly the declared fields of a folder", async () => {
    const folder = await createFolder({ name: "docs" });

    // `toStrictEqual` fails on any further column, such as `createdAt`.
    await expect(folderService.getFolderByName("docs")).resolves.toStrictEqual({ id: folder.id, name: "docs" });
  });
});

describe("tab reads", () => {
  it("lists the tabs of a folder by name, without those of other folders", async () => {
    const folder = await createFolder();
    await createTab({ folder, name: "zeta" });
    await createTab({ folder, name: "alpha" });
    await createTab({ name: "other" });

    expect((await folderService.listTabs(folder.id)).map(({ name }) => name)).toEqual(["alpha", "zeta"]);
  });

  it("lists no tabs for a malformed folder id", async () => {
    await createTab();

    await expect(folderService.listTabs("not-a-uuid")).resolves.toEqual([]);
  });

  it("finds a tab by folder and tab name, and null for a tab of another folder", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });
    await createTab({ folder: await createFolder({ name: "other" }), name: "news" });

    await expect(folderService.getTab("docs", "guides")).resolves.toMatchObject({
      id: tab.id,
      folder: { name: "docs" },
    });
    await expect(folderService.getTab("docs", "news")).resolves.toBeNull();
  });

  it("returns exactly the declared fields of a tab", async () => {
    const folder = await createFolder({ name: "docs" });
    const tab = await createTab({ folder, name: "guides" });

    await expect(folderService.getTab("docs", "guides")).resolves.toStrictEqual({
      id: tab.id,
      name: "guides",
      folder: { id: folder.id, name: "docs" },
    });
  });
});

describe("folder writes", () => {
  it("stores a folder and returns it as stored", async () => {
    const result = await folderService.createFolder({ name: " docs " });

    const stored = await getTestDb().folder.findUniqueOrThrow({ where: { name: "docs" } });
    expect(result).toStrictEqual({ ok: true, value: { id: stored.id, name: "docs" } });
  });

  it("returns name-taken for the name of another folder", async () => {
    await createFolder({ name: "docs" });
    const other = await createFolder({ name: "other" });

    await expect(folderService.createFolder({ name: "docs" })).resolves.toEqual({
      ok: false,
      error: { code: "name-taken" },
    });
    await expect(folderService.renameFolder(other.id, { name: "docs" })).resolves.toEqual({
      ok: false,
      error: { code: "name-taken" },
    });
    expect(await getTestDb().folder.count()).toBe(2);
  });

  it("renames a folder and returns it as stored", async () => {
    const folder = await createFolder({ name: "docs" });

    await expect(folderService.renameFolder(folder.id, { name: "handbook" })).resolves.toStrictEqual({
      ok: true,
      value: { id: folder.id, name: "handbook" },
    });
    expect((await getTestDb().folder.findUniqueOrThrow({ where: { id: folder.id } })).name).toBe("handbook");
  });

  it("returns folder-not-found for a folder that does not exist", async () => {
    await expect(folderService.renameFolder(crypto.randomUUID(), { name: "docs" })).resolves.toEqual({
      ok: false,
      error: { code: "folder-not-found" },
    });
  });

  it("returns the field errors of an invalid name and stores nothing", async () => {
    await expect(folderService.createFolder({ name: "Not A Name" })).resolves.toEqual({
      ok: false,
      error: { code: "invalid-input", fieldErrors: { name: ["Use lowercase letters, digits and single hyphens"] } },
    });
    expect(await getTestDb().folder.count()).toBe(0);
  });
});

describe("tab writes", () => {
  it("stores a tab in its folder and returns it as stored", async () => {
    const folder = await createFolder({ name: "docs" });

    const result = await folderService.createTab(folder.id, { name: " guides " });

    const stored = await getTestDb().tab.findFirstOrThrow({ where: { folderId: folder.id } });
    expect(stored.name).toBe("guides");
    expect(result).toStrictEqual({ ok: true, value: { id: stored.id, name: "guides", folder: { name: "docs" } } });
  });

  it("returns name-taken for the name of another tab of the folder", async () => {
    const folder = await createFolder();
    await createTab({ folder, name: "guides" });
    const other = await createTab({ folder, name: "other" });

    await expect(folderService.createTab(folder.id, { name: "guides" })).resolves.toEqual({
      ok: false,
      error: { code: "name-taken" },
    });
    await expect(folderService.renameTab(other.id, { name: "guides" })).resolves.toEqual({
      ok: false,
      error: { code: "name-taken" },
    });
  });

  it("allows the same tab name in another folder", async () => {
    await createTab({ folder: await createFolder({ name: "docs" }), name: "guides" });
    const other = await createFolder({ name: "other" });
    const news = await createTab({ folder: other, name: "news" });

    await expect(folderService.createTab(other.id, { name: "guides" })).resolves.toMatchObject({
      ok: true,
      value: { name: "guides", folder: { name: "other" } },
    });
    const elsewhere = await createFolder({ name: "elsewhere" });
    const renamed = await createTab({ folder: elsewhere, name: "old" });
    await expect(folderService.renameTab(renamed.id, { name: "guides" })).resolves.toStrictEqual({
      ok: true,
      value: { id: renamed.id, name: "guides", folder: { name: "elsewhere" } },
    });
    // The tab that was not renamed keeps its name.
    expect((await getTestDb().tab.findUniqueOrThrow({ where: { id: news.id } })).name).toBe("news");
  });

  it("returns folder-not-found for a tab in a folder that does not exist", async () => {
    await expect(folderService.createTab(crypto.randomUUID(), { name: "guides" })).resolves.toEqual({
      ok: false,
      error: { code: "folder-not-found" },
    });
    expect(await getTestDb().tab.count()).toBe(0);
  });

  it("returns tab-not-found for a tab that does not exist", async () => {
    await expect(folderService.renameTab(crypto.randomUUID(), { name: "guides" })).resolves.toEqual({
      ok: false,
      error: { code: "tab-not-found" },
    });
  });
});
