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
  await page.getByLabel("Content").fill("## Getting started\n\n- First step\n- Second step");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Created in the browser" })).toBeVisible();
  const article = page.getByRole("article");
  await expect(article.getByRole("heading", { level: 2, name: "Getting started" })).toBeVisible();
  await expect(article.getByRole("listitem")).toHaveText(["First step", "Second step"]);

  const stored = await getTestDb().page.findMany({ where: { title: "Created in the browser" } });
  expect(stored).toHaveLength(1);
  expect(stored[0].content).toBe("## Getting started\n\n- First step\n- Second step");
  expect(page.url()).toMatch(new RegExp(`/pages/${stored[0].id}$`));

  await page.getByRole("banner").getByRole("link", { name: "Pages" }).click();

  const links = page.getByRole("list", { name: "Pages" }).getByRole("link");
  await expect(links).toHaveText([/^Created in the browser/, /^Older page/]);
  expect(errors).toEqual([]);
});

test("an empty title shows an error at the field and creates nothing", async ({ page }) => {
  await page.goto("/pages/new");
  await page.getByLabel("Title").fill("   ");
  await page.getByLabel("Content").fill("Content that must not get lost");
  await page.getByRole("button", { name: "Save" }).click();

  const title = page.getByLabel("Title");
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(title).toHaveAccessibleDescription("Title is required");
  await expect(page).toHaveURL("/pages/new");
  await expect(page.getByLabel("Content")).toHaveValue("Content that must not get lost");
  expect(await getTestDb().page.count()).toBe(0);
});

test("cancel returns to the list and creates nothing", async ({ page }) => {
  await page.goto("/pages/new");
  await page.getByLabel("Title").fill("Never saved");
  await page.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL("/pages");
  await expect(page.getByText("No pages yet")).toBeVisible();
  expect(await getTestDb().page.count()).toBe(0);
});
