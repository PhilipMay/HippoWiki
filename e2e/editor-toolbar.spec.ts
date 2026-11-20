import type { Page } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { contentEditor, editorReady, expectContent, fillContent } from "./support/editor";
import { createFolder, createPage, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

/** The buttons of the toolbar, in their order. */
const BUTTONS = [
  "Bold",
  "Italic",
  "Strikethrough",
  "Inline code",
  "Heading",
  "Link",
  "Bullet list",
  "Numbered list",
  "Task list",
];

function toolbar(page: Page) {
  return page.getByRole("toolbar", { name: "Formatting" });
}

function button(page: Page, name: string) {
  return toolbar(page).getByRole("button", { name, exact: true });
}

/** Opens the editor of a new page with the content, the cursor at its end. */
async function newPageWith(page: Page, content: string) {
  await page.goto("/folders/handbook?action=new");
  await fillContent(page, content);
}

/** Selects the last `count` characters before the cursor. */
async function selectBack(page: Page, count: number) {
  for (let index = 0; index < count; index += 1) await page.keyboard.press("Shift+ArrowLeft");
}

test("the toolbar is above the editor, and every button has a name and is reachable with the keyboard (R14, R19)", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/folders/handbook?action=new");
  const editor = await editorReady(page);

  const toolbarBox = await toolbar(page).boundingBox();
  const editorBox = await editor.boundingBox();
  expect(toolbarBox && editorBox && toolbarBox.y + toolbarBox.height <= editorBox.y).toBe(true);
  for (const name of BUTTONS) {
    await expect(button(page, name)).toBeVisible();
    await expect(button(page, name)).toBeEnabled();
  }

  // Esc, then Shift+Tab, leaves the editor backwards onto the last button; Shift+Tab goes on through all of them.
  await page.keyboard.press("Escape");
  for (const name of BUTTONS.toReversed()) {
    await page.keyboard.press("Shift+Tab");
    await expect(button(page, name)).toBeFocused();
  }

  await button(page, "Heading").click();
  await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText([
    "Normal text",
    "Heading 1",
    "Heading 2",
    "Heading 3",
  ]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("bold marks the selection, one undo restores it, and typing goes on in the editor (R20, R23)", async ({
  page,
}) => {
  await newPageWith(page, "# Page\n\nword");
  await selectBack(page, 4);

  await button(page, "Bold").click();
  await expectContent(page, "# Page\n\n**word**");
  await expect(contentEditor(page)).toBeFocused();

  await page.keyboard.press("ControlOrMeta+z");
  await expectContent(page, "# Page\n\nword");
  await page.keyboard.type("text");
  await expectContent(page, "# Page\n\ntext");
});

test("a line button sets its mark, one undo removes it, and the heading menu sets a heading (R21, R23)", async ({
  page,
}) => {
  await newPageWith(page, "# Page\n\nword");

  await button(page, "Bullet list").click();
  await expectContent(page, "# Page\n\n- word");
  await page.keyboard.type("s");
  await expectContent(page, "# Page\n\n- words");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expectContent(page, "# Page\n\nword");

  await button(page, "Heading").click();
  await page.getByRole("menuitem", { name: "Heading 2" }).click();
  await expectContent(page, "# Page\n\n## word");
  await expect(contentEditor(page)).toBeFocused();
  await page.keyboard.type("s");
  await expectContent(page, "# Page\n\n## words");
});

test("link on a selected word selects the address for typing (R22)", async ({ page }) => {
  await newPageWith(page, "# Page\n\nSee docs");
  await selectBack(page, 4);

  await button(page, "Link").click();
  await expectContent(page, "# Page\n\nSee [docs](address)");
  await page.keyboard.type("https://example.com");

  await expectContent(page, "# Page\n\nSee [docs](https://example.com)");
});

test("Ctrl+B, Ctrl+I and Ctrl+K do the same as their buttons (R24)", async ({ page }) => {
  await newPageWith(page, "# Page\n\nword");

  await selectBack(page, 4);
  await page.keyboard.press("ControlOrMeta+b");
  await expectContent(page, "# Page\n\n**word**");
  await page.keyboard.press("ControlOrMeta+i");
  await expectContent(page, "# Page\n\n***word***");
  await page.keyboard.press("ControlOrMeta+k");
  await expectContent(page, "# Page\n\n***[word](address)***");
});

test("in a long page the toolbar stays at the top of the window at the end of the content (R41)", async ({ page }) => {
  const lines = Array.from({ length: 200 }, (_, index) => `Line ${index + 1}`);
  await createPage({ folder: handbook, name: "long", content: `# Long\n\n${lines.join("\n")}` });

  await page.goto("/folders/handbook/long.md?action=edit");
  const editor = await editorReady(page);
  await editor.press("ControlOrMeta+End");
  await expect(editor.getByText("Line 200", { exact: true })).toBeInViewport();

  await expect(toolbar(page)).toBeInViewport();
  expect((await toolbar(page).boundingBox())?.y).toBeLessThanOrEqual(1);
});
