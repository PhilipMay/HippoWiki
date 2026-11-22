import type { Page } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, becomeUser } from "./support/auth";
import { by, collectErrors, expectNotFound, expectNotFoundResponse } from "./support/browser";
import { createFolder, createPage, createTab, createUser, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

test.beforeEach(async () => {
  await resetTestDatabase();
});

/** The links of the folder list, in display order. */
function listLinks(page: Page) {
  return page.getByRole("list", { name: "Folders" }).getByRole("link");
}

/** The hint below the name field of the name dialogs. */
const NAME_HINT = "Lowercase letters, digits and single hyphens, e.g. release-notes";

/** The logged-in user of the tests, who makes every change through the GUI. */
const USER = KNOWN_USER.name;

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
  await createFolder({ name: "handbook" });
  await page.goto("/folders/handbook");

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

test("saving the rename dialog with the name the folder got meanwhile stores nothing and leads to the folder", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const bob = await createUser({ name: "bob" });
  const folder = await createFolder({ name: "old-name" });

  await page.goto("/folders/old-name?action=rename");
  const dialog = page.getByRole("dialog", { name: "Rename folder" });
  await expect(dialog.getByLabel("Name")).toBeEditable();
  // Bob renames the folder to `new-name` while the dialog is open.
  const renamedAt = new Date("2026-01-01T10:00:00Z");
  await getTestDb().folder.update({
    where: { id: folder.id },
    data: { name: "new-name", lastEditedById: bob.id, lastEditedVia: "mcp", updatedAt: renamedAt },
  });
  await dialog.getByLabel("Name").fill("new-name");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/new-name");
  await expect(page.getByRole("heading", { level: 1, name: "new-name" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(getTestDb().folder.findUniqueOrThrow({ where: { id: folder.id } })).resolves.toMatchObject({
    name: "new-name",
    lastEditedById: bob.id,
    lastEditedVia: "mcp",
    updatedAt: renamedAt,
  });

  await page.goto("/folders");
  const item = page.getByRole("list", { name: "Folders" }).getByRole("listitem");
  await expect(item).toHaveText([by("bob", "mcp", "Owner")]);
  await expect(item.locator("time")).toHaveAttribute("datetime", renamedAt.toISOString());
  expect(errors).toEqual([]);
});

test("the rename dialog of a folder keeps Save disabled, and Enter without effect, while the name is unchanged", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const item = await createFolder({ name: "handbook", updatedAt: new Date("2026-01-01T10:00:00Z") });
  // The submissions of the dialog: each save is a POST to the address of the dialog.
  const saves: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") saves.push(request.url());
  });

  await page.goto("/folders/handbook?action=rename");
  const dialog = page.getByRole("dialog", { name: "Rename folder" });
  const field = dialog.getByLabel("Name");
  const save = dialog.getByRole("button", { name: "Save" });
  await expect(field).toBeEditable();
  await expect(field).toHaveValue("handbook");
  await expect(save).toBeDisabled();
  await expect(field).toHaveAccessibleDescription(NAME_HINT);

  await field.fill("manual");
  await expect(save).toBeEnabled();
  await expect(field).toHaveAccessibleDescription(NAME_HINT);
  for (const unchanged of ["handbook", " handbook "]) {
    await field.fill(unchanged);
    await expect(save).toBeDisabled();
    await expect(field).toHaveAccessibleDescription(NAME_HINT);
  }

  await field.press("Enter");
  // An empty name differs from the current one, so Save is enabled and the server answers. Once its answer is shown,
  // a submission of the Enter before would have been sent as well.
  await field.fill("");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(field).toHaveAccessibleDescription("Name is required");
  expect(saves).toHaveLength(1);
  await expect(page).toHaveURL("/folders/handbook?action=rename");
  await expect(getTestDb().folder.findUniqueOrThrow({ where: { id: item.id } })).resolves.toMatchObject({
    name: "handbook",
    updatedAt: item.updatedAt,
    lastEditedById: item.lastEditedById,
  });

  await field.fill("manual");
  await field.press("Enter");
  await expect(page).toHaveURL("/folders/manual");
  expect(errors).toEqual([]);
});

test("an invalid query string shows the not-found page under the plain title", async ({ page }) => {
  const folder = await createFolder({ name: "existing" });
  const tab = await createTab({ folder, name: "guides" });
  await createPage({ folder, name: "intro", title: "Intro" });
  await createPage({ tab, name: "setup", title: "Setup" });

  // The title and the page decide alike, so an address that shows the not-found page has no title of its own.
  for (const address of [
    "/folders/existing?action=new&view=all",
    "/folders/existing?view=unknown",
    "/folders/existing/guides?view=all",
    "/folders/existing/intro.md?view=history&before=1",
    "/folders/existing/intro.md?action=edit&view=history",
    "/folders/existing/guides/setup.md?notice=changed",
  ]) {
    await expectNotFound(page, address);
    await expect(page, address).toHaveTitle("HippoWiki");
  }
});

test("an unknown or malformed folder and an action an address does not have show the not-found page", async ({
  page,
}) => {
  await createFolder({ name: "existing" });

  for (const address of [
    // An unknown folder and malformed folder names.
    "/folders/no-such-folder",
    "/folders/Bad_Name",
    "/folders/Existing",
    "/folders/existing--folder",
    "/folders/existing.md",
    // Actions that the address does not have.
    "/folders?action=rename",
    "/folders?action=delete",
    "/folders?action=",
    "/folders?action=new&action=new",
    "/folders/existing?action=edit",
    "/folders/existing?action=delete",
    "/folders/existing?action=rename&action=rename",
    "/folders/no-such-folder?action=rename",
  ]) {
    await expectNotFoundResponse(page.request, address);
  }
});

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

test("the folder list shows who changed each folder last; creating and renaming make it the logged-in user", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const bob = await createUser({ name: "bob" });
  await createFolder({ name: "archive", editor: bob, via: "mcp" });
  const items = page.getByRole("list", { name: "Folders" }).getByRole("listitem");

  await page.goto("/folders");
  await expect(items).toHaveText([by("bob", "mcp", "Owner")]);

  await page.goto("/folders?action=new");
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByLabel("Name").fill("handbook");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook");

  await page.goto("/folders");
  await expect(items).toHaveText([by("bob", "mcp", "Owner"), by(USER, "web", "Owner")]);

  await page.goto("/folders/archive?action=rename");
  const rename = page.getByRole("dialog", { name: "Rename folder" });
  await rename.getByLabel("Name").fill("old-stuff");
  await rename.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/old-stuff");

  await page.goto("/folders");
  await expect(listLinks(page)).toHaveText([/^handbook/, /^old-stuff/]);
  await expect(items).toHaveText([by(USER, "web", "Owner"), by(USER, "web", "Owner")]);
  expect(errors).toEqual([]);
});

test("the folder list and the contents of a folder show the channel after each last editor", async ({ page }) => {
  const errors = collectErrors(page);
  const bob = await createUser({ name: "bob" });
  const handbook = await createFolder({ name: "handbook", editor: bob, via: "mcp" });
  await createFolder({ name: "news", editor: bob });
  await createPage({ folder: handbook, name: "alpha", title: "Alpha", editor: bob, via: "mcp" });
  await createPage({ folder: handbook, name: "beta", title: "Beta", editor: bob });
  await createTab({ folder: handbook, name: "drafts", editor: bob, via: "mcp" });
  await createTab({ folder: handbook, name: "guides", editor: bob });

  await page.goto("/folders");
  await expect(page.getByRole("list", { name: "Folders" }).getByRole("listitem")).toHaveText([
    by("bob", "mcp", "Owner"),
    by("bob", "web", "Owner"),
  ]);

  await page.goto("/folders/handbook");
  await expect(page.getByRole("list", { name: "Contents" }).getByRole("listitem")).toHaveText([
    /^Alpha.*by bob via mcp$/,
    /^Beta.*by bob via web$/,
    /^drafts.*by bob via mcp$/,
    /^guides.*by bob via web$/,
  ]);
  expect(errors).toEqual([]);
});

test("a submission of the new folder form with the login of an admin creates nothing and is not found", async ({
  page,
  context,
}) => {
  // The user opens the form; then the browser gets the login of an admin, as if the admin had crafted the request.
  await page.goto("/folders?action=new");
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByLabel("Name").fill("handbook");
  await becomeUser(context, ADMIN_STORAGE_STATE);

  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  expect(await getTestDb().folder.count()).toBe(0);
});
