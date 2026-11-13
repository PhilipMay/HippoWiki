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

const CONTENT = "# Removed page\n\n- First point\n- Second point";

/** Creates a deleted page of the handbook folder with the given name. */
function createDeletedPage(name = "removed") {
  return createPage({ folder: handbook, name, content: CONTENT, deletedAt: new Date("2026-11-01T10:00:00Z") });
}

/** The "Restore page" dialog. */
function restoreDialog(page: Page) {
  return page.getByRole("dialog", { name: "Restore page" });
}

/** Opens the deleted page and its "Restore page" dialog through the "Restore" button. */
async function openRestoreDialog(page: Page, id: string) {
  await page.goto(`/deleted-pages/handbook/${id}`);
  await page.getByRole("main").getByRole("link", { name: "Restore" }).click();
  await expect(page).toHaveURL(`/deleted-pages/handbook/${id}?action=restore`);
  const dialog = restoreDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The logged-in user of the tests, who makes every change through the GUI. */
const USER = KNOWN_USER.name;

/** Text that ends with "by <user>", as the lists and views show the last editor. */
function by(user: string): RegExp {
  return new RegExp(`by ${user}$`);
}

test("restoring a page directly into the folder under its old name leads to it", async ({ page }) => {
  const errors = collectErrors(page);
  const removed = await createDeletedPage();

  const dialog = await openRestoreDialog(page, removed.id);
  await expect(dialog.getByLabel("Name")).toHaveValue("removed");
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/removed.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Removed page"]);
  await expect(page.getByRole("article").getByRole("listitem")).toHaveText(["First point", "Second point"]);
  const stored = await getTestDb().page.findUniqueOrThrow({ where: { id: removed.id } });
  expect(stored).toMatchObject({ name: "removed", content: CONTENT, tabId: null, deletedAt: null });

  await page.goto("/folders/handbook");
  await expect(page.getByRole("list", { name: "Contents" }).getByRole("link")).toHaveText([/^Removed page/]);
  await page.goto("/folders/handbook?view=all");
  await expect(page.getByRole("table", { name: "All pages" }).getByRole("link")).toHaveText(["removed.md"]);
  await page.goto("/deleted-pages/handbook");
  await expect(page.getByText("No deleted pages")).toBeVisible();
  expect(errors).toEqual([]);
});

test("restoring a page into a tab under a new name leads to its new address", async ({ page }) => {
  const errors = collectErrors(page);
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createTab({ folder: handbook, name: "meetings" });
  const removed = await createDeletedPage();
  const other = await createDeletedPage("other");

  const dialog = await openRestoreDialog(page, removed.id);
  await expect(dialog.getByRole("radio")).toHaveCount(3);
  await dialog.getByLabel("Name").fill("restored");
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/restored.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Removed page"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: removed.id } })).toMatchObject({
    name: "restored",
    content: CONTENT,
    tabId: guides.id,
    deletedAt: null,
  });

  await page.goto("/folders/handbook/guides");
  await expect(page.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^Removed page/]);
  await page.goto("/folders/handbook?view=all");
  await expect(page.getByRole("table", { name: "All pages" }).getByRole("link")).toHaveText(["restored.md"]);
  await page.goto("/deleted-pages/handbook");
  const table = page.getByRole("table", { name: "Deleted pages" });
  await expect(table.getByRole("link")).toHaveText(["other"]);
  await expect(table.getByRole("link")).toHaveAttribute("href", `/deleted-pages/handbook/${other.id}`);
  expect(errors).toEqual([]);
});

test("no place is preselected, and the address appears once a place is chosen", async ({ page }) => {
  await createTab({ folder: handbook, name: "guides" });
  const removed = await createDeletedPage();

  const dialog = await openRestoreDialog(page, removed.id);
  const name = dialog.getByLabel("Name");
  for (const radio of await dialog.getByRole("radio").all()) await expect(radio).not.toBeChecked();
  await expect(name).toHaveAccessibleDescription("");

  await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
  await expect(name).toHaveAccessibleDescription("Address: /folders/handbook/removed.md");
  await name.fill("renamed");
  await expect(name).toHaveAccessibleDescription("Address: /folders/handbook/renamed.md");
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await expect(name).toHaveAccessibleDescription("Address: /folders/handbook/guides/renamed.md");
});

test("saving without a place shows choose a place", async ({ page }) => {
  const removed = await createDeletedPage();

  const dialog = await openRestoreDialog(page, removed.id);
  await dialog.getByRole("button", { name: "Save" }).click();

  const places = dialog.getByRole("radiogroup", { name: "Place" });
  await expect(places).toHaveAccessibleDescription("Choose a place");
  await expect(dialog.getByRole("radio", { name: "Directly in the folder" })).toBeFocused();
  await expect(page).toHaveURL(`/deleted-pages/handbook/${removed.id}?action=restore`);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: removed.id } })).toEqual(removed);

  await dialog.getByLabel("Name").fill("");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByLabel("Name")).toHaveAccessibleDescription("Name is required");
  await expect(places).toHaveAccessibleDescription("Choose a place");
  await expect(dialog.getByLabel("Name")).toBeFocused();
});

test("a place chosen while the dialog fades in keeps the focus once the dialog has entered", async ({ page }) => {
  const removed = await createDeletedPage();
  // With the fake clock paused, the fade-in of the dialog does not end until the clock runs, so the place is chosen
  // before the dialog has entered, as on a slow machine or by a quick user.
  await page.clock.install({ time: new Date("2026-11-12T10:00:00Z") });
  await page.goto(`/deleted-pages/handbook/${removed.id}`);
  await page.clock.pauseAt(new Date("2026-11-12T11:00:00Z"));

  await page.getByRole("main").getByRole("link", { name: "Restore" }).click();
  const dialog = restoreDialog(page);
  const folderPlace = dialog.getByRole("radio", { name: "Directly in the folder" });
  await folderPlace.check();
  await expect(folderPlace).toBeFocused();

  await page.clock.runFor(1000);
  await expect(folderPlace).toBeFocused();
});

test("a name that is taken at the chosen place shows an error and keeps name and place", async ({ page }) => {
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ tab: guides, name: "taken", title: "Taken" });
  const removed = await createDeletedPage();

  const dialog = await openRestoreDialog(page, removed.id);
  await dialog.getByLabel("Name").fill("taken");
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByLabel("Name")).toHaveAccessibleDescription("Name is already in use");
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await expect(dialog.getByLabel("Name")).toHaveValue("taken");
  await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: removed.id } })).toEqual(removed);

  // The same name is free directly in the folder.
  await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/taken.md");
});

test("cancel leads back to the deleted page", async ({ page }) => {
  const removed = await createDeletedPage();

  const dialog = await openRestoreDialog(page, removed.id);
  await dialog.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL(`/deleted-pages/handbook/${removed.id}`);
  await expect(restoreDialog(page)).toHaveCount(0);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: removed.id } })).toEqual(removed);
});

test("the Escape key leads back to the deleted page", async ({ page }) => {
  const removed = await createDeletedPage();

  await openRestoreDialog(page, removed.id);
  await page.keyboard.press("Escape");

  await expect(page).toHaveURL(`/deleted-pages/handbook/${removed.id}`);
  await expect(restoreDialog(page)).toHaveCount(0);
});

test("restoring a page that was restored in the meantime shows an error in the dialog", async ({ page }) => {
  const removed = await createDeletedPage();

  const dialog = await openRestoreDialog(page, removed.id);
  await getTestDb().page.update({ where: { id: removed.id }, data: { deletedAt: null } });
  await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("This page no longer exists.");
  await expect(dialog.getByLabel("Name")).toHaveValue("removed");
});

test("the restored page shows the logged-in user who restored it", async ({ page }) => {
  const errors = collectErrors(page);
  const bob = await createUser({ name: "bob" });
  const removed = await createPage({
    folder: handbook,
    name: "removed",
    content: CONTENT,
    deletedAt: new Date("2026-11-01T10:00:00Z"),
    editor: bob,
  });

  const dialog = await openRestoreDialog(page, removed.id);
  await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/removed.md");
  await expect(page.getByText(/^Last updated /)).toHaveText(by(USER));
  await page.goto("/folders/handbook");
  await expect(page.getByRole("list", { name: "Contents" }).getByRole("listitem")).toHaveText([by(USER)]);
  expect(errors).toEqual([]);
});
