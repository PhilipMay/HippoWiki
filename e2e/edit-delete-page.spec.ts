import { expect, test, type Page as BrowserPage } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { createPage, getTestDb, resetTestDatabase } from "./support/database";

test.beforeEach(async () => {
  await resetTestDatabase();
});

/** The links of the page list, in display order. */
function listLinks(page: BrowserPage) {
  return page.getByRole("list", { name: "Pages" }).getByRole("link");
}

test("editing slug and content shows the new version and moves it to the top of the list", async ({ page }) => {
  const errors = collectErrors(page);
  const oldUpdatedAt = new Date("2026-01-01T10:00:00Z");
  const edited = await createPage({
    slug: "original-slug",
    content: "# Original title\n\nOriginal content",
    updatedAt: oldUpdatedAt,
  });
  await createPage({ title: "Other page", updatedAt: new Date("2026-02-01T10:00:00Z") });

  await page.goto("/pages/original-slug");
  await page.getByRole("link", { name: "Edit" }).click();

  await expect(page).toHaveURL("/pages/original-slug/edit");
  await expect(page).toHaveTitle("Edit Original title – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: "Edit page" })).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveCount(0);
  await expect(page.getByLabel("Slug")).toHaveValue("original-slug");
  await expect(page.getByLabel("Content")).toHaveValue("# Original title\n\nOriginal content");
  await page.getByLabel("Slug").fill(" edited-slug ");
  await page.getByLabel("Content").fill("# Edited title\n\n## New section\n\n- Changed item");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/pages/edited-slug");
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
    slug: "edited-slug",
    content: "# Edited title\n\n## New section\n\n- Changed item",
  });
  expect(stored.updatedAt.toISOString()).toBe(shownUpdatedAt);
  expect(await getTestDb().page.count()).toBe(2);

  await page.getByRole("banner").getByRole("link", { name: "Pages" }).click();
  await expect(listLinks(page)).toHaveText([/^Edited title/, /^Other page/]);
  await expect(listLinks(page).first()).toHaveAttribute("href", "/pages/edited-slug");
  expect(errors).toEqual([]);
});

test("the edit form starts with the cursor at the start of the content", async ({ page }) => {
  const errors = collectErrors(page);
  const created = await createPage({ title: "Focused page", content: "# Focused page\n\nSome content" });

  async function expectCursorAtContentStart() {
    const content = page.getByLabel("Content");
    await expect(content).toBeFocused();
    await expect(page.getByLabel("Slug")).not.toBeFocused();
    const selection = await content.evaluate((field: HTMLTextAreaElement) => [
      field.selectionStart,
      field.selectionEnd,
    ]);
    expect(selection).toEqual([0, 0]);
  }

  await page.goto(`/pages/${created.slug}`);
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(`/pages/${created.slug}/edit`);
  await expectCursorAtContentStart();

  await page.goto(`/pages/${created.slug}/edit`);
  await expectCursorAtContentStart();
  expect(errors).toEqual([]);
});

test("changing the heading changes the title and the list entry, but not the slug", async ({ page }) => {
  const errors = collectErrors(page);
  const edited = await createPage({ slug: "stable-slug", content: "# Before\n\nBody" });

  await page.goto("/pages/stable-slug/edit");
  await page.getByLabel("Content").fill("# After the *change*\n\nBody");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/pages/stable-slug");
  await expect(page).toHaveTitle("After the change – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["After the change"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: edited.id } })).toMatchObject({
    title: "After the change",
    slug: "stable-slug",
  });

  await page.getByRole("banner").getByRole("link", { name: "Pages" }).click();
  await expect(listLinks(page)).toHaveText([/^After the change/]);
  await expect(listLinks(page).first()).toHaveAttribute("href", "/pages/stable-slug");
  expect(errors).toEqual([]);
});

test("a page stored with a different title gets the derived title on its next save", async ({ page }) => {
  const created = await createPage({ title: "Stored title", content: "# Heading title\n\nBody" });

  await page.goto(`/pages/${created.slug}/edit`);
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(`/pages/${created.slug}`);
  await expect(page).toHaveTitle("Heading title – HippoWiki");
  expect((await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).title).toBe("Heading title");
});

test("removing the title heading shows an error at the content field and keeps all values", async ({ page }) => {
  const errors = collectErrors(page);
  const created = await createPage({ title: "Valid title" });

  await page.goto(`/pages/${created.slug}/edit`);
  await page.getByLabel("Slug").fill("new-slug");
  await page.getByLabel("Content").fill("Intro first\n\n# Valid title\n\nNew content that must not get lost");
  await page.getByRole("button", { name: "Save" }).click();

  const content = page.getByLabel("Content");
  await expect(content).toHaveAttribute("aria-invalid", "true");
  await expect(content).toHaveAccessibleDescription("Content must start with a title heading: # Title");
  await expect(page).toHaveURL(`/pages/${created.slug}/edit`);
  await expect(page.getByLabel("Slug")).toHaveValue("new-slug");
  await expect(content).toHaveValue("Intro first\n\n# Valid title\n\nNew content that must not get lost");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toEqual(created);
  expect(errors).toEqual([]);
});

test("a form submission with an extra title field stores the derived title", async ({ page }) => {
  const created = await createPage({ title: "Original" });

  await page.goto(`/pages/${created.slug}/edit`);
  await page.getByLabel("Content").fill("# From content");
  const save = page.getByRole("button", { name: "Save" });
  // Add a title field to the form, as a crafted request would.
  await save.evaluate((button: HTMLButtonElement) => {
    const input = document.createElement("input");
    Object.assign(input, { type: "hidden", name: "title", value: "Injected title" });
    button.form?.append(input);
  });
  await save.click();

  await expect(page).toHaveURL(`/pages/${created.slug}`);
  expect((await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).title).toBe("From content");
});

test("the previous slug of a renamed page shows the not-found page", async ({ page }) => {
  const renamed = await createPage({ title: "Renamed page", slug: "old-address" });

  await page.goto("/pages/old-address/edit");
  await page.getByLabel("Slug").fill("new-address");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/pages/new-address");
  await expect(page).toHaveTitle("Renamed page – HippoWiki");

  for (const oldUrl of ["/pages/old-address", "/pages/old-address/edit"]) {
    const response = await page.goto(oldUrl);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  }
  expect((await getTestDb().page.findUniqueOrThrow({ where: { id: renamed.id } })).slug).toBe("new-address");
});

test("cancelling an edit returns to the page view and changes nothing", async ({ page }) => {
  const created = await createPage({ title: "Unchanged", content: "# Unchanged\n\nUnchanged content" });

  await page.goto(`/pages/${created.slug}/edit`);
  await page.getByLabel("Content").fill("# Never saved");
  await page.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL(`/pages/${created.slug}`);
  await expect(page).toHaveTitle("Unchanged – HippoWiki");
  await expect(page.getByRole("article").getByText("Unchanged content")).toBeVisible();
  const stored = await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } });
  expect(stored).toEqual(created);
});

test("a slug taken by another page shows an error at the field and keeps all values", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ title: "Other page", slug: "taken" });
  const edited = await createPage({ title: "Edited page", slug: "edited-page" });

  await page.goto(`/pages/${edited.slug}/edit`);
  await page.getByLabel("Slug").fill("taken");
  await page.getByLabel("Content").fill("# New title\n\nNew content that must not get lost");
  await page.getByRole("button", { name: "Save" }).click();

  const slug = page.getByLabel("Slug");
  await expect(slug).toHaveAttribute("aria-invalid", "true");
  await expect(slug).toHaveAccessibleDescription("Slug is already in use");
  await expect(page).toHaveURL(`/pages/${edited.slug}/edit`);
  await expect(slug).toHaveValue("taken");
  await expect(page.getByLabel("Content")).toHaveValue("# New title\n\nNew content that must not get lost");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: edited.id } })).toEqual(edited);
  expect(errors).toEqual([]);
});

test("saving a page that was deleted in the meantime shows an error and keeps the values", async ({ page }) => {
  const created = await createPage({ title: "Soon gone" });

  await page.goto(`/pages/${created.slug}/edit`);
  await getTestDb().page.delete({ where: { id: created.id } });
  await page.getByLabel("Content").fill("# Soon gone\n\nTyped after the page was deleted");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "This page no longer exists. It may have been deleted.",
  );
  await expect(page).toHaveURL(`/pages/${created.slug}/edit`);
  await expect(page.getByLabel("Content")).toHaveValue("# Soon gone\n\nTyped after the page was deleted");
  expect(await getTestDb().page.count()).toBe(0);
});

test("editing an unknown or malformed slug or an old id address shows the not-found page", async ({ page }) => {
  const created = await createPage({ title: "Existing page", slug: "existing-page" });

  for (const url of ["/pages/no-such-page/edit", "/pages/Bad_Slug/edit", `/pages/${created.id}/edit`]) {
    const response = await page.goto(url);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  }
});

test("deleting a page after confirmation removes it and returns to the list", async ({ page }) => {
  const errors = collectErrors(page);
  const deleted = await createPage({ title: "To be deleted" });
  await createPage({ title: "Kept page" });

  await page.goto(`/pages/${deleted.slug}`);
  await page.getByRole("button", { name: "Delete" }).click();

  const dialog = page.getByRole("dialog", { name: "Delete page?" });
  await expect(dialog).toHaveAccessibleDescription("“To be deleted” will be deleted permanently.");
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(page).toHaveURL("/pages");
  await expect(listLinks(page)).toHaveText([/^Kept page/]);
  expect(await getTestDb().page.findUnique({ where: { id: deleted.id } })).toBeNull();
  expect(errors).toEqual([]);
});

test("deleting a page that was deleted in the meantime returns to the list", async ({ page }) => {
  const created = await createPage({ title: "Deleted twice" });

  await page.goto(`/pages/${created.slug}`);
  await page.getByRole("button", { name: "Delete" }).click();
  await getTestDb().page.delete({ where: { id: created.id } });
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();

  await expect(page).toHaveURL("/pages");
  await expect(page.getByText("No pages yet")).toBeVisible();
});

test("cancelling the delete dialog keeps the page", async ({ page }) => {
  const created = await createPage({ title: "Still here" });

  await page.goto(`/pages/${created.slug}`);
  await page.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete page?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(`/pages/${created.slug}`);
  await expect(page).toHaveTitle("Still here – HippoWiki");
  expect(await getTestDb().page.count()).toBe(1);
});

test("a page can be created, edited and deleted", async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto("/pages");
  await expect(page.getByText("No pages yet")).toBeVisible();

  await page.getByRole("link", { name: "New page" }).click();
  await page.getByLabel("Content").fill("# Lifecycle page\n\nFirst version");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog", { name: "Save page" }).getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/pages/lifecycle-page");
  await expect(page).toHaveTitle("Lifecycle page – HippoWiki");

  await page.getByRole("banner").getByRole("link", { name: "Pages" }).click();
  await expect(listLinks(page)).toHaveText([/^Lifecycle page/]);

  await page.getByRole("link", { name: /^Lifecycle page/ }).click();
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Content").fill("# Lifecycle page, edited\n\nSecond version");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/pages/lifecycle-page");
  await expect(page).toHaveTitle("Lifecycle page, edited – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Lifecycle page, edited"]);
  await expect(page.getByRole("article").getByText("Second version")).toBeVisible();

  await page.getByRole("banner").getByRole("link", { name: "Pages" }).click();
  await expect(listLinks(page)).toHaveText([/^Lifecycle page, edited/]);

  await page.getByRole("link", { name: /^Lifecycle page, edited/ }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/pages");
  await expect(page.getByText("No pages yet")).toBeVisible();
  expect(await getTestDb().page.count()).toBe(0);
  expect(errors).toEqual([]);
});
