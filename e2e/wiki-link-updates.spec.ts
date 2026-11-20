// The update of wiki links when a page is moved or renamed, or a tab is renamed, in the browser.
import type { Page as BrowserPage } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { by, collectErrors } from "./support/browser";
import { createFolder, createPage, createTab, getTestDb, resetTestDatabase } from "./support/database";
import { expectContent, fillContent } from "./support/editor";
import { expect, hydrating, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;
let guides: Awaited<ReturnType<typeof createTab>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
  guides = await createTab({ folder: handbook, name: "guides" });
});

/** The logged-in user of the tests, who makes every change through the GUI. */
const USER = KNOWN_USER.name;

/** The "Move or rename page" dialog. */
function moveDialog(page: BrowserPage) {
  return page.getByRole("dialog", { name: "Move or rename page" });
}

/** The content of the page as stored. */
async function contentOf(name: string): Promise<string> {
  return (await getTestDb().page.findFirstOrThrow({ where: { name, deletedAt: null } })).content;
}

/** Sets up the scenario of the requirements: the setup guide in guides, linked from two pages, one of them in guides. */
async function setUpScenario() {
  const setup = await createPage({ tab: guides, name: "setup", content: "# Setup guide\n\nInstall it." });
  const onboarding = await createPage({
    tab: guides,
    name: "onboarding",
    content: "# Onboarding\n\nStart with [[guides/setup|the setup]].",
  });
  const firstWeek = await createPage({
    folder: handbook,
    name: "first-week",
    content: "# First week\n\n[[guides/setup]]",
  });
  return { setup, onboarding, firstWeek };
}

test("renaming a page updates the links of the pages that link to it, with a marked revision by the user", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await setUpScenario();

  await page.goto("/folders/handbook/guides/setup.md?action=move-or-rename");
  const dialog = moveDialog(page);
  await expect(dialog).toContainText("Links in 2 pages will be updated.");
  await dialog.getByLabel("Name").fill("install");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/install.md");

  expect(await contentOf("onboarding")).toBe("# Onboarding\n\nStart with [[guides/install|the setup]].");
  expect(await contentOf("first-week")).toBe("# First week\n\n[[guides/install]]");
  await expect(page.getByRole("region", { name: "Linked from" }).getByRole("link")).toHaveText([
    "First week",
    "Onboarding",
  ]);

  for (const address of ["/folders/handbook/guides/onboarding.md", "/folders/handbook/first-week.md"]) {
    await page.goto(address);
    await expect(page.getByRole("article").getByText(/^Last updated/)).toHaveText(by(USER));
    await page.goto(`${address}?view=history`);
    const newest = page.getByRole("list", { name: "Revisions" }).getByRole("listitem").first();
    await expect(newest).toContainText(`by ${USER} via web`);
    await expect(newest).toContainText("Links updated after a move or rename");
  }
  await page.goto("/folders/handbook/first-week.md?view=revision&revision=2");
  await expect(page.getByRole("main")).toContainText("Links updated after a move or rename");
  expect(errors).toEqual([]);
});

test("an editor opened on a linking page before the rename has its save refused as changed", async ({
  page,
  context,
}) => {
  await setUpScenario();
  await page.goto("/folders/handbook/first-week.md?action=edit");
  await fillContent(page, "# First week\n\n[[guides/setup]] and more");

  const other = hydrating(await context.newPage());
  await other.goto("/folders/handbook/guides/setup.md?action=move-or-rename");
  await moveDialog(other).getByLabel("Name").fill("install");
  await moveDialog(other).getByRole("button", { name: "Save" }).click();
  await expect(other).toHaveURL("/folders/handbook/guides/install.md");
  await other.close();

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/first-week.md?action=edit&notice=changed");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    new RegExp(`^This page was changed by ${USER} via web at .+ after you opened it\\.$`),
  );
  expect(await contentOf("first-week")).toBe("# First week\n\n[[guides/install]]");
  await expectContent(page, "# First week\n\n[[guides/install]]");
});

test("moving a page into another tab updates the links to it, and a page without links says so", async ({ page }) => {
  await setUpScenario();
  await createTab({ folder: handbook, name: "docs" });
  await createPage({ folder: handbook, name: "alone", content: "# Alone" });

  await page.goto("/folders/handbook/alone.md?action=move-or-rename");
  await expect(moveDialog(page)).toContainText("No page links to this page.");

  await page.goto("/folders/handbook/guides/setup.md?action=move-or-rename");
  await moveDialog(page).getByRole("radio", { name: "Tab docs" }).check();
  await moveDialog(page).getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/docs/setup.md");

  expect(await contentOf("onboarding")).toBe("# Onboarding\n\nStart with [[docs/setup|the setup]].");
  expect(await contentOf("first-week")).toBe("# First week\n\n[[docs/setup]]");
});

test("a page that links to itself is counted and updated too", async ({ page }) => {
  await createPage({ tab: guides, name: "setup", content: "# Setup guide\n\nBack to [[guides/setup|the top]]." });

  await page.goto("/folders/handbook/guides/setup.md?action=move-or-rename");
  await expect(moveDialog(page)).toContainText("Links in 1 page will be updated.");
  await moveDialog(page).getByLabel("Name").fill("install");
  await moveDialog(page).getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/install.md");

  expect(await contentOf("install")).toBe("# Setup guide\n\nBack to [[guides/install|the top]].");
  await expect(page.getByRole("article").getByRole("link", { name: "the top" })).toHaveAttribute(
    "href",
    "/folders/handbook/guides/install.md",
  );
});

test("a revert to a revision that holds the old target stores it as it is, and it shows as missing", async ({
  page,
}) => {
  await setUpScenario();
  await page.goto("/folders/handbook/guides/setup.md?action=move-or-rename");
  await moveDialog(page).getByLabel("Name").fill("install");
  await moveDialog(page).getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/install.md");

  await page.goto("/folders/handbook/first-week.md?action=revert&revision=1");
  await page.getByRole("dialog", { name: "Revert page" }).getByRole("button", { name: "Revert" }).click();
  await expect(page).toHaveURL("/folders/handbook/first-week.md");

  expect(await contentOf("first-week")).toBe("# First week\n\n[[guides/setup]]");
  await expect(page.getByRole("article").getByRole("link", { name: "guides/setup" })).toHaveAccessibleDescription(
    "Page does not exist",
  );
});

test("renaming a tab updates the links into it in every page, and its dialog says how many", async ({ page }) => {
  const errors = collectErrors(page);
  await setUpScenario();
  await createTab({ folder: handbook, name: "empty" });

  await page.goto("/folders/handbook/empty?action=rename");
  await expect(page.getByRole("dialog", { name: "Rename tab" })).toContainText("No page links into this tab.");

  await page.goto("/folders/handbook/guides?action=rename");
  const dialog = page.getByRole("dialog", { name: "Rename tab" });
  await expect(dialog).toContainText("Links in 2 pages will be updated.");
  await dialog.getByLabel("Name").fill("docs");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/docs");

  expect(await contentOf("onboarding")).toBe("# Onboarding\n\nStart with [[docs/setup|the setup]].");
  expect(await contentOf("first-week")).toBe("# First week\n\n[[docs/setup]]");
  await page.goto("/folders/handbook/first-week.md?view=history");
  await expect(page.getByRole("list", { name: "Revisions" }).getByRole("listitem").first()).toContainText(
    "Links updated after a move or rename",
  );
  await page.goto("/folders/handbook/first-week.md");
  await expect(page.getByRole("article").getByRole("link", { name: "Setup guide" })).toHaveAttribute(
    "href",
    "/folders/handbook/docs/setup.md",
  );
  expect(errors).toEqual([]);
});
