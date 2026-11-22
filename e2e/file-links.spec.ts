// Links and embeds of files in the page view: `![[…]]` shows an image and links a PDF, `[[…]]` links a file, a missing
// file is marked and leads a Writer to the upload dialog, the details page lists the pages that show or link the file,
// and the links and embeds count toward the limit of wiki links of a page.

import type { Page as BrowserPage } from "@playwright/test";

import { CONTENT_MAX_WIKI_LINKS } from "@/features/pages/limits";
import { CONTENT_WIKI_LINKS_MESSAGE } from "@/features/pages/schema";

import { collectErrors } from "./support/browser";
import {
  createFile,
  createFolder,
  createPage,
  createRevisions,
  createTab,
  getTestDb,
  resetTestDatabase,
  setOwnRole,
} from "./support/database";
import { contentEditor, fillContent } from "./support/editor";
import { pngBytes, uploadFile } from "./support/files";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;
let guides: Awaited<ReturnType<typeof createTab>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
  guides = await createTab({ folder: handbook, name: "guides" });
});

/** The rendered content of the page view. */
function article(page: BrowserPage) {
  return page.getByRole("article");
}

/** The width of the text of the page view, in CSS pixels. */
function textWidth(page: BrowserPage): Promise<number> {
  return article(page)
    .getByRole("paragraph")
    .first()
    .evaluate((element) => element.getBoundingClientRect().width);
}

test("![[…]] shows an image at its own size, a wide one at the width of the text, and a click opens the file in a new tab", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await createFile({ tab: guides, name: "diagram.png", versions: [{ bytes: await pngBytes(120, 80) }] });
  await createFile({ tab: guides, name: "wide.png", versions: [{ bytes: await pngBytes(3000, 300) }] });
  await createPage({
    folder: handbook,
    name: "setup",
    content: "# Setup\n\n![[guides/diagram.png|The network]]\n\n![[guides/wide.png]]",
  });

  await page.goto("/folders/handbook/setup.md");

  const image = article(page).getByRole("img", { name: "The network" });
  await expect(image).toHaveAttribute("src", "/files/handbook/guides/diagram.png");
  await expect(image).toHaveAttribute("loading", "lazy");
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(120);
  expect(await image.evaluate((img) => img.getBoundingClientRect().width)).toBe(120);
  const wide = article(page).getByRole("img", { name: "wide.png" });
  await expect.poll(() => wide.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(3000);
  const width = await textWidth(page);
  expect(width).toBeLessThan(3000);
  expect(Math.round(await wide.evaluate((img) => img.getBoundingClientRect().width))).toBe(Math.round(width));

  const link = article(page).getByRole("link", { name: "The network" });
  await expect(link).toHaveAttribute("href", "/files/handbook/guides/diagram.png");
  const opened = page.context().waitForEvent("page");
  await image.click();
  const tab = await opened;
  await tab.waitForLoadState();
  expect(new URL(tab.url()).pathname).toBe("/files/handbook/guides/diagram.png");
  await tab.close();
  expect(errors).toEqual([]);
});

test("[[…]] and ![[…]] of a PDF are links to the file with the name or the label, and [[guides/setup]] stays a page link", async ({
  page,
}) => {
  await createFile({ tab: guides, name: "report.pdf" });
  await createPage({ tab: guides, name: "setup", content: "# Setup guide" });
  await createPage({
    folder: handbook,
    name: "links",
    content: "# Links\n\n[[guides/report.pdf]] ![[guides/report.pdf|Manual]] [[guides/setup]]",
  });

  await page.goto("/folders/handbook/links.md");

  await expect(article(page).getByRole("link", { name: "report.pdf", exact: true })).toHaveAttribute(
    "href",
    "/files/handbook/guides/report.pdf",
  );
  await expect(article(page).getByRole("link", { name: "Manual" })).toHaveAttribute(
    "href",
    "/files/handbook/guides/report.pdf",
  );
  await expect(article(page).getByRole("link", { name: "Setup guide" })).toHaveAttribute(
    "href",
    "/folders/handbook/guides/setup.md",
  );
  await expect(article(page).getByRole("img")).toHaveCount(0);
});

test("a missing file, a deleted file and a file of another folder show as missing, and code is text", async ({
  page,
}) => {
  await createFile({ folder: handbook, name: "gone.png", deletedAt: new Date() });
  const other = await createFolder({ name: "other-folder" });
  await createFile({ folder: other, name: "x.png" });
  await setOwnRole(handbook, "reader");
  await createPage({
    folder: handbook,
    name: "links",
    content: "# Links\n\n![[nothing.png]] [[gone.png]] [[other-folder/x.png]] `![[guides/diagram.png]]`",
  });

  await page.goto("/folders/handbook/links.md");

  await expect(article(page).getByText("nothing.png")).toHaveAccessibleDescription("File does not exist");
  await expect(article(page).getByText("gone.png")).toHaveAccessibleDescription("File does not exist");
  await expect(article(page).getByText("other-folder/x.png")).toHaveAccessibleDescription("Tab does not exist");
  await expect(article(page).getByText("nothing.png")).toHaveCSS("text-decoration-style", "dashed");
  await expect(article(page).locator("code")).toHaveText("![[guides/diagram.png]]");
  await expect(article(page).getByRole("paragraph").getByRole("link")).toHaveCount(0);
  await expect(article(page).getByRole("img")).toHaveCount(0);
});

test("a Writer follows a missing file to the upload dialog of its tab with its name, and a Reader sees marked text", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await createPage({ folder: handbook, name: "links", content: "# Links\n\n[[guides/manual.pdf]]" });
  await setOwnRole(handbook, "writer");
  await page.goto("/folders/handbook/links.md");

  const missing = article(page).getByRole("link", { name: "guides/manual.pdf" });
  await expect(missing).toHaveAccessibleDescription("File does not exist");
  await missing.click();
  await expect(page).toHaveURL("/folders/handbook/guides?action=upload&name=manual.pdf");
  await expect(page.getByRole("dialog", { name: "Upload file" }).getByLabel("Name")).toHaveValue("manual.pdf");

  await setOwnRole(handbook, "reader");
  await page.goto("/folders/handbook/links.md");
  await expect(article(page).getByText("guides/manual.pdf")).toHaveAccessibleDescription("File does not exist");
  await expect(article(page).getByRole("paragraph").getByRole("link")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the details page lists the pages that show or link the file, and no longer a page whose link was removed", async ({
  page,
}) => {
  await createFile({ tab: guides, name: "diagram.png" });
  await createPage({ folder: handbook, name: "setup", content: "# Setup\n\n![[guides/diagram.png]]" });
  await createPage({ tab: guides, name: "network", content: "# Network\n\n[[guides/diagram.png]]" });
  await createPage({ folder: handbook, name: "unrelated", content: "# Unrelated\n\n[[guides/diagram]]" });

  await page.goto("/folders/handbook/guides/diagram.png");
  const section = page.getByRole("region", { name: "Shown or linked from" });
  await expect(section.getByRole("link")).toHaveText(["Network", "Setup"]);
  await expect(section.getByRole("link", { name: "Network" })).toHaveAttribute(
    "href",
    "/folders/handbook/guides/network.md",
  );

  await page.goto("/folders/handbook/setup.md?action=edit");
  await fillContent(page, "# Setup\n\nNo image any more.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/setup.md");

  await page.goto("/folders/handbook/guides/diagram.png");
  await expect(section.getByRole("link")).toHaveText(["Network"]);
});

test("a file that no page shows or links says so on its details page", async ({ page }) => {
  await createFile({ folder: handbook, name: "alone.pdf" });
  await page.goto("/folders/handbook/alone.pdf");
  await expect(page.getByRole("region", { name: "Shown or linked from" })).toContainText(
    "No page shows or links this file.",
  );
});

test("after a new version, an old revision of a page that embeds the image shows the new version", async ({ page }) => {
  const file = await createFile({ tab: guides, name: "diagram.png", versions: [{ bytes: await pngBytes(40, 30) }] });
  const setup = await createPage({ folder: handbook, name: "setup", content: "# Setup\n\n![[guides/diagram.png]]" });
  await createRevisions({ page: setup, count: 1, content: () => "# Setup\n\nThe image is gone." });
  await page.goto("/folders/handbook/guides/diagram.png");

  const response = await uploadFile(page, {
    folder: "handbook",
    tab: "guides",
    name: "diagram.png",
    bytes: await pngBytes(90, 60),
    replace: file.lockVersion,
  });
  expect(response.ok()).toBe(true);

  await page.goto("/folders/handbook/setup.md?view=revision&revision=1");
  const image = article(page).getByRole("img", { name: "diagram.png" });
  await expect(image).toHaveAttribute("src", "/files/handbook/guides/diagram.png");
  await expect(image).toHaveAttribute("width", "90");
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(90);
});

test("a save with 4,000 links to pages and 1,001 links to files is refused with the error of the limit", async ({
  page,
}) => {
  const created = await createPage({ folder: handbook, name: "links", title: "Links" });
  // 4,000 links to pages, 500 embeds and 501 links of files: one more than the limit.
  expect(4_000 + 500 + 501).toBe(CONTENT_MAX_WIKI_LINKS + 1);
  const value = `# Links\n\n${"[[setup]] ".repeat(4_000)}${"![[a.png]] ".repeat(500)}${"[[b.pdf]] ".repeat(501)}`;

  await page.goto("/folders/handbook/links.md?action=edit");
  await fillContent(page, value);
  await page.getByRole("button", { name: "Save" }).click();

  const content = contentEditor(page);
  await expect(content).toHaveAttribute("aria-invalid", "true");
  await expect(content).toHaveAccessibleDescription(CONTENT_WIKI_LINKS_MESSAGE);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toEqual(created);
});
