import type { Dialog, Page } from "@playwright/test";

import { collectErrors } from "./support/browser";
import { editorReady, expectContent, fillContent } from "./support/editor";
import { createFolder, createPage, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
  await createPage({ folder: handbook, name: "plan", content: "# Plan\n\nText" });
});

/** The dialog "Discard changes?". */
function discardDialog(page: Page) {
  return page.getByRole("dialog", { name: "Discard changes?" });
}

/** Records the dialogs of the browser that a page raises, such as the question of `beforeunload`. */
function browserDialogs(page: Page): string[] {
  const types: string[] = [];
  page.on("dialog", (dialog: Dialog) => {
    types.push(dialog.type());
    void dialog.accept();
  });
  return types;
}

/** Closes the page as closing its tab would, with its `beforeunload` listeners, and waits until it is closed. */
async function closeTab(page: Page) {
  const closed = page.waitForEvent("close");
  await page.close({ runBeforeUnload: true });
  await closed;
}

const EDITORS = [
  {
    what: "an edited page",
    address: "/folders/handbook/plan.md?action=edit",
    cancelTo: "/folders/handbook/plan.md",
    link: "Edit",
  },
  { what: "a new page", address: "/folders/handbook?action=new", cancelTo: "/folders/handbook", link: "New page" },
];

for (const { what, address, cancelTo, link } of EDITORS) {
  test.describe(`leaving ${what} (R35)`, () => {
    test("after typing, Cancel asks; Keep editing keeps the text, Discard leads where Cancel leads", async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await page.goto(address);
      const editor = await editorReady(page);
      await editor.press("ControlOrMeta+End");
      await page.keyboard.type("x");

      await page.getByRole("link", { name: "Cancel" }).click();
      const dialog = discardDialog(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Keep editing" })).toBeFocused();
      await dialog.getByRole("button", { name: "Keep editing" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page).toHaveURL(address);
      await expectContent(page, what === "a new page" ? "x" : "# Plan\n\nTextx");

      await page.getByRole("link", { name: "Cancel" }).click();
      await discardDialog(page).getByRole("button", { name: "Discard" }).click();
      await expect(page).toHaveURL(cancelTo);
      expect(errors).toEqual([]);
    });

    test("after undoing the typing, and without a change, Cancel leaves without a question", async ({ page }) => {
      await page.goto(address);
      const editor = await editorReady(page);
      await editor.press("ControlOrMeta+End");
      await page.keyboard.type("x");
      await page.keyboard.press("ControlOrMeta+z");

      await page.getByRole("link", { name: "Cancel" }).click();
      await expect(page).toHaveURL(cancelTo);

      await page.goto(address);
      await editorReady(page);
      await page.getByRole("banner").getByRole("link", { name: "Folders" }).click();
      await expect(page).toHaveURL("/folders");
    });

    test("after typing, a link of the app bar asks, and Discard follows it", async ({ page }) => {
      await page.goto(address);
      await editorReady(page);
      await page.keyboard.type("x");

      await page.getByRole("banner").getByRole("link", { name: "Folders" }).click();
      await expect(discardDialog(page)).toBeVisible();
      await expect(page).toHaveURL(address);
      await discardDialog(page).getByRole("button", { name: "Discard" }).click();
      await expect(page).toHaveURL("/folders");
    });

    test("after typing, closing the tab asks the question of the browser; without a change it does not", async ({
      page,
      context,
    }) => {
      const dialogs = browserDialogs(page);
      await page.goto(address);
      await editorReady(page);
      await page.keyboard.type("x");
      await closeTab(page);
      expect(dialogs).toEqual(["beforeunload"]);

      const unchanged = await context.newPage();
      const none = browserDialogs(unchanged);
      await unchanged.goto(address);
      await editorReady(unchanged);
      await closeTab(unchanged);
      expect(none).toEqual([]);
    });

    test("the back button leaves without a question, and the page it leads to asks nothing", async ({ page }) => {
      const dialogs = browserDialogs(page);
      // The editor is opened by its link, as in the app, so that the back button goes back within the app.
      await page.goto(cancelTo);
      await page.getByRole("link", { name: link, exact: true }).click();
      await expect(page).toHaveURL(address);
      await editorReady(page);
      await page.keyboard.type("x");

      await page.goBack();
      await expect(page).toHaveURL(cancelTo);
      await closeTab(page);
      expect(dialogs).toEqual([]);
    });
  });
}

test("Save of an edited page leaves without a question, and the page view asks nothing on closing (R35)", async ({
  page,
}) => {
  const dialogs = browserDialogs(page);
  await page.goto("/folders/handbook/plan.md?action=edit");
  await fillContent(page, "# Plan\n\nChanged");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/plan.md");
  await expect(discardDialog(page)).toHaveCount(0);
  await closeTab(page);
  expect(dialogs).toEqual([]);
});

test("Save of a new page through the Save page dialog leaves without a question (R35)", async ({ page }) => {
  const dialogs = browserDialogs(page);
  await page.goto("/folders/handbook?action=new");
  await fillContent(page, "# Fresh page");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog", { name: "Save page" }).getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/fresh-page.md");
  await expect(discardDialog(page)).toHaveCount(0);
  await closeTab(page);
  expect(dialogs).toEqual([]);
});

test("a save refused as changed shows the stored content, and Cancel then leaves without a question (R35)", async ({
  page,
}) => {
  const stored = await getTestDb().page.findFirstOrThrow({ where: { name: "plan" } });
  await page.goto("/folders/handbook/plan.md?action=edit");
  await fillContent(page, "# Plan\n\nMine");
  // Another change is stored after the editor was opened.
  await getTestDb().page.update({
    where: { id: stored.id },
    data: { content: "# Plan\n\nTheirs", version: { increment: 1 } },
  });
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/plan.md?action=edit&notice=changed");
  await expectContent(page, "# Plan\n\nTheirs");
  await editorReady(page);
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL("/folders/handbook/plan.md");
});
