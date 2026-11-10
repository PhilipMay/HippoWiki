import { expect, test } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { createPage, resetTestDatabase } from "./support/database";

test.beforeEach(async () => {
  await resetTestDatabase();
});

test("home page redirects to the list of pages", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL("/pages");
  await expect(page.getByRole("heading", { level: 1, name: "Pages" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Pages" })).toHaveAttribute("href", "/pages");
});

test("list shows an empty state without pages", async ({ page }) => {
  await page.goto("/pages");

  await expect(page.getByText("No pages yet")).toBeVisible();
  await expect(page.getByRole("list", { name: "Pages" })).toHaveCount(0);
});

test("list shows pages newest first and links to them", async ({ page }) => {
  await createPage({ title: "Oldest", updatedAt: new Date("2026-01-01T10:00:00Z") });
  await createPage({ title: "Newest", updatedAt: new Date("2026-03-01T10:00:00Z") });
  const middle = await createPage({ title: "Middle", updatedAt: new Date("2026-02-01T10:00:00Z") });

  await page.goto("/pages");

  const items = page.getByRole("list", { name: "Pages" }).getByRole("listitem");
  await expect(items).toHaveCount(3);
  await expect(items.getByRole("link")).toHaveText([/^Newest/, /^Middle/, /^Oldest/]);
  await expect(items.nth(1).locator("time")).toHaveAttribute("datetime", "2026-02-01T10:00:00.000Z");

  await items.getByRole("link", { name: /^Middle/ }).click();

  await expect(page).toHaveURL(`/pages/${middle.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Middle" })).toBeVisible();
});

test("page view renders the Markdown content", async ({ page }) => {
  const errors = collectErrors(page);
  const created = await createPage({
    title: "Rendered page",
    content: [
      "## Section heading",
      "",
      "- First item",
      "- Second item",
      "",
      "Read the [Markdown Guide](https://www.markdownguide.org/).",
      "",
      "| Name  | Value |",
      "| ----- | ----- |",
      "| alpha | 42    |",
    ].join("\n"),
  });

  await page.goto(`/pages/${created.id}`);

  await expect(page).toHaveTitle("Rendered page – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: "Rendered page" })).toBeVisible();
  await expect(page.getByText(/^Last updated/)).toBeVisible();
  const article = page.getByRole("article");
  await expect(article.getByRole("heading", { level: 2, name: "Section heading" })).toBeVisible();
  await expect(article.getByRole("listitem")).toHaveText(["First item", "Second item"]);
  await expect(article.getByRole("link", { name: "Markdown Guide" })).toHaveAttribute(
    "href",
    "https://www.markdownguide.org/",
  );
  const table = article.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveText(["Name", "Value"]);
  await expect(table.getByRole("cell")).toHaveText(["alpha", "42"]);
  expect(errors).toEqual([]);
});

test("raw HTML and unsafe links in the Markdown are not executed", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  const created = await createPage({
    title: "Unsafe page",
    content: "Before\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n[Click me](javascript:alert(3))",
  });

  await page.goto(`/pages/${created.id}`);

  const article = page.getByRole("article");
  await expect(article.getByText("<script>alert(1)</script>")).toBeVisible();
  await expect(article.locator("script")).toHaveCount(0);
  await expect(article.locator("img")).toHaveCount(0);
  const link = article.getByText("Click me");
  await expect(link).not.toHaveAttribute("href", /javascript:/);
  await link.click();
  expect(dialogs).toEqual([]);
});

test("unknown page id shows the not-found page", async ({ page }) => {
  const response = await page.goto(`/pages/${crypto.randomUUID()}`);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
});

test("malformed page id shows the not-found page", async ({ page }) => {
  const response = await page.goto("/pages/not-a-uuid");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});
