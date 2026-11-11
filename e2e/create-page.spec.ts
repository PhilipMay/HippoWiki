import { expect, test, type Page } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { createPage, getTestDb, resetTestDatabase } from "./support/database";

const TITLE_HEADING_MISSING = "Content must start with a title heading: # Title";

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

test("creating a page derives title and slug from the title heading and shows the page", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ title: "Older page", updatedAt: new Date("2026-01-01T10:00:00Z") });
  const content = "# Getting started\n\n- First step\n- Second step";

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
  await expect(page).toHaveTitle("Getting started – HippoWiki");
  const article = page.getByRole("article");
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

for (const { name, content } of [
  { name: "text before the title heading", content: "Intro\n\n# Title" },
  { name: "a level-two heading first", content: "## Section\n\n# Title" },
  { name: "a title heading only inside a code block", content: "```\n# Not the title\n```\n\n# Title" },
  { name: "a setext heading", content: "Title\n=====" },
  { name: "a heading without text", content: "# **" },
  { name: "empty content", content: "" },
]) {
  test(`${name} shows the error at the content field and opens no dialog`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/pages/new");
    const field = page.getByLabel("Content");
    await field.fill(content);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription(TITLE_HEADING_MISSING);
    await expect(saveDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL("/pages/new");
    await expect(field).toHaveValue(content);
    expect(await getTestDb().page.count()).toBe(0);

    // Adding a title heading removes the error and opens the dialog.
    await field.fill(`# Fixed\n\n${content}`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(saveDialog(page).getByLabel("Title")).toHaveValue("Fixed");
    await expect(field).toHaveAttribute("aria-invalid", "false");
    expect(errors).toEqual([]);
  });
}

test("the dialog shows the title read-only and has no editable title field", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# Read-only title\n\nBody");

  const title = dialog.getByLabel("Title");
  await expect(title).toHaveValue("Read-only title");
  await expect(title).not.toBeEditable();
  await expect(title).not.toHaveAttribute("name");
  await expect(dialog.getByLabel("Slug")).toBeEditable();
  await expect(dialog.getByLabel("Slug")).toBeFocused();
});

test("a heading with inline Markdown gives a plain title in the list and the browser tab", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# The *`npm`* **[guide](https://example.com)** ![logo](x.png)");

  await expect(dialog.getByLabel("Title")).toHaveValue("The npm guide logo");
  await expect(dialog.getByLabel("Slug")).toHaveValue("the-npm-guide-logo");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/pages/the-npm-guide-logo");
  await expect(page).toHaveTitle("The npm guide logo – HippoWiki");
  expect((await getTestDb().page.findFirstOrThrow()).title).toBe("The npm guide logo");

  await page.getByRole("banner").getByRole("link", { name: "Pages" }).click();
  await expect(page.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^The npm guide logo/]);
});

test("an umlaut title gives a slug with spelled-out umlauts", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# Über Größen");

  await expect(dialog.getByLabel("Title")).toHaveValue("Über Größen");
  await expect(dialog.getByLabel("Slug")).toHaveValue("ueber-groessen");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/pages/ueber-groessen");
  await expect(page).toHaveTitle("Über Größen – HippoWiki");
});

test("a form submission with an extra title field stores the derived title", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# From content");
  const save = dialog.getByRole("button", { name: "Save" });
  // The Save button is tied to the dialog's form; add a title field to that form as a crafted request would.
  await save.evaluate((button: HTMLButtonElement) => {
    const input = document.createElement("input");
    Object.assign(input, { type: "hidden", name: "title", value: "Injected title" });
    button.form?.append(input);
  });
  await save.click();

  await expect(page).toHaveURL("/pages/from-content");
  expect((await getTestDb().page.findFirstOrThrow()).title).toBe("From content");
});

test("a taken slug shows an error in the open dialog and keeps all values", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ title: "Existing page", slug: "taken" });

  const dialog = await openSaveDialog(page, "# Taken\n\nContent that must not get lost");
  await expect(dialog.getByLabel("Slug")).toHaveValue("taken");
  await dialog.getByRole("button", { name: "Save" }).click();

  const slug = dialog.getByLabel("Slug");
  await expect(slug).toHaveAttribute("aria-invalid", "true");
  await expect(slug).toHaveAccessibleDescription("Slug is already in use");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL("/pages/new");
  await expect(dialog.getByLabel("Title")).toHaveValue("Taken");
  await expect(slug).toHaveValue("taken");
  expect(await getTestDb().page.count()).toBe(1);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Content")).toHaveValue("# Taken\n\nContent that must not get lost");
  expect(errors).toEqual([]);
});

for (const { slug, error } of [
  { slug: "Bad Slug", error: "Use lowercase letters, digits and single hyphens" },
  { slug: "new", error: "This slug is reserved" },
  { slug: "", error: "Slug is required" },
]) {
  test(`the slug "${slug}" shows "${error}" in the dialog and creates nothing`, async ({ page }) => {
    const dialog = await openSaveDialog(page, "# Valid title");
    await dialog.getByLabel("Slug").fill(slug);
    await dialog.getByRole("button", { name: "Save" }).click();

    const slugField = dialog.getByLabel("Slug");
    await expect(slugField).toHaveAttribute("aria-invalid", "true");
    await expect(slugField).toHaveAccessibleDescription(error);
    await expect(dialog.getByLabel("Title")).toHaveValue("Valid title");
    await expect(page).toHaveURL("/pages/new");
    await expect(slugField).toHaveValue(slug);
    expect(await getTestDb().page.count()).toBe(0);
  });
}

test("a title in a non-Latin script gives an empty slug that must be entered", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# 日本語");

  await expect(dialog.getByLabel("Title")).toHaveValue("日本語");
  await expect(dialog.getByLabel("Slug")).toHaveValue("");
  await dialog.getByLabel("Slug").fill("japanese");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/pages/japanese");
  expect((await getTestDb().page.findFirstOrThrow()).title).toBe("日本語");
});

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
