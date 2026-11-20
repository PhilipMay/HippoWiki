import { devices, type Locator, type Page } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { contentEditor, editorReady, expectContent, shownLines } from "./support/editor";
import { createFolder, createPage, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

// The editor at phone size with a touch screen (R30, R34): Pixel 7 in portrait, without its browser type, which the
// project sets.
const { viewport, userAgent, deviceScaleFactor } = devices["Pixel 7"];
test.use({ viewport, userAgent, deviceScaleFactor, hasTouch: true, isMobile: true });

/** The smallest touch target, in CSS pixels: the minimum target size of WCAG 2.2. */
const MIN_TARGET = 24;

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

function toolbar(page: Page) {
  return page.getByRole("toolbar", { name: "Formatting" });
}

/** Asserts that the element lies within the width of the window and is at least as large as a touch target. */
async function expectReachable(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(box, await locator.evaluate((element) => element.outerHTML.slice(0, 80))).not.toBeNull();
  if (!box) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(MIN_TARGET);
}

/**
 * Removes the badge of the development server of Next.js, which sits at the bottom left of the window over "Save" at
 * phone size. A production build has none, so there it removes nothing.
 */
async function removeDevelopmentIndicator(page: Page) {
  await page.evaluate(() => document.querySelector("nextjs-portal")?.remove());
}

const CONTENT = "# Phone\n\n- [ ] call back\n\nSome plain words\n\n[docs](https://example.com/docs)\n\nlast";

test("a page is edited by touch at phone size: typing, a toolbar button, the mode switch, a task box, Save (R30)", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const created = await createPage({ folder: handbook, name: "phone", content: CONTENT });
  await page.goto("/folders/handbook/phone.md?action=edit");
  const editor = await editorReady(page);
  await removeDevelopmentIndicator(page);

  // Everything of the editor fits the width of the window, without a horizontal scroll of the page, and every button is
  // a touch target of a usable size.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  const buttons = toolbar(page).getByRole("button");
  expect(await buttons.count()).toBeGreaterThanOrEqual(11);
  for (const button of await buttons.all()) await expectReachable(page, button);
  await expectReachable(page, page.getByRole("button", { name: "Save", exact: true }));
  await expectReachable(page, page.getByRole("link", { name: "Cancel", exact: true }));
  await expectReachable(page, editor.getByRole("checkbox", { name: "call back" }));

  // A tap at the end of the last line puts the cursor there; typing goes on there.
  await editor.getByText("last", { exact: true }).tap({ position: { x: 1, y: 1 } });
  await page.keyboard.press("End");
  await page.keyboard.type(" line");
  await expectContent(page, CONTENT.replace(/last$/, "last line"));

  // A selection of the word "plain", made by the keys of the cursor: Playwright cannot drive the handles of a native
  // selection by touch, which the manual check on a real phone covers. Then the bold button tapped.
  await editor.getByText("Some plain words", { exact: true }).tap({ position: { x: 1, y: 1 } });
  await page.keyboard.press("Home");
  for (let index = 0; index < "Some ".length; index += 1) await page.keyboard.press("ArrowRight");
  for (let index = 0; index < "plain".length; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await toolbar(page).getByRole("button", { name: "Bold", exact: true }).tap();
  await expectContent(page, CONTENT.replace("plain", "**plain**").replace(/last$/, "last line"));

  // The mode switch: source mode shows the Markdown of every line, live preview again the formatted lines.
  await toolbar(page).getByRole("button", { name: "Source", exact: true }).tap();
  await expect(toolbar(page).getByRole("button", { name: "Source", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(async () => (await shownLines(page))[0]).toBe("# Phone");
  await toolbar(page).getByRole("button", { name: "Live preview", exact: true }).tap();
  await expect.poll(async () => (await shownLines(page))[0]).toBe("Phone");

  // A tap on the task box ticks it in the text.
  await editor.getByRole("checkbox", { name: "call back" }).tap();
  const edited = CONTENT.replace("- [ ]", "- [x]").replace("plain", "**plain**").replace(/last$/, "last line");
  await expectContent(page, edited);

  await page.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(page).toHaveURL("/folders/handbook/phone.md");
  const article = page.getByRole("article");
  await expect(article.getByRole("checkbox")).toBeChecked();
  await expect(article.getByText("plain", { exact: true })).toHaveCSS("font-weight", "700");
  expect((await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).content).toBe(edited);
  expect(errors).toEqual([]);
});

test("a tap on a link shows its Markdown and opens no new tab (R34)", async ({ page, context }) => {
  const opened: string[] = [];
  context.on("page", (other) => opened.push(other.url()));
  await createPage({ folder: handbook, name: "phone", content: CONTENT });
  await page.goto("/folders/handbook/phone.md?action=edit");
  const editor = contentEditor(page);
  await expect(editor).toBeEditable();

  await editor.getByText("docs", { exact: true }).tap();
  await expect.poll(async () => (await shownLines(page))[6]).toBe("[docs](https://example.com/docs)");
  expect(opened).toEqual([]);
  expect(context.pages()).toHaveLength(1);
  await expectContent(page, CONTENT);
});
