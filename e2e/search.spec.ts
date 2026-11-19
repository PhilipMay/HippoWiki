import type { Page } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, becomeUser, logInElsewhere } from "./support/auth";
import { collectErrors, expectNotFound } from "./support/browser";
import {
  createFolder,
  createFolderRole,
  createPage,
  createTab,
  createUser,
  resetTestDatabase,
} from "./support/database";
import { holdSearchWords, waitForHeldSearches } from "./support/search";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

/** The address of the results of a search in the folder `handbook`. */
function results(words: string): string {
  return `/folders/handbook?view=search&q=${encodeURIComponent(words)}`;
}

/** The list of the results of the open results view. */
function resultList(page: Page) {
  return page.getByRole("list", { name: "Search results" });
}

/** The titles of the results of the open results view, in their order. */
function resultTitles(page: Page) {
  return resultList(page).getByRole("listitem").getByRole("link");
}

/** The alert at the top of the results view. */
function alert(page: Page) {
  return page.getByRole("main").getByRole("alert");
}

/** The text of a search that takes longer than its time limit, and of a search beyond the running ones. */
const TOO_BROAD = /too broad.*more precise words/;
const BUSY = "Too many searches are running. Try again in a few seconds.";
const TOO_LONG = "Search at most 200 characters and 10 words";

test.describe("the address of the results", () => {
  test("shows the results again after a reload, and with back and forward", async ({ page }) => {
    const errors = collectErrors(page);
    await createPage({ folder: handbook, name: "backup", content: "# Backup\n\nThe backup of the server." });
    await createPage({ folder: handbook, name: "restore", content: "# Restore\n\nHow to restore the server." });

    await page.goto(results("backup"));
    await expect(page).toHaveTitle("Search – handbook – HippoWiki");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Search");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem")).toHaveText([
      "Folders",
      "handbook",
      "Search",
    ]);
    await expect(resultTitles(page)).toHaveText(["Backup"]);

    await page.reload();
    await expect(resultTitles(page)).toHaveText(["Backup"]);

    await page.goto(results("restore"));
    await expect(resultTitles(page)).toHaveText(["Restore"]);
    await page.goBack();
    await expect(page).toHaveURL(results("backup"));
    await expect(resultTitles(page)).toHaveText(["Backup"]);
    await page.goForward();
    await expect(page).toHaveURL(results("restore"));
    await expect(resultTitles(page)).toHaveText(["Restore"]);
    expect(errors).toEqual([]);
  });

  test("shows the results to another user with a role on the folder", async ({ browser }) => {
    const bob = await createUser({ name: "bob", mustChangePassword: false });
    await createFolderRole({ folder: handbook, user: bob, role: "reader" });
    await createPage({ folder: handbook, name: "backup", content: "# Backup\n\nThe backup of the server." });

    const other = await logInElsewhere(browser, "bob");
    await other.page.goto(results("backup"));
    await expect(resultTitles(other.page)).toHaveText(["Backup"]);
    await other.context.close();
  });

  test("shows the not-found page to a user without a role on the folder", async ({ browser }) => {
    await createUser({ name: "carol", mustChangePassword: false });
    await createPage({ folder: handbook, name: "backup", content: "# Backup" });

    const other = await logInElsewhere(browser, "carol");
    await expectNotFound(other.page, results("backup"));
    await other.context.close();
  });

  test("shows the not-found page to an admin", async ({ page, context }) => {
    await createPage({ folder: handbook, name: "backup", content: "# Backup" });
    await becomeUser(context, ADMIN_STORAGE_STATE);

    await expectNotFound(page, results("backup"));
  });

  test("shows the not-found page for words that do not belong to the address", async ({ page }) => {
    const guides = await createTab({ folder: handbook, name: "guides" });
    await createPage({ folder: handbook, name: "overview", content: "# Overview" });
    await createPage({ tab: guides, name: "setup", content: "# Setup" });
    const deleted = await createPage({ folder: handbook, name: "old", content: "# Old", deletedAt: new Date() });

    for (const address of [
      "/folders/handbook?view=search",
      "/folders/handbook?view=search&q=",
      "/folders/handbook?view=search&q=%20%20",
      "/folders/handbook?view=search&q=backup&q=server",
      "/folders/handbook?view=search&q=backup&action=new",
      "/folders/handbook?view=search&q=backup&action=rename",
      "/folders?q=backup",
      "/folders/handbook?q=backup",
      "/folders/handbook?view=all&q=backup",
      "/folders/handbook/guides?q=backup",
      "/folders/handbook/guides?view=search&q=backup",
      "/folders/handbook/overview.md?q=backup",
      "/folders/handbook/overview.md?view=history&q=backup",
      "/folders/handbook/guides/setup.md?q=backup",
      "/deleted-pages/handbook?q=backup",
      `/deleted-pages/handbook/${deleted.id}?q=backup`,
    ]) {
      await expectNotFound(page, address);
    }
  });
});

test("a search for the exact title of a page shows the results, with that page first", async ({ page }) => {
  await createPage({ folder: handbook, name: "notes", content: "# Notes\n\nThe backup server of the office." });
  await createPage({ folder: handbook, name: "backup-server-setup", content: "# Backup server setup" });
  await createPage({ folder: handbook, name: "backup-server", content: "# Backup server" });

  await page.goto(results("backup server"));

  await expect(page).toHaveURL(results("backup server"));
  await expect(resultTitles(page)).toHaveText(["Backup server", "Backup server setup", "Notes"]);
});

test("a result shows its title, tab, piece of text, time, last editor and channel", async ({ page }) => {
  const errors = collectErrors(page);
  const mike = await createUser({ name: "mike" });
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({
    tab: guides,
    name: "gateway",
    content: "# Network\n\nThe <script>alert(1)</script> of the <b>gateway</b> is never run.",
    editor: mike,
    via: "mcp",
    updatedAt: new Date("2026-03-04T10:00:00Z"),
  });
  await createPage({ folder: handbook, name: "direct", content: "# Direct\n\nAnother gateway here." });

  await page.goto(results("gateway"));

  const items = resultList(page).getByRole("listitem");
  await expect(items).toHaveCount(2);
  const result = items.filter({ hasText: "Network" });
  await expect(result.getByRole("link")).toHaveText("Network");
  await expect(result).toContainText("guides / gateway.md");
  await expect(result).toContainText("The <script>alert(1)</script> of the <b>gateway</b> is never run");
  await expect(result.locator("mark")).toHaveText(["gateway"]);
  await expect(result.locator("time")).toHaveAttribute("datetime", "2026-03-04T10:00:00.000Z");
  await expect(result).toContainText("by mike via mcp");
  // Text that looks like markup is text: no element of it exists in the page.
  await expect(page.locator("main script, main b")).toHaveCount(0);
  // A page placed directly in the folder has no tab.
  await expect(items.filter({ hasText: "Direct" })).toContainText(/direct\.md/);
  await expect(items.filter({ hasText: "Direct" })).not.toContainText("/ direct.md");

  await result.getByRole("link").click();
  await expect(page).toHaveURL("/folders/handbook/guides/gateway.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Network");
  expect(errors).toEqual([]);
});

test("words that find nothing show the message with the words as typed and the hint", async ({ page }) => {
  await createPage({ folder: handbook, name: "backup", content: "# Backup" });

  for (const words of ['zebra "<b>x</b>" -old', "---"]) {
    await page.goto(results(words));
    await expect(page.getByRole("main")).toContainText(`No pages in this folder match ${words}`);
    await expect(page.getByRole("main")).toContainText(
      "All words must match. Put words in quotes for a phrase, write -word to leave out the pages with a word, and or between two words to find either.",
    );
    await expect(resultList(page)).toHaveCount(0);
    await expect(page.locator("main b")).toHaveCount(0);
  }
});

test("a search that matches more than 100 pages lists 100 and says that more match", async ({ page }) => {
  test.setTimeout(60_000);
  for (let index = 0; index < 150; index += 1) {
    await createPage({ folder: handbook, name: `meeting-${index}`, content: `# Meeting ${index}\n\nThe agenda.` });
  }
  for (let index = 0; index < 30; index += 1) {
    await createPage({ folder: handbook, name: `budget-${index}`, content: `# Budget ${index}\n\nThe invoice.` });
  }

  await page.goto(results("agenda"));
  await expect(resultList(page).getByRole("listitem")).toHaveCount(100);
  await expect(page.getByRole("main")).toContainText("More than 100 pages match. Use more precise words");

  await page.goto(results("invoice"));
  await expect(resultList(page).getByRole("listitem")).toHaveCount(30);
  await expect(page.getByRole("main")).not.toContainText("More than 100 pages match");
});

test.describe("the limits of a search", () => {
  test.beforeEach(async ({ page }) => {
    await createPage({ folder: handbook, name: "gateway", content: "# Gateway\n\nThe gateway of the office." });
    // Compiles and warms the results view, so that the searches below start without waiting for it.
    await page.goto(results("gateway"));
    await expect(resultTitles(page)).toHaveText(["Gateway"]);
  });

  test("201 characters and 11 words show the message and run no search; 200 and 10 are searched", async ({ page }) => {
    const tooLong = ["gateway", "x".repeat(193)].join(" ");
    const tooMany = Array.from({ length: 11 }, () => "gateway").join(" ");
    const { release } = await holdSearchWords();
    try {
      for (const words of [tooLong, tooMany]) {
        const started = Date.now();
        await page.goto(results(words));
        await expect(alert(page)).toHaveText(TOO_LONG);
        await expect(resultList(page)).toHaveCount(0);
        // The table of the words is held, so a search that ran would wait for it.
        expect(Date.now() - started).toBeLessThan(3_000);
      }
    } finally {
      await release();
    }

    for (const words of [
      ["gateway", "x".repeat(192)].join(" "),
      Array.from({ length: 10 }, () => "gateway").join(" "),
    ]) {
      await page.goto(results(words));
      await expect(alert(page)).toHaveCount(0);
      await expect(page.getByRole("main")).toContainText(/No pages in this folder match|Gateway/);
    }
    await page.goto(results(Array.from({ length: 10 }, () => "gateway").join(" ")));
    await expect(resultTitles(page)).toHaveText(["Gateway"]);
  });

  test("a search that takes longer than the time limit is too broad, and the next one works", async ({ page }) => {
    test.setTimeout(60_000);
    const { release } = await holdSearchWords();
    try {
      await page.goto(results("gateway"));
      await expect(alert(page)).toHaveText(TOO_BROAD);
      await expect(resultList(page)).toHaveCount(0);
    } finally {
      await release();
    }

    await page.goto(results("gateway"));
    await expect(alert(page)).toHaveCount(0);
    await expect(resultTitles(page)).toHaveText(["Gateway"]);
  });

  test("with three searches running, a fourth is busy at once and the pages load", async ({ page, context }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    const { release } = await holdSearchWords();
    const others = await Promise.all([1, 2, 3].map(() => context.newPage()));
    let running: Promise<unknown>[] = [];
    try {
      // Different words, since the browser waits with a request for the same address until the one before it ended.
      running = others.map((other, index) => other.goto(results(["gateway", "office", "gateway office"][index] ?? "")));
      await waitForHeldSearches(3);

      const started = Date.now();
      await page.goto(results("the gateway"));
      await expect(alert(page)).toHaveText(BUSY);
      expect(Date.now() - started).toBeLessThan(3_000);
      await page.goto("/folders/handbook/gateway.md");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Gateway");
    } finally {
      await release();
    }
    await Promise.all(running);
    for (const other of others) await other.close();

    await page.goto(results("gateway"));
    await expect(alert(page)).toHaveCount(0);
    await expect(resultTitles(page)).toHaveText(["Gateway"]);
    expect(errors).toEqual([]);
  });
});

test("the results of a search hold only the pages of the folder", async ({ page }) => {
  const other = await createFolder({ name: "other", roles: [{ user: KNOWN_USER, role: "owner" }] });
  await createPage({ folder: other, name: "elsewhere", content: "# Elsewhere\n\nThe gateway." });
  await createPage({ folder: handbook, name: "old", content: "# Old\n\nThe gateway.", deletedAt: new Date() });
  await createPage({ folder: handbook, name: "here", content: "# Here\n\nThe gateway." });

  await page.goto(results("gateway"));
  await expect(resultTitles(page)).toHaveText(["Here"]);
});
