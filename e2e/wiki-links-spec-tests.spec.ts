// Tests written from the requirements of wiki links alone (`spec/wiki-links-requirements.md`), for the rules or the
// parts of rules that the other specs of wiki links leave open: the links gained while a rename dialog is open, and
// the roles below Owner.

import type { Page as BrowserPage } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { createFolder, createPage, createTab, getTestDb, resetTestDatabase, setOwnRole } from "./support/database";
import { fillContent } from "./support/editor";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;
let guides: Awaited<ReturnType<typeof createTab>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
  guides = await createTab({ folder: handbook, name: "guides" });
});

/** The content of the page as stored. */
async function contentOf(name: string): Promise<string> {
  return (await getTestDb().page.findFirstOrThrow({ where: { name, deletedAt: null } })).content;
}

/** The setup guide in guides, linked from two pages. */
async function setUpLinks() {
  await createPage({ tab: guides, name: "setup", content: "# Setup guide" });
  await createPage({ tab: guides, name: "onboarding", content: "# Onboarding\n\n[[guides/setup|the setup]]" });
  await createPage({ folder: handbook, name: "first-week", content: "# First week\n\n[[guides/setup]]" });
}

// wiki-links-requirements.md, "Rename and move", R9 ("a page that gained a link while the dialog was open is updated
// as well").
test("a page that gains a link while the Move or rename dialog is open is updated as well (R9)", async ({ page }) => {
  const errors = collectErrors(page);
  await setUpLinks();
  await page.goto("/folders/handbook/guides/setup.md?action=move-or-rename");
  const dialog = page.getByRole("dialog", { name: "Move or rename page" });
  await expect(dialog).toContainText("Links in 2 pages will be updated.");

  await createPage({ folder: handbook, name: "later", content: "# Later\n\n[[guides/setup|added later]]" });
  await dialog.getByLabel("Name").fill("install");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/install.md");

  expect(await contentOf("later")).toBe("# Later\n\n[[guides/install|added later]]");
  expect(await contentOf("first-week")).toBe("# First week\n\n[[guides/install]]");
  await expect(page.getByRole("region", { name: "Linked from" }).getByRole("link")).toHaveText([
    "First week",
    "Later",
    "Onboarding",
  ]);
  expect(errors).toEqual([]);
});

// wiki-links-requirements.md, "Rename and move", R30 with R9.
test("a page that gains a link into the tab while the Rename tab dialog is open is updated as well (R30)", async ({
  page,
}) => {
  await setUpLinks();
  await page.goto("/folders/handbook/guides?action=rename");
  const dialog = page.getByRole("dialog", { name: "Rename tab" });
  await expect(dialog).toContainText("Links in 2 pages will be updated.");

  await createPage({ folder: handbook, name: "later", content: "# Later\n\n[[guides/setup]]" });
  await dialog.getByLabel("Name").fill("docs");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/docs");

  expect(await contentOf("later")).toBe("# Later\n\n[[docs/setup]]");
});

for (const role of ["writer", "manager"] as const) {
  // wiki-links-requirements.md, "Missing links", R15 ("For a Writer, Manager or Owner").
  test(`a ${role} follows a missing link to the editor of a new page with its name and place preset (R15)`, async ({
    page,
  }) => {
    await createPage({ folder: handbook, name: "links", content: "# Links\n\n[[guides/faq]]" });
    await setOwnRole(handbook, role);
    await page.goto("/folders/handbook/links.md");
    await page.getByRole("article").getByRole("link", { name: "guides/faq" }).click();

    await expect(page).toHaveURL("/folders/handbook/guides?action=new&name=faq");
    await fillContent(page, "# Frequently asked questions");
    await page.getByRole("button", { name: "Save" }).click();
    const dialog = page.getByRole("dialog", { name: "Save page" });
    await expect(dialog.getByLabel("Name")).toHaveValue("faq");
    await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides/faq.md");
  });
}

/** The section "Linked from" of the page view. */
function linkedFrom(page: BrowserPage) {
  return page.getByRole("region", { name: "Linked from" });
}

// wiki-links-requirements.md, "Backlinks", R12 ("for every role"), and "Users and roles" (Readers see the backlinks).
test("a Reader sees under Linked from the pages that link to a page, and follows them (R12)", async ({ page }) => {
  await setUpLinks();
  await setOwnRole(handbook, "reader");

  await page.goto("/folders/handbook/guides/setup.md");
  await expect(linkedFrom(page).getByRole("listitem")).toHaveText(["First week", "Onboarding in guides"]);
  await linkedFrom(page).getByRole("link", { name: "First week" }).click();
  await expect(page).toHaveURL("/folders/handbook/first-week.md");
});
