import type { Page } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { createFolder, createPage, createTab, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

/** The links of the folder's navigation bar, in display order. */
function navLinks(page: Page) {
  return page.getByRole("navigation", { name: "Folder" }).getByRole("link");
}

async function expectNotFound(page: Page, address: string) {
  const response = await page.goto(address);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
}

test("all pages of a folder are listed by name and then by tab, each with its tab", async ({ page }) => {
  const errors = collectErrors(page);
  const other = await createFolder({ name: "other" });
  const meetings = await createTab({ folder: handbook, name: "meetings" });
  const guides = await createTab({ folder: handbook, name: "guides" });
  // Created in an order that differs from the listed one in every respect.
  await createPage({ tab: meetings, name: "overview", title: "Meetings overview" });
  await createPage({ folder: handbook, name: "zebra", title: "Apple" });
  await createPage({ tab: guides, name: "overview", title: "Guides overview" });
  await createPage({ tab: guides, name: "setup", title: "Setup", updatedAt: new Date("2026-02-01T10:00:00Z") });
  await createPage({ folder: handbook, name: "overview", title: "Folder overview" });
  await createPage({ tab: meetings, name: "agenda", title: "Agenda" });
  await createPage({ folder: other, name: "elsewhere", title: "Elsewhere" });

  await page.goto("/folders/handbook");
  await page.getByRole("main").getByRole("link", { name: "All pages" }).click();

  await expect(page).toHaveURL("/folders/handbook?view=all");
  await expect(page).toHaveTitle("All pages – handbook – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: "handbook" })).toBeVisible();
  await expect(navLinks(page).last()).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Folder" }).locator("[aria-current]")).toHaveCount(1);

  const table = page.getByRole("table", { name: "All pages" });
  await expect(table.getByRole("columnheader")).toHaveText(["Name", "Tab", "Title", "Last update"]);
  const rows = table.getByRole("row").filter({ has: page.getByRole("cell") });
  // By name; among pages of the same name the one placed directly in the folder first, then by tab.
  await expect(rows).toHaveText([
    /^agenda\.mdmeetingsAgenda/,
    /^overview\.md–Folder overview/,
    /^overview\.mdguidesGuides overview/,
    /^overview\.mdmeetingsMeetings overview/,
    /^setup\.mdguidesSetup/,
    /^zebra\.md–Apple/,
  ]);
  const links = table.getByRole("link");
  await expect(links).toHaveCount(6);
  await expect(links.nth(1)).toHaveAttribute("href", "/folders/handbook/overview.md");
  await expect(links.nth(2)).toHaveAttribute("href", "/folders/handbook/guides/overview.md");
  await expect(links.nth(3)).toHaveAttribute("href", "/folders/handbook/meetings/overview.md");
  await expect(rows.nth(4).locator("time")).toHaveAttribute("datetime", "2026-02-01T10:00:00.000Z");

  await links.nth(2).click();
  await expect(page).toHaveURL("/folders/handbook/guides/overview.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Guides overview"]);
  expect(errors).toEqual([]);
});

test("the list of all pages shows an empty state for a folder without pages", async ({ page }) => {
  const other = await createFolder({ name: "other" });
  await createPage({ folder: other, title: "Page of another folder" });
  await createTab({ folder: handbook, name: "guides" });

  await page.goto("/folders/handbook?view=all");

  await expect(page.getByText("No pages yet")).toBeVisible();
  await expect(
    page.getByText("This folder has no pages, neither placed directly in it nor in its tabs."),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(navLinks(page)).toHaveText(["handbook", "guides", "All pages"]);
});

test("the list of all pages is reached from a tab and left through the folder entry", async ({ page }) => {
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ tab: guides, name: "setup", title: "Setup" });

  await page.goto("/folders/handbook/guides");
  await navLinks(page).last().click();
  await expect(page).toHaveURL("/folders/handbook?view=all");
  await expect(page.getByRole("table", { name: "All pages" }).getByRole("link")).toHaveText(["setup.md"]);

  await navLinks(page).first().click();
  await expect(page).toHaveURL("/folders/handbook");
  await expect(page.getByText("No pages yet")).toBeVisible();
});

for (const address of [
  // Unknown, empty and repeated views.
  "/folders/handbook?view=some",
  "/folders/handbook?view=All",
  "/folders/handbook?view=",
  "/folders/handbook?view=all&view=all",
  // A view has no actions.
  "/folders/handbook?view=all&action=new",
  "/folders/handbook?view=all&action=rename",
  "/folders/handbook?view=all&action=delete",
  // Addresses without views.
  "/folders?view=all",
  "/folders/handbook/guides?view=all",
  "/folders/handbook/in-folder.md?view=all",
  "/folders/handbook/guides/in-guides.md?view=all",
  "/folders/no-such-folder?view=all",
]) {
  test(`${address} shows the not-found page`, async ({ page }) => {
    const guides = await createTab({ folder: handbook, name: "guides" });
    await createPage({ tab: guides, name: "in-guides", title: "In guides" });
    await createPage({ folder: handbook, name: "in-folder", title: "In folder" });

    await expectNotFound(page, address);
  });
}
