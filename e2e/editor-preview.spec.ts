import type { Page } from "@playwright/test";

import { USER_STORAGE_STATE } from "./support/auth";
import { collectErrors } from "./support/browser";
import {
  contentEditor,
  editorReady,
  expectContent,
  fillContent,
  shownLines,
  startInSourceMode,
} from "./support/editor";
import { createFolder, createPage, getTestDb, resetTestDatabase } from "./support/database";
import { expect, hydrating, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

/** The switch between the modes in the toolbar. */
function modeButton(page: Page, name: "Live preview" | "Source") {
  return page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });
}

/** Opens the editor of a page with the content and puts the cursor at the end of the content. */
async function editAtEnd(page: Page, content: string) {
  await createPage({ folder: handbook, name: "preview", content });
  await page.goto("/folders/handbook/preview.md?action=edit");
  const editor = await editorReady(page);
  await editor.press("ControlOrMeta+End");
  return editor;
}

const INLINE = "**bold** *italic* ~~struck~~ `code` [link](https://example.com) <https://auto.example> www.example.com";

test("inline elements and headings show formatted without their marks, except on the line of the cursor", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const editor = await editAtEnd(page, `# Title\n\n## Section\n\n${INLINE}\n\nlast`);

  await expect
    .poll(() => shownLines(page))
    .toEqual([
      "Title",
      "",
      "Section",
      "",
      "bold italic struck code link https://auto.example www.example.com",
      "",
      "last",
    ]);
  const style = (text: string, property: "fontWeight" | "fontStyle" | "textDecorationLine" | "fontSize") =>
    editor.getByText(text, { exact: true }).evaluate((element, name) => getComputedStyle(element)[name], property);
  expect(await style("bold", "fontWeight")).toBe("700");
  expect(await style("italic", "fontStyle")).toBe("italic");
  expect(await style("struck", "textDecorationLine")).toBe("line-through");
  expect(parseFloat(await style("Title", "fontSize"))).toBeGreaterThan(parseFloat(await style("last", "fontSize")));

  // Onto the line of the inline elements: every mark of that line shows, the other lines stay formatted.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => shownLines(page)).toEqual(["Title", "", "Section", "", INLINE, "", "last"]);

  // Onto the heading.
  await page.keyboard.press("ControlOrMeta+Home");
  await expect.poll(async () => (await shownLines(page)).slice(0, 3)).toEqual(["# Title", "", "Section"]);
  expect(errors).toEqual([]);
});

test("a click on a link shows its Markdown; Ctrl+click opens only a safe address in a new tab", async ({
  page,
  context,
}) => {
  await context.route("https://example.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>Example</title>" }),
  );
  const popups: string[] = [];
  context.on("page", (opened) => popups.push(opened.url()));
  const content = "# Links\n\n[safe](https://example.com/target)\n\n[unsafe](javascript:alert(1))\n\nlast";
  const editor = await editAtEnd(page, content);

  // The unsafe link is no link: Ctrl+click on it opens nothing.
  await editor.getByText("[unsafe](javascript:alert(1))").click({ modifiers: ["ControlOrMeta"] });
  const opened = context.waitForEvent("page");
  await editor.getByText("safe", { exact: true }).click({ modifiers: ["ControlOrMeta"] });
  const tab = await opened;
  await tab.waitForLoadState();
  expect(tab.url()).toBe("https://example.com/target");
  expect(popups).toEqual(["https://example.com/target"]);
  // The editor keeps its content, and the cursor stayed on the last line, so the link still shows formatted.
  await expectContent(page, content);
  expect((await shownLines(page))[2]).toBe("safe");
  await tab.close();

  await editor.getByText("safe", { exact: true }).click();
  await expect.poll(async () => (await shownLines(page))[2]).toBe("[safe](https://example.com/target)");
  expect(popups).toHaveLength(1);
});

test("an image shows as its Markdown and is not requested", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/x.png") requested.push(request.url());
  });

  await editAtEnd(page, "# Image\n\n![alt](/x.png)\n\nlast");

  await expect.poll(() => shownLines(page)).toEqual(["Image", "", "![alt](/x.png)", "", "last"]);
  // CodeMirror draws images without an address as helpers of the cursor; no image has an address.
  await expect(contentEditor(page).locator("img[src]")).toHaveCount(0);
  expect(requested).toEqual([]);
});

test("the switch names both modes, marks the current one and keeps the text, the cursor and the history", async ({
  page,
}) => {
  await editAtEnd(page, "# Title\n\n**bold**");
  await expect(modeButton(page, "Live preview")).toHaveAttribute("aria-pressed", "true");
  await expect(modeButton(page, "Source")).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.type(" one");
  await modeButton(page, "Source").click();
  await expect(modeButton(page, "Source")).toHaveAttribute("aria-pressed", "true");
  await expect(modeButton(page, "Live preview")).toHaveAttribute("aria-pressed", "false");
  // Source mode shows every character.
  await expect.poll(() => shownLines(page)).toEqual(["# Title", "", "**bold** one"]);
  await expect(contentEditor(page)).toBeFocused();

  await modeButton(page, "Live preview").click();
  await expect.poll(async () => (await shownLines(page))[0]).toBe("Title");
  // The cursor is where it was.
  await page.keyboard.type(" two");
  await expectContent(page, "# Title\n\n**bold** one two");

  // Undo reverts the edit before the switches too.
  await modeButton(page, "Source").click();
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expectContent(page, "# Title\n\n**bold**");

  // The switch is reachable with the keyboard: Esc, then Shift+Tab, lands on its last button, Shift+Tab on the other.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Tab");
  await expect(modeButton(page, "Source")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(modeButton(page, "Live preview")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(modeButton(page, "Live preview")).toHaveAttribute("aria-pressed", "true");
});

test("the editor starts in the mode last chosen in the browser, and in live preview in a fresh one", async ({
  page,
  browser,
}) => {
  await createPage({ folder: handbook, name: "other", content: "# Other" });
  await editAtEnd(page, "# Title");
  await modeButton(page, "Source").click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/preview.md");

  await page.goto("/folders/handbook/other.md");
  await page.getByRole("link", { name: "Edit" }).click();
  await editorReady(page);
  await expect(modeButton(page, "Source")).toHaveAttribute("aria-pressed", "true");
  expect(await shownLines(page)).toEqual(["# Other"]);

  // A fresh browser with the same login has no mode stored.
  const fresh = await browser.newContext({ storageState: USER_STORAGE_STATE });
  const other = hydrating(await fresh.newPage());
  await other.goto("/folders/handbook/other.md?action=edit");
  await editorReady(other);
  await expect(modeButton(other, "Live preview")).toHaveAttribute("aria-pressed", "true");
  await fresh.close();
});

for (const mode of ["live preview", "source mode"]) {
  test(`the stored content does not depend on the mode it was edited in: ${mode}`, async ({ page, context }) => {
    if (mode === "source mode") await startInSourceMode(context);
    const created = await createPage({ folder: handbook, name: "stored", content: "# Stored" });
    const content = "# Stored\n\n## Part\n\n**bold** [link](/x) ![img](/y.png)\n\nTitle\n===\n\n<b>html</b>\n";

    await page.goto("/folders/handbook/stored.md?action=edit");
    await fillContent(page, content);
    await page.keyboard.press("ControlOrMeta+Home");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/handbook/stored.md");
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).content).toBe(content);
  });
}

const BLOCKS = "# Blocks\n\n- bullet\n1. numbered\n- [ ] open\n- [x] done\n\n> quote\n\n```\ncode\n```\n\n---\n\nlast";

test("blocks show formatted while the cursor is on another line, and as Markdown on its lines", async ({ page }) => {
  const errors = collectErrors(page);
  const editor = await editAtEnd(page, BLOCKS);

  await expect
    .poll(() => shownLines(page))
    .toEqual([
      "Blocks",
      "",
      "• bullet",
      "1. numbered",
      " open",
      " done",
      "",
      "quote",
      "",
      "",
      "code",
      "",
      "",
      "",
      "",
      "last",
    ]);
  await expect(editor.getByRole("checkbox", { name: "open" })).not.toBeChecked();
  await expect(editor.getByRole("checkbox", { name: "done" })).toBeChecked();
  await expect(editor.getByRole("separator")).toHaveCount(1);
  // The style of the line that shows the text: the text itself may sit in an element of the highlighting.
  const computed = (text: string, property: "fontFamily" | "backgroundImage") =>
    editor
      .getByText(text, { exact: true })
      .evaluate((element, name) => getComputedStyle(element.closest(".cm-line") ?? element)[name], property);
  expect(await computed("quote", "backgroundImage")).toContain("gradient");
  expect(await computed("code", "fontFamily")).toContain("monospace");

  // A selection over every line shows all of them as Markdown.
  await page.keyboard.press("ControlOrMeta+a");
  await expect.poll(() => shownLines(page)).toEqual(BLOCKS.split("\n"));
  await expect(editor.getByRole("checkbox")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a click on a task box ticks it in the text, Ctrl+Z unticks it, and only Save stores it", async ({ page }) => {
  const created = await createPage({ folder: handbook, name: "tasks", content: "# Tasks\n\n- [ ] a\n\nlast" });
  await page.goto("/folders/handbook/tasks.md?action=edit");
  const editor = await editorReady(page);
  await editor.press("ControlOrMeta+End");

  await editor.getByRole("checkbox", { name: "a" }).click();
  await expectContent(page, "# Tasks\n\n- [x] a\n\nlast");
  await expect(editor.getByRole("checkbox", { name: "a" })).toBeChecked();
  // The cursor stayed on the last line, so the box still shows.
  expect((await shownLines(page))[4]).toBe("last");
  expect((await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).content).toBe(created.content);

  await page.keyboard.press("ControlOrMeta+z");
  await expectContent(page, "# Tasks\n\n- [ ] a\n\nlast");
  await editor.getByRole("checkbox", { name: "a" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/tasks.md");
  expect((await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).content).toBe(
    "# Tasks\n\n- [x] a\n\nlast",
  );
});

const TABLE = "# Table\n\n| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | **b** | c |\n| d | e | f |\n\nlast";

test("a table shows rendered, and as its whole Markdown while the cursor is in it", async ({ page }) => {
  const errors = collectErrors(page);
  const editor = await editAtEnd(page, TABLE);

  const table = editor.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveText(["Left", "Center", "Right"]);
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table.getByRole("cell")).toHaveText(["a", "b", "c", "d", "e", "f"]);
  const align = (name: string) =>
    table.getByRole("cell", { name, exact: true }).evaluate((element) => getComputedStyle(element).textAlign);
  expect([await align("d"), await align("e"), await align("f")]).toEqual(["left", "center", "right"]);
  expect(await table.getByText("b", { exact: true }).evaluate((element) => getComputedStyle(element).fontWeight)).toBe(
    "700",
  );

  // Up from the last line into the table: every line of it shows as Markdown, also those without the cursor.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(editor.getByRole("table")).toHaveCount(0);
  await expect
    .poll(() => shownLines(page))
    .toEqual(TABLE.split("\n").map((line, index) => (index === 0 ? "Table" : line)));

  await page.keyboard.press("ControlOrMeta+End");
  await expect(editor.getByRole("table")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a click on a cell of the rendered table puts the cursor at that cell in the Markdown", async ({ page }) => {
  const editor = await editAtEnd(page, TABLE);

  await editor.getByRole("table").getByRole("cell", { name: "e", exact: true }).click();
  await expect(editor.getByRole("table")).toHaveCount(0);
  await page.keyboard.type("X");

  await expectContent(page, TABLE.replace("| d | e | f |", "| d | Xe | f |"));
});
