import { expect, test, type Page } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { createPage, getTestDb, resetTestDatabase } from "./support/database";

test.beforeEach(async () => {
  await resetTestDatabase();
});

/** The "Save page" dialog of the new page form. */
function saveDialog(page: Page) {
  return page.getByRole("dialog", { name: "Save page" });
}

/** Opens `/pages/new`, enters the content and opens the "Save page" dialog. */
async function openSaveDialog(page: Page, content: string) {
  await page.goto("/pages/new");
  await page.getByLabel("Content").fill(content);
  await page.getByRole("button", { name: "Save" }).click();
  const dialog = saveDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

test("creating a page derives title and slug from the first heading and shows the page", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ title: "Older page", updatedAt: new Date("2026-01-01T10:00:00Z") });
  const content = "Intro\n\n## Getting started\n\n- First step\n- Second step";

  await page.goto("/pages");
  await page.getByRole("link", { name: "New page" }).click();

  await expect(page).toHaveURL("/pages/new");
  await expect(page).toHaveTitle("New page – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: "New page" })).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveCount(0);
  await expect(page.getByLabel("Slug")).toHaveCount(0);
  await page.getByLabel("Content").fill(content);
  await page.getByRole("button", { name: "Save" }).click();

  const dialog = saveDialog(page);
  await expect(dialog.getByLabel("Title")).toHaveValue("Getting started");
  await expect(dialog.getByLabel("Slug")).toHaveValue("getting-started");
  await expect(dialog.getByLabel("Slug")).toHaveAccessibleDescription("Address: /pages/getting-started");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/pages/getting-started");
  await expect(page.getByRole("heading", { level: 1, name: "Getting started" })).toBeVisible();
  const article = page.getByRole("article");
  await expect(article.getByRole("heading", { level: 2, name: "Getting started" })).toBeVisible();
  await expect(article.getByRole("listitem")).toHaveText(["First step", "Second step"]);

  const stored = await getTestDb().page.findMany({ where: { slug: "getting-started" } });
  expect(stored).toHaveLength(1);
  expect(stored[0].title).toBe("Getting started");
  expect(stored[0].content).toBe(content);

  await page.getByRole("banner").getByRole("link", { name: "Pages" }).click();

  const links = page.getByRole("list", { name: "Pages" }).getByRole("link");
  await expect(links).toHaveText([/^Getting started/, /^Older page/]);
  expect(errors).toEqual([]);
});

test("a heading inside a code block is not used as the title", async ({ page }) => {
  const dialog = await openSaveDialog(page, "```\n# Not the title\n```\n\n# Real title");

  await expect(dialog.getByLabel("Title")).toHaveValue("Real title");
  await expect(dialog.getByLabel("Slug")).toHaveValue("real-title");
});

test("without a heading, title and slug start empty and are required", async ({ page }) => {
  const errors = collectErrors(page);
  const dialog = await openSaveDialog(page, "Content without a heading");

  const title = dialog.getByLabel("Title");
  const slug = dialog.getByLabel("Slug");
  await expect(title).toHaveValue("");
  await expect(slug).toHaveValue("");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(title).toHaveAccessibleDescription("Title is required");
  await expect(slug).toHaveAttribute("aria-invalid", "true");
  await expect(slug).toHaveAccessibleDescription("Slug is required");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL("/pages/new");
  expect(await getTestDb().page.count()).toBe(0);
  expect(errors).toEqual([]);
});

test("the slug follows the title until it is edited by hand", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# First title");
  const title = dialog.getByLabel("Title");
  const slug = dialog.getByLabel("Slug");

  await title.fill("Second title");
  await expect(slug).toHaveValue("second-title");

  await slug.fill("my-slug");
  await title.fill("Third title");
  await expect(title).toHaveValue("Third title");
  await expect(slug).toHaveValue("my-slug");
});

test("an umlaut title gives a slug with spelled-out umlauts", async ({ page }) => {
  const dialog = await openSaveDialog(page, "## Über Größen");

  await expect(dialog.getByLabel("Title")).toHaveValue("Über Größen");
  await expect(dialog.getByLabel("Slug")).toHaveValue("ueber-groessen");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/pages/ueber-groessen");
  await expect(page.getByRole("heading", { level: 1, name: "Über Größen" })).toBeVisible();
});

test("a taken slug shows an error in the open dialog and keeps all values", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ title: "Existing page", slug: "taken" });

  const dialog = await openSaveDialog(page, "# Taken\n\nContent that must not get lost");
  await expect(dialog.getByLabel("Slug")).toHaveValue("taken");
  await dialog.getByLabel("Title").fill("Another page");
  await dialog.getByLabel("Slug").fill("taken");
  await dialog.getByRole("button", { name: "Save" }).click();

  const slug = dialog.getByLabel("Slug");
  await expect(slug).toHaveAttribute("aria-invalid", "true");
  await expect(slug).toHaveAccessibleDescription("Slug is already in use");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL("/pages/new");
  await expect(dialog.getByLabel("Title")).toHaveValue("Another page");
  await expect(slug).toHaveValue("taken");
  expect(await getTestDb().page.count()).toBe(1);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Content")).toHaveValue("# Taken\n\nContent that must not get lost");
  expect(errors).toEqual([]);
});

for (const { slug, error } of [
  { slug: "Bad Slug", error: "Use lowercase letters, digits and single hyphens" },
  { slug: "new", error: "This slug is reserved" },
]) {
  test(`the slug "${slug}" shows "${error}" in the dialog and creates nothing`, async ({ page }) => {
    const dialog = await openSaveDialog(page, "# Valid title");
    await dialog.getByLabel("Slug").fill(slug);
    await dialog.getByRole("button", { name: "Save" }).click();

    const slugField = dialog.getByLabel("Slug");
    await expect(slugField).toHaveAttribute("aria-invalid", "true");
    await expect(slugField).toHaveAccessibleDescription(error);
    await expect(dialog.getByLabel("Title")).toHaveAttribute("aria-invalid", "false");
    await expect(page).toHaveURL("/pages/new");
    await expect(slugField).toHaveValue(slug);
    expect(await getTestDb().page.count()).toBe(0);
  });
}

test("cancel in the dialog keeps the content, creates nothing and derives again on reopening", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# First draft\n\nBody");
  await dialog.getByLabel("Slug").fill("hand-made");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL("/pages/new");
  const content = page.getByLabel("Content");
  await expect(content).toHaveValue("# First draft\n\nBody");
  expect(await getTestDb().page.count()).toBe(0);

  await content.fill("# Second draft\n\nBody");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByLabel("Title")).toHaveValue("Second draft");
  await expect(dialog.getByLabel("Slug")).toHaveValue("second-draft");
});

test("cancel on the form returns to the list and creates nothing", async ({ page }) => {
  await page.goto("/pages/new");
  await page.getByLabel("Content").fill("# Never saved");
  await page.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL("/pages");
  await expect(page.getByText("No pages yet")).toBeVisible();
  expect(await getTestDb().page.count()).toBe(0);
});
