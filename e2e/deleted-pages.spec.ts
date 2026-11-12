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
