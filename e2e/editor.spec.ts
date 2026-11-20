import type { Page, Response } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { contentEditor, editorReady, expectContent, fillContent, pasteContent } from "./support/editor";
import { createFolder, createPage, createTab, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

const HELPER_TEXT =
  "Markdown (GitHub Flavored Markdown), starting with the title heading: # Title. Press Esc, then Tab, to leave the editor.";
const TITLE_HEADING_MISSING = "Content must start with a title heading: # Title";

/** Content with Markdown that an editor could be tempted to change: trailing spaces, tabs, a setext heading, HTML. */
const UNUSUAL_MARKDOWN =
  "Setext title\n============\n\nTwo trailing spaces  \nline\t with\ttabs\n\n<div>raw <b>HTML</b></div>\n\\\n* item\n+ other\n\n\n";

/** Opens the editor of a stored page and moves the cursor to the end of the content. */
async function editAtEnd(page: Page, address: string) {
  await page.goto(address);
  const editor = await editorReady(page);
  await editor.press("ControlOrMeta+End");
  return editor;
}

test("a new page in a folder and in a tab and an edited page use the editor, not a textarea (R1)", async ({ page }) => {
  const errors = collectErrors(page);
  await createTab({ folder: handbook, name: "guides" });
  await createPage({ folder: handbook, name: "plan", content: "# Plan" });

  for (const address of [
    "/folders/handbook?action=new",
    "/folders/handbook/guides?action=new",
    "/folders/handbook/plan.md?action=edit",
  ]) {
    await page.goto(address);
    await expect(await editorReady(page), address).toHaveAttribute("contenteditable", "true");
    await expect(page.locator("textarea"), address).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("with JavaScript the editor replaces the read-only field with the same content and enables Save (R29)", async ({
  page,
}) => {
  await createPage({ folder: handbook, name: "plan", content: "# Plan\n\nFirst line\nSecond line" });

  await page.goto("/folders/handbook/plan.md?action=edit");

  const editor = await editorReady(page);
  await expect(editor).toHaveText("# PlanFirst lineSecond line");
  await expectContent(page, "# Plan\n\nFirst line\nSecond line");
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
});

test("every character of the content is visible in the editor (R4)", async ({ page }) => {
  await createPage({
    folder: handbook,
    name: "marks",
    content: "# Marks\n\n**bold** _it_ `code` [a](/b) ~~s~~\n- [x] t",
  });

  await page.goto("/folders/handbook/marks.md?action=edit");

  const editor = await editorReady(page);
  // CodeMirror draws each line as an element of its own.
  expect(await editor.evaluate((element) => Array.from(element.children, (line) => line.textContent).join("\n"))).toBe(
    "# Marks\n\n**bold** _it_ `code` [a](/b) ~~s~~\n- [x] t",
  );
});

test.describe("the stored content (R5)", () => {
  test("saving without a change stores nothing", async ({ page }) => {
    // The page was last changed by another user than the one of the test, so a stored save would show.
    const created = await createPage({ folder: handbook, name: "plan", content: `# Plan\n\n${UNUSUAL_MARKDOWN}` });

    await page.goto("/folders/handbook/plan.md?action=edit");
    await editorReady(page);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/handbook/plan.md");
    // The version, the last editor and the time of the last change stay.
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toStrictEqual(created);
  });

  test("unusual Markdown stays byte for byte after an edit at its end", async ({ page }) => {
    const created = await createPage({ folder: handbook, name: "plan", content: `# Plan\n\n${UNUSUAL_MARKDOWN}` });

    await editAtEnd(page, "/folders/handbook/plan.md?action=edit");
    await page.keyboard.type("end");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/handbook/plan.md");
    const stored = await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.content).toBe(`# Plan\n\n${UNUSUAL_MARKDOWN}end`);
  });
});

test("a new page shows the placeholder # Title in grey until something is typed (R40)", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/folders/handbook?action=new");

  const editor = await editorReady(page);
  const placeholder = editor.getByText("# Title", { exact: true });
  await expect(placeholder).toBeVisible();
  const color = (element: Element) => getComputedStyle(element).color;
  expect(await placeholder.evaluate(color)).not.toBe(await editor.evaluate(color));
  await expect(editor).toHaveAttribute("aria-placeholder", "# Title");

  // "Save" on the empty editor: the placeholder is never content.
  await page.getByRole("button", { name: "Save" }).click();
  await expect(editor).toHaveAccessibleDescription(TITLE_HEADING_MISSING);
  await expectContent(page, "");

  await editor.press("x");
  await expect(placeholder).toHaveCount(0);
  await expectContent(page, "x");
  expect(errors).toEqual([]);
});

test.describe("the height of the editor (R41)", () => {
  test("a page of a few lines shows an editor of about 16 lines", async ({ page }) => {
    await createPage({ folder: handbook, name: "short", content: "# Short\n\nOne line" });

    await page.goto("/folders/handbook/short.md?action=edit");

    const editor = await editorReady(page);
    const lineHeight = await editor.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight));
    const height = (await editor.boundingBox())?.height ?? 0;
    expect(height / lineHeight).toBeGreaterThan(15.9);
    expect(height / lineHeight).toBeLessThan(19);
  });

  test("a long page makes the page scroll, not the editor", async ({ page }) => {
    const lines = Array.from({ length: 200 }, (_, index) => `Line ${index + 1}`);
    await createPage({ folder: handbook, name: "long", content: `# Long\n\n${lines.join("\n")}` });

    await page.goto("/folders/handbook/long.md?action=edit");

    const editor = await editorReady(page);
    const viewport = page.viewportSize()?.height ?? 0;
    expect((await editor.boundingBox())?.height ?? 0).toBeGreaterThan(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);
    // The last line is reached by scrolling the page.
    await page.keyboard.press("ControlOrMeta+End");
    await expect(editor.getByText("Line 200", { exact: true })).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });
});

test("raw HTML shows as its characters, never as elements, and runs nothing (R31)", async ({ page }) => {
  const errors = collectErrors(page);
  const html = ["<b>x</b>", "<script>alert(1)</script>", "<img src=x onerror=alert(1)>"];
  await createPage({ folder: handbook, name: "html", content: `# HTML\n\n${html.join("\n\n")}` });
  const requested: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/x")) requested.push(request.url());
  });
  let dialogs = 0;
  page.on("dialog", (dialog) => {
    dialogs += 1;
    void dialog.dismiss();
  });

  await page.goto("/folders/handbook/html.md?action=edit");

  const editor = await editorReady(page);
  for (const text of html) await expect(editor.getByText(text, { exact: true })).toBeVisible();
  await expect(editor.locator("script, img, b")).toHaveCount(0);
  expect(requested).toEqual([]);
  expect(dialogs).toBe(0);
  expect(errors).toEqual([]);
});

test("pasting HTML adds only its words as plain text (R32)", async ({ page }) => {
  await createPage({ folder: handbook, name: "paste", content: "# Paste\n\n" });

  await editAtEnd(page, "/folders/handbook/paste.md?action=edit");
  await pasteContent(page, { "text/html": "<h1><b>Bold heading</b></h1>", "text/plain": "Bold heading" });

  await expectContent(page, "# Paste\n\nBold heading");
  await expect(contentEditor(page).locator("h1, b")).toHaveCount(0);
});

test("spell check is off in the editor (R33)", async ({ page }) => {
  await page.goto("/folders/handbook?action=new");

  await expect(await editorReady(page)).toHaveAttribute("spellcheck", "false");
});

test("the editor is named Content and described by the helper text (R36)", async ({ page }) => {
  await page.goto("/folders/handbook?action=new");

  const editor = await editorReady(page);
  await expect(editor).toHaveAccessibleName("Content");
  await expect(editor).toHaveAccessibleDescription(HELPER_TEXT);
  await expect(page.getByText(HELPER_TEXT)).toBeVisible();
  await expect(editor).toHaveAttribute("aria-invalid", "false");
});

test("a save without a title heading shows the error below the editor and keeps the content (R37)", async ({
  page,
}) => {
  await createPage({ folder: handbook, name: "plan", content: "# Plan" });

  await page.goto("/folders/handbook/plan.md?action=edit");
  await fillContent(page, "No title\n\nText");
  await page.getByRole("button", { name: "Save" }).click();

  const editor = contentEditor(page);
  await expect(page.getByRole("main").getByText(TITLE_HEADING_MISSING)).toBeVisible();
  await expect(page.getByText(HELPER_TEXT)).toHaveCount(0);
  await expect(editor).toHaveAccessibleDescription(TITLE_HEADING_MISSING);
  await expect(editor).toHaveAttribute("aria-invalid", "true");
  await expect(editor).toBeFocused();
  await expectContent(page, "No title\n\nText");
});

test("undo reverts the last change and redo repeats it (R15)", async ({ page }) => {
  await createPage({ folder: handbook, name: "plan", content: "# Plan" });

  await editAtEnd(page, "/folders/handbook/plan.md?action=edit");
  await page.keyboard.type(" one");
  await expectContent(page, "# Plan one");

  await page.keyboard.press("ControlOrMeta+z");
  await expectContent(page, "# Plan");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expectContent(page, "# Plan one");

  // Ctrl+Y is the redo of Windows and Linux; a Mac has only Cmd+Shift+Z.
  if (process.platform !== "darwin") {
    await page.keyboard.press("ControlOrMeta+z");
    await expectContent(page, "# Plan");
    await page.keyboard.press("Control+y");
    await expectContent(page, "# Plan one");
  }
});

test.describe("the code of the editor (R39)", () => {
  /** Opens the address and returns whether a loaded script of the app holds the code of CodeMirror. */
  async function loadsEditorCode(page: Page, address: string, waitFor?: () => Promise<unknown>) {
    const bodies: Promise<string>[] = [];
    const collect = (response: Response) => {
      if (response.url().includes("/_next/static/") && response.request().resourceType() === "script") {
        bodies.push(response.text().catch(() => ""));
      }
    };
    page.on("response", collect);
    await page.goto(address);
    await waitFor?.();
    // Scripts that start loading after hydration have answered by the time the network is idle.
    await page.waitForLoadState("networkidle");
    page.off("response", collect);
    return (await Promise.all(bodies)).some((body) => body.includes("cm-content"));
  }

  test("only the editor loads it, never the page view, a folder, a tab or the list of all pages", async ({ page }) => {
    await createTab({ folder: handbook, name: "guides" });
    await createPage({ folder: handbook, name: "plan", content: "# Plan\n\n- [ ] Task" });

    for (const address of [
      "/folders/handbook/plan.md",
      "/folders/handbook",
      "/folders/handbook/guides",
      "/folders/handbook?view=all",
    ]) {
      expect(await loadsEditorCode(page, address), address).toBe(false);
    }
    expect(await loadsEditorCode(page, "/folders/handbook/plan.md?action=edit", () => editorReady(page))).toBe(true);
  });
});

test("source mode colors headings, emphasis, links, code and list marks differently from plain text (R11)", async ({
  page,
}) => {
  await createPage({
    folder: handbook,
    name: "colors",
    content: "# Heading\n\nplain words\n\n*emph* [link](/x) `code`\n\n- item",
  });

  await page.goto("/folders/handbook/colors.md?action=edit");

  const editor = await editorReady(page);
  const color = (element: Element) => getComputedStyle(element).color;
  const plain = await editor.getByText("plain words", { exact: true }).evaluate(color);
  for (const text of ["Heading", "emph", "link", "code", "-"]) {
    expect(await editor.getByText(text, { exact: true }).evaluate(color), text).not.toBe(plain);
  }
});

test("Enter at the end of a list item continues the list (R12)", async ({ page }) => {
  await page.goto("/folders/handbook?action=new");
  await fillContent(page, "# List\n\n- one");

  await page.keyboard.press("Enter");
  await page.keyboard.type("two");

  await expectContent(page, "# List\n\n- one\n- two");
});

test("Ctrl+F opens the search, and replace all replaces every occurrence in one step that one undo reverts (R13)", async ({
  page,
}) => {
  const content = "# Word\n\nword and **word**, then word";
  await createPage({ folder: handbook, name: "search", content });

  await page.goto("/folders/handbook/search.md?action=edit");
  const editor = await editorReady(page);
  await editor.press("ControlOrMeta+f");

  const find = page.getByRole("textbox", { name: "Find" });
  await expect(find).toBeFocused();
  await find.fill("word");
  await page.getByRole("textbox", { name: "Replace" }).fill("term");
  await page.getByRole("button", { name: "replace all" }).click();

  // The search ignores case by default, so the heading is found as well.
  await expectContent(page, "# term\n\nterm and **term**, then term");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expectContent(page, content);
});

test.describe("Tab and Esc (R26)", () => {
  test("Tab nests a list item under the item above it, Shift+Tab reverts it", async ({ page }) => {
    await page.goto("/folders/handbook?action=new");
    await fillContent(page, "# List\n\n- a\n- b");

    await page.keyboard.press("Tab");
    await expectContent(page, "# List\n\n- a\n  - b");
    await expect(contentEditor(page)).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expectContent(page, "# List\n\n- a\n- b");
  });

  test("Esc then Tab focuses the control after the editor, Esc then Shift+Tab the one before it", async ({ page }) => {
    await createPage({ folder: handbook, name: "plan", content: "# Plan\n\n- a\n- b" });

    await page.goto("/folders/handbook/plan.md?action=edit");
    const editor = await editorReady(page);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Save" })).toBeFocused();

    await editor.focus();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+Tab");
    await expect(editor).not.toBeFocused();
    // The focused control lies before the editor in the page.
    expect(
      await editor.evaluate(
        (element) =>
          document.activeElement !== null &&
          document.activeElement !== document.body &&
          (document.activeElement.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      ),
    ).toBe(true);
    await expectContent(page, "# Plan\n\n- a\n- b");
  });
});
