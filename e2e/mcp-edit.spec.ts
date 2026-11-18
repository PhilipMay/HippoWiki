// The MCP tool edit_page_content of a Writer connection: exact texts of a page replaced in one call, stored as one
// change and one revision or not at all, against the real database, and what the browser shows of such a change.
import type { APIRequestContext } from "@playwright/test";

import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";

import { KNOWN_USER } from "../prisma/known-users";
import { NO_STORAGE_STATE, USER_STORAGE_STATE } from "./support/auth";
import { createFolderRole, createGrant, createPage, createUser, getTestDb } from "./support/database";
import { call, mcpPath, send, setUpProjects } from "./support/mcp";
import { ISSUER } from "./support/oauth";
import { expect, test } from "./support/test";

// An MCP client has no session cookie: it only has the access token of its grant.
test.use({ storageState: NO_STORAGE_STATE });

/** The content of the page "plan" that the tests edit. */
const PLAN = "# Plan\n\nThe release is on 2026-03-01.\n\n- one\n- two\n- three\n";

/** The message of a change based on an older version, or on none, as replace_page_content gives it too. */
const CHANGED = /^The page was changed by bob via web at .+, after the version this change is based on/;

let projects: Awaited<ReturnType<typeof setUpProjects>>["projects"];
/** The access token of a Writer connection of the known user to "projects", and its address. */
let writer: string;
let writerAddress: string;
/** The page "plan", last changed by bob in the browser, with one revision. */
let bob: Awaited<ReturnType<typeof createUser>>;

test.beforeEach(async () => {
  ({ projects } = await setUpProjects());
  ({ accessToken: writer } = await createGrant({ owner: KNOWN_USER, folder: projects, role: "writer" }));
  writerAddress = mcpPath(projects, "writer");
  bob = await createUser({ name: "bob" });
  await createPage({ folder: projects, name: "plan", content: PLAN, editor: bob });
});

/** Calls edit_page_content, or another tool, at the Writer address. */
function write(request: APIRequestContext, args: Record<string, unknown>, name = "edit_page_content") {
  return call(request, name, args, writer, writerAddress);
}

/** The page "plan" as stored, with what a write changes. */
async function storedPlan() {
  return getTestDb().page.findFirstOrThrow({
    where: { folderId: projects.id, name: "plan" },
    select: { title: true, content: true, version: true, lastEditedById: true, lastEditedVia: true, updatedAt: true },
  });
}

/** The revisions of "plan" as stored, by number. */
async function storedRevisions() {
  return getTestDb().pageRevision.findMany({
    where: { page: { folderId: projects.id, name: "plan" } },
    orderBy: { number: "asc" },
    select: { number: true, content: true, userId: true, via: true },
  });
}

/** Expects the call to be a tool error that contains each part, and returns its message. */
function expectError(result: Awaited<ReturnType<typeof write>>, ...parts: string[]): string {
  expect(result.isError).toBe(true);
  const message = result.content[0]?.text ?? "";
  for (const part of parts) expect(message).toContain(part);
  return message;
}

test("one replacement of a date changes only that date and adds one revision by the user via mcp", async ({
  request,
}) => {
  const result = await write(request, {
    page: "plan",
    version: 1,
    edits: [{ oldText: "2026-03-01", newText: "2026-04-15" }],
  });

  expect(result.isError).toBeUndefined();
  expect(result.structuredContent).toStrictEqual({
    name: "plan",
    title: "Plan",
    tab: null,
    address: `${ISSUER}/folders/projects/plan.md`,
    version: 2,
    replaced: [1],
  });
  const edited = PLAN.replace("2026-03-01", "2026-04-15");
  expect(await storedPlan()).toMatchObject({
    content: edited,
    version: 2,
    lastEditedById: KNOWN_USER.id,
    lastEditedVia: "mcp",
  });
  expect(await storedRevisions()).toEqual([
    { number: 1, content: PLAN, userId: bob.id, via: "web" },
    { number: 2, content: edited, userId: KNOWN_USER.id, via: "mcp" },
  ]);
});

test("three replacements in one call change three places and add one revision", async ({ request }) => {
  const result = await write(request, {
    page: "plan",
    version: 1,
    edits: [
      { oldText: "- one", newText: "- first" },
      { oldText: "- two", newText: "- second" },
      { oldText: "- three", newText: "- third" },
    ],
  });

  expect(result.structuredContent).toMatchObject({ version: 2, replaced: [1, 1, 1] });
  expect(await storedPlan()).toMatchObject({
    content: "# Plan\n\nThe release is on 2026-03-01.\n\n- first\n- second\n- third\n",
    version: 2,
  });
  expect(await storedRevisions()).toHaveLength(2);
});

test("a call with one matching and one missing replacement leaves the page, its version and its history as they were", async ({
  request,
}) => {
  const before = await storedPlan();

  const result = await write(request, {
    page: "plan",
    version: 1,
    edits: [
      { oldText: "- one", newText: "- first" },
      { oldText: "- four", newText: "- fourth" },
    ],
  });

  expectError(result, 'Replacement 2 (oldText "- four") was not found', "Read the page again with read_page");
  expect(await storedPlan()).toEqual(before);
  expect(await storedRevisions()).toHaveLength(1);
});

test("a text that appears twice is refused with the number 2; with replaceAll both places change", async ({
  request,
}) => {
  await getTestDb().page.updateMany({
    where: { name: "plan" },
    data: { content: "# Plan\n\nAsk Ann, then ask Ann again.\n" },
  });

  const refused = await write(request, { page: "plan", version: 1, edits: [{ oldText: "Ann", newText: "Bea" }] });
  const all = await write(request, {
    page: "plan",
    version: 1,
    edits: [{ oldText: "Ann", newText: "Bea", replaceAll: true }],
  });

  expectError(refused, 'Replacement 1 (oldText "Ann") was found 2 times', "set replaceAll");
  expect(all.structuredContent).toMatchObject({ version: 2, replaced: [2] });
  expect(await storedPlan()).toMatchObject({ content: "# Plan\n\nAsk Bea, then ask Bea again.\n", version: 2 });
});

test("a text sent with CRLF line breaks matches; a text that differs only in case is not found", async ({
  request,
}) => {
  const crlf = await write(request, {
    page: "plan",
    version: 1,
    edits: [{ oldText: "- one\r\n- two", newText: "- one\r\n- one and a half\r\n- two" }],
  });
  const upper = await write(request, {
    page: "plan",
    version: 2,
    edits: [{ oldText: "the release", newText: "Our release" }],
  });

  expect(crlf.structuredContent).toMatchObject({ version: 2, replaced: [1] });
  expectError(upper, 'Replacement 1 (oldText "the release") was not found');
  expect(await storedPlan()).toMatchObject({
    content: "# Plan\n\nThe release is on 2026-03-01.\n\n- one\n- one and a half\n- two\n- three\n",
    version: 2,
  });
});

test("a replacement that removes the title heading or passes the length limit changes nothing; one in the heading changes the title", async ({
  request,
}) => {
  const before = await storedPlan();

  const noTitle = await write(request, { page: "plan", version: 1, edits: [{ oldText: "# Plan\n\n", newText: "" }] });
  const tooLong = await write(request, {
    page: "plan",
    version: 1,
    edits: [{ oldText: "- two", newText: "x".repeat(CONTENT_MAX_LENGTH) }],
  });

  expectError(noTitle, "The content must start with a title heading", "Nothing was changed.");
  expectError(tooLong, "would make the content longer than 100,000 characters", "nothing was changed");
  expect(await storedPlan()).toEqual(before);
  expect(await storedRevisions()).toHaveLength(1);

  const renamed = await write(request, {
    page: "plan",
    version: 1,
    edits: [{ oldText: "# Plan", newText: "# Roadmap" }],
  });

  expect(renamed.structuredContent).toMatchObject({ name: "plan", title: "Roadmap", version: 2 });
  expect(await storedPlan()).toMatchObject({ title: "Roadmap", version: 2 });
});

test("a call based on an older version or on none is refused with the message of a full replacement; a text a browser change removed gets the version error", async ({
  request,
}) => {
  const edits = [{ oldText: "- two", newText: "- second" }];
  await getTestDb().page.updateMany({
    where: { name: "plan" },
    data: { content: PLAN.replace("- two\n", ""), version: 2, lastEditedById: bob.id, lastEditedVia: "web" },
  });
  const before = await storedPlan();

  const older = await write(request, { page: "plan", version: 1, edits });
  const none = await write(request, { page: "plan", edits });
  const full = await write(request, { page: "plan", version: 1, content: "# Plan" }, "replace_page_content");

  const message = expectError(older);
  expect(message).toMatch(CHANGED);
  expect(message).toContain(`at ${before.updatedAt.toISOString()}`);
  expect(expectError(none)).toBe(message);
  expect(expectError(full)).toBe(message);
  expect(await storedPlan()).toEqual(before);
});

test("two replacements that cancel each other out keep the version and add no revision", async ({ request }) => {
  const before = await storedPlan();

  const result = await write(request, {
    page: "plan",
    version: 1,
    edits: [
      { oldText: "2026-03-01", newText: "2026-04-15" },
      { oldText: "2026-04-15", newText: "2026-03-01" },
    ],
  });

  expect(result.structuredContent).toMatchObject({ version: 1, replaced: [1, 1] });
  expect(await storedPlan()).toEqual(before);
  expect(await storedRevisions()).toHaveLength(1);
});

test("an unknown page and a deleted page are refused with the error that points to list_folder", async ({
  request,
}) => {
  await createPage({ folder: projects, name: "removed", content: "# Removed\n\nText", deletedAt: new Date() });

  for (const page of ["nowhere", "removed"]) {
    const result = await write(request, { page, version: 1, edits: [{ oldText: "Text", newText: "Other" }] });

    expectError(result, `There is no page named "${page}"`, "Use list_folder to see the pages of the folder");
  }
  expect(await getTestDb().page.findFirstOrThrow({ where: { name: "removed" } })).toMatchObject({
    content: "# Removed\n\nText",
  });
});

test("a Reader connection does not list the tool and its call changes nothing; a Writer connection of a user lowered to Reader is refused", async ({
  request,
}) => {
  const before = await storedPlan();
  const args = { page: "plan", version: 1, edits: [{ oldText: "- one", newText: "- first" }] };

  const listed = (await (await send(request, { method: "tools/list" })).json()) as {
    result: { tools: { name: string }[] };
  };
  const reader = await send(request, { method: "tools/call", params: { name: "edit_page_content", arguments: args } });

  expect(listed.result.tools.map((tool) => tool.name)).not.toContain("edit_page_content");
  expect(await reader.json()).toMatchObject({ error: { code: -32602, message: "Tool edit_page_content not found" } });

  const carol = await createUser({ name: "carol", mustChangePassword: false });
  await createFolderRole({ folder: projects, user: carol, role: "writer" });
  const { accessToken } = await createGrant({ owner: carol, folder: projects, role: "writer" });
  await getTestDb().folderRole.update({
    where: { folderId_userId: { folderId: projects.id, userId: carol.id } },
    data: { role: "reader" },
  });

  const lowered = await send(
    request,
    { method: "tools/call", params: { name: "edit_page_content", arguments: args } },
    accessToken,
    writerAddress,
  );

  expect(lowered.status()).toBe(403);
  expect(await storedPlan()).toEqual(before);
});

test.describe("in the browser", () => {
  test.use({ storageState: USER_STORAGE_STATE });

  test("a page edited through MCP names the user via mcp, and reverting to the revision before restores its content", async ({
    page,
    request,
  }) => {
    await write(request, { page: "plan", version: 1, edits: [{ oldText: "2026-03-01", newText: "2026-04-15" }] });

    await page.goto("/folders/projects/plan.md");
    await expect(page.getByText(/^Last updated /)).toHaveText(new RegExp(`by ${KNOWN_USER.name} via mcp$`));
    await expect(page.getByRole("article")).toContainText("The release is on 2026-04-15.");

    await page.goto("/folders/projects/plan.md?view=history");
    await expect(page.getByRole("list", { name: "Revisions" }).getByRole("link")).toHaveText([
      new RegExp(`^Revision 2.+ by ${KNOWN_USER.name} via mcp · Plan$`),
      /^Revision 1.+ by bob via web · Plan$/,
    ]);

    await page.goto("/folders/projects/plan.md?view=revision&revision=1");
    await page.getByRole("link", { name: "Revert" }).click();
    await page.getByRole("dialog", { name: "Revert page" }).getByRole("button", { name: "Revert" }).click();

    await expect(page).toHaveURL("/folders/projects/plan.md");
    await expect(page.getByRole("article")).toContainText("The release is on 2026-03-01.");
    expect(await storedPlan()).toMatchObject({ content: PLAN, version: 3, lastEditedVia: "web" });
  });
});
