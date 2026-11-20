// Tests written from `spec/markdown-editor-requirements.md` alone, for the rules or the parts of rules that the other
// specs of the editor leave open.

import type { Page } from "@playwright/test";

import { CONTENT_NUL_MESSAGE } from "@/features/pages/schema";

import { collectErrors } from "./support/browser";
import { contentEditor, editorReady, expectContent, pasteContent, shownLines } from "./support/editor";
import { createFolder, createPage, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

function toolbar(page: Page) {
  return page.getByRole("toolbar", { name: "Formatting" });
}

function modeButton(page: Page, name: "Live preview" | "Source") {
  return toolbar(page).getByRole("button", { name, exact: true });
}

/** Opens the editor of a stored page with the content and puts the cursor at the end of the content. */
async function editAtEnd(page: Page, content: string, name = "spec") {
  const created = await createPage({ folder: handbook, name, content });
  await page.goto(`/folders/handbook/${name}.md?action=edit`);
  const editor = await editorReady(page);
  await editor.press("ControlOrMeta+End");
  return { editor, created };
}

// markdown-editor-requirements.md, "Live preview and source mode", R2.
test("switching the mode keeps the cursor in the middle of a line where it was (R2)", async ({ page }) => {
  await editAtEnd(page, "# Title\n\nalpha beta gamma\n\nlast");
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  for (let index = 0; index < "alpha ".length; index += 1) await page.keyboard.press("ArrowRight");

  await modeButton(page, "Source").click();
  await page.keyboard.type("1");
  await modeButton(page, "Live preview").click();
  await page.keyboard.type("2");

  await expectContent(page, "# Title\n\nalpha 12beta gamma\n\nlast");
});

// markdown-editor-requirements.md, "Editing comforts", R13.
test("search in live preview finds the marks it hides, and replace all of them is one undo (R13)", async ({ page }) => {
  const content = "# Marks\n\n**a** and **b**\n\nlast";
  const { editor } = await editAtEnd(page, content);
  await expect.poll(async () => (await shownLines(page))[2]).toBe("a and b");

  await editor.press("ControlOrMeta+f");
  await page.getByRole("textbox", { name: "Find" }).fill("**");
  await page.getByRole("textbox", { name: "Replace" }).fill("__");
  await page.getByRole("button", { name: "replace all" }).click();

  await expectContent(page, "# Marks\n\n__a__ and __b__\n\nlast");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expectContent(page, content);
});

// markdown-editor-requirements.md, "Toolbar", R19.
test("every button of the toolbar has a tooltip with its name, and with its shortcut where it has one (R19)", async ({
  page,
}) => {
  await page.goto("/folders/handbook?action=new");
  await editorReady(page);

  const buttons: [string, string?][] = [
    ["Bold", "B"],
    ["Italic", "I"],
    ["Strikethrough"],
    ["Inline code"],
    ["Heading"],
    ["Link", "K"],
    ["Bullet list"],
    ["Numbered list"],
    ["Task list"],
  ];
  for (const [name, key] of buttons) {
    await toolbar(page).getByRole("button", { name, exact: true }).hover();
    const tooltip = page.getByRole("tooltip").filter({ hasText: name });
    await expect(tooltip, name).toBeVisible();
    if (key) await expect(tooltip, name).toHaveText(new RegExp(`(Ctrl\\+|Cmd\\+|⌘)${key}\\b`));
    else await expect(tooltip, name).not.toHaveText(/Ctrl|Cmd|⌘/);
    await page.mouse.move(0, 0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
});

// markdown-editor-requirements.md, "Toolbar", R25.
test("the switch of the modes sits at the right end of the toolbar, after every button (R25)", async ({ page }) => {
  await page.goto("/folders/handbook?action=new");
  await editorReady(page);

  const bar = await toolbar(page).boundingBox();
  const live = await modeButton(page, "Live preview").boundingBox();
  const source = await modeButton(page, "Source").boundingBox();
  expect(bar && live && source).toBeTruthy();
  if (!bar || !live || !source) return;
  for (const name of ["Bold", "Task list"]) {
    const box = await toolbar(page).getByRole("button", { name, exact: true }).boundingBox();
    expect((box?.x ?? Infinity) + (box?.width ?? 0), name).toBeLessThanOrEqual(live.x);
  }
  // The switch ends at the right end of the toolbar, its padding aside.
  expect(bar.x + bar.width - (source.x + source.width)).toBeLessThan(24);
});

// markdown-editor-requirements.md, "What live preview shows formatted", R17, with "Rendering" of pages.md.
test("Ctrl+click opens a relative link, a reference link, an autolink and a www address in a new tab (R17)", async ({
  page,
  context,
}) => {
  await createPage({ folder: handbook, name: "other", content: "# Other" });
  await context.route(/^https?:\/\/(www\.)?example\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>Example</title>" }),
  );
  const content = [
    "# Links",
    "",
    "[relative](/folders/handbook/other.md)",
    "",
    "[reference][good]",
    "",
    "<https://example.com/auto>",
    "",
    "www.example.com",
    "",
    "[good]: https://example.com/ref",
    "",
    "last",
  ].join("\n");
  const { editor } = await editAtEnd(page, content);

  const opened = async (text: string) => {
    const tab = context.waitForEvent("page");
    await editor.getByText(text, { exact: true }).click({ modifiers: ["ControlOrMeta"] });
    const other = await tab;
    await other.waitForLoadState();
    const url = new URL(other.url());
    await other.close();
    return url;
  };

  expect((await opened("relative")).pathname).toBe("/folders/handbook/other.md");
  expect((await opened("reference")).href).toBe("https://example.com/ref");
  expect((await opened("https://example.com/auto")).href).toBe("https://example.com/auto");
  expect((await opened("www.example.com")).host).toBe("www.example.com");
  await expectContent(page, content);
});

// markdown-editor-requirements.md, "What live preview shows formatted", R17, with "Rendering" of pages.md: with any
// other address than a relative one or one of the safe protocols, a link stays text, in any spelling.
test("Ctrl+click on a link with an unsafe address in any spelling opens nothing and runs nothing (R17)", async ({
  page,
  context,
}) => {
  await context.route("https://example.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>Example</title>" }),
  );
  const dialogs: string[] = [];
  context.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const opened: Page[] = [];
  context.on("page", (other) => opened.push(other));
  const unsafe = [
    ["upper", "[upper](JAVASCRIPT:alert(1))"],
    ["tab", "[tab](<java\tscript:alert(2)>)"],
    ["vb", "[vb](vbscript:msgbox(4))"],
    ["data", "[data](data:text/html;base64,PHNjcmlwdD5hbGVydCg1KTwvc2NyaXB0Pg==)"],
    ["file", "[file](file:///etc/passwd)"],
    ["bad reference", "[bad reference][bad]"],
  ];
  const content = [
    "# Links",
    "",
    ...unsafe.map(([, markdown]) => `${markdown}\n`),
    "[bad]: javascript:alert(6)",
    "",
    "[safe](https://example.com/safe)",
    "",
    "last",
  ].join("\n");
  const { editor } = await editAtEnd(page, content);

  for (const [text] of unsafe) {
    await editor
      .getByText(text ?? "")
      .first()
      .click({ modifiers: ["ControlOrMeta"] });
    await page.keyboard.press("ControlOrMeta+End");
  }
  // A safe link last: the tabs that the clicks before it would open have opened by the time its tab opens.
  const safe = context.waitForEvent("page");
  await editor.getByText("safe", { exact: true }).click({ modifiers: ["ControlOrMeta"] });
  await (await safe).waitForLoadState();

  const urls = await Promise.all(
    opened.map(async (other) => {
      await other.waitForLoadState();
      return other.url();
    }),
  );
  expect(urls).toEqual(["https://example.com/safe"]);
  expect(dialogs).toEqual([]);
  await expectContent(page, content);
});

// markdown-editor-requirements.md, "The stored content", R5: also after switching modes.
test("after switching the modes back and forth, saving without a change stores nothing (R5)", async ({ page }) => {
  const content =
    "# Plan\n\nSetext\n===\n\na b c ﻿ d e​f\fg\vh\u0085i\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n- [ ] task  \n\t* item\n\n<b>x</b>\n\n";
  const { created } = await editAtEnd(page, content);

  for (const mode of ["Source", "Live preview", "Source", "Live preview"] as const) {
    await modeButton(page, mode).click();
    await expect(modeButton(page, mode)).toHaveAttribute("aria-pressed", "true");
  }
  await expectContent(page, content);
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/spec.md");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toStrictEqual(created);
});

// markdown-editor-requirements.md, "Errors and screen readers", R37: a character the wiki cannot store.
test("a save of content with a NUL character shows the error at the editor, with the focus in it (R37)", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const { created } = await editAtEnd(page, "# Plan\n\nText");
  await pasteContent(page, { "text/plain": " a\u0000b" });
  await expectContent(page, "# Plan\n\nText a\u0000b");

  await page.getByRole("button", { name: "Save" }).click();

  const editor = contentEditor(page);
  await expect(page.getByRole("main").getByText(CONTENT_NUL_MESSAGE)).toBeVisible();
  await expect(editor).toHaveAccessibleDescription(CONTENT_NUL_MESSAGE);
  await expect(editor).toHaveAttribute("aria-invalid", "true");
  await expect(editor).toBeFocused();
  await expectContent(page, "# Plan\n\nText a\u0000b");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toStrictEqual(created);
  expect(errors).toEqual([]);
});

// markdown-editor-requirements.md, "What live preview shows formatted", R17, with "Rendering" of pages.md.
test("Ctrl+click opens the address that the page view links to, with entities and escapes resolved (R17)", async ({
  page,
  context,
}) => {
  const content = [
    "# Links",
    "",
    "[entity](&#x6A;avascript:alert(3))",
    "",
    "[escaped](/folders/handbook/a\\_b.md)",
    "",
    "[amp](/folders/handbook/c&amp;d.md)",
    "",
    "last",
  ].join("\n");
  await createPage({ folder: handbook, name: "view", content });

  // The page view makes no link of the first and resolves the escape and the entity of the others.
  await page.goto("/folders/handbook/view.md");
  const article = page.getByRole("article");
  await expect(article.getByRole("link", { name: "entity" })).toHaveCount(0);
  await expect(article.getByRole("link", { name: "escaped" })).toHaveAttribute("href", "/folders/handbook/a_b.md");
  await expect(article.getByRole("link", { name: "amp" })).toHaveAttribute("href", "/folders/handbook/c&d.md");

  const opened: Page[] = [];
  context.on("page", (other) => opened.push(other));
  await page.goto("/folders/handbook/view.md?action=edit");
  const editor = await editorReady(page);
  await editor.press("ControlOrMeta+End");
  // The first is no link in the editor either: it shows as its Markdown.
  await editor.getByText("[entity](&#x6A;avascript:alert(3))").click({ modifiers: ["ControlOrMeta"] });
  await page.keyboard.press("ControlOrMeta+End");
  for (const text of ["escaped", "amp"]) {
    await editor.getByText(text, { exact: true }).click({ modifiers: ["ControlOrMeta"] });
    await page.keyboard.press("ControlOrMeta+End");
  }
  await expect.poll(() => opened.length).toBe(2);
  const paths = await Promise.all(
    opened.map(async (other) => {
      await other.waitForLoadState();
      const url = new URL(other.url());
      return decodeURIComponent(url.pathname + url.hash);
    }),
  );
  expect(paths.toSorted()).toEqual(["/folders/handbook/a_b.md", "/folders/handbook/c&d.md"]);
  expect(opened).toHaveLength(2);
});
