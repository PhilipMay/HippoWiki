import type { Page } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { createFolder, createPage, createTab, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

async function expectNotFound(page: Page, address: string) {
  const response = await page.goto(address);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
}

test("a deleted page is missing from the folder contents, the tab and all pages", async ({ page }) => {
  const errors = collectErrors(page);
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ folder: handbook, name: "kept", title: "Kept page" });
  await createPage({ tab: guides, name: "setup", title: "Setup" });
  await createPage({ folder: handbook, name: "removed", title: "Removed page", deletedAt: new Date() });

  await page.goto("/folders/handbook");
  await expect(page.getByRole("list", { name: "Contents" }).getByRole("link")).toHaveText([/^Kept page/, /^guides/]);

  await page.goto("/folders/handbook/guides");
  await expect(page.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^Setup/]);

  await page.goto("/folders/handbook?view=all");
  const rows = page
    .getByRole("table", { name: "All pages" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });
  await expect(rows).toHaveText([/^kept\.md/, /^setup\.md/]);
  expect(errors).toEqual([]);
});

test("the old address of a deleted page shows the not-found page", async ({ page }) => {
  await createPage({ folder: handbook, name: "removed", deletedAt: new Date() });

  await expectNotFound(page, "/folders/handbook/removed.md");
  await expectNotFound(page, "/folders/handbook/removed.md?action=edit");
});

test("a page with the name of a deleted page can be created directly in the folder", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ folder: handbook, name: "overview", title: "Old overview", deletedAt: new Date() });

  await page.goto("/folders/handbook?action=new");
  await page.getByLabel("Content").fill("# Overview\n\nNew text");
  await page.getByRole("button", { name: "Save" }).click();
  const dialog = page.getByRole("dialog", { name: "Save page" });
  await expect(dialog.getByLabel("Name")).toHaveValue("overview");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/overview.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Overview"]);
  const stored = await getTestDb().page.findMany({ where: { folderId: handbook.id, name: "overview" } });
  expect(stored.map(({ title, deletedAt }) => [title, deletedAt === null])).toEqual(
    expect.arrayContaining([
      ["Old overview", false],
      ["Overview", true],
    ]),
  );
  expect(errors).toEqual([]);
});

/** The breadcrumb of the address. */
function breadcrumb(page: Page) {
  return page.getByRole("navigation", { name: "Breadcrumb" });
}

/** The rows of the list of deleted pages, without its header. */
function deletedPageRows(page: Page) {
  return page
    .getByRole("table", { name: "Deleted pages" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });
}

test("the deleted pages button of a folder leads to its deleted pages, newest first", async ({ page }) => {
  const errors = collectErrors(page);
  const other = await createFolder({ name: "other" });
  const older = await createPage({
    folder: handbook,
    name: "older",
    title: "Older page",
    deletedAt: new Date("2026-11-01T10:00:00Z"),
  });
  await createPage({
    folder: handbook,
    name: "newer",
    title: "Newer page",
    deletedAt: new Date("2026-11-03T10:00:00Z"),
  });
  await createPage({ folder: handbook, name: "kept", title: "Kept page" });
  await createPage({ folder: other, name: "elsewhere", title: "Elsewhere", deletedAt: new Date() });

  await page.goto("/folders/handbook");
  await page.getByRole("main").getByRole("link", { name: "Deleted pages" }).click();

  await expect(page).toHaveURL("/deleted-pages/handbook");
  await expect(page).toHaveTitle("Deleted pages – handbook – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Deleted pages"]);
  const items = breadcrumb(page).getByRole("listitem");
  await expect(items).toHaveText(["Folders", "handbook", "Deleted pages"]);
  await expect(items.nth(2).locator("[aria-current=page]")).toHaveText("Deleted pages");
  await expect(breadcrumb(page).getByRole("link")).toHaveText(["Folders", "handbook"]);

  const table = page.getByRole("table", { name: "Deleted pages" });
  // Where in the folder a page was is not known, so there is no tab column.
  await expect(table.getByRole("columnheader")).toHaveText(["Name", "Title", "Deleted"]);
  const rows = deletedPageRows(page);
  await expect(rows).toHaveText([/^newerNewer page/, /^olderOlder page/]);
  await expect(rows.nth(1).locator("time")).toHaveAttribute("datetime", "2026-11-01T10:00:00.000Z");
  await expect(table.getByRole("link")).toHaveText(["newer", "older"]);
  await expect(table.getByRole("link").nth(1)).toHaveAttribute("href", `/deleted-pages/handbook/${older.id}`);
  expect(errors).toEqual([]);
});

test("the deleted pages of a folder without any show an empty state", async ({ page }) => {
  await createPage({ folder: handbook, name: "kept" });
  await createPage({ name: "elsewhere", deletedAt: new Date() });

  await page.goto("/deleted-pages/handbook");

  await expect(page.getByText("No deleted pages")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("a deleted page can be opened and read, without edit controls", async ({ page }) => {
  const errors = collectErrors(page);
  const removed = await createPage({
    folder: handbook,
    name: "removed",
    content: "# Removed page\n\n- First point\n- Second point",
    deletedAt: new Date("2026-11-02T09:30:00Z"),
  });

  await page.goto("/deleted-pages/handbook");
  await page.getByRole("table", { name: "Deleted pages" }).getByRole("link", { name: "removed" }).click();

  await expect(page).toHaveURL(`/deleted-pages/handbook/${removed.id}`);
  await expect(page).toHaveTitle("Deleted: Removed page – HippoWiki");
  await expect(breadcrumb(page).getByRole("listitem")).toHaveText(["Folders", "handbook", "Deleted pages", "removed"]);
  await expect(breadcrumb(page).getByRole("link")).toHaveText(["Folders", "handbook", "Deleted pages"]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Removed page"]);
  const article = page.getByRole("article");
  await expect(article.getByRole("listitem")).toHaveText(["First point", "Second point"]);
  await expect(article.locator("time")).toHaveAttribute("datetime", "2026-11-02T09:30:00.000Z");
  await expect(page.getByRole("main").getByRole("link", { name: /^(Edit|Move or rename|Delete)$/ })).toHaveCount(0);

  await breadcrumb(page).getByRole("link", { name: "Deleted pages" }).click();
  await expect(page).toHaveURL("/deleted-pages/handbook");
  expect(errors).toEqual([]);
});

test("after renaming a folder its deleted pages open under the new name", async ({ page }) => {
  const removed = await createPage({ folder: handbook, name: "removed", title: "Removed page", deletedAt: new Date() });
  await page.goto(`/deleted-pages/handbook/${removed.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Removed page"]);

  await page.goto("/folders/handbook?action=rename");
  const dialog = page.getByRole("dialog", { name: "Rename folder" });
  await dialog.getByLabel("Name").fill("manual");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/manual");

  await page.goto("/deleted-pages/manual");
  await deletedPageRows(page).getByRole("link", { name: "removed" }).click();
  await expect(page).toHaveURL(`/deleted-pages/manual/${removed.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Removed page"]);
  await expectNotFound(page, `/deleted-pages/handbook/${removed.id}`);
  await expectNotFound(page, "/deleted-pages/handbook");
});

test.describe("addresses that are no deleted pages", () => {
  const removedId = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
  const keptId = "5a2c1c0e-3f55-4a55-8a42-5d2f0e6a9b11";
  const elsewhereId = "9c4d2b7e-1a3f-4c5d-8e6f-7a8b9c0d1e22";

  test.beforeEach(async () => {
    await createPage({ id: removedId, folder: handbook, name: "removed", deletedAt: new Date() });
    await createPage({ id: keptId, folder: handbook, name: "kept" });
    await createPage({ id: elsewhereId, folder: await createFolder({ name: "other" }), deletedAt: new Date() });
  });

  for (const address of [
    "/deleted-pages",
    "/deleted-pages/unknown",
    "/deleted-pages/Handbook",
    `/deleted-pages/unknown/${removedId}`,
    "/deleted-pages/handbook/not-a-uuid",
    "/deleted-pages/handbook/removed",
    `/deleted-pages/handbook/${removedId.toUpperCase()}x`,
    "/deleted-pages/handbook/3f1e0b6c-2d4a-4b8e-9c7f-1a2b3c4d5e6f",
    `/deleted-pages/handbook/${elsewhereId}`,
    `/deleted-pages/handbook/${keptId}`,
    `/deleted-pages/handbook/${removedId}/more`,
    "/deleted-pages/handbook?action=new",
    "/deleted-pages/handbook?view=all",
    `/deleted-pages/handbook/${removedId}?action=edit`,
    `/deleted-pages/handbook/${removedId}?action=delete`,
    `/deleted-pages/handbook/${removedId}?view=all`,
  ]) {
    test(`${address} shows the not-found page`, async ({ page }) => {
      await expectNotFound(page, address);
    });
  }

  test("the deleted page itself is found", async ({ page }) => {
    const response = await page.goto(`/deleted-pages/handbook/${removedId}`);
    expect(response?.status()).toBe(200);
  });
});
