import type { Page } from "@playwright/test";

import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";

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

test.describe("the view of a revision", () => {
  /** A page "intro" in "handbook" with three revisions, the second one through MCP by mike; returns the page. */
  async function pageWithRevisions() {
    const mike = await createUser({ name: "mike" });
    const folder = await createFolder({ name: "handbook", roles: [{ user: ALICE, role: "reader" }] });
    const intro = await createPage({ folder, name: "intro", content: "# Intro\n\nThe **first** text" });
    await createRevisions({
      page: intro,
      count: 1,
      content: () => "# Intro\n\nThe second text",
      editor: mike,
      via: "mcp",
    });
    await createRevisions({ page: intro, count: 1, content: () => "# Intro\n\nThe third text" });
    return intro;
  }

  test("an old revision shows its rendered content, the revision line and a notice with a link to the current page; Raw shows its source", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await pageWithRevisions();

    await page.goto("/folders/handbook/intro.md?view=history");
    await revisionLinks(page)
      .filter({ hasText: /^Revision 2(?!\d)/ })
      .click();

    await expect(page).toHaveURL("/folders/handbook/intro.md?view=revision&revision=2");
    await expect(page).toHaveTitle("Revision 2 of Intro – HippoWiki");
    await expect(page.getByText(/^Revision 2 of 3 · .+ by mike via mcp$/)).toBeVisible();
    await expect(page.getByRole("article").getByText("The second text")).toBeVisible();
    await expect(page.getByText("This is an old revision of the page.")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link")).toHaveText([
      "Folders",
      "handbook",
      "intro.md",
      "History",
    ]);

    await page.getByRole("link", { name: "Raw" }).click();
    await expect(page).toHaveURL("/folders/handbook/intro.md?view=revision&revision=2&format=raw");
    await expect(page.getByLabel("Markdown source")).toHaveText("# Intro\n\nThe second text");
    await expect(page.getByRole("link", { name: "Raw" })).toHaveAttribute("aria-current", "page");
    await page.reload();
    await expect(page.getByLabel("Markdown source")).toHaveText("# Intro\n\nThe second text");

    await page.getByRole("link", { name: "Rendered" }).click();
    await expect(page).toHaveURL("/folders/handbook/intro.md?view=revision&revision=2");
    await expect(page.getByLabel("Markdown source")).toHaveCount(0);
    await expect(page.getByRole("article").getByText("The second text")).toBeVisible();

    await page.getByRole("link", { name: "Show the current page" }).click();
    await expect(page).toHaveURL("/folders/handbook/intro.md");
    await expect(page.getByRole("article").getByText("The third text")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the first revision renders its Markdown, and the newest revision shows no notice", async ({ page }) => {
    await pageWithRevisions();

    await page.goto("/folders/handbook/intro.md?view=revision&revision=1");
    await expect(page.getByRole("article").getByText("first", { exact: true })).toHaveCSS("font-weight", "700");

    await page.goto("/folders/handbook/intro.md?view=revision&revision=3");
    await expect(page.getByText(/^Revision 3 of 3 · .+ by .+ via web$/)).toBeVisible();
    await expect(page.getByText("This is an old revision of the page.")).toHaveCount(0);
  });

  test("a missing, invalid or unknown revision number and an unknown format show the not-found page", async ({
    page,
  }) => {
    await pageWithRevisions();

    for (const address of [
      "/folders/handbook/intro.md?view=revision",
      "/folders/handbook/intro.md?view=revision&revision=",
      "/folders/handbook/intro.md?view=revision&revision=0",
      "/folders/handbook/intro.md?view=revision&revision=02",
      "/folders/handbook/intro.md?view=revision&revision=x",
      "/folders/handbook/intro.md?view=revision&revision=4",
      "/folders/handbook/intro.md?view=revision&revision=1&revision=2",
      "/folders/handbook/intro.md?view=revision&revision=1&format=html",
      "/folders/handbook/intro.md?view=revision&revision=1&format=",
      "/folders/handbook/intro.md?view=revision&revision=1&before=2",
      "/folders/handbook/intro.md?view=history&revision=1",
      "/folders/handbook/intro.md?revision=1",
      "/folders/handbook/intro.md?action=edit&format=raw",
    ]) {
      await expectNotFound(page, address);
    }
  });
});

test.describe("comparing revisions", () => {
  /** The content of the five revisions of "intro". */
  const CONTENTS = [
    "# Intro\n\nOne\nTwo",
    "# Intro\n\nOne\nTwo\nThree",
    "# Intro\n\nOne\nTwo\nThree\n",
    "# Intro\n\nOne\nZwei\nThree",
    "# Intro\n\nOne\nZwei\nThree\nFour",
  ];

  /** A page "intro" in "handbook" with the five revisions of `CONTENTS`; the logged-in user is a Reader. */
  async function pageWithRevisions() {
    const folder = await createFolder({ name: "handbook", roles: [{ user: ALICE, role: "reader" }] });
    const intro = await createPage({ folder, name: "intro", content: CONTENTS[0] });
    await createRevisions({ page: intro, count: 4, content: (number) => CONTENTS[number - 1] ?? "" });
  }

  /** The lines of the comparison with the given mark, as their text shows them. */
  function changes(page: Page, kind: "added" | "removed") {
    return page.getByRole("list", { name: "Changes" }).locator(`li[data-change="${kind}"]`);
  }

  test("comparing revision 5 with the preselected revision 4 shows the lines added since; choosing 1 compares 1 with 5", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await pageWithRevisions();

    await page.goto("/folders/handbook/intro.md?view=revision&revision=5");
    await expect(page.getByLabel("Compare with revision")).toHaveValue("4");
    await page.getByRole("button", { name: "Compare" }).click();

    await expect(page).toHaveURL("/folders/handbook/intro.md?view=compare&from=4&to=5");
    await expect(page).toHaveTitle("Revisions 4 and 5 of Intro – HippoWiki");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Changes from revision 4 to revision 5");
    await expect(changes(page, "added")).toHaveText(["+Four"]);
    await expect(changes(page, "removed")).toHaveCount(0);
    await expect(page.getByText(/^Revision 4 of 5 · /)).toBeVisible();
    await expect(page.getByText(/^Revision 5 of 5 · /)).toBeVisible();

    await page.goto("/folders/handbook/intro.md?view=revision&revision=5");
    await page.getByLabel("Compare with revision").fill("1");
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(page).toHaveURL("/folders/handbook/intro.md?view=compare&from=1&to=5");
    await expect(changes(page, "removed")).toHaveText(["−Two"]);
    await expect(changes(page, "added")).toHaveText(["+Zwei", "+Three", "+Four"]);

    await page.getByRole("heading", { level: 1 }).getByRole("link", { name: "revision 1" }).click();
    await expect(page).toHaveURL("/folders/handbook/intro.md?view=revision&revision=1");
    await expect(page.getByRole("button", { name: "Compare" })).toHaveCount(0);
    await expect(page.getByLabel("Compare with revision")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a comparison goes from the older to the newer revision in either order, and equal content shows No differences", async ({
    page,
  }) => {
    await pageWithRevisions();

    await page.goto("/folders/handbook/intro.md?view=compare&from=5&to=2");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Changes from revision 2 to revision 5");
    const reversed = [await changes(page, "removed").allTextContents(), await changes(page, "added").allTextContents()];
    await page.goto("/folders/handbook/intro.md?view=compare&from=2&to=5");
    await expect(changes(page, "removed")).toHaveText(reversed[0] ?? []);
    await expect(changes(page, "added")).toHaveText(reversed[1] ?? []);
    expect(reversed).toEqual([["−Two"], ["+Zwei", "+Four"]]);

    await page.goto("/folders/handbook/intro.md?view=compare&from=3&to=3");
    await expect(page.getByText("No differences")).toBeVisible();
    await expect(page.getByRole("list", { name: "Changes" })).toHaveCount(0);
  });

  test("two completely different revisions at the length limit answer within a few seconds", async ({ page }) => {
    const folder = await createFolder({ name: "handbook" });
    const lines = (letter: string) => `# Big\n${`${letter}\n`.repeat((CONTENT_MAX_LENGTH - 6) / 2)}`;
    const big = await createPage({ folder, name: "big", content: lines("a") });
    await createRevisions({ page: big, count: 1, content: () => lines("b") });

    const start = Date.now();
    await page.goto("/folders/handbook/big.md?view=compare&from=1&to=2");
    await expect(page.getByText("These revisions are too different to compare.")).toBeVisible();
    expect(Date.now() - start).toBeLessThan(5_000);
  });

  test("a missing or invalid from or to, or a number the page does not have, shows the not-found page", async ({
    page,
  }) => {
    await pageWithRevisions();

    for (const address of [
      "/folders/handbook/intro.md?view=compare",
      "/folders/handbook/intro.md?view=compare&from=1",
      "/folders/handbook/intro.md?view=compare&to=2",
      "/folders/handbook/intro.md?view=compare&from=&to=2",
      "/folders/handbook/intro.md?view=compare&from=0&to=2",
      "/folders/handbook/intro.md?view=compare&from=x&to=2",
      "/folders/handbook/intro.md?view=compare&from=1&to=6",
      "/folders/handbook/intro.md?view=compare&from=1&from=2&to=3",
      "/folders/handbook/intro.md?view=compare&from=1&to=2&revision=1",
      "/folders/handbook/intro.md?view=revision&revision=2&from=1",
    ]) {
      await expectNotFound(page, address);
    }
  });
});
