import type { Page } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { logInElsewhere } from "./support/auth";
import { collectErrors, expectNotFound } from "./support/browser";
import {
  createFolder,
  createGrant,
  createPage,
  createTab,
  createUser,
  getTestDb,
  resetTestDatabase,
} from "./support/database";
import { editorReady, fillContent } from "./support/editor";
import { callTool, mcpPath } from "./support/mcp";
import { expect, hydrating, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  // The logged-in user is Owner of the folder, unless a test says otherwise.
  handbook = await createFolder({ name: "handbook" });
});

/** The logged-in user of the tests, who makes every change through the GUI. */
const ALICE = { id: KNOWN_USER.id };
const USER = KNOWN_USER.name;

const GONE_MESSAGE = "This tab no longer exists.";

/** The "Delete tab" dialog. */
function deleteDialog(page: Page) {
  return page.getByRole("dialog", { name: "Delete tab" });
}

/** The links of the contents list on a folder address (its pages, then its tabs), in display order. */
function contentsLinks(page: Page) {
  return page.getByRole("list", { name: "Contents" }).getByRole("link");
}

/** The rows of the deleted pages of a folder, without the header row. */
function deletedRows(page: Page) {
  return page
    .getByRole("table", { name: "Deleted items" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });
}

/** Opens the tab at the address, clicks its "Delete" button and checks that the dialog is open at its address. */
async function openDeleteDialog(page: Page, address: string) {
  await page.goto(address);
  await page.getByRole("main").getByRole("link", { name: "Delete" }).click();
  await expect(page).toHaveURL(`${address}?action=delete`);
  await expect(deleteDialog(page)).toBeVisible();
}

/** The pages of the folder as stored, by name, with what a deletion changes. */
function storedPages(folder: { id: string }) {
  return getTestDb().page.findMany({
    where: { folderId: folder.id },
    orderBy: { name: "asc" },
    select: { name: true, tabId: true, deletedAt: true, lastEditedById: true, lastEditedVia: true, version: true },
  });
}

test("a Manager deletes a tab with two pages, which become deleted pages of the Manager", async ({ page }) => {
  const errors = collectErrors(page);
  const team = await createFolder({ name: "team", roles: [{ user: ALICE, role: "manager" }] });
  const bob = await createUser({ name: "bob" });
  const meetngs = await createTab({ folder: team, name: "meetngs" });
  const first = await createPage({ tab: meetngs, name: "monday", title: "Monday", editor: bob, via: "mcp" });
  await createPage({ tab: meetngs, name: "tuesday", title: "Tuesday", editor: bob, via: "mcp" });
  await createPage({ folder: team, name: "intro", title: "Intro" });

  await openDeleteDialog(page, "/folders/team/meetngs");
  await expect(deleteDialog(page)).toHaveAccessibleDescription(
    "Delete the tab meetngs? Its 2 pages are deleted with it. The pages can be restored one by one from the deleted " +
      "items of the folder. The tab itself cannot be restored.",
  );
  await deleteDialog(page).getByRole("button", { name: "Delete" }).click();

  await expect(page).toHaveURL("/folders/team");
  await expect(contentsLinks(page)).toHaveText([/^Intro/]);
  expect(await getTestDb().tab.findUnique({ where: { id: meetngs.id } })).toBeNull();
  const [intro, monday, tuesday] = await storedPages(team);
  expect(intro).toMatchObject({ name: "intro", deletedAt: null });
  for (const deleted of [monday, tuesday]) {
    expect(deleted).toMatchObject({
      tabId: null,
      deletedAt: expect.any(Date),
      lastEditedById: KNOWN_USER.id,
      lastEditedVia: "web",
    });
  }
  expect(monday?.deletedAt).toEqual(tuesday?.deletedAt);
  expect(monday?.version).toBe(first.version + 1);

  await page.getByRole("link", { name: "Deleted items" }).click();
  await expect(page).toHaveURL("/deleted-items/team");
  // Both are deleted at the same time, so their order is not fixed.
  await expect(deletedRows(page)).toHaveCount(2);
  expect((await deletedRows(page).getByRole("link").allTextContents()).sort()).toEqual(["monday", "tuesday"]);
  // Deleted by the logged-in user in the browser, though last changed through MCP before.
  for (const row of await deletedRows(page).all()) {
    await expect(row.getByRole("cell").nth(3)).toHaveText(USER);
    await expect(row.getByRole("cell").nth(4)).toHaveText("web");
  }
  // Nothing tells the tab the pages were in, and nothing offers to restore the tab.
  await expect(page.getByRole("main")).not.toContainText("meetngs");
  await page.goto(`/deleted-items/team/${first.id}`);
  await expect(page.getByRole("article").getByText(/^Deleted /)).toHaveText(new RegExp(`by ${USER} via web$`));
  await expect(page.getByRole("main")).not.toContainText("meetngs");
  expect(errors).toEqual([]);
  // The browser reports the 404 of the not-found page as a console error, so it is checked last.
  await expectNotFound(page, "/folders/team/meetngs");
});

test("an Owner deletes a tab in the same way", async ({ page }) => {
  const archive = await createTab({ folder: handbook, name: "archive" });
  await createPage({ tab: archive, name: "old" });

  await openDeleteDialog(page, "/folders/handbook/archive");
  await deleteDialog(page).getByRole("button", { name: "Delete" }).click();

  await expect(page).toHaveURL("/folders/handbook");
  expect(await getTestDb().tab.count()).toBe(0);
  expect((await storedPages(handbook)).map(({ deletedAt }) => deletedAt)).toEqual([expect.any(Date)]);
});

test("the dialog of a tab with one page and of a tab without pages says so", async ({ page }) => {
  const single = await createTab({ folder: handbook, name: "single" });
  await createPage({ tab: single, name: "only" });
  await createTab({ folder: handbook, name: "empty" });

  await page.goto("/folders/handbook/single?action=delete");
  await expect(deleteDialog(page)).toHaveAccessibleDescription(
    "Delete the tab single? Its 1 page is deleted with it. The pages can be restored one by one from the deleted " +
      "items of the folder. The tab itself cannot be restored.",
  );

  await page.goto("/folders/handbook/empty?action=delete");
  await expect(deleteDialog(page)).toHaveAccessibleDescription(
    "Delete the tab empty? It has no pages, so no page is deleted with it. The tab itself cannot be restored.",
  );
  await deleteDialog(page).getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/folders/handbook");
  expect(await getTestDb().tab.findMany({ select: { name: true } })).toEqual([{ name: "single" }]);
});

test("Cancel and the Escape key lead back to the tab, which keeps its pages", async ({ page }) => {
  const errors = collectErrors(page);
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ tab: guides, name: "setup", title: "Setup" });
  const before = await storedPages(handbook);

  await openDeleteDialog(page, "/folders/handbook/guides");
  await expect(page).toHaveTitle("guides – handbook – HippoWiki");
  await deleteDialog(page).getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides");
  await expect(deleteDialog(page)).toHaveCount(0);

  await page.goto("/folders/handbook/guides?action=delete");
  await expect(deleteDialog(page).getByRole("button", { name: "Delete" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL("/folders/handbook/guides");
  await expect(deleteDialog(page)).toHaveCount(0);

  await expect(page.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^Setup/]);
  expect(await storedPages(handbook)).toEqual(before);
  expect(errors).toEqual([]);
});

test("a page of a deleted tab is restored from the deleted pages into another place, with none preselected", async ({
  page,
}) => {
  const old = await createTab({ folder: handbook, name: "old" });
  await createTab({ folder: handbook, name: "guides" });
  const setup = await createPage({ tab: old, name: "setup", title: "Setup" });

  await openDeleteDialog(page, "/folders/handbook/old");
  await deleteDialog(page).getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/folders/handbook");

  await page.goto(`/deleted-items/handbook/${setup.id}`);
  await page.getByRole("main").getByRole("link", { name: "Restore" }).click();
  const dialog = page.getByRole("dialog", { name: "Restore page" });
  await expect(dialog.getByRole("radio")).toHaveCount(2);
  for (const radio of await dialog.getByRole("radio").all()) await expect(radio).not.toBeChecked();
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/setup.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Setup"]);
});

test("after deleting the tab archive, a new tab archive is created in the same folder", async ({ page }) => {
  const archive = await createTab({ folder: handbook, name: "archive" });
  await createPage({ tab: archive, name: "old" });

  await openDeleteDialog(page, "/folders/handbook/archive");
  await deleteDialog(page).getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/folders/handbook");

  await page.goto("/folders/handbook?action=new-tab");
  await page.getByRole("dialog").getByLabel("Name").fill("archive");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/archive");
  await expect(page.getByRole("heading", { level: 1, name: "archive" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Pages" })).toHaveCount(0);
});

test("the pages in the tab when confirming are deleted, not those of the moment the dialog was opened", async ({
  page,
}) => {
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ tab: guides, name: "stays" });
  const leaves = await createPage({ tab: guides, name: "leaves" });

  await page.goto("/folders/handbook/guides?action=delete");
  await expect(deleteDialog(page)).toContainText("Its 2 pages are deleted with it.");
  // Meanwhile one page is created in the tab, and one is moved out of it.
  await createPage({ tab: guides, name: "late" });
  await getTestDb().page.update({ where: { id: leaves.id }, data: { tabId: null } });
  await deleteDialog(page).getByRole("button", { name: "Delete" }).click();

  await expect(page).toHaveURL("/folders/handbook");
  expect((await storedPages(handbook)).map(({ name, deletedAt }) => [name, deletedAt !== null])).toEqual([
    ["late", true],
    ["leaves", false],
    ["stays", true],
  ]);
});

test("a tab renamed after the dialog was opened is deleted on confirming", async ({ page }) => {
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ tab: guides, name: "setup" });

  await page.goto("/folders/handbook/guides?action=delete");
  await getTestDb().tab.update({ where: { id: guides.id }, data: { name: "manuals" } });
  await deleteDialog(page).getByRole("button", { name: "Delete" }).click();

  await expect(page).toHaveURL("/folders/handbook");
  expect(await getTestDb().tab.count()).toBe(0);
  expect((await storedPages(handbook)).map(({ deletedAt }) => deletedAt)).toEqual([expect.any(Date)]);
});

test("the second of two dialogs of the same tab says that the tab no longer exists and deletes nothing", async ({
  page,
  context,
}) => {
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ tab: guides, name: "setup" });
  const second = hydrating(await context.newPage());

  await page.goto("/folders/handbook/guides?action=delete");
  await second.goto("/folders/handbook/guides?action=delete");
  await deleteDialog(page).getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/folders/handbook");
  // A page placed directly in the folder after the first deletion, which the second must not touch.
  await createPage({ folder: handbook, name: "later" });
  const before = await storedPages(handbook);

  const dialog = deleteDialog(second);
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(dialog.getByRole("alert")).toHaveText(GONE_MESSAGE);
  await expect(dialog.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveCount(0);
  const back = dialog.getByRole("link", { name: "Back to the folder" });
  await expect(back).toHaveAttribute("href", "/folders/handbook");
  await expect(back).toBeFocused();
  expect(await storedPages(handbook)).toEqual(before);

  // Escape leads to the folder as well.
  await second.keyboard.press("Escape");
  await expect(second).toHaveURL("/folders/handbook");
});

test("a Writer whose editor was open on a page of the deleted tab gets the message on saving", async ({
  page,
  browser,
}) => {
  const bob = await createUser({ name: "bob", mustChangePassword: false });
  const team = await createFolder({
    name: "team",
    roles: [
      { user: ALICE, role: "manager" },
      { user: bob, role: "writer" },
    ],
  });
  const guides = await createTab({ folder: team, name: "guides" });
  const plan = await createPage({ tab: guides, name: "plan", content: "# Plan\n\nFirst draft" });
  const other = await logInElsewhere(browser, "bob");
  await other.page.goto("/folders/team/guides/plan.md?action=edit");
  await editorReady(other.page);

  await openDeleteDialog(page, "/folders/team/guides");
  await deleteDialog(page).getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/folders/team");
  const deleted = await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } });

  await fillContent(other.page, "# Plan\n\nBob's version");
  await other.page.getByRole("button", { name: "Save" }).click();

  await expect(other.page.getByRole("main").getByRole("alert")).toHaveText("This page no longer exists.");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).toEqual(deleted);
  await other.context.close();
});

test("the folder list shows the same last change of the folder before and after", async ({ page }) => {
  const bob = await createUser({ name: "bob" });
  const team = await createFolder({
    name: "team",
    editor: bob,
    updatedAt: new Date("2026-03-04T09:00:00Z"),
    roles: [{ user: ALICE, role: "owner" }],
  });
  const guides = await createTab({ folder: team, name: "guides" });
  await createPage({ tab: guides, name: "setup" });
  const item = page.getByRole("list", { name: "Folders" }).getByRole("listitem").filter({ hasText: "team" });

  await page.goto("/folders");
  const before = await item.textContent();
  expect(before).toContain("bob");

  await openDeleteDialog(page, "/folders/team/guides");
  await deleteDialog(page).getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/folders/team");

  await page.goto("/folders");
  await expect(item).toHaveText(before ?? "");
});

test("after the deletion, a Writer connection of MCP lists neither the tab nor its pages and creates no page in it", async ({
  page,
  request,
}) => {
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ tab: guides, name: "setup" });
  await createPage({ folder: handbook, name: "intro" });
  const { accessToken } = await createGrant({ owner: KNOWN_USER, folder: handbook, role: "writer" });
  const writerOfHandbook = { address: mcpPath(handbook, "writer"), token: accessToken };

  await openDeleteDialog(page, "/folders/handbook/guides");
  await deleteDialog(page).getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/folders/handbook");

  const listed = await callTool(request, writerOfHandbook, "list_folder");
  expect(listed.structuredContent).toMatchObject({ tabs: [], pages: [{ name: "intro", tab: null }] });
  const created = await callTool(request, writerOfHandbook, "create_page", {
    content: "# New",
    tab: "guides",
  });
  expect(created.isError).toBe(true);
  expect(created.content[0]?.text).toContain('There is no tab named "guides"');
  expect((await storedPages(handbook)).map(({ name }) => name)).toEqual(["intro", "setup"]);
});

test("the folder page offers no deletion next to its tabs", async ({ page }) => {
  await createTab({ folder: handbook, name: "guides" });

  await page.goto("/folders/handbook");

  await expect(contentsLinks(page)).toHaveText([/^guides/]);
  const main = page.getByRole("main");
  // "Deleted items" is the only control whose name starts like a deletion.
  await expect(main.getByRole("link", { name: /^delete(?!d items$)/i })).toHaveCount(0);
  await expect(main.getByRole("button", { name: /^delete/i })).toHaveCount(0);
});
