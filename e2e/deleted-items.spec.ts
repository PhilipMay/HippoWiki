import type { Page } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { by, collectErrors, expectNotFound, expectNotFoundResponse } from "./support/browser";
import { createFolder, createPage, createTab, createUser, getTestDb, resetTestDatabase } from "./support/database";
import { fillContent } from "./support/editor";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

/** The logged-in user of the tests, who makes every change through the GUI. */
const USER = KNOWN_USER.name;

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

/** Every view and action of the address of a page. */
const VIEWS_AND_ACTIONS = [
  "",
  "?action=edit",
  "?action=move-or-rename",
  "?action=delete",
  "?action=revert&revision=1",
  "?view=history",
  "?view=revision&revision=1",
  "?view=revision&revision=1&format=raw",
  "?view=compare&from=1&to=1",
];

test("every view and action of the old address of a deleted page shows the not-found page", async ({ page }) => {
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ folder: handbook, name: "removed", deletedAt: new Date() });
  // A page deleted from a tab loses its tab, as the delete stores it.
  const fromTab = await createPage({ tab: guides, name: "from-tab" });
  await getTestDb().page.update({ where: { id: fromTab.id }, data: { deletedAt: new Date(), tabId: null } });

  // The plain address shows the not-found page in the browser; its views and actions only need the answer.
  for (const oldAddress of ["/folders/handbook/removed.md", "/folders/handbook/guides/from-tab.md"]) {
    await expectNotFound(page, oldAddress);
    for (const query of VIEWS_AND_ACTIONS.filter((query) => query !== "")) {
      await expectNotFoundResponse(page.request, `${oldAddress}${query}`);
    }
  }
});

test("a page with the name of a deleted page can be created directly in the folder", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ folder: handbook, name: "overview", title: "Old overview", deletedAt: new Date() });

  await page.goto("/folders/handbook?action=new");
  await fillContent(page, "# Overview\n\nNew text");
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
    .getByRole("table", { name: "Deleted items" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });
}

test("the deleted items button of a folder leads to its deleted items, newest first", async ({ page }) => {
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
  await page.getByRole("main").getByRole("link", { name: "Deleted items" }).click();

  await expect(page).toHaveURL("/deleted-items/handbook");
  await expect(page).toHaveTitle("Deleted items – handbook – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Deleted items"]);
  const items = breadcrumb(page).getByRole("listitem");
  await expect(items).toHaveText(["Folders", "handbook", "Deleted items"]);
  await expect(items.nth(2).locator("[aria-current=page]")).toHaveText("Deleted items");
  await expect(breadcrumb(page).getByRole("link")).toHaveText(["Folders", "handbook"]);

  const table = page.getByRole("table", { name: "Deleted items" });
  // Where in the folder a page was is not known, so there is no tab column.
  await expect(table.getByRole("columnheader")).toHaveText([
    "Name",
    "Kind",
    "Title or type",
    "Deleted",
    "Deleted by",
    "Via",
  ]);
  const rows = deletedPageRows(page);
  await expect(rows).toHaveText([/^newerPageNewer page/, /^olderPageOlder page/]);
  await expect(rows.nth(1).locator("time")).toHaveAttribute("datetime", "2026-11-01T10:00:00.000Z");
  await expect(table.getByRole("link")).toHaveText(["newer", "older"]);
  await expect(table.getByRole("link").nth(1)).toHaveAttribute("href", `/deleted-items/handbook/${older.id}`);
  expect(errors).toEqual([]);
});

test("the deleted items of a folder without any show an empty state", async ({ page }) => {
  await createPage({ folder: handbook, name: "kept" });
  await createPage({ name: "elsewhere", deletedAt: new Date() });

  await page.goto("/deleted-items/handbook");

  await expect(page.getByText("No deleted items")).toBeVisible();
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

  await page.goto("/deleted-items/handbook");
  await page.getByRole("table", { name: "Deleted items" }).getByRole("link", { name: "removed" }).click();

  await expect(page).toHaveURL(`/deleted-items/handbook/${removed.id}`);
  await expect(page).toHaveTitle("Deleted: Removed page – HippoWiki");
  await expect(breadcrumb(page).getByRole("listitem")).toHaveText(["Folders", "handbook", "Deleted items", "removed"]);
  await expect(breadcrumb(page).getByRole("link")).toHaveText(["Folders", "handbook", "Deleted items"]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Removed page"]);
  const article = page.getByRole("article");
  await expect(article.getByRole("listitem")).toHaveText(["First point", "Second point"]);
  await expect(article.locator("time")).toHaveAttribute("datetime", "2026-11-02T09:30:00.000Z");
  await expect(page.getByRole("main").getByRole("link", { name: /^(Edit|Move or rename|Delete)$/ })).toHaveCount(0);

  await breadcrumb(page).getByRole("link", { name: "Deleted items" }).click();
  await expect(page).toHaveURL("/deleted-items/handbook");
  expect(errors).toEqual([]);
});

test("after renaming a folder its deleted pages open under the new name", async ({ page }) => {
  const removed = await createPage({ folder: handbook, name: "removed", title: "Removed page", deletedAt: new Date() });
  await page.goto(`/deleted-items/handbook/${removed.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Removed page"]);

  await page.goto("/folders/handbook?action=rename");
  const dialog = page.getByRole("dialog", { name: "Rename folder" });
  await dialog.getByLabel("Name").fill("manual");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/manual");

  await page.goto("/deleted-items/manual");
  await deletedPageRows(page).getByRole("link", { name: "removed" }).click();
  await expect(page).toHaveURL(`/deleted-items/manual/${removed.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Removed page"]);
  await expectNotFound(page, `/deleted-items/handbook/${removed.id}`);
  await expectNotFound(page, "/deleted-items/handbook");
});

test("addresses that are no deleted pages show the not-found page, and the deleted page itself is found", async ({
  page,
}) => {
  const removedId = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
  const keptId = "5a2c1c0e-3f55-4a55-8a42-5d2f0e6a9b11";
  const elsewhereId = "9c4d2b7e-1a3f-4c5d-8e6f-7a8b9c0d1e22";
  await createPage({ id: removedId, folder: handbook, name: "removed", deletedAt: new Date() });
  await createPage({ id: keptId, folder: handbook, name: "kept" });
  await createPage({ id: elsewhereId, folder: await createFolder({ name: "other" }), deletedAt: new Date() });

  for (const address of [
    "/deleted-items",
    "/deleted-items/unknown",
    "/deleted-items/Handbook",
    `/deleted-items/unknown/${removedId}`,
    "/deleted-items/handbook/not-a-uuid",
    "/deleted-items/handbook/removed",
    `/deleted-items/handbook/${removedId.toUpperCase()}x`,
    "/deleted-items/handbook/3f1e0b6c-2d4a-4b8e-9c7f-1a2b3c4d5e6f",
    `/deleted-items/handbook/${elsewhereId}`,
    `/deleted-items/handbook/${keptId}`,
    `/deleted-items/handbook/${removedId}/more`,
    "/deleted-items/handbook?action=new",
    "/deleted-items/handbook?view=all",
    `/deleted-items/handbook/${removedId}?action=edit`,
    `/deleted-items/handbook/${removedId}?action=delete`,
    `/deleted-items/handbook/${removedId}?view=all`,
    "/deleted-pages/handbook",
    `/deleted-pages/handbook/${removedId}`,
  ]) {
    await expectNotFoundResponse(page.request, address);
  }
  expect((await page.request.get(`/deleted-items/handbook/${removedId}`)).status()).toBe(200);
});

test("the deleted pages show who deleted each page and how in columns, and the deleted page in its view", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const bob = await createUser({ name: "bob" });
  const folder = await createFolder({ name: "docs" });
  const removed = await createPage({
    folder,
    name: "by-bob",
    deletedAt: new Date("2026-11-02T10:00:00Z"),
    editor: bob,
    via: "mcp",
  });
  const user = await getTestDb().user.findUniqueOrThrow({ where: { id: KNOWN_USER.id } });
  await createPage({ folder, name: "by-user", deletedAt: new Date("2026-11-01T10:00:00Z"), editor: user });

  await page.goto("/deleted-items/docs");
  const table = page.getByRole("table", { name: "Deleted items" });
  await expect(table.getByRole("columnheader")).toHaveText([
    "Name",
    "Kind",
    "Title or type",
    "Deleted",
    "Deleted by",
    "Via",
  ]);
  const rows = table.getByRole("row").filter({ has: page.getByRole("cell") });
  await expect(rows).toHaveText([/^by-bob/, /^by-user/]);
  await expect(rows.nth(0).getByRole("cell").nth(4)).toHaveText("bob");
  await expect(rows.nth(0).getByRole("cell").nth(5)).toHaveText("mcp");
  await expect(rows.nth(1).getByRole("cell").nth(4)).toHaveText(USER);
  await expect(rows.nth(1).getByRole("cell").nth(5)).toHaveText("web");

  await page.goto(`/deleted-items/docs/${removed.id}`);
  await expect(page.getByRole("article").getByText(/^Deleted /)).toHaveText(by("bob", "mcp"));
  expect(errors).toEqual([]);
});
