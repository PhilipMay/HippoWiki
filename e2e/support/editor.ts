import type { BrowserContext, Locator, Page } from "@playwright/test";

import { MODE_STORAGE_KEY } from "@/features/pages/editor/mode";

import { expect } from "./test";

/**
 * The Markdown editor of a page: its content element, by its role and its name "Content". Until the editor is ready
 * this is the read-only field in its place, which is never editable, so an action that waits for an editable element
 * waits for the editor. Behind an open dialog the editor is hidden from assistive technology and is found with
 * `includeHidden`.
 */
export function contentEditor(page: Page, { includeHidden = false } = {}): Locator {
  return page.getByRole("textbox", { name: "Content", exact: true, includeHidden });
}

/** Waits until the editor has replaced the read-only field and can be typed in. */
export async function editorReady(page: Page): Promise<Locator> {
  const editor = contentEditor(page);
  await expect(editor).toBeEditable();
  return editor;
}

/**
 * Replaces the whole content of the editor with `text`, line breaks included, as input that CodeMirror reads: the
 * content element is filled as a user would replace a selection of all of it.
 */
export async function fillContent(page: Page, text: string): Promise<void> {
  await contentEditor(page).fill(text);
}

/**
 * Asserts the exact content of the editor through its hidden field `content`, the one CSS selector of these helpers:
 * CodeMirror draws only the lines in view, so its DOM never holds the whole content of a long page.
 */
export async function expectContent(page: Page, text: string): Promise<void> {
  await expect(page.locator('input[type="hidden"][name="content"]')).toHaveValue(text);
}

/** Dispatches a `paste` event with the given data on the content element of the editor, as a paste from the clipboard. */
export async function pasteContent(page: Page, data: { "text/plain"?: string; "text/html"?: string }): Promise<void> {
  const editor = await editorReady(page);
  await editor.evaluate((element, entries) => {
    const transfer = new DataTransfer();
    for (const [type, value] of Object.entries(entries)) {
      if (value !== undefined) transfer.setData(type, value);
    }
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, data);
}

/**
 * Makes every page of the context start the editor in source mode, as if it had been chosen before in this browser;
 * without it the editor starts in live preview.
 */
export async function startInSourceMode(context: BrowserContext): Promise<void> {
  await context.addInitScript((key) => window.localStorage.setItem(key, "source"), MODE_STORAGE_KEY);
}

/**
 * The text that each line of the editor shows, in order: without the marks that live preview hides. CodeMirror draws
 * only the lines in view, so this is for content that fits on the screen.
 */
export async function shownLines(page: Page): Promise<string[]> {
  return contentEditor(page).evaluate((element) => Array.from(element.children, (line) => line.textContent));
}
