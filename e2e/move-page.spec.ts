import { expect, test, type Page } from "@playwright/test";

import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";

import { collectErrors } from "./support/browser";
import { createFolder, createPage, createTab, getTestDb, resetTestDatabase } from "./support/database";

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

/** The "Move page" dialog. */
function moveDialog(page: Page) {
  return page.getByRole("dialog", { name: "Move page" });
}

async function expectNotFound(page: Page, address: string) {
  const response = await page.goto(address);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
}

test("moving a page from the folder into a tab shows it at its new address", async ({ page }) => {
  const errors = collectErrors(page);
  const other = await createFolder({ name: "other" });
  await createTab({ folder: other, name: "elsewhere" });
  const moved = await createPage({ folder: handbook, name: "moved", content: "# Moved page\n\nBody" });

  await page.goto("/folders/handbook/moved.md");
  await page.getByRole("link", { name: "Move" }).click();

  await expect(page).toHaveURL("/folders/handbook/moved.md?action=move");
  const dialog = moveDialog(page);
  // The folder itself and its tabs by name; tabs of other folders are no choice.
  const choices = dialog.getByRole("radiogroup", { name: "Move to" }).getByRole("radio");
  await expect(choices).toHaveCount(3);
  await expect(dialog.getByRole("radiogroup").locator("label")).toHaveText([
    "Directly in the folder",
    "Tab guides",
    "Tab meetings",
  ]);
  await expect(dialog.getByRole("radio", { name: "Directly in the folder" })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "Directly in the folder" })).toBeFocused();
  // The page stays visible behind the dialog.
  await expect(page.getByRole("article", { includeHidden: true })).toHaveCount(1);
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/moved.md");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Moved page"]);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem")).toHaveText([
    "Folders",
    "handbook",
    "guides",
    "moved.md",
  ]);
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

  await page.goto("/folders/handbook/guides/moved.md?action=move");
  const dialog = moveDialog(page);
  await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();
  await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/moved.md");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem")).toHaveText([
    "Folders",
    "handbook",
    "moved.md",
  ]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: moved.id } })).toMatchObject({
    folderId: handbook.id,
    tabId: null,
  });

  await expectNotFound(page, "/folders/handbook/guides/moved.md");
});

test("moving a page from one tab to another shows it at its new address", async ({ page }) => {
  const moved = await createPage({ tab: guides, name: "moved", title: "Moved page" });

  await page.goto("/folders/handbook/guides/moved.md");
  await page.getByRole("link", { name: "Move" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/moved.md?action=move");
  const dialog = moveDialog(page);
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

test("a taken name at the target shows the error and the page stays where it was", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ tab: guides, name: "overview", title: "Guides overview" });
  await createPage({ folder: handbook, name: "overview", title: "Folder overview" });
  const moved = await createPage({ tab: meetings, name: "overview", title: "Meetings overview" });

  await page.goto("/folders/handbook/meetings/overview.md?action=move");
  const dialog = moveDialog(page);
  const group = dialog.getByRole("radiogroup", { name: "Move to" });

  for (const target of ["Tab guides", "Directly in the folder"]) {
    await dialog.getByRole("radio", { name: target }).check();
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(group).toHaveAccessibleDescription("A page with this name already exists there");
    await expect(dialog.getByRole("radio", { name: target })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: target })).toBeFocused();
    await expect(page).toHaveURL("/folders/handbook/meetings/overview.md?action=move");
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: moved.id } })).toEqual(moved);
  }

  // The page is still at its old address.
  await dialog.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL("/folders/handbook/meetings/overview.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Meetings overview"]);
  expect(errors).toEqual([]);
});

test("moving a page whose content is above the content limit succeeds", async ({ page }) => {
  // Stored directly, as if the limit had been lowered after the page was saved.
  const content = `# Big page\n\n${"x".repeat(CONTENT_MAX_LENGTH)}`;
  expect(content.length).toBeGreaterThan(CONTENT_MAX_LENGTH);
  const big = await createPage({ folder: handbook, name: "big", content });

  await page.goto("/folders/handbook/big.md?action=move");
  const dialog = moveDialog(page);
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/big.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Big page"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: big.id } })).toMatchObject({
    tabId: guides.id,
    title: "Big page",
    content,
  });
});

test("saving the move dialog with the current place keeps the page where it is", async ({ page }) => {
  const kept = await createPage({ tab: guides, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/guides/kept.md?action=move");
  await moveDialog(page).getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/kept.md");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toMatchObject({ tabId: guides.id });
});

test("cancelling the move dialog returns to the page and moves nothing", async ({ page }) => {
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=move");
  await moveDialog(page).getByRole("radio", { name: "Tab guides" }).check();
  await page.keyboard.press("Escape");

  await expect(page).toHaveURL("/folders/handbook/kept.md");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
});

test("moving into a tab that no longer exists shows an error and the page stays where it was", async ({ page }) => {
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=move");
  const dialog = moveDialog(page);
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await getTestDb().tab.delete({ where: { id: guides.id } });
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("This tab no longer exists.");
  await expect(page).toHaveURL("/folders/handbook/kept.md?action=move");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
});

test("a crafted move into a tab of another folder is refused", async ({ page }) => {
  const other = await createFolder({ name: "other" });
  const foreignTab = await createTab({ folder: other, name: "foreign" });
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=move");
  const dialog = moveDialog(page);
  // Point the selected choice to the tab of another folder, as a crafted request would.
  const choice = dialog.getByRole("radio", { name: "Directly in the folder" });
  await expect(choice).toBeChecked();
  await choice.evaluate((radio: HTMLInputElement, tabId) => (radio.value = tabId), foreignTab.id);
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("This tab no longer exists.");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
  await expectNotFound(page, "/folders/other/foreign/kept.md");
});

test("a folder without tabs offers only the folder itself", async ({ page }) => {
  const plain = await createFolder({ name: "plain" });
  await createPage({ folder: plain, name: "alone", title: "Alone" });

  await page.goto("/folders/plain/alone.md?action=move");

  const dialog = moveDialog(page);
  await expect(dialog.getByRole("radio")).toHaveCount(1);
  await expect(dialog.getByRole("radio", { name: "Directly in the folder" })).toBeChecked();
});

for (const address of [
  "/folders/handbook?action=move",
  "/folders/handbook/guides?action=move",
  "/folders/handbook/no-such-page.md?action=move",
  "/folders/handbook/guides/no-such-page.md?action=move",
  "/folders/handbook/in-folder.md?action=move&action=move",
]) {
  test(`${address} shows the not-found page`, async ({ page }) => {
    await createPage({ folder: handbook, name: "in-folder", title: "In folder" });

    await expectNotFound(page, address);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
