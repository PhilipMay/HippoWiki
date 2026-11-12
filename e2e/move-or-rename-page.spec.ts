import type { Page } from "@playwright/test";

import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import { PLACE_FIELD } from "@/features/pages/schema";

import { collectErrors } from "./support/browser";
import { createFolder, createPage, createTab, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;
let guides: Awaited<ReturnType<typeof createTab>>;
let meetings: Awaited<ReturnType<typeof createTab>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
  // Created out of order: the dialog lists the tabs by name.
  meetings = await createTab({ folder: handbook, name: "meetings" });
  guides = await createTab({ folder: handbook, name: "guides" });
});

/** The "Move or rename page" dialog. */
function dialogOf(page: Page) {
  return page.getByRole("dialog", { name: "Move or rename page" });
}

function breadcrumbItems(page: Page) {
  return page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem");
}

async function expectNotFound(page: Page, address: string) {
  const response = await page.goto(address);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
}

test("Move or rename opens the dialog with the current name, place and address", async ({ page }) => {
  const errors = collectErrors(page);
  const other = await createFolder({ name: "other" });
  await createTab({ folder: other, name: "elsewhere" });
  await createPage({ folder: handbook, name: "overview", title: "Overview" });

  await page.goto("/folders/handbook/overview.md");
  await page.getByRole("link", { name: "Move or rename" }).click();

  await expect(page).toHaveURL("/folders/handbook/overview.md?action=move-or-rename");
  await expect(page).toHaveTitle("Overview – HippoWiki");
  const dialog = dialogOf(page);
  const name = dialog.getByLabel("Name");
  await expect(name).toHaveValue("overview");
  await expect(name).toBeFocused();
  await expect(name).toHaveAccessibleDescription("Address: /folders/handbook/overview.md");
  // The folder itself and its tabs by name; tabs of other folders are no choice.
  const places = dialog.getByRole("radiogroup", { name: "Place" });
  await expect(places.getByRole("radio")).toHaveCount(3);
  await expect(places.locator("label")).toHaveText(["Directly in the folder", "Tab guides", "Tab meetings"]);
  await expect(dialog.getByRole("radio", { name: "Directly in the folder" })).toBeChecked();
  // The page stays visible behind the dialog.
  await expect(page.getByRole("article", { includeHidden: true })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("the address follows the typed name and the chosen place", async ({ page }) => {
  await createPage({ tab: guides, name: "overview", title: "Overview" });

  await page.goto("/folders/handbook/guides/overview.md?action=move-or-rename");
  const dialog = dialogOf(page);
  const name = dialog.getByLabel("Name");
  await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();
  await expect(name).toHaveAccessibleDescription("Address: /folders/handbook/guides/overview.md");

  await name.fill(" summary ");
  await expect(name).toHaveAccessibleDescription("Address: /folders/handbook/guides/summary.md");
  await dialog.getByRole("radio", { name: "Tab meetings" }).check();
  await expect(name).toHaveAccessibleDescription("Address: /folders/handbook/meetings/summary.md");
  await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
  await expect(name).toHaveAccessibleDescription("Address: /folders/handbook/summary.md");
});

test("renaming a page in the folder shows it at its new address", async ({ page }) => {
  const errors = collectErrors(page);
  const renamed = await createPage({ folder: handbook, name: "old-name", content: "# Renamed page\n\nBody" });

  await page.goto("/folders/handbook/old-name.md");
  await page.getByRole("link", { name: "Move or rename" }).click();
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill(" new-name ");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/new-name.md");
  await expect(page).toHaveTitle("Renamed page – HippoWiki");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(breadcrumbItems(page)).toHaveText(["Folders", "handbook", "new-name.md"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: renamed.id } })).toMatchObject({
    name: "new-name",
    title: "Renamed page",
    content: "# Renamed page\n\nBody",
    folderId: handbook.id,
    tabId: null,
  });
  expect(errors).toEqual([]);

  for (const oldAddress of ["/folders/handbook/old-name.md", "/folders/handbook/old-name.md?action=edit"]) {
    await expectNotFound(page, oldAddress);
  }
});

test("renaming a page in a tab keeps it in the tab", async ({ page }) => {
  const renamed = await createPage({ tab: guides, name: "old-name", content: "# Renamed page\n\nBody" });

  await page.goto("/folders/handbook/guides/old-name.md");
  await page.getByRole("link", { name: "Move or rename" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/old-name.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("new-name");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/new-name.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Renamed page"]);
  await expect(breadcrumbItems(page)).toHaveText(["Folders", "handbook", "guides", "new-name.md"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: renamed.id } })).toMatchObject({
    name: "new-name",
    title: "Renamed page",
    content: "# Renamed page\n\nBody",
    tabId: guides.id,
  });

  await expectNotFound(page, "/folders/handbook/guides/old-name.md");
});

test("moving a page from the folder into a tab shows it at its new address", async ({ page }) => {
  const errors = collectErrors(page);
  const moved = await createPage({ folder: handbook, name: "moved", content: "# Moved page\n\nBody" });

  await page.goto("/folders/handbook/moved.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/moved.md");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Moved page"]);
  await expect(breadcrumbItems(page)).toHaveText(["Folders", "handbook", "guides", "moved.md"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: moved.id } })).toMatchObject({
    name: "moved",
    title: "Moved page",
    content: "# Moved page\n\nBody",
    folderId: handbook.id,
    tabId: guides.id,
  });
  expect(errors).toEqual([]);

  await expectNotFound(page, "/folders/handbook/moved.md");
});

test("moving a page from a tab back to the folder shows it at its new address", async ({ page }) => {
  const moved = await createPage({ tab: guides, name: "moved", title: "Moved page" });

  await page.goto("/folders/handbook/guides/moved.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/moved.md");
  await expect(breadcrumbItems(page)).toHaveText(["Folders", "handbook", "moved.md"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: moved.id } })).toMatchObject({
    name: "moved",
    folderId: handbook.id,
    tabId: null,
  });

  await expectNotFound(page, "/folders/handbook/guides/moved.md");
});

test("moving a page from one tab to another shows it at its new address", async ({ page }) => {
  const moved = await createPage({ tab: guides, name: "moved", title: "Moved page" });

  await page.goto("/folders/handbook/guides/moved.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByRole("radio", { name: "Tab meetings" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/meetings/moved.md");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: moved.id } })).toMatchObject({
    folderId: handbook.id,
    tabId: meetings.id,
  });

  await expectNotFound(page, "/folders/handbook/guides/moved.md");
  // The page is listed in its new tab only.
  await page.goto("/folders/handbook/meetings");
  await expect(page.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^Moved page/]);
  await page.goto("/folders/handbook/guides");
  await expect(page.getByText("No pages yet")).toBeVisible();
});

test("renaming and moving a page together shows it at its new address", async ({ page }) => {
  const changed = await createPage({ tab: guides, name: "old-name", content: "# Changed page\n\nBody" });

  await page.goto("/folders/handbook/guides/old-name.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("new-name");
  await dialog.getByRole("radio", { name: "Tab meetings" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/meetings/new-name.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Changed page"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: changed.id } })).toMatchObject({
    name: "new-name",
    title: "Changed page",
    content: "# Changed page\n\nBody",
    tabId: meetings.id,
  });

  await expectNotFound(page, "/folders/handbook/guides/old-name.md");
  await expectNotFound(page, "/folders/handbook/guides/new-name.md");
});

test("a name taken at the target shows the error at the name field and the page stays unchanged", async ({ page }) => {
  const errors = collectErrors(page);
  const other = await createFolder({ name: "other" });
  await createPage({ tab: guides, name: "overview", title: "Guides overview" });
  await createPage({ folder: handbook, name: "taken", title: "Folder page" });
  await createPage({ folder: other, name: "free-here", title: "Page of another folder" });
  const kept = await createPage({ tab: meetings, name: "overview", title: "Meetings overview" });

  await page.goto("/folders/handbook/meetings/overview.md?action=move-or-rename");
  const dialog = dialogOf(page);
  const name = dialog.getByLabel("Name");

  // Moving only: the same name is taken in the chosen tab.
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription("Name is already in use");
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("overview");
  await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();
  await expect(page).toHaveURL("/folders/handbook/meetings/overview.md?action=move-or-rename");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);

  // Renaming and moving: the new name is taken directly in the folder.
  await name.fill("taken");
  await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(name).toHaveAccessibleDescription("Name is already in use");
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("taken");
  await expect(dialog.getByRole("radio", { name: "Directly in the folder" })).toBeChecked();
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);

  // A name that only a page of another folder uses is free.
  await name.fill("free-here");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/free-here.md");
  expect(errors).toEqual([]);
});

test("an invalid name shows the error at the name field and writes nothing", async ({ page }) => {
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=move-or-rename");
  const dialog = dialogOf(page);
  const name = dialog.getByLabel("Name");
  await name.fill("Not Valid");
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(name).toHaveAccessibleDescription("Use lowercase letters, digits and single hyphens");
  await expect(name).toHaveValue("Not Valid");
  await expect(name).toBeFocused();
  await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();

  await name.fill(" ");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(name).toHaveAccessibleDescription("Name is required");

  await expect(page).toHaveURL("/folders/handbook/kept.md?action=move-or-rename");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
});

test("a page whose content is above the content limit can be moved and renamed", async ({ page }) => {
  // Stored directly, as if the limit had been lowered after the page was saved.
  const content = `# Big page\n\n${"x".repeat(CONTENT_MAX_LENGTH)}`;
  expect(content.length).toBeGreaterThan(CONTENT_MAX_LENGTH);
  const big = await createPage({ folder: handbook, name: "big", content });

  await page.goto("/folders/handbook/big.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("still-big");
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/still-big.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Big page"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: big.id } })).toMatchObject({
    name: "still-big",
    tabId: guides.id,
    title: "Big page",
    content,
  });
});

test("saving the dialog unchanged keeps the page where it is", async ({ page }) => {
  const kept = await createPage({ tab: guides, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/guides/kept.md?action=move-or-rename");
  await dialogOf(page).getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/kept.md");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toMatchObject({
    name: "kept",
    tabId: guides.id,
  });
});

test("Cancel returns to the page and changes nothing", async ({ page }) => {
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("other-name");
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL("/folders/handbook/kept.md");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
});

test("the Escape key returns to the page and changes nothing", async ({ page }) => {
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("other-name");
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await page.keyboard.press("Escape");

  await expect(page).toHaveURL("/folders/handbook/kept.md");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
});

test("moving into a tab that no longer exists shows an error and the page stays where it was", async ({ page }) => {
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("new-name");
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await getTestDb().tab.delete({ where: { id: guides.id } });
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("This tab no longer exists.");
  await expect(dialog.getByLabel("Name")).toHaveValue("new-name");
  await expect(page).toHaveURL("/folders/handbook/kept.md?action=move-or-rename");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
});

test("a crafted move into a tab of another folder is refused", async ({ page }) => {
  const other = await createFolder({ name: "other" });
  const foreignTab = await createTab({ folder: other, name: "foreign" });
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=move-or-rename");
  const dialog = dialogOf(page);
  const save = dialog.getByRole("button", { name: "Save" });
  // Send the tab of another folder as the target, as a crafted request would. It is set in the submitted form data, not
  // in a radio button: React writes a radio button's value back whenever it renders the button again, e.g. on focus.
  await save.evaluate(
    (button: HTMLButtonElement, { field, tabId }) =>
      button.form?.addEventListener("formdata", (event) => event.formData.set(field, tabId)),
    { field: PLACE_FIELD, tabId: foreignTab.id },
  );
  await save.click();

  await expect(dialog.getByRole("alert")).toHaveText("This tab no longer exists.");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
  await expectNotFound(page, "/folders/other/foreign/kept.md");
});

test("saving a page that no longer exists shows an error in the dialog", async ({ page }) => {
  const created = await createPage({ folder: handbook, name: "soon-gone", title: "Soon gone" });

  await page.goto("/folders/handbook/soon-gone.md?action=move-or-rename");
  await getTestDb().page.delete({ where: { id: created.id } });
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("new-name");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("This page no longer exists.");
  await expect(dialog.getByLabel("Name")).toHaveValue("new-name");
  expect(await getTestDb().page.count()).toBe(0);
});

test("a folder without tabs offers only the folder itself", async ({ page }) => {
  const plain = await createFolder({ name: "plain" });
  await createPage({ folder: plain, name: "alone", title: "Alone" });

  await page.goto("/folders/plain/alone.md?action=move-or-rename");

  const dialog = dialogOf(page);
  await expect(dialog.getByRole("radio")).toHaveCount(1);
  await expect(dialog.getByRole("radio", { name: "Directly in the folder" })).toBeChecked();
});

for (const address of [
  "/folders/handbook/in-folder.md?action=rename",
  "/folders/handbook/in-folder.md?action=move",
  "/folders/handbook/guides/in-guides.md?action=rename",
  "/folders/handbook/guides/in-guides.md?action=move",
  "/folders/handbook?action=move-or-rename",
  "/folders/handbook/guides?action=move-or-rename",
  "/folders/handbook/in-folder.md?action=move-or-rename&action=move-or-rename",
  "/folders/handbook/no-such-page.md?action=move-or-rename",
  "/folders/handbook/guides/no-such-page.md?action=move-or-rename",
]) {
  test(`${address} shows the not-found page`, async ({ page }) => {
    await createPage({ folder: handbook, name: "in-folder", title: "In folder" });
    await createPage({ tab: guides, name: "in-guides", title: "In guides" });

    await expectNotFound(page, address);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
