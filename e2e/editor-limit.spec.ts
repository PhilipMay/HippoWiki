// The content limit in the editor. A spec of its own, because it fills pages near the limit.

import type { Page } from "@playwright/test";

import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";

import { editorReady, expectContent, pasteContent } from "./support/editor";
import { createFolder, createPage, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

/** Content of exactly `length` characters that starts with a title heading. */
function contentOfLength(length: number): string {
  const head = "# Long page\n\n";
  return head + "x".repeat(length - head.length);
}

/** Opens the editor of a stored page with the given content and moves the cursor to its end. */
async function editAtEnd(page: Page, content: string) {
  await createPage({ folder: handbook, name: "long", content });
  await page.goto("/folders/handbook/long.md?action=edit");
  const editor = await editorReady(page);
  await editor.press("ControlOrMeta+End");
  return editor;
}

test("at the limit a typed character is not added (R27)", async ({ page }) => {
  const content = contentOfLength(CONTENT_MAX_LENGTH);
  await editAtEnd(page, content);

  await page.keyboard.type("y");

  await expectContent(page, content);
});

test("a paste at 99,995 characters adds the first 5 of 10 characters (R27)", async ({ page }) => {
  const content = contentOfLength(CONTENT_MAX_LENGTH - 5);
  await editAtEnd(page, content);

  await pasteContent(page, { "text/plain": "0123456789" });

  await expectContent(page, `${content}01234`);
});

test("the counter shows from 90,000 characters on (R28)", async ({ page }) => {
  const content = contentOfLength(89_999);
  await editAtEnd(page, content);

  await expect(page.getByText("/ 100,000")).toHaveCount(0);
  await page.keyboard.type("y");

  await expect(page.getByText("90,000 / 100,000", { exact: true })).toBeVisible();
  await page.keyboard.press("Backspace");
  await expect(page.getByText("/ 100,000")).toHaveCount(0);
});
