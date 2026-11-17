import type { Page } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { collectErrors } from "./support/browser";
import {
  createFolder,
  createPage,
  createRevisions,
  createTab,
  createUser,
  resetTestDatabase,
} from "./support/database";
import { expect, test } from "./support/test";

/** The known user, who is logged in; given a role on a folder by `createFolder({ roles })`. */
const ALICE = { id: KNOWN_USER.id };

test.beforeEach(async () => {
  await resetTestDatabase();
});

async function expectNotFound(page: Page, address: string) {
  const response = await page.goto(address);

  expect(response?.status(), address).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
}

/** The entries of the list of revisions, in display order. */
function revisionLinks(page: Page) {
  return page.getByRole("list", { name: "Revisions" }).getByRole("link");
}

/** The names "Revision <n>" of the revisions from `from` down to `to`, as the history lists them. */
function revisionsFromTo(from: number, to: number): RegExp[] {
  return Array.from({ length: from - to + 1 }, (_, index) => new RegExp(`^Revision ${from - index}(?!\\d)`));
}

test.describe("the history list", () => {
  test("a Reader opens the history from the page and sees each revision with number, time, user, channel and title", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const mike = await createUser({ name: "mike" });
    const folder = await createFolder({ name: "handbook", roles: [{ user: ALICE, role: "reader" }] });
    const guides = await createTab({ folder, name: "guides" });
    const setup = await createPage({
      tab: guides,
      name: "setup",
      content: "# Setup\n\nFirst",
      editor: mike,
      updatedAt: new Date("2026-03-01T10:00:00Z"),
    });
    await createRevisions({
      page: setup,
      count: 1,
      content: () => "# Installation\n\nSecond",
      via: "mcp",
      createdAt: () => new Date("2026-03-02T10:00:00Z"),
    });

    await page.goto("/folders/handbook/guides/setup.md");
    await page.getByRole("main").getByRole("link", { name: "History", exact: true }).click();

    await expect(page).toHaveURL("/folders/handbook/guides/setup.md?view=history");
    await expect(page).toHaveTitle("History of Installation – HippoWiki");
    await expect(page.getByRole("heading", { level: 1, name: "Installation" })).toBeVisible();
    await expect(page.getByText("History: revisions 2 to 1 of 2")).toBeVisible();
    await expect(revisionLinks(page)).toHaveText([
      /^Revision 2Mar 2, 2026, .+ by mike via mcp · Installation$/,
      /^Revision 1Mar 1, 2026, .+ by mike via web · Setup$/,
    ]);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link")).toHaveText([
      "Folders",
      "handbook",
      "guides",
      "setup.md",
    ]);
    await expect(page.getByRole("link", { name: "Older revisions" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Newer revisions" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a user without a role on the folder gets the not-found page at the address of the history", async ({
    page,
  }) => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "handbook", roles: [{ user: bob, role: "owner" }] });
    await createPage({ folder, name: "intro" });

    await expectNotFound(page, "/folders/handbook/intro.md?view=history");
  });

  test("a page with 250 revisions shows 100 at a time, the oldest still listed", async ({ page }) => {
    const errors = collectErrors(page);
    const folder = await createFolder({ name: "handbook" });
    const intro = await createPage({ folder, name: "intro" });
    await createRevisions({ page: intro, count: 249 });

    await page.goto("/folders/handbook/intro.md?view=history");
    await expect(revisionLinks(page)).toHaveText(revisionsFromTo(250, 151));
    await expect(page.getByRole("link", { name: "Newer revisions" })).toHaveCount(0);

    await page.getByRole("link", { name: "Older revisions" }).click();
    await expect(page).toHaveURL("/folders/handbook/intro.md?view=history&before=151");
    await expect(revisionLinks(page)).toHaveText(revisionsFromTo(150, 51));

    await page.getByRole("link", { name: "Older revisions" }).click();
    await expect(page).toHaveURL("/folders/handbook/intro.md?view=history&before=51");
    await expect(revisionLinks(page)).toHaveText(revisionsFromTo(50, 1));
    await expect(page.getByRole("link", { name: "Older revisions" })).toHaveCount(0);

    await page.getByRole("link", { name: "Newer revisions" }).click();
    await expect(page).toHaveURL("/folders/handbook/intro.md?view=history&before=151");
    await expect(revisionLinks(page)).toHaveText(revisionsFromTo(150, 51));
    await page.getByRole("link", { name: "Newer revisions" }).click();
    await expect(page).toHaveURL("/folders/handbook/intro.md?view=history");
    await expect(revisionLinks(page)).toHaveText(revisionsFromTo(250, 151));
    expect(errors).toEqual([]);
  });

  test("a revision recorded by a revert names the revision it went back to", async ({ page }) => {
    const folder = await createFolder({ name: "handbook" });
    const intro = await createPage({ folder, name: "intro", content: "# Intro\n\nFirst" });
    await createRevisions({ page: intro, count: 1, content: () => "# Intro\n\nSecond" });
    await createRevisions({
      page: intro,
      count: 1,
      content: () => "# Intro\n\nFirst",
      revertedTo: () => 1,
    });

    await page.goto("/folders/handbook/intro.md?view=history");

    await expect(revisionLinks(page)).toHaveText([
      /^Revision 3.* · Intro · Reverted to revision 1$/,
      /^Revision 2.* · Intro$/,
      /^Revision 1.* · Intro$/,
    ]);
  });

  test("after a rename the history at the new address lists the same revisions", async ({ page }) => {
    const folder = await createFolder({ name: "handbook" });
    const intro = await createPage({ folder, name: "intro" });
    await createRevisions({ page: intro, count: 2 });

    await page.goto("/folders/handbook/intro.md?action=move-or-rename");
    const dialog = page.getByRole("dialog", { name: "Move or rename page" });
    await dialog.getByLabel("Name").fill("start");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/start.md");

    await page.goto("/folders/handbook/start.md?view=history");
    await expect(revisionLinks(page)).toHaveText(revisionsFromTo(3, 1));
    await expectNotFound(page, "/folders/handbook/intro.md?view=history");
  });

  test("an invalid before, the view with an action, a parameter of another view and an unknown view show the not-found page", async ({
    page,
  }) => {
    const folder = await createFolder({ name: "handbook" });
    const guides = await createTab({ folder, name: "guides" });
    const intro = await createPage({ folder, name: "intro" });
    await createRevisions({ page: intro, count: 4 });
    await createPage({ tab: guides, name: "setup" });

    expect((await page.goto("/folders/handbook/intro.md?view=history&before=5"))?.status()).toBe(200);
    await expect(revisionLinks(page)).toHaveText(revisionsFromTo(4, 1));

    for (const address of [
      "/folders/handbook/intro.md?view=history&before=",
      "/folders/handbook/intro.md?view=history&before=abc",
      "/folders/handbook/intro.md?view=history&before=0",
      "/folders/handbook/intro.md?view=history&before=1",
      "/folders/handbook/intro.md?view=history&before=05",
      "/folders/handbook/intro.md?view=history&before=+5",
      "/folders/handbook/intro.md?view=history&before=2.0",
      "/folders/handbook/intro.md?view=history&before=6",
      "/folders/handbook/intro.md?view=history&before=99999999999",
      "/folders/handbook/intro.md?view=history&before=3&before=4",
      "/folders/handbook/intro.md?before=3",
      "/folders/handbook/intro.md?view=history&action=edit",
      "/folders/handbook/intro.md?view=history&notice=changed",
      "/folders/handbook/intro.md?view=history&from=1",
      "/folders/handbook/intro.md?view=nothing",
      "/folders/handbook/intro.md?view=history&view=history",
      "/folders/handbook/guides/setup.md?view=history&before=abc",
      "/folders/handbook/guides/setup.md?view=nothing",
      "/folders/handbook/missing.md?view=history",
    ]) {
      await expectNotFound(page, address);
    }
  });
});
