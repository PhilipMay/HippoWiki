import { expect, test, type Page } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { createFolder, createPage, resetTestDatabase } from "./support/database";

test.beforeEach(async () => {
  await resetTestDatabase();
});

async function expectNotFound(page: Page, address: string) {
  const response = await page.goto(address);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
}

test("the home page shows the folder list", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL("/folders");
  await expect(page.getByRole("heading", { level: 1, name: "Folders" })).toBeVisible();
  const mainLinks = page.getByRole("banner").getByRole("navigation", { name: "Main" }).getByRole("link");
  await expect(mainLinks).toHaveText(["Folders"]);
  await expect(mainLinks).toHaveAttribute("href", "/folders");
});

test("a folder shows an empty state without pages", async ({ page }) => {
  const other = await createFolder({ name: "other" });
  await createPage({ folder: other, title: "Page of another folder" });
  await createFolder({ name: "handbook" });

  await page.goto("/folders/handbook");

  await expect(page.getByText("No pages yet")).toBeVisible();
  await expect(page.getByRole("list", { name: "Pages" })).toHaveCount(0);
});

test("a folder lists its pages by name and links to them", async ({ page }) => {
  const folder = await createFolder({ name: "handbook" });
  const other = await createFolder({ name: "other" });
  // Names, titles and update times each give a different order; the list follows the names.
  await createPage({ folder, name: "middle", title: "Zebra", updatedAt: new Date("2026-02-01T10:00:00Z") });
  await createPage({ folder, name: "last", title: "Apple", updatedAt: new Date("2026-03-01T10:00:00Z") });
  await createPage({ folder, name: "first", title: "Mango", updatedAt: new Date("2026-01-01T10:00:00Z") });
  await createPage({ folder: other, name: "elsewhere", title: "Elsewhere" });

  await page.goto("/folders/handbook");

  const items = page.getByRole("list", { name: "Pages" }).getByRole("listitem");
  await expect(items).toHaveCount(3);
  await expect(items.getByRole("link")).toHaveText([/^Mango.*first\.md/, /^Apple.*last\.md/, /^Zebra.*middle\.md/]);
  await expect(items.getByRole("link").nth(2)).toHaveAttribute("href", "/folders/handbook/middle.md");
  await expect(items.nth(2).locator("time")).toHaveAttribute("datetime", "2026-02-01T10:00:00.000Z");

  await items.getByRole("link", { name: /^Zebra/ }).click();

  await expect(page).toHaveURL("/folders/handbook/middle.md");
  await expect(page).toHaveTitle("Zebra – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Zebra"]);
});

test("page view renders the Markdown content below a breadcrumb", async ({ page }) => {
  const errors = collectErrors(page);
  const folder = await createFolder({ name: "handbook" });
  await createPage({
    folder,
    name: "rendered-page",
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

  await page.goto("/folders/handbook/rendered-page.md");

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

  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb.getByRole("listitem")).toHaveText(["Folders", "handbook", "rendered-page.md"]);
  await expect(breadcrumb.getByRole("link", { name: "Folders" })).toHaveAttribute("href", "/folders");
  await expect(breadcrumb.getByText("rendered-page.md")).toHaveAttribute("aria-current", "page");
  await expect(article.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(article.getByRole("link", { name: "Delete" })).toHaveCount(0);

  await breadcrumb.getByRole("link", { name: "handbook" }).click();
  await expect(page).toHaveURL("/folders/handbook");
  expect(errors).toEqual([]);
});

test("page view shows the content's heading instead of the stored title", async ({ page }) => {
  const errors = collectErrors(page);
  const folder = await createFolder({ name: "handbook" });
  await createPage({ folder, name: "stored", title: "Stored title", content: "# Content heading\n\nBody text" });

  await page.goto("/folders/handbook/stored.md");

  // The browser tab uses the stored title; the page shows only the content's heading.
  await expect(page).toHaveTitle("Stored title – HippoWiki");
  const article = page.getByRole("article");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Content heading"]);
  await expect(page.getByRole("heading", { name: "Stored title" })).toHaveCount(0);
  await expect(article.getByText(/^Last updated/)).toBeVisible();
  await expect(article.getByText("Body text")).toBeVisible();

  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL("/folders/handbook/stored.md?action=edit");
  await expect(page.getByLabel("Content")).toHaveValue("# Content heading\n\nBody text");
  expect(errors).toEqual([]);
});

test("raw HTML and unsafe links in the Markdown are not executed", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  const folder = await createFolder({ name: "handbook" });
  await createPage({
    folder,
    name: "unsafe",
    title: "Unsafe page",
    content: "Before\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n[Click me](javascript:alert(3))",
  });

  await page.goto("/folders/handbook/unsafe.md");

  const article = page.getByRole("article");
  await expect(article.getByText("<script>alert(1)</script>")).toBeVisible();
  await expect(article.locator("script")).toHaveCount(0);
  await expect(article.locator("img")).toHaveCount(0);
  const link = article.getByText("Click me");
  await expect(link).not.toHaveAttribute("href", /javascript:/);
  await link.click();
  expect(dialogs).toEqual([]);
});

test("the same page name in two folders gives two pages, each at its own address", async ({ page }) => {
  const handbook = await createFolder({ name: "handbook" });
  const archive = await createFolder({ name: "archive" });
  await createPage({ folder: handbook, name: "overview", content: "# Handbook overview" });
  await createPage({ folder: archive, name: "overview", content: "# Archive overview" });

  await page.goto("/folders/handbook/overview.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Handbook overview"]);

  await page.goto("/folders/archive/overview.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Archive overview"]);
});

for (const address of [
  // An unknown page, and a page address without or with a wrong suffix.
  "/folders/handbook/no-such-page.md",
  "/folders/handbook/existing-page",
  "/folders/handbook/existing-page.MD",
  "/folders/handbook/existing-page.Md",
  "/folders/handbook/existing-page.md.md",
  "/folders/handbook/existing-page.markdown",
  // Malformed names.
  "/folders/handbook/Existing-Page.md",
  "/folders/handbook/existing--page.md",
  "/folders/handbook/.md",
  "/folders/Handbook/existing-page.md",
  // The page of another folder, and an unknown folder.
  "/folders/other/existing-page.md",
  "/folders/no-such-folder/existing-page.md",
  // Unknown and repeated actions.
  "/folders/handbook/existing-page.md?action=delete",
  "/folders/handbook/existing-page.md?action=new",
  "/folders/handbook/existing-page.md?action=",
  "/folders/handbook/existing-page.md?action=edit&action=edit",
  "/folders/handbook/existing-page?action=edit",
  // Page addresses outside `/folders`.
  "/pages",
  "/pages/new",
  "/pages/existing-page",
  "/pages/existing-page/edit",
]) {
  test(`${address} shows the not-found page`, async ({ page }) => {
    const folder = await createFolder({ name: "handbook" });
    await createFolder({ name: "other" });
    await createPage({ folder, name: "existing-page", title: "Existing page" });

    await expectNotFound(page, address);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to folders" })).toHaveAttribute("href", "/folders");
  });
}
