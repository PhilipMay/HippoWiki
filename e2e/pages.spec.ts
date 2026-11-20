import type { Locator } from "@playwright/test";

import { collectErrors, expectNotFound } from "./support/browser";
import { createFolder, createPage, createUser, resetTestDatabase } from "./support/database";
import { expectContent } from "./support/editor";
import { expect, test } from "./support/test";

test.beforeEach(async () => {
  await resetTestDatabase();
});

test("the home page shows the folder list", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL("/folders");
  await expect(page.getByRole("heading", { level: 1, name: "Folders" })).toBeVisible();
  const mainLinks = page.getByRole("banner").getByRole("navigation", { name: "Main" }).getByRole("link");
  await expect(mainLinks).toHaveText(["Folders", "Users"]);
  await expect(mainLinks.nth(0)).toHaveAttribute("href", "/folders");
  await expect(mainLinks.nth(1)).toHaveAttribute("href", "/users");
});

test("a folder with neither pages nor tabs shows an empty state and no list", async ({ page }) => {
  const other = await createFolder({ name: "other" });
  await createPage({ folder: other, title: "Page of another folder" });
  await createFolder({ name: "handbook" });

  await page.goto("/folders/handbook");

  await expect(page.getByText("This folder is empty")).toBeVisible();
  await expect(page.getByText("Create a page with “New page” or a tab with “New tab”.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Contents" })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("list")).toHaveCount(0);
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

  const items = page.getByRole("list", { name: "Contents" }).getByRole("listitem");
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
  await expect(article.getByRole("link", { name: "Delete" })).toHaveAttribute(
    "href",
    "/folders/handbook/rendered-page.md?action=delete",
  );

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
  await expectContent(page, "# Content heading\n\nBody text");
  expect(errors).toEqual([]);
});

/** The left edge of a visible element, in pixels of the page. */
async function left(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box?.x ?? 0;
}

test("task lists are indented and nested like other lists", async ({ page }) => {
  const errors = collectErrors(page);
  const folder = await createFolder({ name: "handbook" });
  await createPage({
    folder,
    name: "tasks",
    content: [
      "# Task lists",
      "",
      "## Nested",
      "",
      "- [ ] Parent task",
      "    - [x] Child task",
      "",
      "## Mixed",
      "",
      "- [x] Mixed task",
      "- Mixed plain",
      "",
      "## Ordered",
      "",
      "1. [ ] First step",
      "2. [x] Second step",
    ].join("\n"),
  });

  await page.goto("/folders/handbook/tasks.md");

  const article = page.getByRole("article");
  const checkboxes = article.getByRole("checkbox");
  await expect(checkboxes).toHaveCount(5);
  // The checked item of each list is checked, the others are not.
  const checked = [false, true, true, false, true];
  for (const [index, isChecked] of checked.entries()) {
    await expect(checkboxes.nth(index)).toBeChecked({ checked: isChecked });
  }

  // The nested task list is indented under its parent by at least the indent of a list.
  const indent = await article
    .locator("ul.contains-task-list")
    .first()
    .evaluate((list) => Number.parseFloat(getComputedStyle(list).paddingLeft));
  expect(indent).toBeGreaterThan(0);
  expect((await left(checkboxes.nth(1))) - (await left(checkboxes.nth(0)))).toBeGreaterThanOrEqual(indent);

  // The checkboxes sit in the indent of their lists, never left of the content.
  const titleLeft = await left(article.getByRole("heading", { level: 1, name: "Task lists" }));
  for (const checkbox of await checkboxes.all()) {
    expect(await left(checkbox)).toBeGreaterThanOrEqual(titleLeft);
  }

  // A plain item of a task list keeps its bullet; a task item of an ordered list keeps its number.
  const items = article.getByRole("listitem");
  await expect(items.filter({ hasText: /^Mixed plain$/ })).toHaveCSS("list-style-type", "disc");
  await expect(items.filter({ hasText: /^Mixed task$/ })).toHaveCSS("list-style-type", "none");
  await expect(items.filter({ hasText: /^First step$/ })).toHaveCSS("list-style-type", "decimal");
  await expect(items.filter({ hasText: /^Second step$/ })).toHaveCSS("list-style-type", "decimal");
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
    content: [
      "Before",
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(2)>",
      "[Click me](javascript:alert(3))",
      "[Mixed case](JaVaScRiPt:alert(4))",
      "[Entity](&#106;avascript:alert(5))",
      "[Visual Basic](vbscript:msgbox(6))",
      "[Data](data:text/html;base64,PHNjcmlwdD5hbGVydCg3KTwvc2NyaXB0Pg==)",
      "[Reference][unsafe]",
      "<javascript:alert(8)>",
      "![Data image](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==)",
      "[Safe](https://example.com/) [Relative](/folders/handbook) [Mail](mailto:team@example.com)",
      "[unsafe]: javascript:alert(9)",
    ].join("\n\n"),
  });

  await page.goto("/folders/handbook/unsafe.md");

  const article = page.getByRole("article");
  await expect(article.getByText("<script>alert(1)</script>")).toBeVisible();
  await expect(article.locator("script")).toHaveCount(0);
  await expect(article.locator("img")).toHaveCount(0);
  // Each unsafe link stays its Markdown text; only the safe links are links.
  for (const text of [
    "[Click me](javascript:alert(3))",
    "[Mixed case](JaVaScRiPt:alert(4))",
    "[Visual Basic](vbscript:msgbox(6))",
    "<javascript:alert(8)>",
  ]) {
    await expect(article.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(
    article.getByRole("link", { name: /Click me|Mixed case|Entity|Visual Basic|Data|Reference|javascript/ }),
  ).toHaveCount(0);
  await expect(article.getByRole("link", { name: "Safe" })).toHaveAttribute("href", "https://example.com/");
  await expect(article.getByRole("link", { name: "Relative" })).toHaveAttribute("href", "/folders/handbook");
  await expect(article.getByRole("link", { name: "Mail" })).toHaveAttribute("href", "mailto:team@example.com");
  await article.getByText("[Click me](javascript:alert(3))").click();
  const addresses = await page
    .locator("[href], [src]")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("href") ?? element.getAttribute("src") ?? ""),
    );
  expect(addresses.filter((address) => /^\s*(javascript|vbscript|data):/i.test(address))).toEqual([]);
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
  "/folders/handbook/existing-page.md?action=restore",
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

test("a page shows when, by whom and how it was last changed", async ({ page }) => {
  const bob = await createUser({ name: "bob" });
  const folder = await createFolder({ name: "notes" });
  await createPage({ folder, name: "by-agent", title: "By agent", editor: bob, via: "mcp" });
  await createPage({ folder, name: "by-hand", title: "By hand", editor: bob });

  await page.goto("/folders/notes/by-agent.md");
  await expect(page.getByText(/^Last updated /)).toHaveText(/^Last updated .+ by bob via mcp$/);
  await page.goto("/folders/notes/by-hand.md");
  await expect(page.getByText(/^Last updated /)).toHaveText(/^Last updated .+ by bob via web$/);
});
