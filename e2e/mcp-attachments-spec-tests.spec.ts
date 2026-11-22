// Tests of MCP written from the requirements of attachments alone (`spec/attachments-requirements.md`), for the rules
// or the parts of rules that the other specs of MCP leave open: the tools of pages, given the names of files, change
// no file, and the files of a tab deleted through `delete_tab` are restored in the browser with their versions.
import type { APIRequestContext } from "@playwright/test";

import { logIn, NO_STORAGE_STATE } from "./support/auth";
import { createFile, createGrant, createPage, createTab, getTestDb } from "./support/database";
import { call, mcpPath, setUpProjects, type ToolResult } from "./support/mcp";
import { expect, test } from "./support/test";

// An MCP client has no session cookie: it only has the access token of its grant.
test.use({ storageState: NO_STORAGE_STATE });

let projects: Awaited<ReturnType<typeof setUpProjects>>["projects"];
let owner: Awaited<ReturnType<typeof setUpProjects>>["owner"];
/** The access token of a Manager connection of the Owner of "projects", the role that may do the most. */
let manager: string;

test.beforeEach(async () => {
  ({ projects, owner } = await setUpProjects());
  ({ accessToken: manager } = await createGrant({ owner, folder: projects, role: "manager" }));
});

/** Calls a tool at the Manager address of "projects". */
function manage(request: APIRequestContext, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return call(request, name, args, manager, mcpPath(projects, "manager"));
}

/** Every file and file version of the database, to compare a whole state before and after the calls. */
async function allFiles() {
  const db = getTestDb();
  return {
    files: await db.file.findMany({ orderBy: { id: "asc" } }),
    versions: await db.fileVersion.findMany({ orderBy: { id: "asc" } }),
  };
}

// attachments-requirements.md, "MCP" (R6): no tool of any connection uploads, changes, moves, renames or deletes a
// single file, also not a tool of pages that is given the name of a file.
test("the tools of pages, given the name of a file, change no file and create none", async ({ request }) => {
  const guides = await createTab({ folder: projects, name: "guides" });
  await createFile({ tab: guides, name: "diagram.png", versions: [{}, {}] });
  await createFile({ folder: projects, name: "report.pdf" });
  await createPage({ tab: guides, name: "setup", content: "# Setup" });
  const before = await allFiles();

  const calls: [string, Record<string, unknown>][] = [];
  for (const [tab, page] of [
    ["guides", "diagram.png"],
    ["guides", "diagram"],
    [null, "report.pdf"],
    [null, "report"],
  ] as const) {
    calls.push(
      ["read_page", { tab, page }],
      ["replace_page_content", { tab, page, version: 1, content: "# Replaced" }],
      ["edit_page_content", { tab, page, version: 1, edits: [{ oldText: "PNG", newText: "GIF" }] }],
      ["move_or_rename_page", { tab, page, version: 1, newTab: null, newName: "moved" }],
      ["delete_page", { tab, page, version: 1 }],
    );
  }
  calls.push(
    ["create_page", { name: "diagram.png", tab: "guides", content: "# Diagram" }],
    ["create_page", { name: "new.pdf", content: "# New" }],
    ["move_or_rename_page", { tab: "guides", page: "setup", version: 1, newTab: "guides", newName: "diagram.png" }],
  );

  for (const [name, args] of calls) {
    const result = await manage(request, name, args);
    expect(result.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
  }

  expect(await allFiles()).toEqual(before);
  expect(await getTestDb().page.findMany({ select: { name: true, deletedAt: true } })).toEqual([
    { name: "setup", deletedAt: null },
  ]);
});

// attachments-requirements.md, "Deleting and restoring" (R20): after `delete_tab` of a Manager connection the files of
// the tab are among the deleted items of the folder, and a Manager or an Owner restores each with its versions.
test("the files of a tab deleted through delete_tab are listed under Deleted items and restored with their versions", async ({
  page,
  request,
}) => {
  const guides = await createTab({ folder: projects, name: "guides" });
  const diagram = await createFile({ tab: guides, name: "diagram.png", versions: [{}, {}] });
  await createFile({ tab: guides, name: "report.pdf" });

  const result = await manage(request, "delete_tab", { tab: "guides" });
  expect(result.isError).toBeFalsy();

  await logIn(page, owner.name);
  await expect(page).toHaveURL("/folders");
  await page.goto(`/deleted-items/${projects.name}`);
  const rows = page
    .getByRole("table", { name: "Deleted items" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });
  await expect(rows).toHaveCount(2);
  const kinds = await Promise.all(
    (await rows.all()).map(async (row) => (await row.getByRole("cell").allTextContents()).slice(0, 2).join(" ")),
  );
  expect(kinds.sort()).toEqual(["diagram.png File", "report.pdf File"]);

  await page.goto(`/deleted-items/${projects.name}/${diagram.id}?action=restore`);
  const dialog = page.getByRole("dialog", { name: "Restore file" });
  await expect(dialog.getByLabel("Name")).toHaveValue("diagram.png");
  await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(`/folders/${projects.name}/diagram.png`);
  await expect(page.getByRole("table", { name: "Versions" }).getByRole("link", { name: /^Version/ })).toHaveText([
    "Version 2",
    "Version 1",
  ]);
});
