// The tools of a Manager connection of MCP: delete_page and the tools of tabs, and what the browser shows of
// their changes.
import type { APIRequestContext } from "@playwright/test";

import { USER_TEXT_NOTE } from "@/features/mcp/tool-schemas";

import { logIn, NO_STORAGE_STATE } from "./support/auth";
import { createFile, createGrant, createPage, createTab, createUser, getTestDb } from "./support/database";
import { call, send, setUpProjects, type ToolResult } from "./support/mcp";
import { ISSUER } from "./support/oauth";
import { expect, test } from "./support/test";

// An MCP client has no session cookie: it only has the access token of its grant.
test.use({ storageState: NO_STORAGE_STATE });

/**
 * The folder "projects", its Owner, the path of its Reader address, and the access token of a grant of the Owner
 * there: the address and the bearer token of `send()` and `call()` unless a test gives others.
 */
let projects: Awaited<ReturnType<typeof setUpProjects>>["projects"];
let owner: Awaited<ReturnType<typeof setUpProjects>>["owner"];
let address: string;
let secret: string;

test.beforeEach(async () => {
  ({ projects, owner, address, secret } = await setUpProjects());
});

test.describe("the tools of a Manager connection", () => {
  /** The access token of a Manager connection of the Owner of "projects", and its address. */
  let manager: string;
  let managerAddress: string;

  test.beforeEach(async () => {
    ({ accessToken: manager } = await createGrant({ owner, folder: projects, role: "manager" }));
    managerAddress = `/mcp/${projects.id}/manager`;
  });

  /** Calls a tool at the Manager address. */
  function manage(request: APIRequestContext, name: string, args: Record<string, unknown> = {}) {
    return call(request, name, args, manager, managerAddress);
  }

  /** The tabs and pages that `list_folder` of the Manager connection lists. */
  async function listed(request: APIRequestContext) {
    return (await manage(request, "list_folder")).structuredContent as {
      tabs: { name: string; address: string }[];
      pages: { name: string; tab: string | null; address: string }[];
    };
  }

  /** The tabs and pages of "projects" as stored, in a stable order. */
  async function stored() {
    const db = getTestDb();
    return {
      tabs: await db.tab.findMany({ where: { folderId: projects.id }, orderBy: { name: "asc" } }),
      pages: await db.page.findMany({ where: { folderId: projects.id }, orderBy: { name: "asc" } }),
    };
  }

  /** The message of a tool error; fails the test if the call worked. */
  function errorOf(result: ToolResult): string {
    expect(result.isError).toBe(true);
    return result.content[0]?.text ?? "";
  }

  test("delete_page deletes a page and names it, its tab and the full address of the deleted items", async ({
    request,
  }) => {
    const guides = await createTab({ folder: projects, name: "guides" });
    await createPage({ tab: guides, name: "setup", content: "# Setup" });
    await createPage({ folder: projects, name: "plan", content: "# Plan" });

    const result = await manage(request, "delete_page", { tab: "guides", page: "setup", version: 1 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      note: USER_TEXT_NOTE,
      name: "setup",
      title: "Setup",
      tab: "guides",
      deletedItemsAddress: `${ISSUER}/deleted-items/projects`,
      restore: expect.stringMatching(/restored by a Manager or Owner of the folder in the browser/),
    });
    expect((await listed(request)).pages.map(({ name }) => name)).toEqual(["plan"]);
    expect(errorOf(await manage(request, "read_page", { tab: "guides", page: "setup" }))).toContain(
      'There is no page named "setup"',
    );
    const deleted = await getTestDb().page.findFirstOrThrow({ where: { name: "setup" } });
    expect(deleted).toMatchObject({
      deletedAt: expect.any(Date),
      tabId: null,
      lastEditedById: owner.id,
      lastEditedVia: "mcp",
    });
  });

  test("delete_page based on an older version or on none is refused with who changed the page and when; a deleted page is not found", async ({
    request,
  }) => {
    const bob = await createUser({ name: "bob" });
    await createPage({ folder: projects, name: "plan", content: "# Plan", editor: bob, version: 3 });
    const before = await stored();

    for (const args of [{ page: "plan", version: 2 }, { page: "plan" }]) {
      const message = errorOf(await manage(request, "delete_page", args));
      expect(message).toMatch(/^The page was changed by bob via web at \d{4}-/);
      expect(message).toContain("read_page");
    }
    expect(await stored()).toEqual(before);

    await expect(manage(request, "delete_page", { page: "plan", version: 3 })).resolves.toMatchObject({
      structuredContent: { name: "plan" },
    });
    expect(errorOf(await manage(request, "delete_page", { page: "plan", version: 4 }))).toContain(
      'There is no page named "plan" directly in the folder "projects"',
    );
  });

  test("create_tab creates a tab into which create_page and move_or_rename_page put pages at once; a bad or taken name creates nothing", async ({
    request,
  }) => {
    await createPage({ folder: projects, name: "plan", content: "# Plan" });

    const result = await manage(request, "create_tab", { name: "meetings" });

    expect(result.structuredContent).toEqual({
      name: "meetings",
      address: `${ISSUER}/folders/projects/meetings`,
    });
    expect((await listed(request)).tabs.map(({ name }) => name)).toEqual(["meetings"]);
    await expect(getTestDb().tab.findFirstOrThrow({ where: { name: "meetings" } })).resolves.toMatchObject({
      lastEditedById: owner.id,
      lastEditedVia: "mcp",
    });
    await expect(manage(request, "create_page", { tab: "meetings", content: "# Kick-off" })).resolves.toMatchObject({
      structuredContent: { name: "kick-off", tab: "meetings" },
    });
    await expect(
      manage(request, "move_or_rename_page", { page: "plan", version: 1, newTab: "meetings", newName: "plan" }),
    ).resolves.toMatchObject({ structuredContent: { name: "plan", tab: "meetings" } });

    const before = await stored();
    expect(errorOf(await manage(request, "create_tab", { name: "Bad Name" }))).toContain("The name is not valid");
    expect(errorOf(await manage(request, "create_tab", { name: "meetings" }))).toContain(
      'A tab named "meetings" already exists in the folder "projects"',
    );
    expect(await stored()).toEqual(before);
  });

  test("rename_tab gives the tab and its pages new addresses; an unknown tab, a bad name and a taken name change nothing", async ({
    request,
  }) => {
    const misc = await createTab({ folder: projects, name: "misc" });
    await createTab({ folder: projects, name: "guides" });
    await createPage({ tab: misc, name: "notes", content: "# Notes" });

    const result = await manage(request, "rename_tab", { tab: "misc", newName: "archive" });

    expect(result.structuredContent).toEqual({
      note: USER_TEXT_NOTE,
      name: "archive",
      address: `${ISSUER}/folders/projects/archive`,
      updatedPages: [],
    });
    const { tabs, pages } = await listed(request);
    expect(tabs.map(({ name }) => name)).toEqual(["archive", "guides"]);
    await expect(getTestDb().tab.findUniqueOrThrow({ where: { id: misc.id } })).resolves.toMatchObject({
      lastEditedById: owner.id,
      lastEditedVia: "mcp",
    });
    expect(pages).toMatchObject([
      { name: "notes", tab: "archive", address: `${ISSUER}/folders/projects/archive/notes.md` },
    ]);

    const before = await stored();
    expect(errorOf(await manage(request, "rename_tab", { tab: "misc", newName: "old" }))).toContain(
      'There is no tab named "misc" in the folder "projects"',
    );
    expect(errorOf(await manage(request, "rename_tab", { tab: "archive", newName: "Old Stuff" }))).toContain(
      "The name is not valid",
    );
    expect(errorOf(await manage(request, "rename_tab", { tab: "archive", newName: "guides" }))).toContain(
      'A tab named "guides" already exists in the folder "projects"',
    );
    expect(await stored()).toEqual(before);
  });

  test("rename_tab lists the pages whose links into the tab it updated", async ({ request }) => {
    const guides = await createTab({ folder: projects, name: "guides" });
    await createPage({ tab: guides, name: "setup", content: "# Setup guide" });
    await createPage({ tab: guides, name: "onboarding", content: "# Onboarding\n\n[[guides/setup|the setup]]" });
    await createPage({
      folder: projects,
      name: "first-week",
      content: "# First week\n\n[[guides/setup]] [[guides/faq]]",
    });

    const result = await manage(request, "rename_tab", { tab: "guides", newName: "docs" });

    expect(result.structuredContent).toMatchObject({
      name: "docs",
      updatedPages: [
        { name: "first-week", tab: null, title: "First week" },
        { name: "onboarding", tab: "docs", title: "Onboarding" },
      ],
    });
    const contents = await getTestDb().page.findMany({
      orderBy: { name: "asc" },
      select: { name: true, content: true },
    });
    expect(contents).toEqual([
      { name: "first-week", content: "# First week\n\n[[docs/setup]] [[docs/faq]]" },
      { name: "onboarding", content: "# Onboarding\n\n[[docs/setup|the setup]]" },
      { name: "setup", content: "# Setup guide" },
    ]);
  });

  test("rename_tab with the current name of a tab changes nothing and answers as a rename; an unknown tab and a Writer connection are refused as for any name", async ({
    request,
  }) => {
    const bob = await createUser({ name: "bob" });
    const longAgo = new Date("2026-01-01T10:00:00Z");
    await createTab({ folder: projects, name: "misc" });
    await createTab({ folder: projects, name: "guides", editor: bob, via: "web", updatedAt: longAgo });
    // The answer of a rename to a new name, for comparison.
    const renamed = await manage(request, "rename_tab", { tab: "misc", newName: "archive" });
    const before = await stored();
    const listedBefore = (await manage(request, "list_folder")).structuredContent;

    for (const newName of ["guides", " guides "]) {
      const result = await manage(request, "rename_tab", { tab: "guides", newName });

      expect(result.structuredContent).toEqual({
        note: USER_TEXT_NOTE,
        name: "guides",
        address: `${ISSUER}/folders/projects/guides`,
        updatedPages: [],
      });
      expect(JSON.stringify(result)).toBe(JSON.stringify(renamed).replaceAll("archive", "guides"));
    }
    expect(await stored()).toEqual(before);
    expect((await manage(request, "list_folder")).structuredContent).toEqual(listedBefore);
    await expect(getTestDb().tab.findFirstOrThrow({ where: { name: "guides" } })).resolves.toMatchObject({
      updatedAt: longAgo,
      lastEditedById: bob.id,
      lastEditedVia: "web",
    });

    expect(errorOf(await manage(request, "rename_tab", { tab: "unknown", newName: "unknown" }))).toContain(
      'There is no tab named "unknown" in the folder "projects"',
    );
    const { accessToken: writer } = await createGrant({ owner, folder: projects, role: "writer" });
    const asWriter = (newName: string) =>
      send(
        request,
        { method: "tools/call", params: { name: "rename_tab", arguments: { tab: "guides", newName } } },
        writer,
        `/mcp/${projects.id}/writer`,
      ).then((answer) => answer.json());
    expect(await asWriter("guides")).toEqual(await asWriter("news"));
    expect(await stored()).toEqual(before);
  });

  test("delete_tab deletes a tab with its five pages at once, lists each of them, and frees the name of the tab", async ({
    request,
  }) => {
    const drafts = await createTab({ folder: projects, name: "drafts" });
    for (const i of [1, 2, 3, 4, 5]) {
      await createPage({ tab: drafts, name: `draft-${i}`, content: `# Draft ${i}` });
    }
    await createPage({ folder: projects, name: "plan", content: "# Plan" });

    const result = await manage(request, "delete_tab", { tab: "drafts" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      note: USER_TEXT_NOTE,
      name: "drafts",
      pageCount: 5,
      pages: [1, 2, 3, 4, 5].map((i) => ({ name: `draft-${i}`, title: `Draft ${i}` })),
      files: [],
      deletedItemsAddress: `${ISSUER}/deleted-items/projects`,
      restore: expect.stringMatching(/restored one by one by a Manager or Owner of the folder in the browser/),
    });
    const { tabs, pages } = await listed(request);
    expect(tabs).toEqual([]);
    expect(pages.map(({ name }) => name)).toEqual(["plan"]);
    const deleted = await getTestDb().page.findMany({ where: { name: { startsWith: "draft-" } } });
    expect(deleted).toHaveLength(5);
    for (const page of deleted) {
      expect(page).toMatchObject({
        deletedAt: expect.any(Date),
        tabId: null,
        lastEditedById: owner.id,
        lastEditedVia: "mcp",
      });
    }
    await expect(manage(request, "create_tab", { name: "drafts" })).resolves.toMatchObject({
      structuredContent: { name: "drafts" },
    });
  });

  test("delete_tab deletes a tab with two files, names both, and they go to the deleted items of the folder", async ({
    request,
  }) => {
    const guides = await createTab({ folder: projects, name: "guides" });
    await createPage({ tab: guides, name: "setup", content: "# Setup" });
    const report = await createFile({ tab: guides, name: "report.pdf" });
    const diagram = await createFile({ tab: guides, name: "diagram.png" });
    const kept = await createFile({ folder: projects, name: "kept.png" });

    const result = await manage(request, "delete_tab", { tab: "guides" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      name: "guides",
      pageCount: 1,
      files: [{ name: "diagram.png" }, { name: "report.pdf" }],
      restore: expect.stringContaining("Its pages and files can be restored one by one"),
    });
    for (const file of [report, diagram]) {
      expect(await getTestDb().file.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
        deletedAt: expect.any(Date),
        tabId: null,
        lastEditedById: owner.id,
        lastEditedVia: "mcp",
      });
    }
    expect(await getTestDb().file.findUniqueOrThrow({ where: { id: kept.id } })).toMatchObject({ deletedAt: null });
  });

  test("delete_tab deletes an empty tab with 0 pages; a tab that does not exist is a tool error that changes nothing", async ({
    request,
  }) => {
    await createTab({ folder: projects, name: "empty" });
    await createTab({ folder: projects, name: "guides" });

    await expect(manage(request, "delete_tab", { tab: "empty" })).resolves.toMatchObject({
      structuredContent: { name: "empty", pageCount: 0, pages: [] },
    });

    const before = await stored();
    for (const tab of ["empty", "missing"]) {
      expect(errorOf(await manage(request, "delete_tab", { tab }))).toContain(
        `There is no tab named "${tab}" in the folder "projects", so nothing was changed.`,
      );
    }
    expect(await stored()).toEqual(before);
  });

  test("the tool list of a Manager connection has eleven tools, the destructive hint on the content changes and the deletes and none for deleted pages, roles or the folder", async ({
    request,
  }) => {
    const answer = await send(request, { method: "tools/list" }, manager, managerAddress);
    const tools = (
      (await answer.json()) as {
        result: { tools: { name: string; description: string; annotations: Record<string, boolean> }[] };
      }
    ).result.tools;

    expect(tools.map(({ name }) => name)).toEqual([
      "list_folder",
      "read_page",
      "search_pages",
      "create_page",
      "replace_page_content",
      "edit_page_content",
      "move_or_rename_page",
      "delete_page",
      "create_tab",
      "rename_tab",
      "delete_tab",
    ]);
    const hints = Object.fromEntries(tools.map(({ name, annotations }) => [name, annotations]));
    for (const name of ["delete_page", "create_tab", "rename_tab", "delete_tab"]) {
      expect(hints[name]?.readOnlyHint, name).toBe(false);
    }
    expect(hints.replace_page_content?.destructiveHint).toBe(true);
    expect(hints.edit_page_content).toStrictEqual(hints.replace_page_content);
    expect(hints.delete_page?.destructiveHint).toBe(true);
    expect(hints.delete_tab?.destructiveHint).toBe(true);
    expect(hints.create_tab?.destructiveHint).toBe(false);
    expect(hints.rename_tab?.destructiveHint).toBe(false);
    expect(tools.map(({ name }) => name).join(" ")).not.toMatch(/restore|deleted|role|owner|folder_/);
    // No tool uploads, changes, moves, renames or deletes a single file: delete_tab deletes files only with their tab.
    expect(tools.map(({ name }) => name).join(" ")).not.toMatch(/file|upload/);
    expect(tools.find(({ name }) => name === "delete_tab")?.description).toContain(
      "together with every page and every file (image or PDF) in it",
    );
  });

  test("initialize at the Manager address gives the instructions of a Manager connection", async ({ request }) => {
    const response = await send(
      request,
      {
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } },
      },
      manager,
      managerAddress,
    );

    const { instructions } = ((await response.json()) as { result: { instructions: string } }).result;
    expect(instructions).toContain('the folder "projects" with the role Manager');
    expect(instructions).toContain("creates, renames and deletes tabs");
    expect(instructions).toContain("Use edit_page_content to change parts of a page");
    expect(instructions).toContain("Deleting a tab deletes all its pages and files with it.");
    expect(instructions).toContain("Deleted items can be neither seen nor restored through this connection");
  });

  test("a call of delete_page, create_tab, rename_tab or delete_tab through a Writer or a Reader connection changes nothing", async ({
    request,
  }) => {
    const { accessToken: writer } = await createGrant({ owner, folder: projects, role: "writer" });
    await createTab({ folder: projects, name: "guides" });
    await createPage({ folder: projects, name: "plan", content: "# Plan" });
    const before = await stored();

    for (const [token, to] of [
      [writer, `/mcp/${projects.id}/writer`],
      [secret, address],
    ] as const) {
      for (const [name, args] of [
        ["delete_page", { page: "plan", version: 1 }],
        ["create_tab", { name: "news" }],
        ["rename_tab", { tab: "guides", newName: "news" }],
        ["delete_tab", { tab: "guides" }],
      ] as const) {
        const answer = await send(request, { method: "tools/call", params: { name, arguments: args } }, token, to);
        expect(JSON.stringify(await answer.json()), `${name} at ${to}`).toContain(name);
      }
    }
    expect(await stored()).toEqual(before);
  });

  test.describe("in the browser", () => {
    // The browser is logged in as the Owner of "projects", whose connection the tests use.
    test.beforeEach(async ({ page }) => {
      await logIn(page, owner.name);
      await expect(page).toHaveURL("/folders");
    });

    test("a page deleted through MCP is listed under Deleted items with the user who deleted it, via mcp", async ({
      page,
      request,
    }) => {
      const bob = await createUser({ name: "bob" });
      await createPage({ folder: projects, name: "plan", content: "# Plan", editor: bob });

      await manage(request, "delete_page", { page: "plan", version: 1 });
      await page.goto("/deleted-items/projects");

      const rows = page
        .getByRole("table", { name: "Deleted items" })
        .getByRole("row")
        .filter({ has: page.getByRole("cell") });
      await expect(rows).toHaveCount(1);
      await expect(rows.nth(0)).toContainText("plan");
      await expect(rows.nth(0).getByRole("cell").nth(4)).toHaveText(owner.name);
      await expect(rows.nth(0).getByRole("cell").nth(5)).toHaveText("mcp");
    });

    test("the pages of a tab deleted through MCP are listed under Deleted items with the user who deleted them, via mcp", async ({
      page,
      request,
    }) => {
      const bob = await createUser({ name: "bob" });
      const drafts = await createTab({ folder: projects, name: "drafts", editor: bob });
      for (const i of [1, 2, 3, 4, 5]) {
        await createPage({ tab: drafts, name: `draft-${i}`, content: `# Draft ${i}`, editor: bob });
      }

      await manage(request, "delete_tab", { tab: "drafts" });
      await page.goto("/deleted-items/projects");

      const rows = page
        .getByRole("table", { name: "Deleted items" })
        .getByRole("row")
        .filter({ has: page.getByRole("cell") });
      await expect(rows).toHaveCount(5);
      for (const i of [0, 1, 2, 3, 4]) {
        await expect(rows.nth(i).getByRole("cell").nth(4)).toHaveText(owner.name);
        await expect(rows.nth(i).getByRole("cell").nth(5)).toHaveText("mcp");
      }
    });

    test("a tab deleted in the browser meanwhile is a tool error of delete_tab that changes nothing", async ({
      page,
      request,
    }) => {
      const guides = await createTab({ folder: projects, name: "guides" });
      await createPage({ tab: guides, name: "intro", content: "# Intro" });
      await expect(manage(request, "list_folder")).resolves.toMatchObject({
        structuredContent: { tabs: [{ name: "guides" }] },
      });

      await page.goto("/folders/projects/guides?action=delete");
      await page.getByRole("dialog", { name: "Delete tab" }).getByRole("button", { name: "Delete" }).click();
      await expect(page).toHaveURL("/folders/projects");
      const before = await stored();

      expect(errorOf(await manage(request, "delete_tab", { tab: "guides" }))).toContain(
        'There is no tab named "guides" in the folder "projects"',
      );
      expect(await stored()).toEqual(before);
    });

    test("a tab created and a tab renamed through MCP show the user as their last editor", async ({
      page,
      request,
    }) => {
      const bob = await createUser({ name: "bob" });
      await createTab({ folder: projects, name: "misc", editor: bob });
      await createTab({ folder: projects, name: "other", editor: bob });
      const items = page.getByRole("list", { name: "Contents" }).getByRole("listitem");

      await manage(request, "create_tab", { name: "meetings" });
      await manage(request, "rename_tab", { tab: "misc", newName: "archive" });
      await page.goto("/folders/projects");

      await expect(items).toHaveText([
        new RegExp(`^archive.*by ${owner.name} via mcp$`),
        new RegExp(`^meetings.*by ${owner.name} via mcp$`),
        /^other.*by bob via web$/,
      ]);
    });
  });
});
