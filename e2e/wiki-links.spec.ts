// Wiki links in the page view, the limit of wiki links of a page and their plain text in titles. The editor's live
// preview of wiki links has a spec of its own.

import { CONTENT_MAX_WIKI_LINKS } from "@/features/pages/limits";
import { CONTENT_WIKI_LINKS_MESSAGE } from "@/features/pages/schema";

import { collectErrors } from "./support/browser";
import { createFolder, createPage, getTestDb, resetTestDatabase } from "./support/database";
import { contentEditor, expectContent, fillContent } from "./support/editor";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

/** Content with a title and the given number of wiki links. */
function withWikiLinks(count: number): string {
  return `# Links\n\n${"[[setup]] ".repeat(count)}`;
}

test.describe("the limit of wiki links (R26)", () => {
  test("a save with 5,001 wiki links is refused at the content field and stores nothing", async ({ page }) => {
    const errors = collectErrors(page);
    const created = await createPage({ folder: handbook, name: "links", title: "Links" });
    const value = withWikiLinks(CONTENT_MAX_WIKI_LINKS + 1);

    await page.goto("/folders/handbook/links.md?action=edit");
    await fillContent(page, value);
    await page.getByRole("button", { name: "Save" }).click();

    const content = contentEditor(page);
    await expect(content).toHaveAttribute("aria-invalid", "true");
    await expect(content).toHaveAccessibleDescription(CONTENT_WIKI_LINKS_MESSAGE);
    await expect(page).toHaveURL("/folders/handbook/links.md?action=edit");
    await expectContent(page, value);
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toEqual(created);
    expect(errors).toEqual([]);
  });

  test("a save with 5,000 wiki links is stored", async ({ page }) => {
    const created = await createPage({ folder: handbook, name: "links", title: "Links" });
    const value = withWikiLinks(CONTENT_MAX_WIKI_LINKS);

    await page.goto("/folders/handbook/links.md?action=edit");
    await fillContent(page, value);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/handbook/links.md");
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).content).toBe(value);
  });
});

test("a page whose heading holds a wiki link gets its label, or its target, in the title (R23)", async ({ page }) => {
  await page.goto("/folders/handbook?action=new");
  await fillContent(page, "# About [[setup|the setup]]\n\nText");
  await page.getByRole("button", { name: "Save" }).click();
  const dialog = page.getByRole("dialog", { name: "Save page" });
  await expect(dialog.getByLabel("Name")).toHaveValue("about-the-setup");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/about-the-setup.md");
  await expect(page).toHaveTitle("About the setup – HippoWiki");

  await page.goto("/folders/handbook?action=new");
  await fillContent(page, "# About [[guides/setup]]");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByLabel("Name")).toHaveValue("about-guides-setup");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/about-guides-setup.md");
  await expect(page).toHaveTitle("About guides/setup – HippoWiki");
  expect(
    (await getTestDb().page.findMany({ select: { title: true }, orderBy: { title: "asc" } })).map((p) => p.title),
  ).toEqual(["About guides/setup", "About the setup"]);
});
