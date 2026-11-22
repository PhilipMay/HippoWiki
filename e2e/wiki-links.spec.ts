// Wiki links in the page view, the limit of wiki links of a page and their plain text in titles. The editor's live
// preview of wiki links has a spec of its own.

import type { Page as BrowserPage } from "@playwright/test";

import { CONTENT_MAX_WIKI_LINKS } from "@/features/pages/limits";
import { CONTENT_WIKI_LINKS_MESSAGE } from "@/features/pages/schema";

import { collectErrors } from "./support/browser";
import {
  createFolder,
  createPage,
  createRevisions,
  createTab,
  getTestDb,
  resetTestDatabase,
  setOwnRole,
} from "./support/database";
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

test.describe("the limit of wiki links", () => {
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

// A heading with a link without a label gives its target, as tested in src/features/pages/derive.test.ts.
test("a page whose heading holds a wiki link gets its label in the title", async ({ page }) => {
  await page.goto("/folders/handbook?action=new");
  await fillContent(page, "# About [[setup|the setup]]\n\nText");
  await page.getByRole("button", { name: "Save" }).click();
  const dialog = page.getByRole("dialog", { name: "Save page" });
  await expect(dialog.getByLabel("Name")).toHaveValue("about-the-setup");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/about-the-setup.md");
  await expect(page).toHaveTitle("About the setup – HippoWiki");
  expect((await getTestDb().page.findFirstOrThrow()).title).toBe("About the setup");
});

test.describe("wiki links in the page view", () => {
  let guides: Awaited<ReturnType<typeof createTab>>;

  test.beforeEach(async () => {
    guides = await createTab({ folder: handbook, name: "guides" });
    await createPage({ folder: handbook, name: "setup", content: "# Setup\n\nDirectly in the folder." });
    await createPage({ tab: guides, name: "setup", content: "# Setup guide\n\nIn the tab." });
  });

  /** The article of the page view. */
  function article(page: BrowserPage) {
    return page.getByRole("article");
  }

  test("[[setup]] and [[guides/setup]] lead to the page directly in the folder and to the page in the tab, from either place", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const content = "# Links\n\n[[setup]] and [[guides/setup]] and [[guides/setup|the setup]]";
    await createPage({ folder: handbook, name: "links", content });
    await createPage({ tab: guides, name: "links", content });

    for (const address of ["/folders/handbook/links.md", "/folders/handbook/guides/links.md"]) {
      await page.goto(address);
      await expect(article(page).getByRole("link", { name: "Setup", exact: true })).toHaveAttribute(
        "href",
        "/folders/handbook/setup.md",
      );
      await expect(article(page).getByRole("link", { name: "Setup guide" })).toHaveAttribute(
        "href",
        "/folders/handbook/guides/setup.md",
      );
      await expect(article(page).getByRole("link", { name: "the setup" })).toHaveAttribute(
        "href",
        "/folders/handbook/guides/setup.md",
      );
    }
    await article(page).getByRole("link", { name: "Setup guide" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides/setup.md");
    expect(errors).toEqual([]);
  });

  test("a link without a label shows the new title of its page without a change of the linking page", async ({
    page,
  }) => {
    const links = await createPage({ folder: handbook, name: "links", content: "# Links\n\n[[guides/setup]]" });
    await page.goto("/folders/handbook/guides/setup.md?action=edit");
    await fillContent(page, "# Installation guide\n\nIn the tab.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides/setup.md");

    await page.goto("/folders/handbook/links.md");
    await expect(article(page).getByRole("link", { name: "Installation guide" })).toBeVisible();
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: links.id } })).toEqual(links);
  });

  test("a link to a missing page is marked, with its hint for pointer and screen reader users", async ({ page }) => {
    await createPage({ folder: handbook, name: "links", content: "# Links\n\n[[no-such-page]] and [[setup]]" });
    await page.goto("/folders/handbook/links.md");

    const missing = article(page).getByRole("link", { name: "no-such-page" });
    await expect(missing).toHaveAccessibleDescription("Page does not exist");
    await expect(missing).toHaveAttribute("title", "Page does not exist");
    await expect(missing).toHaveCSS("text-decoration-style", "dashed");
    const existing = article(page).getByRole("link", { name: "Setup", exact: true });
    await expect(existing).toHaveAccessibleDescription("");
    await expect(existing).not.toHaveCSS("text-decoration-style", "dashed");
    expect(await missing.evaluate((element) => getComputedStyle(element).color)).not.toBe(
      await existing.evaluate((element) => getComputedStyle(element).color),
    );
  });

  test("a Writer follows a missing link to the editor with its name and place preset, and the link then leads to the new page", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await createPage({ folder: handbook, name: "links", content: "# Links\n\n[[guides/faq]]" });
    await page.goto("/folders/handbook/links.md");
    await article(page).getByRole("link", { name: "guides/faq" }).click();

    await expect(page).toHaveURL("/folders/handbook/guides?action=new&name=faq");
    await fillContent(page, "# Frequently asked questions");
    await page.getByRole("button", { name: "Save" }).click();
    const dialog = page.getByRole("dialog", { name: "Save page" });
    await expect(dialog.getByLabel("Name")).toHaveValue("faq");
    await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides/faq.md");

    await page.goto("/folders/handbook/links.md");
    await expect(article(page).getByRole("link", { name: "Frequently asked questions" })).toHaveAttribute(
      "href",
      "/folders/handbook/guides/faq.md",
    );
    expect(errors).toEqual([]);
  });

  test("a Reader sees a missing link as marked text without a link", async ({ page }) => {
    await createPage({ folder: handbook, name: "links", content: "# Links\n\n[[guides/faq]]" });
    await setOwnRole(handbook, "reader");
    await page.goto("/folders/handbook/links.md");

    const missing = article(page).getByText("guides/faq");
    await expect(missing).toHaveAccessibleDescription("Page does not exist");
    await expect(missing).toHaveCSS("text-decoration-style", "dashed");
    await expect(article(page).getByRole("paragraph").getByRole("link")).toHaveCount(0);
  });

  // As a Writer, who gets a link for a missing page; a Reader gets no link for any missing page.
  test("a target that breaks the name rule or names a missing tab is marked text with its hint for a writer", async ({
    page,
  }) => {
    await createPage({ folder: handbook, name: "setup-guide", content: "# Setup guide page" });
    await createPage({
      folder: handbook,
      name: "links",
      content:
        "# Links\n\n[[Setup Guide]] [[setup.md]] [[Guides/Setup]] [[guides/setup/more]] [[setup#install]] " +
        "[[nosuchtab/setup]] ![[setup]]",
    });
    await setOwnRole(handbook, "writer");
    await page.goto("/folders/handbook/links.md");

    for (const text of ["Setup Guide", "setup.md", "Guides/Setup", "guides/setup/more", "setup#install"]) {
      const marked = article(page).getByText(text, { exact: true });
      await expect(marked).toHaveAccessibleDescription("Not a valid page name");
      await expect(marked).toHaveCSS("text-decoration-style", "dashed");
    }
    await expect(article(page).getByText("nosuchtab/setup", { exact: true })).toHaveAccessibleDescription(
      "Tab does not exist",
    );
    // `![[setup]]` is the text ! and a link; nothing else is a link.
    await expect(article(page).getByRole("paragraph").getByRole("link")).toHaveText(["Setup"]);
    await expect(article(page).getByRole("paragraph").filter({ hasText: "Setup Guide" })).toContainText("!Setup");
  });

  // A label with Markdown, \| in a table cell, code, escapes and a link over a line break are read in
  // src/features/pages/wiki-links.test.ts, and a label is rendered as text in src/features/pages/markdown.test.ts.

  test("a link into a deleted page shows as missing to a Manager and a Reader, and leads to it again once it is restored under its name", async ({
    page,
  }) => {
    await createPage({ folder: handbook, name: "links", content: "# Links\n\n[[guides/setup]]" });
    await page.goto("/folders/handbook/guides/setup.md?action=delete");
    await page.getByRole("dialog", { name: "Delete page" }).getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides");

    await page.goto("/folders/handbook/links.md");
    await expect(article(page).getByRole("link", { name: "guides/setup" })).toHaveAccessibleDescription(
      "Page does not exist",
    );
    await setOwnRole(handbook, "reader");
    await page.reload();
    await expect(article(page).getByText("guides/setup", { exact: true })).toHaveAccessibleDescription(
      "Page does not exist",
    );

    await setOwnRole(handbook, "manager");
    const deleted = await getTestDb().page.findFirstOrThrow({ where: { deletedAt: { not: null } } });
    await page.goto(`/deleted-items/handbook/${deleted.id}?action=restore`);
    const restore = page.getByRole("dialog", { name: "Restore page" });
    await restore.getByRole("radio", { name: "Tab guides" }).check();
    await restore.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides/setup.md");

    await page.goto("/folders/handbook/links.md");
    await expect(article(page).getByRole("link", { name: "Setup guide" })).toHaveAttribute(
      "href",
      "/folders/handbook/guides/setup.md",
    );
  });

  test("a link into a page restored under another name stays missing and no page is changed", async ({ page }) => {
    const links = await createPage({ folder: handbook, name: "links", content: "# Links\n\n[[guides/setup]]" });
    const setup = await getTestDb().page.findFirstOrThrow({ where: { name: "setup", tabId: guides.id } });
    await getTestDb().page.update({ where: { id: setup.id }, data: { deletedAt: new Date(), tabId: null } });

    await page.goto(`/deleted-items/handbook/${setup.id}?action=restore`);
    const restore = page.getByRole("dialog", { name: "Restore page" });
    await restore.getByLabel("Name").fill("install");
    await restore.getByRole("radio", { name: "Tab guides" }).check();
    await restore.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides/install.md");

    await page.goto("/folders/handbook/links.md");
    await expect(article(page).getByRole("link", { name: "guides/setup" })).toHaveAccessibleDescription(
      "Page does not exist",
    );
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: links.id } })).toEqual(links);
  });

  test("an old revision and a deleted page show their links resolved against the folder as it is now", async ({
    page,
  }) => {
    const links = await createPage({ folder: handbook, name: "links", content: "# Links\n\n[[faq]] first" });
    await createRevisions({ page: links, count: 1, content: () => "# Links\n\n[[faq]] second" });
    await page.goto("/folders/handbook/links.md?view=revision&revision=1");
    await expect(article(page).getByRole("link", { name: "faq" })).toHaveAccessibleDescription("Page does not exist");

    await createPage({ folder: handbook, name: "faq", content: "# FAQ" });
    await page.reload();
    await expect(article(page).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/folders/handbook/faq.md");
    await page.goto("/folders/handbook/links.md");
    await expect(article(page).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/folders/handbook/faq.md");

    const deleted = await createPage({
      folder: handbook,
      name: "old",
      content: "# Old\n\n[[guides/setup]] and [[gone]]",
      deletedAt: new Date(),
    });
    await page.goto(`/deleted-items/handbook/${deleted.id}`);
    await expect(article(page).getByRole("link", { name: "Setup guide" })).toHaveAttribute(
      "href",
      "/folders/handbook/guides/setup.md",
    );
    await expect(article(page).getByRole("link", { name: "gone" })).toHaveAccessibleDescription("Page does not exist");
    await page.goto(`/deleted-items/handbook/${deleted.id}?view=revision&revision=1`);
    await expect(article(page).getByRole("link", { name: "Setup guide" })).toBeVisible();
  });

  test("the page view under the delete dialog shows the links", async ({ page }) => {
    await createPage({ folder: handbook, name: "links", content: "# Links\n\n[[setup]]" });
    await page.goto("/folders/handbook/links.md?action=delete");
    await expect(
      page
        .getByRole("article", { includeHidden: true })
        .getByRole("link", { name: "Setup", exact: true, includeHidden: true }),
    ).toHaveAttribute("href", "/folders/handbook/setup.md");
  });
});

test.describe("Linked from", () => {
  /** The section "Linked from" of the page view. */
  function linkedFrom(page: BrowserPage) {
    return page.getByRole("region", { name: "Linked from" });
  }

  test("lists the pages that link to a page by title, leading to them, and loses a deleted one", async ({ page }) => {
    const errors = collectErrors(page);
    const guides = await createTab({ folder: handbook, name: "guides" });
    await createPage({ tab: guides, name: "setup", content: "# Setup guide\n\n[[guides/setup]]" });
    await createPage({ tab: guides, name: "onboarding", content: "# Onboarding\n\n[[guides/setup|the setup]]" });
    await createPage({ folder: handbook, name: "first-week", content: "# First week\n\n[[guides/setup]]" });

    await page.goto("/folders/handbook/guides/setup.md");
    await expect(linkedFrom(page).getByRole("link")).toHaveText(["First week", "Onboarding"]);
    await expect(linkedFrom(page).getByRole("listitem")).toHaveText(["First week", "Onboarding in guides"]);
    await linkedFrom(page).getByRole("link", { name: "Onboarding" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides/onboarding.md");

    await page.goto("/folders/handbook/first-week.md?action=delete");
    await page.getByRole("dialog", { name: "Delete page" }).getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL("/folders/handbook");
    await page.goto("/folders/handbook/guides/setup.md");
    await expect(linkedFrom(page).getByRole("link")).toHaveText(["Onboarding"]);
    expect(errors).toEqual([]);
  });

  test("says that no page links here, also to a Reader", async ({ page }) => {
    await createPage({ folder: handbook, name: "alone", content: "# Alone\n\n[[alone]]" });
    await setOwnRole(handbook, "reader");

    await page.goto("/folders/handbook/alone.md");
    await expect(linkedFrom(page)).toContainText("No page links here.");
    await expect(linkedFrom(page).getByRole("link")).toHaveCount(0);
  });
});
