import type { Page } from "@playwright/test";

import { PLACE_FIELD } from "@/features/pages/schema";

import { collectErrors } from "./support/browser";
import { createFolder, createPage, createTab, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

const TITLE_HEADING_MISSING = "Content must start with a title heading: # Title";
/** The address of the editor for a new page in the folder that every test starts with. */
const NEW_PAGE = "/folders/handbook?action=new";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

/** The "Save page" dialog of the new page form. */
function saveDialog(page: Page) {
  return page.getByRole("dialog", { name: "Save page" });
}

/** Opens the editor for a new page in the folder, enters the content and opens the "Save page" dialog. */
async function openSaveDialog(page: Page, content: string) {
  await page.goto(NEW_PAGE);
  await page.getByLabel("Content").fill(content);
  await page.getByRole("button", { name: "Save" }).click();
  const dialog = saveDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

test("creating a page derives title and name from the title heading and shows the page", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ folder: handbook, name: "older-page", title: "Older page" });
  const content = "# Getting started\n\n- First step\n- Second step";

  await page.goto("/folders/handbook");
  await page.getByRole("link", { name: "New page" }).click();

  await expect(page).toHaveURL(NEW_PAGE);
  await expect(page).toHaveTitle("New page – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: "New page" })).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveCount(0);
  await expect(page.getByLabel("Name")).toHaveCount(0);
  await page.getByLabel("Content").fill(content);
  await page.getByRole("button", { name: "Save" }).click();

  const dialog = saveDialog(page);
  await expect(dialog.getByLabel("Name")).toHaveValue("getting-started");
  await expect(dialog.getByLabel("Name")).toHaveAccessibleDescription("Address: /folders/handbook/getting-started.md");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/getting-started.md");
  await expect(page).toHaveTitle("Getting started – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Getting started"]);
  const article = page.getByRole("article");
  await expect(article.getByRole("listitem")).toHaveText(["First step", "Second step"]);

  const stored = await getTestDb().page.findMany({ where: { name: "getting-started" } });
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ title: "Getting started", content, folderId: handbook.id });

  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "handbook" }).click();

  const links = page.getByRole("list", { name: "Contents" }).getByRole("link");
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
    await page.goto(NEW_PAGE);
    const field = page.getByLabel("Content");
    await field.fill(content);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription(TITLE_HEADING_MISSING);
    await expect(saveDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(NEW_PAGE);
    await expect(field).toHaveValue(content);
    expect(await getTestDb().page.count()).toBe(0);

    // Adding a title heading removes the error and opens the dialog.
    await field.fill(`# Fixed\n\n${content}`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(saveDialog(page).getByLabel("Name")).toHaveValue("fixed");
    await expect(field).toHaveAttribute("aria-invalid", "false");
    expect(errors).toEqual([]);
  });
}

test("the dialog asks only for the name and shows no title", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# Hidden title\n\nBody");

  await expect(dialog.getByLabel("Title")).toHaveCount(0);
  await expect(dialog.getByRole("textbox")).toHaveCount(1);
  await expect(dialog.getByText("Hidden title")).toHaveCount(0);
  await expect(dialog.getByLabel("Name")).toHaveValue("hidden-title");
  await expect(dialog.getByLabel("Name")).toBeEditable();
  await expect(dialog.getByLabel("Name")).toBeFocused();
});

test("a heading with inline Markdown gives a plain title in the list and the browser tab", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# The *`npm`* **[guide](https://example.com)** ![logo](x.png)");

  await expect(dialog.getByLabel("Name")).toHaveValue("the-npm-guide-logo");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/the-npm-guide-logo.md");
  await expect(page).toHaveTitle("The npm guide logo – HippoWiki");
  expect((await getTestDb().page.findFirstOrThrow()).title).toBe("The npm guide logo");

  await page.goto("/folders/handbook");
  await expect(page.getByRole("list", { name: "Contents" }).getByRole("link")).toHaveText([/^The npm guide logo/]);
});

test("an umlaut title gives a name with spelled-out umlauts", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# Über Größen");

  await expect(dialog.getByLabel("Name")).toHaveValue("ueber-groessen");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/ueber-groessen.md");
  await expect(page).toHaveTitle("Über Größen – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Über Größen"]);
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

  await expect(page).toHaveURL("/folders/handbook/from-content.md");
  expect((await getTestDb().page.findFirstOrThrow()).title).toBe("From content");
});

test("a taken name shows an error in the open dialog and keeps all values", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ folder: handbook, title: "Existing page", name: "taken" });

  const dialog = await openSaveDialog(page, "# Taken\n\nContent that must not get lost");
  await expect(dialog.getByLabel("Name")).toHaveValue("taken");
  await dialog.getByRole("button", { name: "Save" }).click();

  const name = dialog.getByLabel("Name");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription("Name is already in use");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(NEW_PAGE);
  await expect(name).toHaveValue("taken");
  expect(await getTestDb().page.count()).toBe(1);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Content")).toHaveValue("# Taken\n\nContent that must not get lost");
  expect(errors).toEqual([]);
});

test("a name that is taken in another folder is free in this folder", async ({ page }) => {
  const other = await createFolder({ name: "other" });
  await createPage({ folder: other, title: "Overview of the other folder", name: "overview" });

  const dialog = await openSaveDialog(page, "# Overview");
  await expect(dialog.getByLabel("Name")).toHaveValue("overview");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/overview.md");
  const stored = await getTestDb().page.findMany({ where: { name: "overview" }, orderBy: { title: "asc" } });
  expect(stored.map(({ title, folderId }) => ({ title, folderId }))).toEqual([
    { title: "Overview", folderId: handbook.id },
    { title: "Overview of the other folder", folderId: other.id },
  ]);
});

for (const { name, error } of [
  { name: "Bad Name", error: "Use lowercase letters, digits and single hyphens" },
  { name: "valid-title.md", error: "Use lowercase letters, digits and single hyphens" },
  { name: "", error: "Name is required" },
]) {
  test(`the name "${name}" shows "${error}" in the dialog and creates nothing`, async ({ page }) => {
    const dialog = await openSaveDialog(page, "# Valid title");
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByRole("button", { name: "Save" }).click();

    const nameField = dialog.getByLabel("Name");
    await expect(nameField).toHaveAttribute("aria-invalid", "true");
    await expect(nameField).toHaveAccessibleDescription(error);
    await expect(page).toHaveURL(NEW_PAGE);
    await expect(nameField).toHaveValue(name);
    expect(await getTestDb().page.count()).toBe(0);
  });
}

test("no page name is reserved: a page can be named new", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# New");

  await expect(dialog.getByLabel("Name")).toHaveValue("new");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/new.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["New"]);
});

test("a title in a non-Latin script gives an empty name that must be entered", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# 日本語");

  await expect(dialog.getByLabel("Name")).toHaveValue("");
  await dialog.getByLabel("Name").fill("japanese");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/japanese.md");
  expect((await getTestDb().page.findFirstOrThrow()).title).toBe("日本語");
});

test("cancel in the dialog keeps the content, creates nothing and derives again on reopening", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# First draft\n\nBody");
  await dialog.getByLabel("Name").fill("hand-made");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(NEW_PAGE);
  const content = page.getByLabel("Content");
  await expect(content).toHaveValue("# First draft\n\nBody");
  expect(await getTestDb().page.count()).toBe(0);

  await content.fill("# Second draft\n\nBody");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByLabel("Name")).toHaveValue("second-draft");
});

test("cancel on the form returns to the folder and creates nothing", async ({ page }) => {
  await page.goto(NEW_PAGE);
  await page.getByLabel("Content").fill("# Never saved");
  await page.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL("/folders/handbook");
  await expect(page.getByText("This folder is empty")).toBeVisible();
  expect(await getTestDb().page.count()).toBe(0);
});

test("saving into a folder that no longer exists shows an error and keeps the values", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# Orphan\n\nContent that must not get lost");
  await getTestDb().folder.delete({ where: { id: handbook.id } });
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("This folder no longer exists.");
  await expect(dialog.getByLabel("Name")).toHaveValue("orphan");
  await expect(page.getByLabel("Content")).toHaveValue("# Orphan\n\nContent that must not get lost");
  expect(await getTestDb().page.count()).toBe(0);
});

test("a crafted request whose place is a tab of another folder shows an error and keeps the values", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const other = await createFolder({ name: "other" });
  const foreignTab = await createTab({ folder: other, name: "foreign" });

  const dialog = await openSaveDialog(page, "# Crafted\n\nContent that must not get lost");
  const save = dialog.getByRole("button", { name: "Save" });
  // Send the tab of another folder as the place, as a crafted request would. It is set in the submitted form data, not
  // in a form control: React writes a control's value back whenever it renders the control again.
  await save.evaluate(
    (button: HTMLButtonElement, { field, tabId }) =>
      button.form?.addEventListener("formdata", (event) => event.formData.set(field, tabId)),
    { field: PLACE_FIELD, tabId: foreignTab.id },
  );
  await save.click();

  await expect(dialog.getByRole("alert")).toHaveText("This tab no longer exists.");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(NEW_PAGE);
  await expect(dialog.getByLabel("Name")).toHaveValue("crafted");
  expect(await getTestDb().page.count()).toBe(0);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Content")).toHaveValue("# Crafted\n\nContent that must not get lost");
  expect(errors).toEqual([]);
});
