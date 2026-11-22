// Wiki links in the Markdown editor: live preview of the links, with the titles and the missing pages of the page list
// as of opening the editor, and Ctrl+click or Cmd+click on a link; the images, files and file picker of live preview,
// and pasted and dropped files, which the editor ignores.

import type { BrowserContext, Page } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { createFile, createFolder, createPage, createTab, getTestDb, resetTestDatabase } from "./support/database";
import { contentEditor, editorReady, expectContent, shownLines } from "./support/editor";
import { pngBytes } from "./support/files";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;
let guides: Awaited<ReturnType<typeof createTab>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
  guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ tab: guides, name: "setup", content: "# Setup guide" });
});

/** Opens the editor of a new page `onboarding` with the content, the cursor at the end of the content. */
async function editAtEnd(page: Page, content: string) {
  await createPage({ folder: handbook, name: "onboarding", content });
  await page.goto("/folders/handbook/onboarding.md?action=edit");
  const editor = await editorReady(page);
  await editor.press("ControlOrMeta+End");
  return editor;
}

/** The addresses of the browser tabs that open from now on. */
function openedTabs(context: BrowserContext): string[] {
  const opened: string[] = [];
  context.on("page", (tab) => opened.push(tab.url()));
  return opened;
}

test("a wiki link shows its label or the title of its page off the line of the cursor, its Markdown on it", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const content = "# Onboarding\n\nSee [[guides/setup]] and [[guides/setup|the setup]].\n\nlast";
  const editor = await editAtEnd(page, content);

  await expect.poll(() => shownLines(page)).toEqual(["Onboarding", "", "See Setup guide and the setup.", "", "last"]);
  const color = (text: string) =>
    editor.getByText(text, { exact: true }).evaluate((element) => getComputedStyle(element).textDecorationLine);
  expect(await color("Setup guide")).toBe("underline");
  expect(await color("the setup")).toBe("underline");

  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect
    .poll(async () => (await shownLines(page))[2])
    .toBe("See [[guides/setup]] and [[guides/setup|the setup]].");
  await expectContent(page, content);
  expect(errors).toEqual([]);
});

test("Ctrl+click opens the page, or the editor of a missing page, in a new tab, and nothing for an invalid target", async ({
  page,
  context,
}) => {
  const opened = openedTabs(context);
  const content = "# Onboarding\n\n[[guides/setup]] [[guides/faq]] [[Setup Guide]]\n\nlast";
  const editor = await editAtEnd(page, content);
  await expect.poll(async () => (await shownLines(page))[2]).toBe("Setup guide guides/faq Setup Guide");

  // A target that breaks the name rule opens nothing.
  await editor.getByText("Setup Guide", { exact: true }).click({ modifiers: ["ControlOrMeta"] });

  let next = context.waitForEvent("page");
  await editor.getByText("Setup guide", { exact: true }).click({ modifiers: ["ControlOrMeta"] });
  let tab = await next;
  await tab.waitForLoadState();
  expect(new URL(tab.url()).pathname).toBe("/folders/handbook/guides/setup.md");
  await expect(tab.getByRole("heading", { name: "Setup guide", level: 1 })).toBeVisible();
  await tab.close();

  next = context.waitForEvent("page");
  await editor.getByText("guides/faq", { exact: true }).click({ modifiers: ["ControlOrMeta"] });
  tab = await next;
  await tab.waitForLoadState();
  const address = new URL(tab.url());
  expect(`${address.pathname}${address.search}`).toBe("/folders/handbook/guides?action=new&name=faq");
  await tab.close();

  expect(opened).toHaveLength(2);
  // The editor keeps its content, and the cursor stayed on the last line, so the links still show formatted.
  await expectContent(page, content);
  expect((await shownLines(page))[2]).toBe("Setup guide guides/faq Setup Guide");
});

test("a link to a missing page is marked with its hint, against the pages as of opening the editor", async ({
  page,
}) => {
  const content = "# Onboarding\n\n[[no-such-page]] [[nosuchtab/setup]]\n\nlast";
  const editor = await editAtEnd(page, content);
  // The hint is the title of the marked text, for pointer users.
  const missing = editor.getByTitle("Page does not exist", { exact: true });
  await expect(missing).toHaveText("no-such-page");
  expect(await missing.evaluate((element) => getComputedStyle(element).textDecorationStyle)).toBe("dashed");
  await expect(editor.getByTitle("Tab does not exist", { exact: true })).toHaveText("nosuchtab/setup");

  // A page created elsewhere after the editor was opened stays missing until the editor is opened again.
  await createPage({ folder: handbook, name: "no-such-page", content: "# Now here" });
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowDown");
  await expect(missing).toHaveText("no-such-page");

  await page.reload();
  await editorReady(page);
  await contentEditor(page).press("ControlOrMeta+End");
  await expect.poll(async () => (await shownLines(page))[2]).toBe("Now here nosuchtab/setup");
});

test("the editor of a new page shows wiki links against the pages of the folder", async ({ page }) => {
  await page.goto("/folders/handbook/guides?action=new");
  const editor = await editorReady(page);
  await editor.fill("# New\n\n[[guides/setup]]\n\nlast");
  await expect.poll(async () => (await shownLines(page))[2]).toBe("Setup guide");
});

test.describe("the picker on [[", () => {
  test("typing [[ and part of a title lists the matching pages; choosing one inserts its link, one undo reverts it", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await createPage({ folder: handbook, name: "first-week", content: "# First week" });
    const editor = await editAtEnd(page, "# Onboarding\n\n");

    await editor.pressSequentially("See [[");
    const options = page.getByRole("listbox").getByRole("option");
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toContainText("First week");
    await expect(options.nth(0)).toContainText("Directly in the folder");

    await editor.pressSequentially("guide");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText("Setup guide");
    await expect(options.first()).toContainText("Tab guides");
    await page.keyboard.press("Enter");
    await expectContent(page, "# Onboarding\n\nSee [[guides/setup]]");
    await expect(page.getByRole("listbox")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+z");
    await expectContent(page, "# Onboarding\n\nSee [[guide");
    expect(errors).toEqual([]);
  });

  test('says "No page found" without a match, and Esc leaves the text as typed', async ({ page }) => {
    const editor = await editAtEnd(page, "# Onboarding\n\n");
    await editor.pressSequentially("[[nothing");
    await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["No page found"]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expectContent(page, "# Onboarding\n\n[[nothing");

    // Esc then Tab still leaves the editor while no picker is open.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    await expect(editor).not.toBeFocused();
    await expectContent(page, "# Onboarding\n\n[[nothing");
  });

  test("Enter continues a list while no picker is open", async ({ page }) => {
    const editor = await editAtEnd(page, "# Onboarding\n\n- [[guides/setup]]");
    await editor.press("Enter");
    await expectContent(page, "# Onboarding\n\n- [[guides/setup]]\n- ");
  });
});

test.describe("files in the editor", () => {
  test("live preview shows the image of ![[…]] below its line, and the Markdown on the line of the cursor", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await createFile({ tab: guides, name: "diagram.png", versions: [{ bytes: await pngBytes(120, 80) }] });
    const editor = await editAtEnd(page, "# Onboarding\n\n![[guides/diagram.png|The network]]\n\nlast");

    const image = editor.getByRole("img", { name: "The network" });
    await expect(image).toHaveAttribute("src", "/files/handbook/guides/diagram.png");
    await expect(image).toHaveAttribute("width", "120");
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(120);
    // The image is a block under the line of the embed, whose Markdown is hidden away from the cursor.
    const lines = editor.locator(".cm-line");
    const embedLine = lines.nth(2);
    await expect(embedLine).toHaveText("");
    const below = await image.evaluate((img) => img.getBoundingClientRect().top);
    expect(below).toBeGreaterThanOrEqual(await embedLine.evaluate((line) => line.getBoundingClientRect().bottom));

    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(embedLine).toHaveText("![[guides/diagram.png|The network]]");
    await expect(image).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("typing [[dia offers guides/diagram.png marked as a file, and choosing it inserts its link", async ({
    page,
  }) => {
    await createFile({ tab: guides, name: "diagram.png" });
    const editor = await editAtEnd(page, "# Onboarding\n\n");

    await editor.pressSequentially("See [[dia");
    const options = page.getByRole("listbox").getByRole("option");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText("guides/diagram.png");
    await expect(options.first()).toContainText("File in tab guides");
    await page.keyboard.press("Enter");
    await expectContent(page, "# Onboarding\n\nSee [[guides/diagram.png]]");
  });

  test("dropping and pasting a file changes nothing and uploads nothing", async ({ page }) => {
    const content = "# Onboarding\n\ntext";
    const editor = await editAtEnd(page, content);
    const uploads: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/uploads/")) uploads.push(request.url());
    });

    for (const type of ["drop", "paste"] as const) {
      await editor.evaluate((element, eventType) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(["# Not a page\n"], "notes.md", { type: "text/markdown" }));
        transfer.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png", { type: "image/png" }));
        const event =
          eventType === "paste"
            ? new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true })
            : new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true });
        element.dispatchEvent(event);
      }, type);
    }

    await expectContent(page, content);
    expect(uploads).toEqual([]);
    expect(await getTestDb().file.count()).toBe(0);
  });

  test("the toolbar has no upload button", async ({ page }) => {
    await editAtEnd(page, "# Onboarding");
    const toolbar = page.getByRole("toolbar", { name: "Formatting" });
    await expect(toolbar.getByRole("button").first()).toBeVisible();
    await expect(toolbar.getByRole("button", { name: /upload|file|image/i })).toHaveCount(0);
  });
});
