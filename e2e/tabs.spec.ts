import type { Page } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { createFolder, createPage, createTab, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

/** The links of the folder's navigation bar, in display order. */
function navLinks(page: Page) {
  return page.getByRole("navigation", { name: "Folder" }).getByRole("link");
}

/** The links of the page list, in display order. */
function listLinks(page: Page) {
  return page.getByRole("list", { name: "Pages" }).getByRole("link");
}

async function expectNotFound(page: Page, address: string) {
  const response = await page.goto(address);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
}

test("creating a tab through the dialog shows the new tab", async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto("/folders/handbook");
  await expect(navLinks(page)).toHaveText(["handbook", "All pages"]);
  await page.getByRole("link", { name: "New tab" }).click();

  await expect(page).toHaveURL("/folders/handbook?action=new-tab");
  const dialog = page.getByRole("dialog", { name: "New tab" });
  const name = dialog.getByLabel("Name");
  await expect(name).toHaveValue("");
  await expect(name).toBeFocused();
  await name.fill(" guides ");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides");
  await expect(page).toHaveTitle("guides – handbook – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: "handbook" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "guides" })).toBeVisible();
  await expect(page.getByText("No pages yet")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(navLinks(page)).toHaveText(["handbook", "guides", "All pages"]);
  const stored = await getTestDb().tab.findMany();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ name: "guides", folderId: handbook.id });
  expect(errors).toEqual([]);
});

test("an invalid or taken tab name shows the error at the name field and keeps the entered name", async ({ page }) => {
  const errors = collectErrors(page);
  await createTab({ folder: handbook, name: "taken" });

  await page.goto("/folders/handbook?action=new-tab");
  const dialog = page.getByRole("dialog", { name: "New tab" });
  const name = dialog.getByLabel("Name");

  for (const [entered, error] of [
    ["Bad Name", "Use lowercase letters, digits and single hyphens"],
    ["guides.md", "Use lowercase letters, digits and single hyphens"],
    ["", "Name is required"],
    ["taken", "Name is already in use"],
  ] as const) {
    await name.fill(entered);
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(name).toHaveAccessibleDescription(error);
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveValue(entered);
    await expect(name).toBeFocused();
  }
  await expect(page).toHaveURL("/folders/handbook?action=new-tab");
  expect(await getTestDb().tab.count()).toBe(1);
  expect(errors).toEqual([]);
});

test("the same tab name in two folders gives two tabs", async ({ page }) => {
  const archive = await createFolder({ name: "archive" });
  await createTab({ folder: archive, name: "guides" });

  await page.goto("/folders/handbook?action=new-tab");
  const dialog = page.getByRole("dialog", { name: "New tab" });
  await dialog.getByLabel("Name").fill("guides");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides");
  const stored = await getTestDb().tab.findMany({ where: { name: "guides" }, select: { folderId: true } });
  expect(stored.map(({ folderId }) => folderId).sort()).toEqual([handbook.id, archive.id].sort());

  await page.goto("/folders/archive/guides");
  await expect(page.getByRole("heading", { level: 1, name: "archive" })).toBeVisible();
  await expect(navLinks(page)).toHaveText(["archive", "guides", "All pages"]);
});

test("renaming a tab shows it at its new address with its pages and the old address shows the not-found page", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const tab = await createTab({ folder: handbook, name: "old-tab" });
  await createTab({ folder: handbook, name: "taken" });
  await createPage({ tab, name: "inside", title: "Inside the tab" });

  await page.goto("/folders/handbook/old-tab");
  await page.getByRole("main").getByRole("link", { name: "Rename" }).click();

  await expect(page).toHaveURL("/folders/handbook/old-tab?action=rename");
  const dialog = page.getByRole("dialog", { name: "Rename tab" });
  const name = dialog.getByLabel("Name");
  await expect(name).toHaveValue("old-tab");
  await expect(name).toBeFocused();

  await name.fill("taken");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(name).toHaveAccessibleDescription("Name is already in use");
  await expect(name).toHaveValue("taken");

  await name.fill("new-tab");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/new-tab");
  await expect(page.getByRole("heading", { level: 2, name: "new-tab" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(navLinks(page)).toHaveText(["handbook", "new-tab", "taken", "All pages"]);
  await expect(listLinks(page)).toHaveText([/^Inside the tab/]);
  await expect(listLinks(page)).toHaveAttribute("href", "/folders/handbook/new-tab/inside.md");
  expect((await getTestDb().tab.findUniqueOrThrow({ where: { id: tab.id } })).name).toBe("new-tab");
  expect(errors).toEqual([]);

  await page.goto("/folders/handbook/new-tab/inside.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Inside the tab"]);

  for (const oldAddress of ["/folders/handbook/old-tab", "/folders/handbook/old-tab/inside.md"]) {
    await expectNotFound(page, oldAddress);
  }
});

test("cancelling the tab dialogs returns to the address without the query string", async ({ page }) => {
  await createTab({ folder: handbook, name: "guides" });

  await page.goto("/folders/handbook?action=new-tab");
  await page.getByRole("dialog", { name: "New tab" }).getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL("/folders/handbook");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto("/folders/handbook/guides?action=rename");
  await page.getByRole("dialog", { name: "Rename tab" }).getByLabel("Name").fill("other");
  await page.getByRole("dialog", { name: "Rename tab" }).getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await getTestDb().tab.findFirstOrThrow()).name).toBe("guides");
});

test("the navigation bar lists the folder and its tabs by name and marks the current entry", async ({ page }) => {
  const other = await createFolder({ name: "other" });
  await createTab({ folder: handbook, name: "meetings" });
  await createTab({ folder: handbook, name: "archive" });
  await createTab({ folder: handbook, name: "guides" });
  await createTab({ folder: other, name: "elsewhere" });

  await page.goto("/folders/handbook");

  await expect(navLinks(page)).toHaveText(["handbook", "archive", "guides", "meetings", "All pages"]);
  await expect(navLinks(page).nth(0)).toHaveAttribute("href", "/folders/handbook");
  await expect(navLinks(page).nth(2)).toHaveAttribute("href", "/folders/handbook/guides");
  await expect(navLinks(page).nth(0)).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Folder" }).locator("[aria-current]")).toHaveCount(1);

  await navLinks(page).nth(2).click();

  await expect(page).toHaveURL("/folders/handbook/guides");
  await expect(navLinks(page)).toHaveText(["handbook", "archive", "guides", "meetings", "All pages"]);
  await expect(navLinks(page).nth(2)).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Folder" }).locator("[aria-current]")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "New tab" })).toHaveAttribute("href", "/folders/handbook?action=new-tab");

  await navLinks(page).nth(0).click();
  await expect(page).toHaveURL("/folders/handbook");
});

test("a page can be created in a tab, viewed, edited and renamed", async ({ page }) => {
  const errors = collectErrors(page);
  const tab = await createTab({ folder: handbook, name: "guides" });

  await page.goto("/folders/handbook/guides");
  await page.getByRole("link", { name: "New page" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides?action=new");
  await expect(page).toHaveTitle("New page – HippoWiki");
  await expect(page.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/folders/handbook/guides");
  await page.getByLabel("Content").fill("# Setup guide\n\nFirst version");
  await page.getByRole("button", { name: "Save" }).click();
  const saveDialog = page.getByRole("dialog", { name: "Save page" });
  await expect(saveDialog.getByLabel("Name")).toHaveAccessibleDescription(
    "Address: /folders/handbook/guides/setup-guide.md",
  );
  await saveDialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/setup-guide.md");
  await expect(page).toHaveTitle("Setup guide – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Setup guide"]);
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb.getByRole("listitem")).toHaveText(["Folders", "handbook", "guides", "setup-guide.md"]);
  await expect(breadcrumb.getByRole("link", { name: "guides" })).toHaveAttribute("href", "/folders/handbook/guides");
  const created = await getTestDb().page.findFirstOrThrow();
  expect(created).toMatchObject({ name: "setup-guide", folderId: handbook.id, tabId: tab.id });

  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/setup-guide.md?action=edit");
  await expect(page).toHaveTitle("Edit Setup guide – HippoWiki");
  await page.getByLabel("Content").fill("# Setup guide, edited\n\nSecond version");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/setup-guide.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Setup guide, edited"]);

  await page.getByRole("link", { name: "Rename" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/setup-guide.md?action=rename");
  const renameDialog = page.getByRole("dialog", { name: "Rename page" });
  await renameDialog.getByLabel("Name").fill("setup");
  await renameDialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/setup.md");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
    name: "setup",
    title: "Setup guide, edited",
    folderId: handbook.id,
    tabId: tab.id,
  });

  // The page is listed in its tab, not among the pages placed directly in the folder.
  await breadcrumb.getByRole("link", { name: "guides" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides");
  await expect(listLinks(page)).toHaveText([/^Setup guide, edited.*setup\.md/]);
  await expect(listLinks(page)).toHaveAttribute("href", "/folders/handbook/guides/setup.md");
  await page.goto("/folders/handbook");
  await expect(page.getByText("No pages yet")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a tab lists its pages by name, without the pages of the folder and of other tabs", async ({ page }) => {
  const guides = await createTab({ folder: handbook, name: "guides" });
  const meetings = await createTab({ folder: handbook, name: "meetings" });
  await createPage({ tab: guides, name: "second", title: "Alpha", updatedAt: new Date("2026-02-01T10:00:00Z") });
  await createPage({ tab: guides, name: "first", title: "Omega", updatedAt: new Date("2026-03-01T10:00:00Z") });
  await createPage({ tab: meetings, name: "in-meetings", title: "In meetings" });
  await createPage({ folder: handbook, name: "in-folder", title: "In folder" });

  await page.goto("/folders/handbook/guides");

  const items = page.getByRole("list", { name: "Pages" }).getByRole("listitem");
  await expect(items.getByRole("link")).toHaveText([/^Omega.*first\.md/, /^Alpha.*second\.md/]);
  await expect(items.nth(1).locator("time")).toHaveAttribute("datetime", "2026-02-01T10:00:00.000Z");

  await page.goto("/folders/handbook");
  await expect(listLinks(page)).toHaveText([/^In folder/]);
});

test("a page created on the folder address is placed directly in the folder, also when it has tabs", async ({
  page,
}) => {
  await createTab({ folder: handbook, name: "guides" });

  await page.goto("/folders/handbook?action=new");
  await page.getByLabel("Content").fill("# Direct page");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog", { name: "Save page" }).getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/direct-page.md");
  expect(await getTestDb().page.findFirstOrThrow()).toMatchObject({ folderId: handbook.id, tabId: null });
});

test("overview.md can exist directly in a folder and in two of its tabs, but only once in the same tab", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createTab({ folder: handbook, name: "meetings" });
  await createPage({ folder: handbook, name: "overview", content: "# Folder overview" });
  await createPage({ tab: guides, name: "overview", content: "# Guides overview" });

  // The name is taken in the folder and in the other tab, but free in this tab.
  await page.goto("/folders/handbook/meetings?action=new");
  await page.getByLabel("Content").fill("# Overview\n\nMeetings overview");
  await page.getByRole("button", { name: "Save" }).click();
  const dialog = page.getByRole("dialog", { name: "Save page" });
  await expect(dialog.getByLabel("Name")).toHaveValue("overview");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/meetings/overview.md");
  expect(await getTestDb().page.count({ where: { name: "overview", folderId: handbook.id } })).toBe(3);

  await page.goto("/folders/handbook/overview.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Folder overview"]);
  await page.goto("/folders/handbook/guides/overview.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Guides overview"]);
  await page.goto("/folders/handbook/meetings/overview.md");
  await expect(page.getByRole("article").getByText("Meetings overview")).toBeVisible();

  // A second overview in the same tab is refused.
  await page.goto("/folders/handbook/meetings?action=new");
  await page.getByLabel("Content").fill("# Overview\n\nA second one");
  await page.getByRole("button", { name: "Save" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByLabel("Name")).toHaveAccessibleDescription("Name is already in use");
  await expect(dialog.getByLabel("Name")).toHaveValue("overview");
  await expect(page).toHaveURL("/folders/handbook/meetings?action=new");
  expect(await getTestDb().page.count()).toBe(3);

  // And so is a second overview placed directly in the folder.
  await page.goto("/folders/handbook?action=new");
  await page.getByLabel("Content").fill("# Overview\n\nA second one");
  await page.getByRole("button", { name: "Save" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByLabel("Name")).toHaveAccessibleDescription("Name is already in use");
  expect(await getTestDb().page.count()).toBe(3);
  expect(errors).toEqual([]);
});

test("renaming a page in a tab to a name taken in the same tab is refused, a name taken elsewhere is free", async ({
  page,
}) => {
  const guides = await createTab({ folder: handbook, name: "guides" });
  const meetings = await createTab({ folder: handbook, name: "meetings" });
  await createPage({ tab: guides, name: "taken-here", title: "Taken here" });
  await createPage({ tab: meetings, name: "taken-in-other-tab", title: "Other tab" });
  await createPage({ folder: handbook, name: "taken-in-folder", title: "Folder" });
  const renamed = await createPage({ tab: guides, name: "renamed", title: "Renamed" });

  await page.goto("/folders/handbook/guides/renamed.md?action=rename");
  const dialog = page.getByRole("dialog", { name: "Rename page" });
  const name = dialog.getByLabel("Name");
  await name.fill("taken-here");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(name).toHaveAccessibleDescription("Name is already in use");

  await name.fill("taken-in-other-tab");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/taken-in-other-tab.md");

  await page.goto("/folders/handbook/guides/taken-in-other-tab.md?action=rename");
  await name.fill("taken-in-folder");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/taken-in-folder.md");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: renamed.id } })).toMatchObject({
    name: "taken-in-folder",
    tabId: guides.id,
  });
});

test("a tab guides and a page guides.md in the same folder each have their own address", async ({ page }) => {
  const errors = collectErrors(page);
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ tab: guides, name: "inside", title: "Inside the tab" });

  // The page is created through the form, so the name check against the tab name is exercised as well.
  await page.goto("/folders/handbook?action=new");
  await page.getByLabel("Content").fill("# Guides\n\nThe page named like the tab");
  await page.getByRole("button", { name: "Save" }).click();
  const dialog = page.getByRole("dialog", { name: "Save page" });
  await expect(dialog.getByLabel("Name")).toHaveValue("guides");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides.md");
  await expect(page.getByRole("article").getByText("The page named like the tab")).toBeVisible();

  await page.goto("/folders/handbook/guides");
  await expect(page.getByRole("heading", { level: 2, name: "guides" })).toBeVisible();
  await expect(listLinks(page)).toHaveText([/^Inside the tab/]);

  // And the other way round: a tab named like an existing page.
  await createPage({ folder: handbook, name: "meetings", title: "Meetings page" });
  await page.goto("/folders/handbook?action=new-tab");
  await page.getByRole("dialog", { name: "New tab" }).getByLabel("Name").fill("meetings");
  await page.getByRole("dialog", { name: "New tab" }).getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/meetings");
  await page.goto("/folders/handbook/meetings.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Meetings page"]);
  expect(errors).toEqual([]);
});

test("saving a page into a tab that no longer exists shows an error and keeps the values", async ({ page }) => {
  const tab = await createTab({ folder: handbook, name: "guides" });

  await page.goto("/folders/handbook/guides?action=new");
  await page.getByLabel("Content").fill("# Orphan\n\nContent that must not get lost");
  await page.getByRole("button", { name: "Save" }).click();
  const dialog = page.getByRole("dialog", { name: "Save page" });
  await getTestDb().tab.delete({ where: { id: tab.id } });
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("This tab no longer exists.");
  await expect(dialog.getByLabel("Name")).toHaveValue("orphan");
  await expect(page.getByLabel("Content")).toHaveValue("# Orphan\n\nContent that must not get lost");
  expect(await getTestDb().page.count()).toBe(0);
});

test("the database refuses a page whose tab belongs to another folder", async () => {
  const other = await createFolder({ name: "other" });
  const foreignTab = await createTab({ folder: other, name: "foreign" });

  await expect(
    getTestDb().page.create({
      data: {
        name: "misplaced",
        title: "Misplaced",
        content: "# Misplaced",
        folderId: handbook.id,
        tabId: foreignTab.id,
      },
    }),
  ).rejects.toMatchObject({ code: "P2003" });
  expect(await getTestDb().page.count()).toBe(0);
});

for (const address of [
  // An unknown or malformed tab, and the tab of another folder.
  "/folders/handbook/no-such-tab",
  "/folders/handbook/Guides",
  "/folders/handbook/guides.MD",
  "/folders/handbook/elsewhere",
  "/folders/no-such-folder/guides",
  // A page in the wrong place.
  "/folders/handbook/meetings/in-guides.md",
  "/folders/handbook/in-guides.md",
  "/folders/handbook/guides/in-folder.md",
  "/folders/other/guides/in-guides.md",
  "/folders/handbook/no-such-tab/in-guides.md",
  // A page address in a tab without or with a wrong suffix, and with further segments.
  "/folders/handbook/guides/in-guides",
  "/folders/handbook/guides/in-guides.MD",
  "/folders/handbook/guides/in-guides.md/more",
  "/folders/handbook/guides/meetings",
  // Actions that the address does not have.
  "/folders/handbook/guides?action=edit",
  "/folders/handbook/guides?action=delete",
  "/folders/handbook/guides?action=new-tab",
  "/folders/handbook/guides?action=new&action=new",
  "/folders/handbook/guides/in-guides.md?action=new",
  "/folders/handbook/guides/in-guides.md?action=new-tab",
  "/folders/handbook/guides/in-guides.md?action=delete",
  "/folders/handbook?action=new-tab&action=new-tab",
]) {
  test(`${address} shows the not-found page`, async ({ page }) => {
    const other = await createFolder({ name: "other" });
    const guides = await createTab({ folder: handbook, name: "guides" });
    await createTab({ folder: handbook, name: "meetings" });
    await createTab({ folder: other, name: "elsewhere" });
    await createPage({ tab: guides, name: "in-guides", title: "In guides" });
    await createPage({ folder: handbook, name: "in-folder", title: "In folder" });

    await expectNotFound(page, address);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
