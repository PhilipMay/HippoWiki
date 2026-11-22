import type { Page } from "@playwright/test";

import { PLACE_FIELD } from "@/features/pages/fields";
import { CONTENT_MAX_DEPTH } from "@/features/pages/limits";

import { KNOWN_USER } from "../prisma/known-users";
import { by, collectErrors } from "./support/browser";
import { createFolder, createPage, createTab, createUser, getTestDb, resetTestDatabase } from "./support/database";
import { contentEditor, expectContent, fillContent } from "./support/editor";
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

/**
 * Opens the editor for a new page at the given address (the folder by default), enters the content and opens the "Save
 * page" dialog.
 */
async function openSaveDialog(page: Page, content: string, address = NEW_PAGE) {
  await page.goto(address);
  await fillContent(page, content);
  await page.getByRole("button", { name: "Save" }).click();
  const dialog = saveDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The logged-in user of the tests, who makes every change through the GUI. */
const USER = KNOWN_USER.name;

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
  await fillContent(page, content);
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

// The other contents without a title heading, such as a level-two heading first, a setext heading or empty content,
// are tested in src/features/pages/derive.test.ts (`titleFromContent`) and give the same error.
test("text before the title heading shows the error at the content field and opens no dialog", async ({ page }) => {
  const errors = collectErrors(page);
  const content = "Intro\n\n# Title";
  await page.goto(NEW_PAGE);
  const field = contentEditor(page);
  await fillContent(page, content);
  await page.getByRole("button", { name: "Save" }).click();

  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(TITLE_HEADING_MISSING);
  await expect(saveDialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(NEW_PAGE);
  await expectContent(page, content);
  expect(await getTestDb().page.count()).toBe(0);

  // Adding a title heading removes the error and opens the dialog.
  await fillContent(page, `# Fixed\n\n${content}`);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(saveDialog(page).getByLabel("Name")).toHaveValue("fixed");
  // Behind the open dialog the editor is hidden from assistive technology.
  await expect(contentEditor(page, { includeHidden: true })).toHaveAttribute("aria-invalid", "false");
  expect(errors).toEqual([]);
});

test("the dialog asks for the name and the place and shows no title", async ({ page }) => {
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
  await expect(name).toBeFocused();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(NEW_PAGE);
  await expect(name).toHaveValue("taken");
  expect(await getTestDb().page.count()).toBe(1);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expectContent(page, "# Taken\n\nContent that must not get lost");
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

test("an invalid name shows its error in the open dialog and creates nothing", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# Valid title");
  const nameField = dialog.getByLabel("Name");

  for (const [name, error] of [
    ["Bad Name", "Use lowercase letters, digits and single hyphens"],
    ["valid-title.md", "Use lowercase letters, digits and single hyphens"],
    ["", "Name is required"],
  ] as const) {
    await nameField.fill(name);
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(nameField, name).toHaveAccessibleDescription(error);
    await expect(nameField, name).toHaveAttribute("aria-invalid", "true");
    await expect(nameField, name).toHaveValue(name);
  }
  await expect(page).toHaveURL(NEW_PAGE);
  expect(await getTestDb().page.count()).toBe(0);
});

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
  await expectContent(page, "# First draft\n\nBody");
  expect(await getTestDb().page.count()).toBe(0);

  await fillContent(page, "# Second draft\n\nBody");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByLabel("Name")).toHaveValue("second-draft");
});

test("the Escape key closes the dialog, keeps the content and creates nothing", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# First draft\n\nBody");
  await page.keyboard.press("Escape");

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(NEW_PAGE);
  await expectContent(page, "# First draft\n\nBody");
  expect(await getTestDb().page.count()).toBe(0);
});

test("cancel on the form returns to the folder and creates nothing", async ({ page }) => {
  await page.goto(NEW_PAGE);
  await fillContent(page, "# Never saved");
  await page.getByRole("link", { name: "Cancel" }).click();
  await page.getByRole("dialog", { name: "Discard changes?" }).getByRole("button", { name: "Discard" }).click();

  await expect(page).toHaveURL("/folders/handbook");
  await expect(page.getByText("This folder is empty")).toBeVisible();
  expect(await getTestDb().page.count()).toBe(0);
});

// A folder that does not exist has no role of the user either, so it answers like a folder the user cannot see.
test("saving into a folder that no longer exists shows the not-found page and creates nothing", async ({ page }) => {
  const dialog = await openSaveDialog(page, "# Orphan\n\nContent that must not get lost");
  // The roles of a folder keep it from being deleted, so they go first.
  await getTestDb().folderRole.deleteMany({ where: { folderId: handbook.id } });
  await getTestDb().folder.delete({ where: { id: handbook.id } });
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
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
  await expectContent(page, "# Crafted\n\nContent that must not get lost");
  expect(errors).toEqual([]);
});

test("lists nested one level too deep are refused with the error and the typed content stays in the editor", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const content = [
    "# Deep lists",
    "",
    ...Array.from({ length: CONTENT_MAX_DEPTH + 1 }, (_, level) => `${"  ".repeat(level)}- level ${level + 1}`),
  ].join("\n");

  const dialog = await openSaveDialog(page, content);
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByRole("alert")).toHaveText(
    `Lists and quotes must be nested at most ${CONTENT_MAX_DEPTH} levels deep`,
  );
  await expect(page).toHaveURL(NEW_PAGE);
  expect(await getTestDb().page.count()).toBe(0);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expectContent(page, content);
  expect(errors).toEqual([]);
});

test.describe("the place of the new page", () => {
  /** The address of the editor for a new page in the tab guides of the folder. */
  const NEW_PAGE_IN_GUIDES = "/folders/handbook/guides?action=new";

  let guides: Awaited<ReturnType<typeof createTab>>;

  test.beforeEach(async () => {
    guides = await createTab({ folder: handbook, name: "guides" });
    await createTab({ folder: handbook, name: "meetings" });
  });

  test("the place the editor was opened for is preselected", async ({ page }) => {
    const errors = collectErrors(page);
    let dialog = await openSaveDialog(page, "# Preselected");
    await expect(dialog.getByRole("radiogroup", { name: "Place" }).getByRole("radio")).toHaveCount(3);
    await expect(dialog.getByRole("radio", { name: "Directly in the folder" })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Tab guides" })).not.toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Tab meetings" })).not.toBeChecked();

    dialog = await openSaveDialog(page, "# Preselected", NEW_PAGE_IN_GUIDES);
    await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Directly in the folder" })).not.toBeChecked();
    await expect(dialog.getByLabel("Name")).toHaveAccessibleDescription(
      "Address: /folders/handbook/guides/preselected.md",
    );
    expect(errors).toEqual([]);
  });

  test("a preset name is proposed in the dialog with the place of the address, and saving creates the page there", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const dialog = await openSaveDialog(
      page,
      "# Frequently asked questions",
      "/folders/handbook/guides?action=new&name=faq",
    );
    await expect(dialog.getByLabel("Name")).toHaveValue("faq");
    await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();
    await expect(dialog.getByLabel("Name")).toHaveAccessibleDescription("Address: /folders/handbook/guides/faq.md");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/handbook/guides/faq.md");
    expect(await getTestDb().page.findFirstOrThrow({ where: { name: "faq" } })).toMatchObject({
      tabId: guides.id,
      title: "Frequently asked questions",
    });

    // The name and the place can still be changed.
    const other = await openSaveDialog(page, "# Other", "/folders/handbook?action=new&name=faq-two");
    await expect(other.getByLabel("Name")).toHaveValue("faq-two");
    await expect(other.getByRole("radio", { name: "Directly in the folder" })).toBeChecked();
    await other.getByLabel("Name").fill("changed");
    await other.getByRole("radio", { name: "Tab meetings" }).check();
    await other.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/meetings/changed.md");
    expect(errors).toEqual([]);
  });

  test("choosing another place than the one of the address creates the page there", async ({ page }) => {
    const errors = collectErrors(page);
    // On a tab address: another tab, then the folder.
    let dialog = await openSaveDialog(page, "# Into the folder", NEW_PAGE_IN_GUIDES);
    await dialog.getByRole("radio", { name: "Tab meetings" }).check();
    await expect(dialog.getByLabel("Name")).toHaveAccessibleDescription(
      "Address: /folders/handbook/meetings/into-the-folder.md",
    );
    await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
    await expect(dialog.getByLabel("Name")).toHaveAccessibleDescription(
      "Address: /folders/handbook/into-the-folder.md",
    );
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/handbook/into-the-folder.md");
    expect(await getTestDb().page.findFirstOrThrow({ where: { name: "into-the-folder" } })).toMatchObject({
      folderId: handbook.id,
      tabId: null,
    });

    // On the folder address: a tab.
    dialog = await openSaveDialog(page, "# Into a tab");
    await dialog.getByRole("radio", { name: "Tab guides" }).check();
    await expect(dialog.getByLabel("Name")).toHaveAccessibleDescription(
      "Address: /folders/handbook/guides/into-a-tab.md",
    );
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/handbook/guides/into-a-tab.md");
    expect(await getTestDb().page.findFirstOrThrow({ where: { name: "into-a-tab" } })).toMatchObject({
      folderId: handbook.id,
      tabId: guides.id,
    });
    expect(errors).toEqual([]);
  });

  test("a name taken at the chosen place keeps name, place and content, and is free at another place", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await createPage({ tab: guides, name: "taken", title: "Taken in guides" });

    const dialog = await openSaveDialog(page, "# Taken\n\nContent that must not get lost");
    await dialog.getByRole("radio", { name: "Tab guides" }).check();
    await dialog.getByRole("button", { name: "Save" }).click();

    const name = dialog.getByLabel("Name");
    await expect(name).toHaveAccessibleDescription("Name is already in use");
    await expect(name).toHaveValue("taken");
    await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();
    await expect(page).toHaveURL(NEW_PAGE);
    expect(await getTestDb().page.count()).toBe(1);

    await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/handbook/taken.md");
    await expect(page.getByRole("article").getByText("Content that must not get lost")).toBeVisible();
    expect(await getTestDb().page.count({ where: { name: "taken" } })).toBe(2);
    expect(errors).toEqual([]);
  });

  test("cancelling the dialog and opening it again starts with the place the editor was opened for", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const dialog = await openSaveDialog(page, "# Reopened", NEW_PAGE_IN_GUIDES);
    await dialog.getByRole("radio", { name: "Tab meetings" }).check();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Tab meetings" })).not.toBeChecked();
    expect(errors).toEqual([]);
  });
});

test("in a folder without tabs the dialog offers only the folder itself", async ({ page }) => {
  const errors = collectErrors(page);
  const dialog = await openSaveDialog(page, "# Alone");

  const places = dialog.getByRole("radiogroup", { name: "Place" }).getByRole("radio");
  await expect(places).toHaveCount(1);
  await expect(places).toHaveAccessibleName("Directly in the folder");
  await expect(places).toBeChecked();
  expect(errors).toEqual([]);
});

test("a new page shows the logged-in user as its last editor in the page view and the lists", async ({ page }) => {
  const errors = collectErrors(page);
  const bob = await createUser({ name: "bob" });
  await createPage({ folder: handbook, name: "older-page", title: "Older page", editor: bob });
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ tab: guides, name: "older-in-tab", title: "Older in tab", editor: bob });

  const dialog = await openSaveDialog(page, "# Getting started");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/getting-started.md");
  await expect(page.getByText(/^Last updated /)).toHaveText(by(USER));

  const inTab = await openSaveDialog(page, "# In the tab", "/folders/handbook/guides?action=new");
  await inTab.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/in-the-tab.md");
  await expect(page.getByText(/^Last updated /)).toHaveText(by(USER));

  await page.goto("/folders/handbook");
  const items = page.getByRole("list", { name: "Contents" }).getByRole("listitem");
  // The pages placed directly in the folder, by title, then the tab.
  await expect(items).toHaveText([/^Getting started.*/, /^Older page.*/, /^guides/]);
  await expect(items.nth(0)).toHaveText(by(USER));
  await expect(items.nth(1)).toHaveText(by("bob"));

  await page.goto("/folders/handbook/guides");
  await expect(page.getByRole("list", { name: "Pages" }).getByRole("listitem")).toHaveText([by(USER), by("bob")]);
  expect(errors).toEqual([]);
});
