import type { Page } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { createFolder, createPage, createTab, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

/** The breadcrumb of the address. */
function breadcrumb(page: Page) {
  return page.getByRole("navigation", { name: "Breadcrumb" });
}

/** The links of the page list on a tab address, in display order. */
function listLinks(page: Page) {
  return page.getByRole("list", { name: "Pages" }).getByRole("link");
}

/** The links of the contents list on a folder address (its pages, then its tabs), in display order. */
function contentsLinks(page: Page) {
  return page.getByRole("list", { name: "Contents" }).getByRole("link");
}

async function expectNotFound(page: Page, address: string) {
  const response = await page.goto(address);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
}

test("creating a tab through the dialog shows the new tab", async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto("/folders/handbook");
  await expect(page.getByRole("list", { name: "Contents" })).toHaveCount(0);
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["guides"]);
  await expect(page.getByText("No pages yet")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(breadcrumb(page).getByRole("listitem")).toHaveText(["Folders", "handbook", "guides"]);
  const stored = await getTestDb().tab.findMany();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ name: "guides", folderId: handbook.id });

  await page.goto("/folders/handbook");
  await expect(contentsLinks(page)).toHaveText([/^guides/]);
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
  await expect(breadcrumb(page).getByRole("listitem")).toHaveText(["Folders", "archive", "guides"]);
  await expect(breadcrumb(page).getByRole("link", { name: "archive" })).toHaveAttribute("href", "/folders/archive");
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["new-tab"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(breadcrumb(page).getByRole("listitem")).toHaveText(["Folders", "handbook", "new-tab"]);
  await expect(listLinks(page)).toHaveText([/^Inside the tab/]);
  await expect(listLinks(page)).toHaveAttribute("href", "/folders/handbook/new-tab/inside.md");
  expect((await getTestDb().tab.findUniqueOrThrow({ where: { id: tab.id } })).name).toBe("new-tab");
  expect(errors).toEqual([]);

  await page.goto("/folders/handbook");
  await expect(contentsLinks(page)).toHaveText([/^new-tab/, /^taken/]);

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

test("the folder address lists its pages by name and then its tabs by name in one list", async ({ page }) => {
  const other = await createFolder({ name: "other" });
  // A page "zulu" before the tab "alpha" shows that pages come first, not a mixed order by name.
  await createTab({ folder: handbook, name: "meetings" });
  await createTab({ folder: handbook, name: "alpha" });
  await createTab({ folder: handbook, name: "guides", updatedAt: new Date("2026-02-01T10:00:00Z") });
  await createTab({ folder: other, name: "elsewhere" });
  await createPage({ folder: handbook, name: "zulu", title: "Zulu page", updatedAt: new Date("2026-03-01T10:00:00Z") });
  await createPage({ folder: handbook, name: "bravo", title: "Bravo page" });

  await page.goto("/folders/handbook");

  const lists = page.getByRole("main").getByRole("list");
  await expect(lists).toHaveCount(1);
  await expect(lists).toHaveAccessibleName("Contents");
  await expect(page.getByRole("heading", { name: "Tabs" })).toHaveCount(0);
  await expect(contentsLinks(page)).toHaveText([
    /^Bravo page.*bravo\.md/,
    /^Zulu page.*zulu\.md/,
    /^alpha/,
    /^guides/,
    /^meetings/,
  ]);
  await expect(contentsLinks(page).nth(1)).toHaveAttribute("href", "/folders/handbook/zulu.md");
  await expect(contentsLinks(page).nth(3)).toHaveAttribute("href", "/folders/handbook/guides");
  const items = page.getByRole("list", { name: "Contents" }).getByRole("listitem");
  await expect(items).toHaveCount(5);
  await expect(items.nth(1).locator("time")).toHaveAttribute("datetime", "2026-03-01T10:00:00.000Z");
  await expect(items.nth(3).locator("time")).toHaveAttribute("datetime", "2026-02-01T10:00:00.000Z");

  await contentsLinks(page).nth(3).click();

  await expect(page).toHaveURL("/folders/handbook/guides");
});

test("the tab address shows the way back to its folder as a breadcrumb and the tab name as heading", async ({
  page,
}) => {
  await createTab({ folder: handbook, name: "guides" });

  await page.goto("/folders/handbook/guides");

  const items = breadcrumb(page).getByRole("listitem");
  await expect(items).toHaveText(["Folders", "handbook", "guides"]);
  await expect(breadcrumb(page).getByRole("link")).toHaveText(["Folders", "handbook"]);
  await expect(breadcrumb(page).getByRole("link", { name: "Folders" })).toHaveAttribute("href", "/folders");
  await expect(breadcrumb(page).getByRole("link", { name: "handbook" })).toHaveAttribute("href", "/folders/handbook");
  await expect(items.nth(2).locator("[aria-current=page]")).toHaveText("guides");
  await expect(breadcrumb(page).locator("[aria-current]")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["guides"]);
  await expect(page.getByRole("navigation", { name: "Folder" })).toHaveCount(0);
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Rename" })).toHaveAttribute(
    "href",
    "/folders/handbook/guides?action=rename",
  );
  await expect(main.getByRole("link", { name: "New page" })).toHaveAttribute(
    "href",
    "/folders/handbook/guides?action=new",
  );
  await expect(main.getByRole("link", { name: "New tab" })).toHaveCount(0);

  await breadcrumb(page).getByRole("link", { name: "handbook" }).click();
  await expect(page).toHaveURL("/folders/handbook");
});

test("a folder without tabs lists only its pages", async ({ page }) => {
  await createPage({ folder: handbook, name: "in-folder", title: "In folder" });

  await page.goto("/folders/handbook");

  await expect(contentsLinks(page)).toHaveText([/^In folder/]);
  await expect(page.getByRole("heading", { name: "Tabs" })).toHaveCount(0);
});

test("a folder with tabs but without pages lists only its tabs, without an empty state", async ({ page }) => {
  await createTab({ folder: handbook, name: "guides" });

  await page.goto("/folders/handbook");

  await expect(contentsLinks(page)).toHaveText([/^guides/]);
  await expect(page.getByText("This folder is empty")).toHaveCount(0);
  await expect(page.getByText("No pages yet")).toHaveCount(0);
});

test("the folder header links to all pages, a new tab and a new page", async ({ page }) => {
  await page.goto("/folders/handbook");

  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Rename" })).toHaveAttribute("href", "/folders/handbook?action=rename");
  await expect(main.getByRole("link", { name: "All pages" })).toHaveAttribute("href", "/folders/handbook?view=all");
  await expect(main.getByRole("link", { name: "New tab" })).toHaveAttribute("href", "/folders/handbook?action=new-tab");
  await expect(main.getByRole("link", { name: "New page" })).toHaveAttribute("href", "/folders/handbook?action=new");
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
  await expect(breadcrumb(page).getByRole("listitem")).toHaveText(["Folders", "handbook", "guides", "setup-guide.md"]);
  await expect(breadcrumb(page).getByRole("link", { name: "guides" })).toHaveAttribute(
    "href",
    "/folders/handbook/guides",
  );
  const created = await getTestDb().page.findFirstOrThrow();
  expect(created).toMatchObject({ name: "setup-guide", folderId: handbook.id, tabId: tab.id });

  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/setup-guide.md?action=edit");
  await expect(page).toHaveTitle("Edit Setup guide – HippoWiki");
  await page.getByLabel("Content").fill("# Setup guide, edited\n\nSecond version");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/setup-guide.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Setup guide, edited"]);

  await page.getByRole("link", { name: "Move or rename" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/setup-guide.md?action=move-or-rename");
  const moveOrRenameDialog = page.getByRole("dialog", { name: "Move or rename page" });
  await moveOrRenameDialog.getByLabel("Name").fill("setup");
  await moveOrRenameDialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/setup.md");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
    name: "setup",
    title: "Setup guide, edited",
    folderId: handbook.id,
    tabId: tab.id,
  });

  // The page is listed in its tab, not among the pages placed directly in the folder.
  await breadcrumb(page).getByRole("link", { name: "guides" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides");
  await expect(listLinks(page)).toHaveText([/^Setup guide, edited.*setup\.md/]);
  await expect(listLinks(page)).toHaveAttribute("href", "/folders/handbook/guides/setup.md");
  await page.goto("/folders/handbook");
  await expect(contentsLinks(page)).toHaveText([/^guides/]);
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
  await expect(contentsLinks(page)).toHaveText([/^In folder/, /^guides/, /^meetings/]);
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

  await page.goto("/folders/handbook/guides/renamed.md?action=move-or-rename");
  const dialog = page.getByRole("dialog", { name: "Move or rename page" });
  const name = dialog.getByLabel("Name");
  await name.fill("taken-here");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(name).toHaveAccessibleDescription("Name is already in use");

  await name.fill("taken-in-other-tab");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/taken-in-other-tab.md");

  await page.goto("/folders/handbook/guides/taken-in-other-tab.md?action=move-or-rename");
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["guides"]);
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
  "/folders/handbook/guides/in-guides.md?action=restore",
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
