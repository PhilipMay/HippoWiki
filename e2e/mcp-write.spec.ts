// The write tools of MCP for a Writer connection: create_page, replace_page_content and move_or_rename_page,
// with optimistic locking and what the browser shows of their changes. edit_page_content has its own spec,
// `mcp-edit.spec.ts`; here it is only listed.
import type { APIRequestContext } from "@playwright/test";

import { USER_TEXT_NOTE } from "@/features/mcp/tool-schemas";
import { CONTENT_MAX_LENGTH, CONTENT_MAX_WIKI_LINKS } from "@/features/pages/limits";

import { logIn, NO_STORAGE_STATE } from "./support/auth";
import { createFolderRole, createGrant, createPage, createTab, createUser, getTestDb } from "./support/database";
import { expectContent, fillContent } from "./support/editor";
import { call, callTool, mcpPath, send, setUpProjects } from "./support/mcp";
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

test.describe("the write tools", () => {
  /** The access token of a Writer connection of the Owner to "projects", and its address. */
  let writer: string;
  let writerAddress: string;

  test.beforeEach(async () => {
    ({ accessToken: writer } = await createGrant({ owner, folder: projects, role: "writer" }));
    writerAddress = `/mcp/${projects.id}/writer`;
  });

  /** Calls a tool at the Writer address. */
  function write(request: APIRequestContext, name: string, args: Record<string, unknown>) {
    return call(request, name, args, writer, writerAddress);
  }

  /** The last editor and the channel of the pages of "projects" as stored, by name. */
  async function storedEditors() {
    return getTestDb().page.findMany({
      where: { folderId: projects.id },
      orderBy: { name: "asc" },
      select: { name: true, lastEditedById: true, lastEditedVia: true },
    });
  }

  /** The revisions of the pages of "projects" as stored, by page name and number. */
  async function storedRevisions() {
    return getTestDb().pageRevision.findMany({
      where: { page: { folderId: projects.id } },
      orderBy: [{ page: { name: "asc" } }, { number: "asc" }],
      select: { page: { select: { name: true } }, number: true, content: true, userId: true, via: true },
    });
  }

  /** The pages of "projects" as stored, by name, with what a write changes. */
  async function storedPages() {
    return getTestDb().page.findMany({
      where: { folderId: projects.id },
      orderBy: { name: "asc" },
      select: { name: true, title: true, content: true, tabId: true, version: true },
    });
  }

  test("are listed for a Writer connection and not for a Reader connection; a call at the Reader address changes nothing", async ({
    request,
  }) => {
    const writeTools = ["create_page", "replace_page_content", "edit_page_content", "move_or_rename_page"];
    const listed = async (token: string, to: string) =>
      (
        (await (await send(request, { method: "tools/list" }, token, to)).json()) as {
          result: { tools: { name: string }[] };
        }
      ).result.tools.map((tool) => tool.name);

    expect(await listed(writer, writerAddress)).toEqual([
      "list_folder",
      "read_page",
      "search_pages",
      "read_file",
      ...writeTools,
    ]);
    expect(await listed(secret, address)).toEqual(["list_folder", "read_page", "search_pages", "read_file"]);

    const answer = await send(request, {
      method: "tools/call",
      params: { name: "create_page", arguments: { content: "# Sneaky" } },
    });
    expect(await answer.json()).toMatchObject({ error: { code: -32602, message: "Tool create_page not found" } });
    expect(await storedPages()).toEqual([]);
  });

  test("create_page without a name gives the page the suggested name; bad input is a tool error and creates nothing", async ({
    request,
  }) => {
    await createTab({ folder: projects, name: "guides" });

    const created = await write(request, "create_page", { content: "# Release Notes\n\nFirst." });
    const inTab = await write(request, "create_page", { content: "# Setup", tab: "guides", name: "install" });

    expect(created.isError).toBeUndefined();
    expect(created.structuredContent).toEqual({
      note: USER_TEXT_NOTE,
      name: "release-notes",
      title: "Release Notes",
      tab: null,
      address: `${ISSUER}/folders/projects/release-notes.md`,
      wikiLink: "[[release-notes]]",
      version: 1,
    });
    expect(inTab.structuredContent).toMatchObject({
      name: "install",
      tab: "guides",
      wikiLink: "[[guides/install]]",
      version: 1,
    });
    expect(await storedEditors()).toEqual([
      { name: "install", lastEditedById: owner.id, lastEditedVia: "mcp" },
      { name: "release-notes", lastEditedById: owner.id, lastEditedVia: "mcp" },
    ]);
    // Creating a page through MCP records its first revision with the channel mcp.
    expect(await storedRevisions()).toEqual([
      { page: { name: "install" }, number: 1, content: "# Setup", userId: owner.id, via: "mcp" },
      {
        page: { name: "release-notes" },
        number: 1,
        content: "# Release Notes\n\nFirst.",
        userId: owner.id,
        via: "mcp",
      },
    ]);
    const before = await storedPages();

    for (const [args, message] of [
      [{ content: "No title" }, "must start with a title heading"],
      [{ content: "# 日本語" }, "The title suggests no name"],
      [{ content: "# Other", name: "release-notes" }, 'A page named "release-notes" already exists'],
      [{ content: "# Other", name: "Not A Name" }, "The name is not valid"],
      [{ content: "# Other", tab: "nowhere" }, 'There is no tab named "nowhere"'],
    ] as const) {
      const result = await write(request, "create_page", args);

      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.content[0]?.text).toContain(message);
    }
    expect(await storedPages()).toEqual(before);
  });

  test("replace_page_content gives the page the new content and the title of its new heading; content without a title heading changes nothing", async ({
    request,
  }) => {
    const bob = await createUser({ name: "bob" });
    await createPage({ folder: projects, name: "plan", content: "# Plan\n\nOld.", editor: bob });
    const { version } = (await call(request, "read_page", { page: "plan" })).structuredContent as {
      version: number;
    };

    const replaced = await write(request, "replace_page_content", {
      page: "plan",
      version,
      content: "# Roadmap\n\nNew.",
    });
    const refused = await write(request, "replace_page_content", { page: "plan", version: 2, content: "No title" });

    // The wiki link names the page by its name, not by its new title.
    expect(replaced.structuredContent).toMatchObject({
      name: "plan",
      title: "Roadmap",
      wikiLink: "[[plan]]",
      version: 2,
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain("must start with a title heading");
    expect(await storedPages()).toEqual([
      { name: "plan", title: "Roadmap", content: "# Roadmap\n\nNew.", tabId: null, version: 2 },
    ]);
    expect(await storedEditors()).toEqual([{ name: "plan", lastEditedById: owner.id, lastEditedVia: "mcp" }]);
    // The new content is recorded as the next revision with the channel mcp; the refused one records nothing.
    expect(await storedRevisions()).toEqual([
      { page: { name: "plan" }, number: 1, content: "# Plan\n\nOld.", userId: bob.id, via: "web" },
      { page: { name: "plan" }, number: 2, content: "# Roadmap\n\nNew.", userId: owner.id, via: "mcp" },
    ]);
  });

  test("replace_page_content with lists nested too deep is refused and the page keeps its content and version", async ({
    request,
  }) => {
    await createPage({ folder: projects, name: "plan", content: "# Plan\n\nOld." });
    const before = await storedPages();

    const refused = await write(request, "replace_page_content", {
      page: "plan",
      version: 1,
      content: `# Plan\n\n${"- ".repeat(21)}too deep`,
    });

    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain(
      "Lists and quotes must be nested at most 20 levels deep. Nothing was changed.",
    );
    expect(await storedPages()).toEqual(before);
    expect(before).toMatchObject([{ name: "plan", version: 1 }]);
  });

  test("create_page, replace_page_content and edit_page_content with 5,001 wiki links are refused and change nothing", async ({
    request,
  }) => {
    await createPage({ folder: projects, name: "plan", content: "# Plan\n\nOld." });
    const before = await storedPages();
    const links = "[[setup]] ".repeat(CONTENT_MAX_WIKI_LINKS + 1);

    const refusals = [
      await write(request, "create_page", { content: `# Links\n\n${links}`, name: "links" }),
      await write(request, "replace_page_content", { page: "plan", version: 1, content: `# Plan\n\n${links}` }),
      await write(request, "edit_page_content", {
        page: "plan",
        version: 1,
        edits: [{ oldText: "Old.", newText: links }],
      }),
    ];

    for (const refused of refusals) {
      expect(refused.isError).toBe(true);
      expect(refused.content[0]?.text).toContain("A page may hold at most 5,000 wiki links.");
    }
    expect(await storedPages()).toEqual(before);
  });

  test("move_or_rename_page changes the links to the page and lists the pages it updated", async ({ request }) => {
    const guides = await createTab({ folder: projects, name: "guides" });
    await createPage({ tab: guides, name: "setup", content: "# Setup guide" });
    await createPage({ tab: guides, name: "onboarding", content: "# Onboarding\n\n[[guides/setup|the setup]]" });
    await createPage({ folder: projects, name: "first-week", content: "# First week\n\n[[guides/setup]]" });
    await createPage({ folder: projects, name: "unrelated", content: "# Unrelated\n\n[[setup]]" });

    const moved = await write(request, "move_or_rename_page", {
      tab: "guides",
      page: "setup",
      version: 1,
      newTab: "guides",
      newName: "install",
    });

    expect(moved.structuredContent).toMatchObject({
      name: "install",
      updatedPages: [
        { name: "first-week", tab: null, title: "First week" },
        { name: "onboarding", tab: "guides", title: "Onboarding" },
      ],
    });
    expect(await storedPages()).toMatchObject([
      { name: "first-week", content: "# First week\n\n[[guides/install]]", version: 2 },
      { name: "install" },
      { name: "onboarding", content: "# Onboarding\n\n[[guides/install|the setup]]", version: 2 },
      { name: "unrelated", content: "# Unrelated\n\n[[setup]]", version: 1 },
    ]);
    const revisions = await storedRevisions();
    expect(revisions.filter((revision) => revision.number === 2)).toEqual([
      expect.objectContaining({ page: { name: "first-week" }, userId: owner.id, via: "mcp" }),
      expect.objectContaining({ page: { name: "onboarding" }, userId: owner.id, via: "mcp" }),
    ]);
  });

  test("move_or_rename_page puts the page at its new place; a taken name and a missing tab change nothing", async ({
    request,
  }) => {
    const guides = await createTab({ folder: projects, name: "guides" });
    await createPage({ folder: projects, name: "plan", content: "# Plan" });
    await createPage({ tab: guides, name: "taken", content: "# Taken" });

    const moved = await write(request, "move_or_rename_page", {
      page: "plan",
      version: 1,
      newTab: "guides",
      newName: "roadmap",
    });
    expect(moved.structuredContent).toEqual({
      note: USER_TEXT_NOTE,
      name: "roadmap",
      title: "Plan",
      tab: "guides",
      address: `${ISSUER}/folders/projects/guides/roadmap.md`,
      wikiLink: "[[guides/roadmap]]",
      version: 2,
      updatedPages: [],
    });
    expect(await storedEditors()).toEqual([
      { name: "roadmap", lastEditedById: owner.id, lastEditedVia: "mcp" },
      { name: "taken", lastEditedById: expect.any(String), lastEditedVia: "web" },
    ]);
    const before = await storedPages();

    for (const [args, message] of [
      [{ newTab: "guides", newName: "taken" }, 'A page named "taken" already exists'],
      [{ newTab: "nowhere", newName: "roadmap" }, 'There is no tab named "nowhere"'],
    ] as const) {
      const result = await write(request, "move_or_rename_page", {
        tab: "guides",
        page: "roadmap",
        version: 2,
        ...args,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(message);
    }
    expect(await storedPages()).toEqual(before);
  });

  // A move to the current name and tab changes nothing and answers as every move.
  test("move_or_rename_page to the current name and tab keeps the page as it is and returns the version that was sent; based on an older version it is refused", async ({
    request,
  }) => {
    const bob = await createUser({ name: "bob" });
    const guides = await createTab({ folder: projects, name: "guides" });
    const plan = await createPage({ tab: guides, name: "plan", content: "# Plan", editor: bob, version: 3 });

    for (const newName of ["plan", " plan "]) {
      const result = await write(request, "move_or_rename_page", {
        tab: "guides",
        page: "plan",
        version: 3,
        newTab: "guides",
        newName,
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        note: USER_TEXT_NOTE,
        name: "plan",
        title: "Plan",
        tab: "guides",
        address: `${ISSUER}/folders/projects/guides/plan.md`,
        wikiLink: "[[guides/plan]]",
        version: 3,
        updatedPages: [],
      });
    }
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).toStrictEqual(plan);
    expect(await storedRevisions()).toHaveLength(1);

    const refused = await write(request, "move_or_rename_page", {
      tab: "guides",
      page: "plan",
      version: 2,
      newTab: "guides",
      newName: "plan",
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toMatch(
      /^The page was changed by bob via web at .*Read the page again with read_page/,
    );
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).toStrictEqual(plan);
  });

  test("move_or_rename_page to the current name and tab from a Writer connection of a user who is now a Reader is refused and changes nothing", async ({
    request,
  }) => {
    const bob = await createUser({ name: "bob", mustChangePassword: false });
    await createFolderRole({ folder: projects, user: bob, role: "writer" });
    const plan = await createPage({ folder: projects, name: "plan", content: "# Plan" });
    const grant = await createGrant({ owner: bob, folder: projects, role: "writer" });
    await getTestDb().folderRole.update({
      where: { folderId_userId: { folderId: projects.id, userId: bob.id } },
      data: { role: "reader" },
    });

    const refused = await send(
      request,
      {
        method: "tools/call",
        params: { name: "move_or_rename_page", arguments: { page: "plan", version: 1, newTab: null, newName: "plan" } },
      },
      grant.accessToken,
      writerAddress,
    );
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toEqual({
      error: "role_too_low",
      error_description: "Your role on the folder does not allow this address.",
    });
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).toStrictEqual(plan);
  });

  test("of two changes based on the same version the first is stored and the second is refused with who changed the page, how and when", async ({
    request,
  }) => {
    await createPage({ folder: projects, name: "plan", content: "# Plan" });
    const { version } = (await call(request, "read_page", { page: "plan" })).structuredContent as {
      version: number;
    };

    const first = await write(request, "replace_page_content", { page: "plan", version, content: "# First" });
    const second = await write(request, "replace_page_content", { page: "plan", version, content: "# Second" });
    const none = await write(request, "replace_page_content", { page: "plan", content: "# None" });

    expect(first.isError).toBeUndefined();
    for (const refused of [second, none]) {
      expect(refused.isError).toBe(true);
      expect(refused.content[0]?.text).toMatch(
        new RegExp(
          `^The page was changed by ${owner.name} via mcp at \\d{4}-\\d{2}-\\d{2}T.*Read the page again with read_page`,
        ),
      );
    }
    expect(await storedPages()).toMatchObject([{ content: "# First", version: 2 }]);
  });

  test("read_page tells how the page was last changed: web after the browser, mcp and the user after a write tool", async ({
    request,
  }) => {
    const bob = await createUser({ name: "bob" });
    await createPage({ folder: projects, name: "plan", content: "# Plan", editor: bob });

    await expect(call(request, "read_page", { page: "plan" })).resolves.toMatchObject({
      structuredContent: { lastEditedBy: "bob", lastEditedVia: "web", version: 1 },
    });
    await write(request, "replace_page_content", { page: "plan", version: 1, content: "# Plan\n\nBy an agent." });

    const read = await call(request, "read_page", { page: "plan" });
    expect(read.structuredContent).toMatchObject({ lastEditedBy: owner.name, lastEditedVia: "mcp", version: 2 });
    expect(JSON.parse(read.content[0]?.text ?? "")).toEqual(read.structuredContent);
  });

  test("a change based on a version older than an edit in the browser is refused with the user, via web and the time", async ({
    request,
  }) => {
    const bob = await createUser({ name: "bob" });
    const plan = await createPage({ folder: projects, name: "plan", content: "# Plan" });
    const { version } = (await call(request, "read_page", { page: "plan" })).structuredContent as {
      version: number;
    };
    // bob saves the page in the browser meanwhile.
    const edited = await getTestDb().page.update({
      where: { id: plan.id },
      data: { content: "# Plan\n\nBy bob.", version: { increment: 1 }, lastEditedById: bob.id, lastEditedVia: "web" },
    });

    const refused = await write(request, "replace_page_content", { page: "plan", version, content: "# Mine" });

    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain(
      `The page was changed by bob via web at ${edited.updatedAt.toISOString()}, after the version`,
    );
    expect(await storedPages()).toMatchObject([{ content: "# Plan\n\nBy bob.", version: 2 }]);
  });

  // The stored content based on an older version is refused like every other change.
  test("replace_page_content with the stored content based on an older version is refused as a changed page", async ({
    request,
  }) => {
    const bob = await createUser({ name: "bob" });
    await createPage({ folder: projects, name: "plan", content: "# Plan\n\nBy bob.", editor: bob, version: 3 });
    const before = await storedPages();

    const refused = await write(request, "replace_page_content", {
      page: "plan",
      version: 2,
      content: "# Plan\n\nBy bob.",
    });

    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain("The page was changed by bob via web at ");
    expect(await storedPages()).toEqual(before);
  });

  // The limits in force are checked also for the stored content.
  test("replace_page_content with stored content over the length limit is refused and the page stays as it was", async ({
    request,
  }) => {
    const bob = await createUser({ name: "bob" });
    const content = `# Plan\n\n${"x".repeat(CONTENT_MAX_LENGTH)}`;
    const plan = await createPage({
      folder: projects,
      name: "plan",
      content,
      editor: bob,
      updatedAt: new Date("2026-01-01T10:00:00Z"),
      version: 3,
    });

    const refused = await write(request, "replace_page_content", { page: "plan", version: 3, content });

    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain("The content is not valid");
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).toStrictEqual(plan);
  });

  test("after the user is lowered to Reader a write through the Writer connection is refused and the page stays as it was", async ({
    request,
  }) => {
    const bob = await createUser({ name: "bob", mustChangePassword: false });
    await createFolderRole({ folder: projects, user: bob, role: "writer" });
    await createPage({ folder: projects, name: "plan", content: "# Plan" });
    const { accessToken } = await createGrant({ owner: bob, folder: projects, role: "writer" });
    await getTestDb().folderRole.update({
      where: { folderId_userId: { folderId: projects.id, userId: bob.id } },
      data: { role: "reader" },
    });

    const response = await send(
      request,
      {
        method: "tools/call",
        params: { name: "replace_page_content", arguments: { page: "plan", version: 1, content: "# Changed" } },
      },
      accessToken,
      writerAddress,
    );

    expect(response.status()).toBe(403);
    expect(await storedPages()).toMatchObject([{ content: "# Plan", version: 1 }]);
  });

  // The stored content sent back changes nothing and returns the version stated.
  test("replace_page_content with the stored content keeps the last change and the version; a change on that version is stored", async ({
    request,
  }) => {
    const bob = await createUser({ name: "bob" });
    const updatedAt = new Date("2026-01-01T10:00:00Z");
    await createPage({ folder: projects, name: "plan", content: "# Plan\n\nBy bob.", editor: bob, updatedAt });
    const read = (await call(request, "read_page", { page: "plan" })).structuredContent as {
      content: string;
      version: number;
    };

    const same = await write(request, "replace_page_content", {
      page: "plan",
      version: read.version,
      content: read.content,
    });

    expect(same.isError).toBeFalsy();
    expect(same.structuredContent).toEqual({
      note: USER_TEXT_NOTE,
      name: "plan",
      title: "Plan",
      tab: null,
      address: `${ISSUER}/folders/projects/plan.md`,
      wikiLink: "[[plan]]",
      version: read.version,
    });
    await expect(call(request, "read_page", { page: "plan" })).resolves.toMatchObject({
      structuredContent: {
        lastEditedBy: "bob",
        lastEditedVia: "web",
        lastChanged: updatedAt.toISOString(),
        version: read.version,
      },
    });
    expect(await getTestDb().page.findFirstOrThrow({ where: { folderId: projects.id, name: "plan" } })).toMatchObject({
      lastEditedById: bob.id,
      lastEditedVia: "web",
      updatedAt,
    });

    const changed = await write(request, "replace_page_content", {
      page: "plan",
      version: read.version,
      content: "# Plan\n\nBy an agent.",
    });
    expect(changed.structuredContent).toMatchObject({ version: read.version + 1 });
    expect(await storedPages()).toMatchObject([{ content: "# Plan\n\nBy an agent.", version: read.version + 1 }]);
  });

  test.describe("in the browser", () => {
    // The browser is logged in as the Owner of "projects", whose connection the tests use.
    test.beforeEach(async ({ page }) => {
      await logIn(page, owner.name);
      await expect(page).toHaveURL("/folders");
    });

    // That a page changed through MCP names the user and the channel mcp, and no app, is shown in mcp-edit.spec.ts.
    test("a write through MCP while the editor is open refuses the save in the browser once, and both are in the history", async ({
      page,
      request,
    }) => {
      const bob = await createUser({ name: "bob", mustChangePassword: false });
      await createFolderRole({ folder: projects, user: bob, role: "writer" });
      const { accessToken } = await createGrant({ owner: bob, folder: projects, role: "writer" });
      const bobsConnection = { address: mcpPath(projects, "writer"), token: accessToken };
      await createPage({ folder: projects, name: "plan", content: "# Plan\n\nFirst draft", editor: bob });

      await page.goto("/folders/projects/plan.md?action=edit");
      await fillContent(page, "# Plan\n\nBy the owner.");
      const written = await callTool(request, bobsConnection, "replace_page_content", {
        page: "plan",
        version: 1,
        content: "# Plan\n\nBy an agent.",
      });
      expect(written.isError).toBeFalsy();
      await page.getByRole("button", { name: "Save" }).click();

      await expect(page).toHaveURL("/folders/projects/plan.md?action=edit&notice=changed");
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        /^This page was changed by bob via mcp at .+ after you opened it\.$/,
      );
      await expectContent(page, "# Plan\n\nBy an agent.");

      await fillContent(page, "# Plan\n\nBy the owner.");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page).toHaveURL("/folders/projects/plan.md");

      await page.goto("/folders/projects/plan.md?view=history");
      await expect(page.getByRole("list", { name: "Revisions" }).getByRole("link")).toHaveText([
        new RegExp(`^Revision 3.+ by ${owner.name} via web · Plan$`),
        /^Revision 2.+ by bob via mcp · Plan$/,
        /^Revision 1.+ by bob via web · Plan$/,
      ]);
      expect(await storedPages()).toMatchObject([{ content: "# Plan\n\nBy the owner.", version: 3 }]);
    });
  });
});
