import { expect, test, type Page } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { createFolder, getTestDb, resetTestDatabase } from "./support/database";

test.beforeEach(async () => {
  await resetTestDatabase();
});

/** The links of the folder list, in display order. */
function listLinks(page: Page) {
  return page.getByRole("list", { name: "Folders" }).getByRole("link");
}

async function expectNotFound(page: Page, address: string) {
  const response = await page.goto(address);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
}

test("the folder list shows an empty state without folders", async ({ page }) => {
  await page.goto("/folders");

  await expect(page).toHaveTitle("Folders – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: "Folders" })).toBeVisible();
  await expect(page.getByText("No folders yet")).toBeVisible();
  await expect(page.getByRole("list", { name: "Folders" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the folder list shows folders by name and links to them", async ({ page }) => {
  await createFolder({ name: "meetings", updatedAt: new Date("2026-03-01T10:00:00Z") });
  await createFolder({ name: "archive", updatedAt: new Date("2026-01-01T10:00:00Z") });
  await createFolder({ name: "handbook", updatedAt: new Date("2026-02-01T10:00:00Z") });

  await page.goto("/folders");

  await expect(listLinks(page)).toHaveText([/^archive/, /^handbook/, /^meetings/]);
  await expect(listLinks(page).nth(1)).toHaveAttribute("href", "/folders/handbook");
  const items = page.getByRole("list", { name: "Folders" }).getByRole("listitem");
  await expect(items.nth(1).locator("time")).toHaveAttribute("datetime", "2026-02-01T10:00:00.000Z");

  await listLinks(page).nth(1).click();

  await expect(page).toHaveURL("/folders/handbook");
  await expect(page).toHaveTitle("handbook – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: "handbook" })).toBeVisible();
  await expect(page.getByText("This folder is empty")).toBeVisible();
});

test("the app bar links to the folder list", async ({ page }) => {
  await page.goto("/pages");

  await page.getByRole("banner").getByRole("link", { name: "Folders" }).click();

  await expect(page).toHaveURL("/folders");
  await expect(page.getByRole("heading", { level: 1, name: "Folders" })).toBeVisible();
});

test("creating a folder through the dialog shows the new folder", async ({ page }) => {
  const errors = collectErrors(page);
  await createFolder({ name: "archive" });

  await page.goto("/folders");
  await page.getByRole("link", { name: "New folder" }).click();

  await expect(page).toHaveURL("/folders?action=new");
  const dialog = page.getByRole("dialog", { name: "New folder" });
  const name = dialog.getByLabel("Name");
  await expect(name).toHaveValue("");
  await expect(name).toBeFocused();
  // The list stays visible behind the dialog.
  await expect(page.getByRole("list", { name: "Folders", includeHidden: true })).toHaveCount(1);
  await name.fill(" handbook ");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook");
  await expect(page).toHaveTitle("handbook – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: "handbook" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await getTestDb().folder.findMany({ select: { name: true }, orderBy: { name: "asc" } })).toEqual([
    { name: "archive" },
    { name: "handbook" },
  ]);

  await page.getByRole("banner").getByRole("link", { name: "Folders" }).click();
  await expect(listLinks(page)).toHaveText([/^archive/, /^handbook/]);
  expect(errors).toEqual([]);
});

test("the name field submits with the Enter key", async ({ page }) => {
  await page.goto("/folders?action=new");
  const name = page.getByRole("dialog", { name: "New folder" }).getByLabel("Name");
  await name.fill("by-keyboard");
  await name.press("Enter");

  await expect(page).toHaveURL("/folders/by-keyboard");
});

for (const { name, error } of [
  { name: "Bad Name", error: "Use lowercase letters, digits and single hyphens" },
  { name: "guides.md", error: "Use lowercase letters, digits and single hyphens" },
  { name: "double--hyphen", error: "Use lowercase letters, digits and single hyphens" },
  { name: "", error: "Name is required" },
]) {
  test(`the folder name "${name}" shows "${error}" and creates nothing`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/folders?action=new");
    const dialog = page.getByRole("dialog", { name: "New folder" });
    const field = dialog.getByLabel("Name");
    await field.fill(name);
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription(error);
    await expect(field).toHaveValue(name);
    await expect(field).toBeFocused();
    await expect(page).toHaveURL("/folders?action=new");
    expect(await getTestDb().folder.count()).toBe(0);
    expect(errors).toEqual([]);
  });
}

test("a taken folder name shows the error at the name field and keeps the entered name", async ({ page }) => {
  const errors = collectErrors(page);
  await createFolder({ name: "taken" });

  await page.goto("/folders?action=new");
  const dialog = page.getByRole("dialog", { name: "New folder" });
  const field = dialog.getByLabel("Name");
  await field.fill("taken");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription("Name is already in use");
  await expect(field).toHaveValue("taken");
  await expect(page).toHaveURL("/folders?action=new");
  expect(await getTestDb().folder.count()).toBe(1);

  // A free name saves from the same dialog.
  await field.fill("free");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/free");
  expect(errors).toEqual([]);
});

test("renaming a folder shows it at its new address and the old address shows the not-found page", async ({ page }) => {
  const errors = collectErrors(page);
  const folder = await createFolder({ name: "old-name", updatedAt: new Date("2026-01-01T10:00:00Z") });

  await page.goto("/folders/old-name");
  await page.getByRole("link", { name: "Rename" }).click();

  await expect(page).toHaveURL("/folders/old-name?action=rename");
  const dialog = page.getByRole("dialog", { name: "Rename folder" });
  const name = dialog.getByLabel("Name");
  await expect(name).toHaveValue("old-name");
  await expect(name).toBeFocused();
  await name.fill("new-name");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/new-name");
  await expect(page).toHaveTitle("new-name – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: "new-name" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const stored = await getTestDb().folder.findUniqueOrThrow({ where: { id: folder.id } });
  expect(stored.name).toBe("new-name");
  expect(stored.updatedAt.getTime()).toBeGreaterThan(folder.updatedAt.getTime());
  expect(await getTestDb().folder.count()).toBe(1);
  expect(errors).toEqual([]);

  await expectNotFound(page, "/folders/old-name");
});

test("renaming a folder to a taken or invalid name shows the error and keeps the entered name", async ({ page }) => {
  await createFolder({ name: "taken" });
  const folder = await createFolder({ name: "renamed" });

  await page.goto("/folders/renamed?action=rename");
  const dialog = page.getByRole("dialog", { name: "Rename folder" });
  const field = dialog.getByLabel("Name");
  await field.fill("taken");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(field).toHaveAccessibleDescription("Name is already in use");
  await expect(field).toHaveValue("taken");

  await field.fill("Not Valid");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(field).toHaveAccessibleDescription("Use lowercase letters, digits and single hyphens");
  await expect(field).toHaveValue("Not Valid");
  await expect(page).toHaveURL("/folders/renamed?action=rename");
  expect((await getTestDb().folder.findUniqueOrThrow({ where: { id: folder.id } })).name).toBe("renamed");
});

test("saving the rename dialog with the unchanged name keeps the folder", async ({ page }) => {
  await createFolder({ name: "unchanged" });

  await page.goto("/folders/unchanged?action=rename");
  await page.getByRole("dialog", { name: "Rename folder" }).getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/unchanged");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("an unknown folder shows the not-found page", async ({ page }) => {
  await createFolder({ name: "existing" });

  await expectNotFound(page, "/folders/no-such-folder");
  await expect(page.getByRole("banner")).toBeVisible();
});

for (const name of ["Bad_Name", "Existing", "existing--folder", "existing.md"]) {
  test(`the malformed folder name "${name}" shows the not-found page`, async ({ page }) => {
    await createFolder({ name: "existing" });

    await expectNotFound(page, `/folders/${name}`);
  });
}

for (const address of [
  "/folders?action=rename",
  "/folders?action=delete",
  "/folders?action=",
  "/folders?action=new&action=new",
  "/folders/existing?action=new",
  "/folders/existing?action=delete",
  "/folders/existing?action=rename&action=rename",
  "/folders/no-such-folder?action=rename",
]) {
  test(`the action in ${address} shows the not-found page`, async ({ page }) => {
    await createFolder({ name: "existing" });

    await expectNotFound(page, address);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("cancelling the new folder dialog returns to the folder list", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/folders?action=new");
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByLabel("Name").fill("never-saved");
  await dialog.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL("/folders");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("No folders yet")).toBeVisible();
  expect(await getTestDb().folder.count()).toBe(0);

  // Opening the dialog again starts with an empty name.
  await page.getByRole("link", { name: "New folder" }).click();
  await expect(dialog.getByLabel("Name")).toHaveValue("");
  expect(errors).toEqual([]);
});

test("the Escape key closes the rename dialog and returns to the folder", async ({ page }) => {
  const folder = await createFolder({ name: "kept-name" });

  await page.goto("/folders/kept-name?action=rename");
  const dialog = page.getByRole("dialog", { name: "Rename folder" });
  await dialog.getByLabel("Name").fill("other-name");
  await page.keyboard.press("Escape");

  await expect(page).toHaveURL("/folders/kept-name");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await getTestDb().folder.findUniqueOrThrow({ where: { id: folder.id } })).name).toBe("kept-name");
});
