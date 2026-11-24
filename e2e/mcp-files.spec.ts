// The tools of MCP that move, rename and delete a single file: move_or_rename_file of a Writer and a Manager
// connection, with the update of the links and embeds of the file, and delete_file of a Manager connection, with the
// pages that showed or linked the file; both with optimistic locking and what the browser shows of the change. The tools that read files are in `mcp-read.spec.ts`, the upload links in `file-upload-links.spec.ts`.
import type { APIRequestContext } from "@playwright/test";

import { USER_TEXT_NOTE } from "@/features/mcp/tool-schemas";

import { logIn, NO_STORAGE_STATE } from "./support/auth";
import { createFile, createGrant, createPage, createTab, getTestDb } from "./support/database";
import { pngBytes, uploadFile } from "./support/files";
import { call, mcpPath, send, setUpProjects, type ToolResult } from "./support/mcp";
import { ISSUER } from "./support/oauth";
import { expect, test } from "./support/test";

// An MCP client has no session cookie: it only has the access token of its grant.
test.use({ storageState: NO_STORAGE_STATE });

let projects: Awaited<ReturnType<typeof setUpProjects>>["projects"];
let owner: Awaited<ReturnType<typeof setUpProjects>>["owner"];
/** The access token of the Reader connection of the Owner of "projects", and its address. */
let reader: string;
let readerAddress: string;
/** The access tokens of a Writer and a Manager connection of the Owner of "projects". */
let writer: string;
let manager: string;

test.beforeEach(async () => {
  ({ projects, owner, secret: reader, address: readerAddress } = await setUpProjects());
  ({ accessToken: writer } = await createGrant({ owner, folder: projects, role: "writer" }));
  ({ accessToken: manager } = await createGrant({ owner, folder: projects, role: "manager" }));
});

/** Calls a tool at the Writer address of "projects". */
function write(request: APIRequestContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return call(request, name, args, writer, mcpPath(projects, "writer"));
}

/** Calls a tool at the Manager address of "projects". */
function manage(request: APIRequestContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return call(request, name, args, manager, mcpPath(projects, "manager"));
}

/** The message of a tool error; fails the test if the call worked. */
function errorOf(result: ToolResult): string {
  expect(result.isError, JSON.stringify(result.structuredContent)).toBe(true);
  return result.content[0]?.text ?? "";
}

/** The files of "projects" as stored, by id, with what a move or a delete changes. */
async function storedFiles() {
  return getTestDb().file.findMany({
    where: { folderId: projects.id },
    orderBy: { id: "asc" },
    select: { name: true, tabId: true, lockVersion: true, deletedAt: true, lastEditedVia: true },
  });
}

test.describe("move_or_rename_file", () => {
  test("moves setup.png from the folder into the tab guides as setup-v2.png, and the old name and place are gone", async ({
    request,
  }) => {
    await createTab({ folder: projects, name: "guides" });
    const file = await createFile({ folder: projects, name: "setup.png", editor: owner });

    const moved = await write(request, "move_or_rename_file", {
      file: "setup.png",
      lockVersion: file.lockVersion,
      newTab: "guides",
      newName: "setup-v2.png",
    });

    expect(moved.isError).toBeFalsy();
    expect(moved.structuredContent).toEqual({
      note: USER_TEXT_NOTE,
      name: "setup-v2.png",
      tab: "guides",
      type: "png",
      address: expect.stringMatching(/\/files\/projects\/guides\/setup-v2\.png$/),
      detailsAddress: expect.stringMatching(/\/folders\/projects\/guides\/setup-v2\.png$/),
      wikiLink: "[[guides/setup-v2.png]]",
      embedLink: "![[guides/setup-v2.png]]",
      lockVersion: file.lockVersion + 1,
      updatedPages: [],
    });
    const listed = (await write(request, "list_folder", {})).structuredContent as { files: { name: string }[] };
    expect(listed.files).toMatchObject([{ name: "setup-v2.png", tab: "guides" }]);
    const read = await write(request, "read_file", { tab: "guides", file: "setup-v2.png" });
    expect(read.structuredContent).toMatchObject({ name: "setup-v2.png", tab: "guides", versions: 1 });
    expect(errorOf(await write(request, "read_file", { file: "setup.png" }))).toContain(
      'There is no file named "setup.png"',
    );
  });

  test("changes the embeds and links of the file in the pages of the folder and names those pages", async ({
    request,
  }) => {
    await createTab({ folder: projects, name: "guides" });
    const file = await createFile({ folder: projects, name: "setup.png", editor: owner });
    const page = await createPage({
      folder: projects,
      name: "network",
      content: "# Network\n\n![[setup.png]] and [[setup.png|label]]",
      editor: owner,
    });

    const moved = await write(request, "move_or_rename_file", {
      file: "setup.png",
      lockVersion: file.lockVersion,
      newTab: "guides",
      newName: "setup-v2.png",
    });

    expect(moved.structuredContent).toMatchObject({
      updatedPages: [{ name: "network", tab: null, title: "Network" }],
    });
    const stored = await getTestDb().page.findUniqueOrThrow({ where: { id: page.id } });
    expect(stored.content).toBe("# Network\n\n![[guides/setup-v2.png]] and [[guides/setup-v2.png|label]]");
    expect(stored).toMatchObject({ lastEditedById: owner.id, lastEditedVia: "mcp" });
  });

  test("refuses an unknown file, a page, a deleted file, a wrong extension, a broken name, a taken name and an unknown tab, and changes nothing", async ({
    request,
  }) => {
    const guides = await createTab({ folder: projects, name: "guides" });
    const file = await createFile({ folder: projects, name: "setup.png", editor: owner });
    await createFile({ tab: guides, name: "setup-v2.png", editor: owner });
    await createFile({ folder: projects, name: "old.png", editor: owner, deletedAt: new Date() });
    await createPage({ folder: projects, name: "setup", content: "# Setup", editor: owner });
    const before = await storedFiles();
    const move = (args: Record<string, unknown>) =>
      write(request, "move_or_rename_file", {
        file: "setup.png",
        lockVersion: file.lockVersion,
        newTab: null,
        newName: "setup.png",
        ...args,
      });

    for (const name of ["missing.png", "setup", "old.png"]) {
      expect(errorOf(await move({ file: name })), name).toContain("Use list_folder to see the files of the folder");
    }
    for (const newName of ["setup.jpg", "setup"]) {
      expect(errorOf(await move({ newName })), newName).toContain("The name must end in .png");
    }
    expect(errorOf(await move({ newName: "Setup.png" }))).toContain(
      "A file name is lowercase letters, digits and single hyphens",
    );
    expect(errorOf(await move({ newTab: "guides", newName: "setup-v2.png" }))).toContain(
      'A file named "setup-v2.png" already exists in the tab "guides" of the folder "projects"',
    );
    const writerTab = errorOf(await move({ newTab: "archive" }));
    expect(writerTab).toContain('There is no tab named "archive"');
    expect(writerTab).toContain("tabs are created in the browser");
    const managerTab = errorOf(
      await manage(request, "move_or_rename_file", {
        file: "setup.png",
        lockVersion: file.lockVersion,
        newTab: "archive",
        newName: "setup.png",
      }),
    );
    expect(managerTab).toContain("create the tab with create_tab");

    expect(await storedFiles()).toEqual(before);
  });

  test("refuses a move based on the lock version before a new version in the browser, and keeps the file", async ({
    page,
    request,
  }) => {
    const file = await createFile({ folder: projects, name: "setup.png", editor: owner });
    await logIn(page, owner.name);
    await expect(page).toHaveURL("/folders");
    const upload = await uploadFile(page, {
      folder: "projects",
      name: "setup.png",
      bytes: await pngBytes(50, 50),
      replace: file.lockVersion,
    });
    expect(upload.ok()).toBe(true);

    const message = errorOf(
      await write(request, "move_or_rename_file", {
        file: "setup.png",
        lockVersion: file.lockVersion,
        newTab: null,
        newName: "network.png",
      }),
    );

    expect(message).toContain(`The file was changed by ${owner.name} via web at`);
    expect(message).toContain("Read it again with read_file and base the move on its current lockVersion.");
    expect(await storedFiles()).toMatchObject([{ name: "setup.png", tabId: null, lockVersion: file.lockVersion + 1 }]);
  });

  test("a move to the current name and place succeeds with the same lock version and no updated page", async ({
    request,
  }) => {
    const guides = await createTab({ folder: projects, name: "guides" });
    const file = await createFile({ tab: guides, name: "setup.png", editor: owner });
    await createPage({ folder: projects, name: "network", content: "# Network\n\n![[guides/setup.png]]" });
    const pages = await getTestDb().page.findMany();

    const moved = await write(request, "move_or_rename_file", {
      tab: "guides",
      file: "setup.png",
      lockVersion: file.lockVersion,
      newTab: "guides",
      newName: "setup.png",
    });

    expect(moved.isError).toBeFalsy();
    expect(moved.structuredContent).toMatchObject({ lockVersion: file.lockVersion, updatedPages: [] });
    expect(await getTestDb().page.findMany()).toEqual(pages);
  });

  test("a call at the Reader address changes nothing", async ({ request }) => {
    const file = await createFile({ folder: projects, name: "setup.png", editor: owner });
    const before = await storedFiles();

    const answer = await send(
      request,
      {
        method: "tools/call",
        params: {
          name: "move_or_rename_file",
          arguments: { file: "setup.png", lockVersion: file.lockVersion, newTab: null, newName: "network.png" },
        },
      },
      reader,
      readerAddress,
    );

    expect(await answer.json()).toMatchObject({
      error: { code: -32602, message: "Tool move_or_rename_file not found" },
    });
    expect(await storedFiles()).toEqual(before);
  });

  test("the details page of a file moved through MCP shows the last change by the user via mcp", async ({
    page,
    request,
  }) => {
    const file = await createFile({ folder: projects, name: "setup.png" });

    const moved = await write(request, "move_or_rename_file", {
      file: "setup.png",
      lockVersion: file.lockVersion,
      newTab: null,
      newName: "network.png",
    });
    expect(moved.isError).toBeFalsy();

    await logIn(page, owner.name);
    await expect(page).toHaveURL("/folders");
    await page.goto("/folders/projects/network.png");
    const lastChange = page.getByRole("table", { name: "Details" }).getByRole("row", { name: /Last change/ });
    await expect(lastChange.getByRole("cell")).toHaveText(new RegExp(` by ${owner.name} via mcp$`));
  });
});

test.describe("delete_file", () => {
  test("deletes guides/setup.png, which the page guides/setup shows, names that page, and the file is gone everywhere", async ({
    page,
    request,
  }) => {
    const guides = await createTab({ folder: projects, name: "guides" });
    const file = await createFile({ tab: guides, name: "setup.png", editor: owner });
    await createPage({ tab: guides, name: "setup", content: "# Setup\n\n![[guides/setup.png]]", editor: owner });

    const deleted = await manage(request, "delete_file", {
      tab: "guides",
      file: "setup.png",
      lockVersion: file.lockVersion,
    });

    expect(deleted.isError).toBeFalsy();
    expect(deleted.structuredContent).toEqual({
      note: USER_TEXT_NOTE,
      name: "setup.png",
      type: "png",
      tab: "guides",
      deletedItemsAddress: `${ISSUER}/deleted-items/projects`,
      restore: expect.stringMatching(
        /restored with all its versions by a Manager or Owner of the folder in the browser/,
      ),
      shownOrLinkedFrom: [{ name: "setup", tab: "guides", title: "Setup" }],
    });
    const listed = (await manage(request, "list_folder", {})).structuredContent as { files: unknown[] };
    expect(listed.files).toEqual([]);
    expect(errorOf(await manage(request, "read_file", { tab: "guides", file: "setup.png" }))).toContain(
      "Use list_folder to see the files of the folder",
    );
    const searched = (await manage(request, "search_pages", { query: "setup" })).structuredContent as {
      files: unknown[];
    };
    expect(searched.files).toEqual([]);
    expect(await getTestDb().file.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
      deletedAt: expect.any(Date),
      lastEditedById: owner.id,
      lastEditedVia: "mcp",
    });

    await logIn(page, owner.name);
    await expect(page).toHaveURL("/folders");
    await page.goto("/folders/projects/guides/setup.md");
    await expect(page.getByRole("article").getByText("guides/setup.png")).toHaveAccessibleDescription(
      "File does not exist",
    );
    await expect(page.getByRole("article").getByRole("img")).toHaveCount(0);
  });

  test("deleting a file that no page uses gives an empty list", async ({ request }) => {
    const file = await createFile({ folder: projects, name: "manual.pdf", editor: owner });
    await createPage({ folder: projects, name: "plan", content: "# Plan\n\n[[other.pdf]]", editor: owner });

    const deleted = await manage(request, "delete_file", { file: "manual.pdf", lockVersion: file.lockVersion });

    expect(deleted.structuredContent).toMatchObject({
      name: "manual.pdf",
      type: "pdf",
      tab: null,
      shownOrLinkedFrom: [],
    });
  });

  test("refuses a delete based on the lock version before a rename in the browser, and an unknown or deleted file", async ({
    page,
    request,
  }) => {
    const file = await createFile({ folder: projects, name: "setup.png", editor: owner });
    await createFile({ folder: projects, name: "old.png", editor: owner, deletedAt: new Date() });
    await logIn(page, owner.name);
    await expect(page).toHaveURL("/folders");
    await page.goto("/folders/projects/setup.png?action=move-or-rename");
    const dialog = page.getByRole("dialog", { name: "Move or rename file" });
    await dialog.getByLabel("Name").fill("network.png");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/projects/network.png");
    const before = await storedFiles();

    const changed = errorOf(
      await manage(request, "delete_file", { file: "network.png", lockVersion: file.lockVersion }),
    );
    expect(changed).toContain(`The file was changed by ${owner.name} via web at`);
    expect(changed).toContain("Nothing was deleted.");
    for (const name of ["setup.png", "old.png", "missing.png"]) {
      expect(errorOf(await manage(request, "delete_file", { file: name, lockVersion: 1 })), name).toContain(
        "Use list_folder to see the files of the folder",
      );
    }

    expect(await storedFiles()).toEqual(before);
    expect(before).toContainEqual(expect.objectContaining({ name: "network.png", deletedAt: null }));
  });

  test("changes nothing after the user's role was lowered to Writer, and at the Writer and the Reader address", async ({
    request,
  }) => {
    const file = await createFile({ folder: projects, name: "setup.png", editor: owner });
    const before = await storedFiles();
    const args = { file: "setup.png", lockVersion: file.lockVersion };

    await getTestDb().folderRole.updateMany({
      where: { folderId: projects.id, userId: owner.id },
      data: { role: "writer" },
    });
    // The Manager address of a user who is a Writer now answers 403 and runs no tool; a role lowered between the
    // request and the delete is the tool error of the role, which tools.test.ts shows.
    const lowered = await send(
      request,
      { method: "tools/call", params: { name: "delete_file", arguments: args } },
      manager,
      mcpPath(projects, "manager"),
    );
    expect(lowered.status()).toBe(403);
    expect(await storedFiles()).toEqual(before);
    await getTestDb().folderRole.updateMany({
      where: { folderId: projects.id, userId: owner.id },
      data: { role: "owner" },
    });
    for (const [token, to] of [
      [writer, mcpPath(projects, "writer")],
      [reader, readerAddress],
    ] as const) {
      const answer = await send(
        request,
        { method: "tools/call", params: { name: "delete_file", arguments: args } },
        token,
        to,
      );
      expect(await answer.json(), to).toMatchObject({ error: { code: -32602, message: "Tool delete_file not found" } });
    }

    expect(await storedFiles()).toEqual(before);
  });

  test("the deleted file is listed under Deleted items by the user via mcp, and a Manager restores it with all its versions", async ({
    page,
    request,
  }) => {
    const guides = await createTab({ folder: projects, name: "guides" });
    const file = await createFile({ tab: guides, name: "setup.png", versions: [{}, {}] });

    const deleted = await manage(request, "delete_file", {
      tab: "guides",
      file: "setup.png",
      lockVersion: file.lockVersion,
    });
    expect(deleted.isError).toBeFalsy();

    await logIn(page, owner.name);
    await expect(page).toHaveURL("/folders");
    await page.goto("/deleted-items/projects");
    const rows = page
      .getByRole("table", { name: "Deleted items" })
      .getByRole("row")
      .filter({ has: page.getByRole("cell") });
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0).getByRole("cell").nth(0)).toHaveText("setup.png");
    await expect(rows.nth(0).getByRole("cell").nth(4)).toHaveText(owner.name);
    await expect(rows.nth(0).getByRole("cell").nth(5)).toHaveText("mcp");

    await page.goto(`/deleted-items/projects/${file.id}?action=restore`);
    const dialog = page.getByRole("dialog", { name: "Restore file" });
    await expect(dialog.getByLabel("Name")).toHaveValue("setup.png");
    await dialog.getByRole("radio", { name: "Tab guides" }).check();
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/projects/guides/setup.png");
    await expect(page.getByRole("table", { name: "Versions" }).getByRole("link", { name: /^Version/ })).toHaveText([
      "Version 2",
      "Version 1",
    ]);
  });
});
