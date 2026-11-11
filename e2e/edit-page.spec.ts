import { expect, test, type Page as BrowserPage } from "@playwright/test";

import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";

import { collectErrors } from "./support/browser";
import { createFolder, createPage, getTestDb, resetTestDatabase } from "./support/database";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

/** The links of the page list of a folder, in display order. */
function listLinks(page: BrowserPage) {
  return page.getByRole("list", { name: "Pages" }).getByRole("link");
}

/** The "Rename page" dialog. */
function renameDialog(page: BrowserPage) {
  return page.getByRole("dialog", { name: "Rename page" });
}

async function expectNotFound(page: BrowserPage, address: string) {
  const response = await page.goto(address);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
}

test("editing the content shows the new version and keeps the name", async ({ page }) => {
  const errors = collectErrors(page);
  const oldUpdatedAt = new Date("2026-01-01T10:00:00Z");
  const edited = await createPage({
    folder: handbook,
    name: "original-name",
    content: "# Original title\n\nOriginal content",
    updatedAt: oldUpdatedAt,
  });
  await createPage({ folder: handbook, name: "other-page", title: "Other page" });

  await page.goto("/folders/handbook/original-name.md");
  await page.getByRole("link", { name: "Edit" }).click();

  await expect(page).toHaveURL("/folders/handbook/original-name.md?action=edit");
  await expect(page).toHaveTitle("Edit Original title – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: "Edit page" })).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveCount(0);
  await expect(page.getByLabel("Name")).toHaveCount(0);
  await expect(page.getByLabel("Content")).toHaveValue("# Original title\n\nOriginal content");
  await page.getByLabel("Content").fill("# Edited title\n\n## New section\n\n- Changed item");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/original-name.md");
  await expect(page).toHaveTitle("Edited title – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Edited title"]);
  const article = page.getByRole("article");
  await expect(article.getByRole("heading", { level: 2, name: "New section" })).toBeVisible();
  await expect(article.getByRole("listitem")).toHaveText(["Changed item"]);
  const shownUpdatedAt = await article.locator("time").getAttribute("datetime");
  expect(new Date(shownUpdatedAt ?? "").getTime()).toBeGreaterThan(oldUpdatedAt.getTime());

  const stored = await getTestDb().page.findUniqueOrThrow({ where: { id: edited.id } });
  expect(stored).toMatchObject({
    title: "Edited title",
    name: "original-name",
    content: "# Edited title\n\n## New section\n\n- Changed item",
    folderId: handbook.id,
  });
  expect(stored.updatedAt.toISOString()).toBe(shownUpdatedAt);
  expect(await getTestDb().page.count()).toBe(2);

  await page.goto("/folders/handbook");
  await expect(listLinks(page)).toHaveText([/^Edited title/, /^Other page/]);
  await expect(listLinks(page).first()).toHaveAttribute("href", "/folders/handbook/original-name.md");
  expect(errors).toEqual([]);
});

test("the edit form starts with the cursor at the start of the content", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ folder: handbook, name: "focused", content: "# Focused page\n\nSome content" });

  async function expectCursorAtContentStart() {
    const content = page.getByLabel("Content");
    await expect(content).toBeFocused();
    const selection = await content.evaluate((field: HTMLTextAreaElement) => [
      field.selectionStart,
      field.selectionEnd,
    ]);
    expect(selection).toEqual([0, 0]);
  }

  await page.goto("/folders/handbook/focused.md");
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL("/folders/handbook/focused.md?action=edit");
  await expectCursorAtContentStart();

  await page.goto("/folders/handbook/focused.md?action=edit");
  await expectCursorAtContentStart();
  expect(errors).toEqual([]);
});

test("changing the heading changes the title and the list entry, but not the name", async ({ page }) => {
  const errors = collectErrors(page);
  const edited = await createPage({ folder: handbook, name: "stable-name", content: "# Before\n\nBody" });

  await page.goto("/folders/handbook/stable-name.md?action=edit");
  await page.getByLabel("Content").fill("# After the *change*\n\nBody");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/stable-name.md");
  await expect(page).toHaveTitle("After the change – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["After the change"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: edited.id } })).toMatchObject({
    title: "After the change",
    name: "stable-name",
  });

  await page.goto("/folders/handbook");
  await expect(listLinks(page)).toHaveText([/^After the change/]);
  await expect(listLinks(page).first()).toHaveAttribute("href", "/folders/handbook/stable-name.md");
  expect(errors).toEqual([]);
});

test("a page stored with a different title gets the derived title on its next save", async ({ page }) => {
  const created = await createPage({
    folder: handbook,
    name: "stored",
    title: "Stored title",
    content: "# Heading title\n\nBody",
  });

  await page.goto("/folders/handbook/stored.md?action=edit");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/stored.md");
  await expect(page).toHaveTitle("Heading title – HippoWiki");
  expect((await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).title).toBe("Heading title");
});

test("removing the title heading shows an error at the content field and keeps the content", async ({ page }) => {
  const errors = collectErrors(page);
  const created = await createPage({ folder: handbook, name: "valid", title: "Valid title" });

  await page.goto("/folders/handbook/valid.md?action=edit");
  await page.getByLabel("Content").fill("Intro first\n\n# Valid title\n\nNew content that must not get lost");
  await page.getByRole("button", { name: "Save" }).click();

  const content = page.getByLabel("Content");
  await expect(content).toHaveAttribute("aria-invalid", "true");
  await expect(content).toHaveAccessibleDescription("Content must start with a title heading: # Title");
  await expect(content).toBeFocused();
  await expect(page).toHaveURL("/folders/handbook/valid.md?action=edit");
  await expect(content).toHaveValue("Intro first\n\n# Valid title\n\nNew content that must not get lost");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toEqual(created);
  expect(errors).toEqual([]);
});

test("content above the limit shows an error at the content field and stores nothing", async ({ page }) => {
  const errors = collectErrors(page);
  const created = await createPage({ folder: handbook, name: "long", title: "Long page" });

  await page.goto("/folders/handbook/long.md?action=edit");
  // Remove the field's limit, as a crafted request would, to submit content that is too long.
  const content = page.getByLabel("Content");
  await content.evaluate((field: HTMLTextAreaElement) => field.removeAttribute("maxlength"));
  await content.fill(`# Long page\n\n${"x".repeat(CONTENT_MAX_LENGTH)}`);
  await page.getByRole("button", { name: "Save" }).click();

  await expect(content).toHaveAttribute("aria-invalid", "true");
  await expect(content).toHaveAccessibleDescription("Content must be at most 100,000 characters");
  await expect(content).toBeFocused();
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toEqual(created);
  expect(errors).toEqual([]);
});

test("a form submission with extra title and name fields stores the derived title and keeps the name", async ({
  page,
}) => {
  const created = await createPage({ folder: handbook, name: "crafted", title: "Original" });

  await page.goto("/folders/handbook/crafted.md?action=edit");
  await page.getByLabel("Content").fill("# From content");
  const save = page.getByRole("button", { name: "Save" });
  // Add fields to the form, as a crafted request would.
  await save.evaluate((button: HTMLButtonElement) => {
    for (const [name, value] of [
      ["title", "Injected title"],
      ["name", "injected-name"],
    ]) {
      const input = document.createElement("input");
      Object.assign(input, { type: "hidden", name, value });
      button.form?.append(input);
    }
  });
  await save.click();

  await expect(page).toHaveURL("/folders/handbook/crafted.md");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
    title: "From content",
    name: "crafted",
  });
});

test("cancelling an edit returns to the page view and changes nothing", async ({ page }) => {
  const created = await createPage({
    folder: handbook,
    name: "unchanged",
    content: "# Unchanged\n\nUnchanged content",
  });

  await page.goto("/folders/handbook/unchanged.md?action=edit");
  await page.getByLabel("Content").fill("# Never saved");
  await page.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL("/folders/handbook/unchanged.md");
  await expect(page).toHaveTitle("Unchanged – HippoWiki");
  await expect(page.getByRole("article").getByText("Unchanged content")).toBeVisible();
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toEqual(created);
});

test("saving a page that no longer exists shows an error and keeps the content", async ({ page }) => {
  const created = await createPage({ folder: handbook, name: "soon-gone", title: "Soon gone" });

  await page.goto("/folders/handbook/soon-gone.md?action=edit");
  await getTestDb().page.delete({ where: { id: created.id } });
  await page.getByLabel("Content").fill("# Soon gone\n\nTyped after the page was removed");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("main").getByRole("alert")).toHaveText("This page no longer exists.");
  await expect(page.getByLabel("Content")).not.toBeFocused();
  await expect(page).toHaveURL("/folders/handbook/soon-gone.md?action=edit");
  await expect(page.getByLabel("Content")).toHaveValue("# Soon gone\n\nTyped after the page was removed");
  expect(await getTestDb().page.count()).toBe(0);
});

test("editing an unknown page or a page address without .md shows the not-found page", async ({ page }) => {
  await createPage({ folder: handbook, name: "existing-page", title: "Existing page" });

  for (const address of [
    "/folders/handbook/no-such-page.md?action=edit",
    "/folders/handbook/existing-page?action=edit",
    "/folders/handbook/Bad_Name.md?action=edit",
  ]) {
    await expectNotFound(page, address);
  }
});

test("renaming a page shows it at its new address and the old address shows the not-found page", async ({ page }) => {
  const errors = collectErrors(page);
  const renamed = await createPage({ folder: handbook, name: "old-name", content: "# Renamed page\n\nBody" });

  await page.goto("/folders/handbook/old-name.md");
  await page.getByRole("link", { name: "Rename" }).click();

  await expect(page).toHaveURL("/folders/handbook/old-name.md?action=rename");
  const dialog = renameDialog(page);
  const name = dialog.getByLabel("Name");
  await expect(name).toHaveValue("old-name");
  await expect(name).toBeFocused();
  // The page stays visible behind the dialog.
  await expect(page.getByRole("article", { includeHidden: true })).toHaveCount(1);
  await name.fill(" new-name ");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/new-name.md");
  await expect(page).toHaveTitle("Renamed page – HippoWiki");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem")).toHaveText([
    "Folders",
    "handbook",
    "new-name.md",
  ]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: renamed.id } })).toMatchObject({
    name: "new-name",
    title: "Renamed page",
    content: "# Renamed page\n\nBody",
  });
  expect(errors).toEqual([]);

  for (const oldAddress of ["/folders/handbook/old-name.md", "/folders/handbook/old-name.md?action=edit"]) {
    await expectNotFound(page, oldAddress);
  }
});

test("renaming a page to a taken or invalid name shows the error and keeps the entered name", async ({ page }) => {
  const errors = collectErrors(page);
  const other = await createFolder({ name: "other" });
  await createPage({ folder: handbook, name: "taken", title: "Other page" });
  await createPage({ folder: other, name: "free-here", title: "Page of another folder" });
  const renamed = await createPage({ folder: handbook, name: "renamed", title: "Renamed page" });

  await page.goto("/folders/handbook/renamed.md?action=rename");
  const dialog = renameDialog(page);
  const name = dialog.getByLabel("Name");
  await name.fill("taken");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription("Name is already in use");
  await expect(name).toHaveValue("taken");
  await expect(name).toBeFocused();
  await expect(page).toHaveURL("/folders/handbook/renamed.md?action=rename");

  await name.fill("Not Valid");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(name).toHaveAccessibleDescription("Use lowercase letters, digits and single hyphens");
  await expect(name).toHaveValue("Not Valid");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: renamed.id } })).toEqual(renamed);

  // A name that only a page of another folder uses is free.
  await name.fill("free-here");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/free-here.md");
  expect(errors).toEqual([]);
});

test("renaming a page whose content is above the content limit succeeds", async ({ page }) => {
  // Stored directly, as if the limit had been lowered after the page was saved.
  const content = `# Big page\n\n${"x".repeat(CONTENT_MAX_LENGTH)}`;
  expect(content.length).toBeGreaterThan(CONTENT_MAX_LENGTH);
  const big = await createPage({ folder: handbook, name: "big", content });

  await page.goto("/folders/handbook/big.md?action=rename");
  const dialog = renameDialog(page);
  await dialog.getByLabel("Name").fill("still-big");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/still-big.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Big page"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: big.id } })).toMatchObject({
    name: "still-big",
    title: "Big page",
    content,
  });
});

test("cancelling the rename dialog returns to the page and changes nothing", async ({ page }) => {
  const created = await createPage({ folder: handbook, name: "kept-name", title: "Kept name" });

  await page.goto("/folders/handbook/kept-name.md?action=rename");
  const dialog = renameDialog(page);
  await dialog.getByLabel("Name").fill("other-name");
  await dialog.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL("/folders/handbook/kept-name.md");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toEqual(created);
});

test("renaming a page that no longer exists shows an error in the dialog", async ({ page }) => {
  const created = await createPage({ folder: handbook, name: "soon-gone", title: "Soon gone" });

  await page.goto("/folders/handbook/soon-gone.md?action=rename");
  await getTestDb().page.delete({ where: { id: created.id } });
  const dialog = renameDialog(page);
  await dialog.getByLabel("Name").fill("new-name");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("This page no longer exists.");
  await expect(dialog.getByLabel("Name")).toHaveValue("new-name");
  expect(await getTestDb().page.count()).toBe(0);
});

test("a folder and a page can be created, and the page edited and renamed", async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto("/folders?action=new");
  await page.getByRole("dialog", { name: "New folder" }).getByLabel("Name").fill("lifecycle");
  await page.getByRole("dialog", { name: "New folder" }).getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/lifecycle");
  await expect(page.getByText("No pages yet")).toBeVisible();

  await page.getByRole("link", { name: "New page" }).click();
  await page.getByLabel("Content").fill("# Lifecycle page\n\nFirst version");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog", { name: "Save page" }).getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/lifecycle/lifecycle-page.md");
  await expect(page).toHaveTitle("Lifecycle page – HippoWiki");

  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "lifecycle" }).click();
  await expect(listLinks(page)).toHaveText([/^Lifecycle page/]);

  await page.getByRole("link", { name: /^Lifecycle page/ }).click();
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Content").fill("# Lifecycle page, edited\n\nSecond version");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/lifecycle/lifecycle-page.md");
  await expect(page).toHaveTitle("Lifecycle page, edited – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Lifecycle page, edited"]);
  await expect(page.getByRole("article").getByText("Second version")).toBeVisible();

  await page.getByRole("link", { name: "Rename" }).click();
  await renameDialog(page).getByLabel("Name").fill("lifecycle-renamed");
  await renameDialog(page).getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/lifecycle/lifecycle-renamed.md");

  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "lifecycle" }).click();
  await expect(listLinks(page)).toHaveText([/^Lifecycle page, edited.*lifecycle-renamed\.md/]);
  expect(await getTestDb().page.count()).toBe(1);
  expect(errors).toEqual([]);
});
