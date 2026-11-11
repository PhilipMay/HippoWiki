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
  await createPage({ title: "Oldest", slug: "oldest", updatedAt: new Date("2026-01-01T10:00:00Z") });
  await createPage({ title: "Newest", slug: "newest", updatedAt: new Date("2026-03-01T10:00:00Z") });
  await createPage({ title: "Middle", slug: "middle", updatedAt: new Date("2026-02-01T10:00:00Z") });

  await page.goto("/pages");

  const items = page.getByRole("list", { name: "Pages" }).getByRole("listitem");
  await expect(items).toHaveCount(3);
  await expect(items.getByRole("link")).toHaveText([/^Newest/, /^Middle/, /^Oldest/]);
  await expect(items.getByRole("link").nth(1)).toHaveAttribute("href", "/pages/middle");
  await expect(items.nth(1).locator("time")).toHaveAttribute("datetime", "2026-02-01T10:00:00.000Z");

  await items.getByRole("link", { name: /^Middle/ }).click();

  await expect(page).toHaveURL("/pages/middle");
  await expect(page).toHaveTitle("Middle – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Middle"]);
});

test("page view renders the Markdown content", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({
    title: "Rendered page",
    slug: "rendered-page",
    content: [
      "# Rendered page",
      "",
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

  await page.goto("/pages/rendered-page");

  await expect(page).toHaveTitle("Rendered page – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Rendered page"]);
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

test("page view shows the content's heading instead of the stored title", async ({ page }) => {
  const errors = collectErrors(page);
  const created = await createPage({ title: "Stored title", content: "# Content heading\n\nBody text" });

  await page.goto(`/pages/${created.slug}`);

  // The browser tab and the delete dialog use the stored title; the page shows only the content's heading.
  await expect(page).toHaveTitle("Stored title – HippoWiki");
  const article = page.getByRole("article");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Content heading"]);
  await expect(page.getByRole("heading", { name: "Stored title" })).toHaveCount(0);
  await expect(article.getByText(/^Last updated/)).toBeVisible();
  await expect(article.getByText("Body text")).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog", { name: "Delete page?" })).toHaveAccessibleDescription(
    "“Stored title” will be deleted permanently.",
  );
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(`/pages/${created.slug}/edit`);
  await expect(page.getByLabel("Content")).toHaveValue("# Content heading\n\nBody text");
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

  await page.goto(`/pages/${created.slug}`);

  const article = page.getByRole("article");
  await expect(article.getByText("<script>alert(1)</script>")).toBeVisible();
  await expect(article.locator("script")).toHaveCount(0);
  await expect(article.locator("img")).toHaveCount(0);
  const link = article.getByText("Click me");
  await expect(link).not.toHaveAttribute("href", /javascript:/);
  await link.click();
  expect(dialogs).toEqual([]);
});

test("unknown page slug shows the not-found page", async ({ page }) => {
  await createPage({ title: "Existing page", slug: "existing-page" });

  const response = await page.goto("/pages/no-such-page");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
});

for (const slug of ["Bad_Slug", "Existing-Page", "existing--page"]) {
  test(`malformed page slug "${slug}" shows the not-found page`, async ({ page }) => {
    await createPage({ title: "Existing page", slug: "existing-page" });

    const response = await page.goto(`/pages/${slug}`);

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });
}

test("the old id address of a page shows the not-found page", async ({ page }) => {
  const created = await createPage({ title: "Reached by slug", slug: "reached-by-slug" });

  const response = await page.goto(`/pages/${created.id}`);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});
