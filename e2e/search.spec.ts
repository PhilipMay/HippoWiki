import type { Page } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, becomeUser } from "./support/auth";
import { collectErrors, expectNotFound, expectNotFoundResponse } from "./support/browser";
import {
  createFile,
  createFolder,
  createFolderRole,
  createPage,
  createRevisions,
  createTab,
  createUser,
  getTestDb,
  resetTestDatabase,
  setOwnRole,
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

/** The search field of the open page. */
function searchField(page: Page) {
  return page
    .getByRole("search", { name: "Search this folder" })
    .getByRole("searchbox", { name: "Search this folder" });
}

/** Expects the alert of the results view above the search field. */
async function expectAlertAboveField(page: Page) {
  await expect(page.getByRole("main").locator("[role=alert], [role=search]")).toHaveCount(2);
  await expect(page.getByRole("main").locator("[role=alert], [role=search]").first()).toHaveAttribute("role", "alert");
}

/** Collects the requests of the page for the results of a search. */
function searchRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("view=search")) requests.push(request.url());
  });
  return requests;
}

/**
 * Sends a request of its own from the page and waits for its answer, so that every request that the input before it
 * started has been sent by then.
 */
async function afterPendingRequests(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await fetch("/api/health");
  });
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

  // The logged-in user is a Reader of a folder of bob, who created its page.
  test("shows the results to another user with a role on the folder", async ({ page }) => {
    const bob = await createUser({ name: "bob" });
    await createFolderRole({ folder: handbook, user: bob, role: "owner" });
    await setOwnRole(handbook, "reader");
    await createPage({
      folder: handbook,
      name: "backup",
      content: "# Backup\n\nThe backup of the server.",
      editor: bob,
    });

    await page.goto(results("backup"));
    await expect(resultTitles(page)).toHaveText(["Backup"]);
  });

  // The logged-in user has no role on the folder of bob.
  test("shows the not-found page to a user without a role on the folder", async ({ page }) => {
    const bob = await createUser({ name: "bob" });
    await createFolderRole({ folder: handbook, user: bob, role: "owner" });
    await getTestDb().folderRole.deleteMany({ where: { folderId: handbook.id, userId: KNOWN_USER.id } });
    await createPage({ folder: handbook, name: "backup", content: "# Backup", editor: bob });

    await expectNotFound(page, results("backup"));
  });

  test("shows the not-found page to an admin", async ({ page, context }) => {
    await createPage({ folder: handbook, name: "backup", content: "# Backup" });
    await becomeUser(context, ADMIN_STORAGE_STATE);

    await expectNotFound(page, results("backup"));
  });

  // The words of every other address are read by `folderAddressOf()`, `tabAddressOf()`, `pageAddressOf()` and
  // `deletedPageAddressOf()`, whose unit tests cover them; these two routes read them in their page.
  test("shows the not-found page for words that do not belong to the address", async ({ page }) => {
    for (const address of ["/folders?q=backup", "/deleted-items/handbook?q=backup"]) {
      await expectNotFoundResponse(page.request, address);
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
    await expect(page.getByRole("main")).toContainText(`No pages or files in this folder match ${words}`);
    await expect(page.getByRole("main")).toContainText(
      "All words must match. Put words in quotes for a phrase, write -word to leave out the pages with a word, and or between two words to find either.",
    );
    await expect(resultList(page)).toHaveCount(0);
    await expect(page.locator("main b")).toHaveCount(0);
  }
});

test.describe("files in the results", () => {
  /** The list of the files of the open results view. */
  function fileList(page: Page) {
    return page.getByRole("list", { name: "Files" });
  }

  test("a search lists the files whose names match above the pages, each leading to its details page", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const mike = await createUser({ name: "mike" });
    const guides = await createTab({ folder: handbook, name: "guides" });
    await createFile({
      tab: guides,
      name: "network-diagram.png",
      editor: mike,
      via: "mcp",
      updatedAt: new Date("2026-03-04T10:00:00Z"),
    });
    await createFile({ folder: handbook, name: "diagram.pdf" });
    await createFile({ folder: handbook, name: "photo.jpg" });
    await createPage({ folder: handbook, name: "network", content: "# Network\n\nThe diagram of the network." });

    await page.goto(results("diagram"));

    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText(["Files", "Pages"]);
    const files = fileList(page).getByRole("listitem");
    // The whole name first, then a name with a part that matches.
    await expect(files).toHaveText([/^diagram\.pdf/, /^guides \/ network-diagram\.png/]);
    await expect(files.nth(1)).toContainText("PNG");
    await expect(files.nth(1)).toContainText("by mike via mcp");
    await expect(files.nth(1).locator("time")).toHaveAttribute("datetime", "2026-03-04T10:00:00.000Z");
    await expect(files.nth(0)).toContainText("PDF");
    await expect(resultTitles(page)).toHaveText(["Network"]);
    // The files come before the pages.
    await expect(
      page
        .getByRole("main")
        .getByRole("list", { name: /^(Files|Search results)$/ })
        .first(),
    ).toHaveAccessibleName("Files");

    await files.nth(1).getByRole("link").click();
    await expect(page).toHaveURL("/folders/handbook/guides/network-diagram.png");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("network-diagram.png");
    expect(errors).toEqual([]);
  });

  test("a part of a word finds a file, and a deleted file or one of another folder is never found", async ({
    page,
  }) => {
    const other = await createFolder({ name: "other", roles: [{ user: KNOWN_USER, role: "owner" }] });
    await createFile({ folder: other, name: "network-diagram.png" });
    await createFile({ folder: handbook, name: "old-diagram.png", deletedAt: new Date() });
    await createFile({ folder: handbook, name: "network-diagram.png" });

    await page.goto(results("agra"));
    await expect(fileList(page).getByRole("listitem")).toHaveText([/^network-diagram\.png/]);
    // Without pages that match, the list of the pages and its heading are left out.
    await expect(resultList(page)).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText(["Files"]);

    await page.goto(results("diagram -network"));
    await expect(page.getByRole("main")).toContainText("No pages or files in this folder match diagram -network");
    await expect(fileList(page)).toHaveCount(0);
  });

  test("a word that is only inside a PDF finds nothing", async ({ page }) => {
    await createFile({
      folder: handbook,
      name: "manual.pdf",
      versions: [{ bytes: new TextEncoder().encode("%PDF-1.4\n(zanzibar) Tj\n%%EOF\n") }],
    });

    await page.goto(results("zanzibar"));
    await expect(page.getByRole("main")).toContainText("No pages or files in this folder match zanzibar");
  });
});

test("a search that matches more than 100 pages lists 100 and says that more match", async ({ page }) => {
  test.setTimeout(60_000);
  for (let index = 0; index < 150; index += 1) {
    await createPage({ folder: handbook, name: `meeting-${index}`, content: `# Meeting ${index}\n\nThe agenda.` });
  }

  await page.goto(results("agenda"));
  await expect(resultList(page).getByRole("listitem")).toHaveCount(100);
  await expect(page.getByRole("main")).toContainText("More than 100 pages match. Use more precise words");
  // That fewer matches are all listed without the message is tested in integration/search-service.test.ts.
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
        await expectAlertAboveField(page);
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
      await expect(page.getByRole("main")).toContainText(/No pages or files in this folder match|Gateway/);
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
      await expectAlertAboveField(page);
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
      await expectAlertAboveField(page);
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

test.describe("the search field", () => {
  /** Sets up a tab, a page placed directly in the folder, a page in the tab with two revisions, and a deleted page. */
  async function setUpFolder() {
    const guides = await createTab({ folder: handbook, name: "guides" });
    await createPage({ folder: handbook, name: "overview", content: "# Overview\n\nThe start." });
    const setup = await createPage({ tab: guides, name: "setup", content: "# Setup\n\nThe first steps." });
    await createRevisions({ page: setup, count: 1 });
    const deleted = await createPage({ folder: handbook, name: "old", content: "# Old", deletedAt: new Date() });
    return { deleted };
  }

  /** Every address of the folder, its tab and its pages with a view and without an action. */
  const VIEWS = [
    "/folders/handbook",
    "/folders/handbook?view=all",
    "/folders/handbook?view=roles",
    "/folders/handbook?view=mcp",
    "/folders/handbook?view=search&q=setup",
    "/folders/handbook/guides",
    "/folders/handbook/overview.md",
    "/folders/handbook/guides/setup.md",
    "/folders/handbook/guides/setup.md?view=history",
    "/folders/handbook/guides/setup.md?view=revision&revision=1",
    "/folders/handbook/guides/setup.md?view=revision&revision=1&format=raw",
    "/folders/handbook/guides/setup.md?view=compare&from=1&to=2",
  ];

  // To a Reader: `SearchField` has no branch by role, and the views show it to every role alike.
  test("shows on every address of the folder, its tab and its pages to a reader", async ({ page }) => {
    test.setTimeout(60_000);
    await setUpFolder();
    await setOwnRole(handbook, "reader");

    for (const address of VIEWS) {
      await page.goto(address);
      await expect(searchField(page), address).toBeVisible();
      await expect(searchField(page), address).toBeEditable();
    }
  });

  // The HTML that the server renders holds the field wherever the page shows it, so its absence is read there. The
  // folder list, the user list and the account page never render it.
  test("does not show while an action is open and on the deleted items", async ({ page }) => {
    const { deleted } = await setUpFolder();
    /** The HTML of the address as the server renders it, after a check that the page was found. */
    const htmlOf = async (address: string) => {
      const response = await page.request.get(address);
      expect(response.status(), address).toBe(200);
      return response.text();
    };
    expect(await htmlOf("/folders/handbook")).toContain('role="search"');

    for (const address of [
      "/folders/handbook?action=new",
      "/folders/handbook?action=rename",
      "/folders/handbook?action=new-tab",
      "/folders/handbook?action=give-role",
      "/folders/handbook/guides?action=new",
      "/folders/handbook/guides?action=rename",
      "/folders/handbook/guides?action=delete",
      "/folders/handbook/overview.md?action=edit",
      "/folders/handbook/overview.md?action=move-or-rename",
      "/folders/handbook/overview.md?action=delete",
      "/folders/handbook/guides/setup.md?action=revert&revision=1",
      "/deleted-items/handbook",
      `/deleted-items/handbook/${deleted.id}`,
      `/deleted-items/handbook/${deleted.id}?view=history`,
      `/deleted-items/handbook/${deleted.id}?view=revision&revision=1`,
    ]) {
      expect(await htmlOf(address), address).not.toContain('role="search"');
    }
  });

  test("typing sends nothing and shows no list; Enter opens the results", async ({ page }) => {
    const errors = collectErrors(page);
    await createPage({ folder: handbook, name: "backup", content: "# Backup\n\nThe backup of the server." });
    await page.goto("/folders/handbook");
    const requests = searchRequests(page);

    await searchField(page).fill("backup");
    await searchField(page).pressSequentially(" server", { delay: 50 });
    await afterPendingRequests(page);
    expect(requests).toEqual([]);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page).toHaveURL("/folders/handbook");

    await searchField(page).press("Enter");
    await expect(page).toHaveURL(results("backup server"));
    await expect(resultTitles(page)).toHaveText(["Backup"]);
    expect(errors).toEqual([]);
  });

  test("Enter in an empty field or one of spaces only keeps the address and sends nothing", async ({ page }) => {
    await page.goto("/folders/handbook");
    const requests = searchRequests(page);

    await searchField(page).press("Enter");
    await searchField(page).fill("   ");
    await searchField(page).press("Enter");
    await afterPendingRequests(page);

    await expect(page).toHaveURL("/folders/handbook");
    expect(requests).toEqual([]);
  });

  test("holds the words of the results, and changed words open their results", async ({ page }) => {
    await createPage({ folder: handbook, name: "backup", content: "# Backup server\n\nThe backup of the server." });
    await createPage({ folder: handbook, name: "restore", content: "# Restore\n\nHow to restore the server." });

    await page.goto(results("backup server"));
    await expect(searchField(page)).toHaveValue("backup server");

    await searchField(page).fill("restore");
    await searchField(page).press("Enter");
    await expect(page).toHaveURL(results("restore"));
    await expect(searchField(page)).toHaveValue("restore");
    await expect(resultTitles(page)).toHaveText(["Restore"]);

    await page.goBack();
    await expect(page).toHaveURL(results("backup server"));
    await expect(searchField(page)).toHaveValue("backup server");
  });

  test("a search for the exact title of a page opens the results, not the page", async ({ page }) => {
    await createPage({ folder: handbook, name: "backup-server", content: "# Backup server" });
    await createPage({ folder: handbook, name: "notes", content: "# Notes\n\nThe backup server of the office." });
    await page.goto("/folders/handbook");

    await searchField(page).fill("Backup server");
    await searchField(page).press("Enter");

    await expect(page).toHaveURL(results("Backup server"));
    await expect(resultTitles(page)).toHaveText(["Backup server", "Notes"]);
  });

  test("a search started on a page in a tab covers the whole folder", async ({ page }) => {
    const meetings = await createTab({ folder: handbook, name: "meetings" });
    const guides = await createTab({ folder: handbook, name: "guides" });
    await createPage({ tab: meetings, name: "weekly", content: "# Weekly\n\nThe gateway is down." });
    await createPage({ tab: guides, name: "network", content: "# Network\n\nThe gateway of the office." });
    await createPage({ folder: handbook, name: "overview", content: "# Overview\n\nAbout the gateway." });

    await page.goto("/folders/handbook/meetings/weekly.md");
    await searchField(page).fill("gateway");
    await searchField(page).press("Enter");

    await expect(page).toHaveURL(results("gateway"));
    await expect(resultTitles(page)).toHaveCount(3);
    await expect(resultList(page)).toContainText("meetings / weekly.md");
    await expect(resultList(page)).toContainText("guides / network.md");
    await expect(resultList(page)).toContainText(/overview\.md/);
  });
});

test.describe("the scenarios of search", () => {
  test("Anna finds the page about the configuration of the database", async ({ page }) => {
    await createPage({
      folder: handbook,
      name: "datenbank-backup",
      content:
        "# Datenbank-Backup\n\nJede Nacht wird die Datenbank gesichert. Die Konfiguration der Sicherung steht im Abschnitt über den Server.",
    });
    await createPage({
      folder: handbook,
      name: "konfiguration-der-datenbank",
      content:
        "# Konfiguration der Datenbank\n\nDie Datenbank läuft auf dem zweiten Server. Hier steht, welche Einstellungen sie braucht und warum.",
    });
    await page.goto("/folders/handbook");

    await searchField(page).fill("datenbank konfig");
    await searchField(page).press("Enter");

    await expect(resultTitles(page).first()).toHaveText("Konfiguration der Datenbank");
    await resultTitles(page).first().click();
    await expect(page).toHaveURL("/folders/handbook/konfiguration-der-datenbank.md");
  });

  test("Ben finds the pages about houses in every tab, with their pieces of text", async ({ page }) => {
    const meetings = await createTab({ folder: handbook, name: "meetings" });
    const plans = await createTab({ folder: handbook, name: "plans" });
    await createPage({
      tab: meetings,
      name: "kickoff",
      content:
        "# Kickoff\n\nIn der Besprechung ging es um das neue Haus am See. Die Arbeiten beginnen im Sommer und dauern drei Wochen.",
    });
    await createPage({
      tab: plans,
      name: "neubau",
      content:
        "# Neubau\n\nDie Häuser der Siedlung bekommen neue Fenster. Der Architekt stellt die Pläne in der nächsten Woche vor.",
    });
    await createPage({
      folder: handbook,
      name: "budget",
      content:
        "# Budget\n\nDas Budget für das nächste Jahr wird im Herbst beschlossen, nach der Prüfung aller Rechnungen.",
    });

    await page.goto("/folders/handbook/meetings/kickoff.md");
    await searchField(page).fill("Häuser");
    await searchField(page).press("Enter");

    const items = resultList(page).getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.filter({ hasText: "Kickoff" }).locator("mark")).toHaveText(["Haus"]);
    await expect(items.filter({ hasText: "Neubau" }).locator("mark")).toHaveText(["Häuser"]);
  });
});
