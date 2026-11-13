import type { Page } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { collectErrors } from "./support/browser";
import { createFolder, createPage, createTab, createUser, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

/** The "Delete page" dialog. */
function deleteDialog(page: Page) {
  return page.getByRole("dialog", { name: "Delete page" });
}

async function expectNotFound(page: Page, address: string) {
  const response = await page.goto(address);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
}

/** Opens the page at the address, deletes it through its "Delete" button and confirms the dialog. */
async function deleteThroughDialog(page: Page, address: string) {
  await page.goto(address);
  await page.getByRole("main").getByRole("link", { name: "Delete" }).click();
  await expect(page).toHaveURL(`${address}?action=delete`);
  await deleteDialog(page).getByRole("button", { name: "Delete" }).click();
}

/** The logged-in user of the tests, who makes every change through the GUI. */
const USER = KNOWN_USER.name;

/** Text that ends with "by <user>", as the lists and views show the last editor. */
function by(user: string): RegExp {
  return new RegExp(`by ${user}$`);
}

test("deleting a page placed directly in a folder leads to the folder and removes it everywhere", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ folder: handbook, name: "kept", title: "Kept page" });
  const removed = await createPage({ folder: handbook, name: "removed", title: "Removed page" });

  await deleteThroughDialog(page, "/folders/handbook/removed.md");

  await expect(page).toHaveURL("/folders/handbook");
  await expect(page.getByRole("list", { name: "Contents" }).getByRole("link")).toHaveText([/^Kept page/]);
  const stored = await getTestDb().page.findUniqueOrThrow({ where: { id: removed.id } });
  expect(stored).toMatchObject({ folderId: handbook.id, tabId: null, deletedAt: expect.any(Date) });
  expect(stored.updatedAt.getTime()).toBeGreaterThan(removed.updatedAt.getTime());

  await page.goto("/folders/handbook?view=all");
  const rows = page
    .getByRole("table", { name: "All pages" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });
  await expect(rows).toHaveText([/^kept\.md/]);
  expect(errors).toEqual([]);
  // The browser reports the 404 of the not-found page as a console error, so it is checked last.
  await expectNotFound(page, "/folders/handbook/removed.md");
});

test("deleting a page in a tab leads to the tab and puts it on top of the deleted pages", async ({ page }) => {
  const errors = collectErrors(page);
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ tab: guides, name: "kept", title: "Kept page" });
  await createPage({
    folder: handbook,
    name: "earlier",
    title: "Earlier",
    deletedAt: new Date("2026-01-01T00:00:00Z"),
  });
  const removed = await createPage({ tab: guides, name: "removed", title: "Removed page" });

  await deleteThroughDialog(page, "/folders/handbook/guides/removed.md");

  await expect(page).toHaveURL("/folders/handbook/guides");
  await expect(page.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^Kept page/]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: removed.id } })).toMatchObject({
    folderId: handbook.id,
    tabId: null,
    deletedAt: expect.any(Date),
  });

  await page.goto("/deleted-pages/handbook");
  const table = page.getByRole("table", { name: "Deleted pages" });
  await expect(table.getByRole("link")).toHaveText(["removed", "earlier"]);
  await expect(table.getByRole("link").first()).toHaveAttribute("href", `/deleted-pages/handbook/${removed.id}`);
  expect(errors).toEqual([]);
  // The browser reports the 404 of the not-found page as a console error, so it is checked last.
  await expectNotFound(page, "/folders/handbook/guides/removed.md");
});

test("a page of the same name can be created at the same place right after deleting", async ({ page }) => {
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ tab: guides, name: "overview", title: "Old overview" });

  await deleteThroughDialog(page, "/folders/handbook/guides/overview.md");
  await expect(page).toHaveURL("/folders/handbook/guides");

  await page.goto("/folders/handbook/guides?action=new");
  await page.getByLabel("Content").fill("# Overview\n\nNew text");
  await page.getByRole("button", { name: "Save" }).click();
  const dialog = page.getByRole("dialog", { name: "Save page" });
  await expect(dialog.getByLabel("Name")).toHaveValue("overview");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/overview.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Overview"]);
});

test("the dialog names the page, and cancel keeps the page and leads back to it", async ({ page }) => {
  const errors = collectErrors(page);
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=delete");

  const dialog = deleteDialog(page);
  await expect(page).toHaveTitle("Kept page – HippoWiki");
  await expect(dialog).toHaveAccessibleDescription(
    "Delete the page kept.md? You can restore it later from the deleted pages of its folder.",
  );
  await dialog.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL("/folders/handbook/kept.md");
  await expect(dialog).toHaveCount(0);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
  expect(errors).toEqual([]);
});

test("the Escape key closes the dialog and keeps the page", async ({ page }) => {
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=delete");
  await expect(deleteDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page).toHaveURL("/folders/handbook/kept.md");
  await expect(deleteDialog(page)).toHaveCount(0);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
});

test("deleting a page that was deleted in the meantime shows an error in the dialog", async ({ page }) => {
  const created = await createPage({ folder: handbook, name: "soon-gone", title: "Soon gone" });

  await page.goto("/folders/handbook/soon-gone.md?action=delete");
  const deletedAt = new Date("2026-01-01T00:00:00Z");
  await getTestDb().page.update({ where: { id: created.id }, data: { deletedAt } });
  const dialog = deleteDialog(page);
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("This page no longer exists.");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ deletedAt });
});

test("the deleted pages and the deleted page show the logged-in user who deleted the page", async ({ page }) => {
  const errors = collectErrors(page);
  const bob = await createUser({ name: "bob" });
  const removed = await createPage({ folder: handbook, name: "removed", editor: bob });

  await deleteThroughDialog(page, "/folders/handbook/removed.md");
  await expect(page).toHaveURL("/folders/handbook");

  await page.goto("/deleted-pages/handbook");
  const rows = page
    .getByRole("table", { name: "Deleted pages" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });
  await expect(rows.getByRole("cell").last()).toHaveText(USER);
  await page.goto(`/deleted-pages/handbook/${removed.id}`);
  await expect(page.getByRole("article").getByText(/^Deleted /)).toHaveText(by(USER));
  expect(errors).toEqual([]);
});
