// The update of wiki links when a page is moved or renamed, or a tab is renamed, in the browser.
import type { Page as BrowserPage } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { by, collectErrors } from "./support/browser";
import { createFile, createFolder, createPage, createTab, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

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

  // The second linking page gets its revision in the same way (integration/wiki-links-service.test.ts).
  await page.goto("/folders/handbook/guides/onboarding.md");
  await expect(page.getByRole("article").getByText(/^Last updated/)).toHaveText(by(USER));
  await page.goto("/folders/handbook/guides/onboarding.md?view=history");
  const newest = page.getByRole("list", { name: "Revisions" }).getByRole("listitem").first();
  await expect(newest).toContainText(`by ${USER} via web`);
  await expect(newest).toContainText("Links updated after a move or rename");
  await page.goto("/folders/handbook/guides/onboarding.md?view=revision&revision=2");
  await expect(page.getByRole("main")).toContainText("Links updated after a move or rename");
  expect(errors).toEqual([]);
});

// An editor opened on a linking page before the rename has its save refused as changed, as after any change
// ("a save refused as changed" of editor-leave.spec.ts); the rename counts the version of the page up
// (integration/wiki-links-service.test.ts).
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

// A revert to a revision that holds the old target stores it as it is (integration/wiki-links-service.test.ts).
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
  // The revisions of the updated pages are those of "renaming a page" above.
  expect(errors).toEqual([]);
});

test("renaming a tab updates the links and embeds of its files in every page, and its dialog counts them", async ({
  page,
}) => {
  await createFile({ tab: guides, name: "diagram.png" });
  await createPage({ folder: handbook, name: "setup", content: "# Setup\n\n![[guides/diagram.png]]" });
  await createPage({ tab: guides, name: "manual", content: "# Manual\n\n[[guides/diagram.png|The diagram]]" });

  await page.goto("/folders/handbook/guides?action=rename");
  const dialog = page.getByRole("dialog", { name: "Rename tab" });
  await expect(dialog).toContainText("Links in 2 pages will be updated.");
  await dialog.getByLabel("Name").fill("manuals");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/manuals");

  expect(await contentOf("setup")).toBe("# Setup\n\n![[manuals/diagram.png]]");
  expect(await contentOf("manual")).toBe("# Manual\n\n[[manuals/diagram.png|The diagram]]");
  await page.goto("/folders/handbook/setup.md");
  await expect(page.getByRole("article").getByRole("img", { name: "diagram.png" })).toHaveAttribute(
    "src",
    "/files/handbook/manuals/diagram.png",
  );
});
