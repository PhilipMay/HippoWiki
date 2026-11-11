import { expect, test } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { createPage, getTestDb, resetTestDatabase } from "./support/database";

test.beforeEach(async () => {
  await resetTestDatabase();
});

test("creating a page shows it rendered and lists it first", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ title: "Older page", updatedAt: new Date("2026-01-01T10:00:00Z") });

  await page.goto("/pages");
  await page.getByRole("link", { name: "New page" }).click();

  await expect(page).toHaveURL("/pages/new");
  await expect(page).toHaveTitle("New page – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: "New page" })).toBeVisible();
  await page.getByLabel("Title").fill("  Created in the browser  ");
  await page.getByLabel("Slug").fill("created-in-the-browser");
  await expect(page.getByLabel("Slug")).toHaveAccessibleDescription("Address: /pages/created-in-the-browser");
  await page.getByLabel("Content").fill("## Getting started\n\n- First step\n- Second step");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/pages/created-in-the-browser");
  await expect(page.getByRole("heading", { level: 1, name: "Created in the browser" })).toBeVisible();
  const article = page.getByRole("article");
  await expect(article.getByRole("heading", { level: 2, name: "Getting started" })).toBeVisible();
  await expect(article.getByRole("listitem")).toHaveText(["First step", "Second step"]);

  const stored = await getTestDb().page.findMany({ where: { title: "Created in the browser" } });
  expect(stored).toHaveLength(1);
  expect(stored[0].slug).toBe("created-in-the-browser");
  expect(stored[0].content).toBe("## Getting started\n\n- First step\n- Second step");

  await page.getByRole("banner").getByRole("link", { name: "Pages" }).click();

  const links = page.getByRole("list", { name: "Pages" }).getByRole("link");
  await expect(links).toHaveText([/^Created in the browser/, /^Older page/]);
  expect(errors).toEqual([]);
});

test("an empty title shows an error at the field and creates nothing", async ({ page }) => {
  await page.goto("/pages/new");
  await page.getByLabel("Title").fill("   ");
  await page.getByLabel("Slug").fill("valid-slug");
  await page.getByLabel("Content").fill("Content that must not get lost");
  await page.getByRole("button", { name: "Save" }).click();

  const title = page.getByLabel("Title");
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(title).toHaveAccessibleDescription("Title is required");
  await expect(page).toHaveURL("/pages/new");
  await expect(page.getByLabel("Slug")).toHaveValue("valid-slug");
  await expect(page.getByLabel("Content")).toHaveValue("Content that must not get lost");
  expect(await getTestDb().page.count()).toBe(0);
});

test("a taken slug shows an error at the field and keeps all values", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ title: "Existing page", slug: "taken" });

  await page.goto("/pages/new");
  await page.getByLabel("Title").fill("Another page");
  await page.getByLabel("Slug").fill("taken");
  await page.getByLabel("Content").fill("Content that must not get lost");
  await page.getByRole("button", { name: "Save" }).click();

  const slug = page.getByLabel("Slug");
  await expect(slug).toHaveAttribute("aria-invalid", "true");
  await expect(slug).toHaveAccessibleDescription("Slug is already in use");
  await expect(page).toHaveURL("/pages/new");
  await expect(page.getByLabel("Title")).toHaveValue("Another page");
  await expect(slug).toHaveValue("taken");
  await expect(page.getByLabel("Content")).toHaveValue("Content that must not get lost");
  expect(await getTestDb().page.count()).toBe(1);
  expect(errors).toEqual([]);
});

for (const { slug, error } of [
  { slug: "", error: "Slug is required" },
  { slug: "Bad Slug", error: "Use lowercase letters, digits and single hyphens" },
  { slug: "new", error: "This slug is reserved" },
]) {
  test(`the slug "${slug}" shows "${error}" at the field and creates nothing`, async ({ page }) => {
    await page.goto("/pages/new");
    await page.getByLabel("Title").fill("Valid title");
    await page.getByLabel("Slug").fill(slug);
    await page.getByRole("button", { name: "Save" }).click();

    const slugField = page.getByLabel("Slug");
    await expect(slugField).toHaveAttribute("aria-invalid", "true");
    await expect(slugField).toHaveAccessibleDescription(error);
    await expect(page.getByLabel("Title")).toHaveAttribute("aria-invalid", "false");
    await expect(page).toHaveURL("/pages/new");
    await expect(slugField).toHaveValue(slug);
    expect(await getTestDb().page.count()).toBe(0);
  });
}

test("cancel returns to the list and creates nothing", async ({ page }) => {
  await page.goto("/pages/new");
  await page.getByLabel("Title").fill("Never saved");
  await page.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL("/pages");
  await expect(page.getByText("No pages yet")).toBeVisible();
  expect(await getTestDb().page.count()).toBe(0);
});
