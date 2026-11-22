import type { Page as BrowserPage } from "@playwright/test";

import { VERSION_FIELD } from "@/features/pages/fields";
import { CONTENT_MAX_LENGTH, CONTENT_MAX_TABLE_CELLS } from "@/features/pages/limits";

import { KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, becomeUser, logInElsewhere } from "./support/auth";
import { by, collectErrors, expectNotFoundResponse } from "./support/browser";
import {
  createFolder,
  createFolderRole,
  createPage,
  createTab,
  createUser,
  getTestDb,
  resetTestDatabase,
} from "./support/database";
import { contentEditor, editorReady, expectContent, fillContent } from "./support/editor";
import { expect, hydrating, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

/** The links of the contents list of a folder, in display order. */
function listLinks(page: BrowserPage) {
  return page.getByRole("list", { name: "Contents" }).getByRole("link");
}

/** The "Move or rename page" dialog. */
function moveOrRenameDialog(page: BrowserPage) {
  return page.getByRole("dialog", { name: "Move or rename page" });
}

/** The logged-in user of the tests, who makes every change through the GUI. */
const USER = KNOWN_USER.name;

test("editing the content shows the new version and keeps the name", async ({ page }) => {
  const errors = collectErrors(page);
  const oldUpdatedAt = new Date("2026-01-01T10:00:00Z");
  const edited = await createPage({
    folder: handbook,
    name: "original-name",
    content: "# Original title\n\nOriginal content",
    updatedAt: oldUpdatedAt,
  });
  await createPage({ folder: handbook, name: "other-page", title: "Other page" });

  await page.goto("/folders/handbook/original-name.md");
  await page.getByRole("link", { name: "Edit" }).click();

  await expect(page).toHaveURL("/folders/handbook/original-name.md?action=edit");
  await expect(page).toHaveTitle("Edit Original title – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: "Edit page" })).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveCount(0);
  await expect(page.getByLabel("Name")).toHaveCount(0);
  await expectContent(page, "# Original title\n\nOriginal content");
  await fillContent(page, "# Edited title\n\n## New section\n\n- Changed item");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/original-name.md");
  await expect(page).toHaveTitle("Edited title – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Edited title"]);
  const article = page.getByRole("article");
  await expect(article.getByRole("heading", { level: 2, name: "New section" })).toBeVisible();
  await expect(article.getByRole("listitem")).toHaveText(["Changed item"]);
  const shownUpdatedAt = await article.locator("time").getAttribute("datetime");
  expect(new Date(shownUpdatedAt ?? "").getTime()).toBeGreaterThan(oldUpdatedAt.getTime());

  const stored = await getTestDb().page.findUniqueOrThrow({ where: { id: edited.id } });
  expect(stored).toMatchObject({
    title: "Edited title",
    name: "original-name",
    content: "# Edited title\n\n## New section\n\n- Changed item",
    folderId: handbook.id,
  });
  expect(stored.updatedAt.toISOString()).toBe(shownUpdatedAt);
  expect(await getTestDb().page.count()).toBe(2);

  await page.goto("/folders/handbook");
  await expect(listLinks(page)).toHaveText([/^Edited title/, /^Other page/]);
  await expect(listLinks(page).first()).toHaveAttribute("href", "/folders/handbook/original-name.md");
  expect(errors).toEqual([]);
});

test("the edit form starts with the cursor at the start of the content", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ folder: handbook, name: "focused", content: "# Focused page\n\nSome content" });

  // The cursor is checked by typing: a character typed right away lands at the start of the content. Each address
  // opens the editor anew with the stored content.
  async function expectCursorAtContentStart() {
    await expect(await editorReady(page)).toBeFocused();
    await page.keyboard.type("X");
    await expectContent(page, "X# Focused page\n\nSome content");
  }

  await page.goto("/folders/handbook/focused.md");
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL("/folders/handbook/focused.md?action=edit");
  await expectCursorAtContentStart();

  await page.goto("/folders/handbook/focused.md?action=edit");
  await expectCursorAtContentStart();
  expect(errors).toEqual([]);
});

test("changing the heading changes the title and the list entry, but not the name", async ({ page }) => {
  const errors = collectErrors(page);
  const edited = await createPage({ folder: handbook, name: "stable-name", content: "# Before\n\nBody" });

  await page.goto("/folders/handbook/stable-name.md?action=edit");
  await fillContent(page, "# After the *change*\n\nBody");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/stable-name.md");
  await expect(page).toHaveTitle("After the change – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["After the change"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: edited.id } })).toMatchObject({
    title: "After the change",
    name: "stable-name",
  });

  await page.goto("/folders/handbook");
  await expect(listLinks(page)).toHaveText([/^After the change/]);
  await expect(listLinks(page).first()).toHaveAttribute("href", "/folders/handbook/stable-name.md");
  expect(errors).toEqual([]);
});

// A save without a change stores nothing, not even the derived title.
test("a page stored with a different title keeps it on a save without a change and gets the derived title on its next change", async ({
  page,
}) => {
  const created = await createPage({
    folder: handbook,
    name: "stored",
    title: "Stored title",
    content: "# Heading title\n\nBody",
  });

  await page.goto("/folders/handbook/stored.md?action=edit");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/stored.md");
  await expect(page).toHaveTitle("Stored title – HippoWiki");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toStrictEqual(created);

  await page.goto("/folders/handbook/stored.md?action=edit");
  await fillContent(page, "# Heading title\n\nBody, changed");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/stored.md");
  await expect(page).toHaveTitle("Heading title – HippoWiki");
  expect((await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).title).toBe("Heading title");
});

test("removing the title heading shows an error at the content field and keeps the content", async ({ page }) => {
  const errors = collectErrors(page);
  const created = await createPage({ folder: handbook, name: "valid", title: "Valid title" });

  await page.goto("/folders/handbook/valid.md?action=edit");
  await fillContent(page, "Intro first\n\n# Valid title\n\nNew content that must not get lost");
  await page.getByRole("button", { name: "Save" }).click();

  const content = contentEditor(page);
  await expect(content).toHaveAttribute("aria-invalid", "true");
  await expect(content).toHaveAccessibleDescription("Content must start with a title heading: # Title");
  await expect(content).toBeFocused();
  await expect(page).toHaveURL("/folders/handbook/valid.md?action=edit");
  await expectContent(page, "Intro first\n\n# Valid title\n\nNew content that must not get lost");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toEqual(created);
  expect(errors).toEqual([]);
});

test("content above the limit shows an error at the content field and stores nothing", async ({ page }) => {
  const errors = collectErrors(page);
  const created = await createPage({ folder: handbook, name: "long", title: "Long page" });

  await page.goto("/folders/handbook/long.md?action=edit");
  await fillContent(page, "# Long page\n\nShort");
  const save = page.getByRole("button", { name: "Save" });
  // The editor accepts no more than the limit, so the content that is too long is set in the submitted form data, as
  // a crafted request would send it.
  await save.evaluate(
    (button: HTMLButtonElement, value) =>
      button.form?.addEventListener("formdata", (event) => event.formData.set("content", value)),
    `# Long page\n\n${"x".repeat(CONTENT_MAX_LENGTH)}`,
  );
  await save.click();

  const content = contentEditor(page);
  await expect(content).toHaveAttribute("aria-invalid", "true");
  await expect(content).toHaveAccessibleDescription("Content must be at most 100,000 characters");
  await expect(content).toBeFocused();
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toEqual(created);
  expect(errors).toEqual([]);
});

test("a table with too many cells shows an error at the content field and keeps the content", async ({ page }) => {
  const errors = collectErrors(page);
  const created = await createPage({ folder: handbook, name: "table", title: "Table page" });
  // A header of 100 columns and 100 rows of one cell, filled up to 100 cells each: 100 cells more than the limit.
  const table = `|${" h |".repeat(100)}\n|${" - |".repeat(100)}\n${"| a |\n".repeat(100)}`;
  const value = `# Table page\n\n${table}`;

  await page.goto("/folders/handbook/table.md?action=edit");
  const content = contentEditor(page);
  await fillContent(page, value);
  await page.getByRole("button", { name: "Save" }).click();

  await expect(content).toHaveAttribute("aria-invalid", "true");
  await expect(content).toHaveAccessibleDescription(
    `Tables must have at most ${CONTENT_MAX_TABLE_CELLS.toLocaleString("en-US")} cells in all, counting the empty ` +
      "cells that fill a row up to the columns of its header",
  );
  await expect(page).toHaveURL("/folders/handbook/table.md?action=edit");
  await expectContent(page, value);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toEqual(created);
  expect(errors).toEqual([]);
});

test("a form submission with extra title and name fields stores the derived title and keeps the name", async ({
  page,
}) => {
  const created = await createPage({ folder: handbook, name: "crafted", title: "Original" });

  await page.goto("/folders/handbook/crafted.md?action=edit");
  await fillContent(page, "# From content");
  const save = page.getByRole("button", { name: "Save" });
  // Add fields to the form, as a crafted request would.
  await save.evaluate((button: HTMLButtonElement) => {
    for (const [name, value] of [
      ["title", "Injected title"],
      ["name", "injected-name"],
    ]) {
      const input = document.createElement("input");
      Object.assign(input, { type: "hidden", name, value });
      button.form?.append(input);
    }
  });
  await save.click();

  await expect(page).toHaveURL("/folders/handbook/crafted.md");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
    title: "From content",
    name: "crafted",
  });
});

test("cancelling an edit returns to the page view and changes nothing", async ({ page }) => {
  const created = await createPage({
    folder: handbook,
    name: "unchanged",
    content: "# Unchanged\n\nUnchanged content",
  });

  await page.goto("/folders/handbook/unchanged.md?action=edit");
  await fillContent(page, "# Never saved");
  await page.getByRole("link", { name: "Cancel" }).click();
  await page.getByRole("dialog", { name: "Discard changes?" }).getByRole("button", { name: "Discard" }).click();

  await expect(page).toHaveURL("/folders/handbook/unchanged.md");
  await expect(page).toHaveTitle("Unchanged – HippoWiki");
  await expect(page.getByRole("article").getByText("Unchanged content")).toBeVisible();
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toEqual(created);
});

// A page deleted after the editor was opened is refused as before, whatever its version.
test("saving a page that was deleted in the meantime shows an error and keeps the content", async ({ page }) => {
  const created = await createPage({ folder: handbook, name: "soon-gone", title: "Soon gone" });

  await page.goto("/folders/handbook/soon-gone.md?action=edit");
  // Deleted by another user while the form is open.
  await getTestDb().page.update({ where: { id: created.id }, data: { deletedAt: new Date() } });
  await fillContent(page, "# Soon gone\n\nTyped after the page was removed");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("main").getByRole("alert")).toHaveText("This page no longer exists.");
  await expect(contentEditor(page)).not.toBeFocused();
  await expect(page).toHaveURL("/folders/handbook/soon-gone.md?action=edit");
  await expectContent(page, "# Soon gone\n\nTyped after the page was removed");
  expect((await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).content).toBe(created.content);
});

test("editing an unknown page or a page address without .md shows the not-found page", async ({ page }) => {
  await createPage({ folder: handbook, name: "existing-page", title: "Existing page" });

  for (const address of [
    "/folders/handbook/no-such-page.md?action=edit",
    "/folders/handbook/existing-page?action=edit",
    "/folders/handbook/Bad_Name.md?action=edit",
  ]) {
    await expectNotFoundResponse(page.request, address);
  }
});

test("a folder and a page can be created, and the page edited and renamed", async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto("/folders?action=new");
  await page.getByRole("dialog", { name: "New folder" }).getByLabel("Name").fill("lifecycle");
  await page.getByRole("dialog", { name: "New folder" }).getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/lifecycle");
  await expect(page.getByText("This folder is empty")).toBeVisible();

  await page.getByRole("link", { name: "New page" }).click();
  await fillContent(page, "# Lifecycle page\n\nFirst version");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog", { name: "Save page" }).getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/lifecycle/lifecycle-page.md");
  await expect(page).toHaveTitle("Lifecycle page – HippoWiki");

  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "lifecycle" }).click();
  await expect(listLinks(page)).toHaveText([/^Lifecycle page/]);

  await page.getByRole("link", { name: /^Lifecycle page/ }).click();
  await page.getByRole("link", { name: "Edit" }).click();
  await fillContent(page, "# Lifecycle page, edited\n\nSecond version");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/lifecycle/lifecycle-page.md");
  await expect(page).toHaveTitle("Lifecycle page, edited – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Lifecycle page, edited"]);
  await expect(page.getByRole("article").getByText("Second version")).toBeVisible();

  await page.getByRole("link", { name: "Move or rename" }).click();
  await moveOrRenameDialog(page).getByLabel("Name").fill("lifecycle-renamed");
  await moveOrRenameDialog(page).getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/lifecycle/lifecycle-renamed.md");

  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "lifecycle" }).click();
  await expect(listLinks(page)).toHaveText([/^Lifecycle page, edited.*lifecycle-renamed\.md/]);
  expect(await getTestDb().page.count()).toBe(1);
  expect(errors).toEqual([]);
});

test("a page created and saved in the browser has a revision per change, and a save without a change changes nothing", async ({
  page,
  browser,
}) => {
  const errors = collectErrors(page);
  const bob = await createUser({ name: "bob", mustChangePassword: false });
  await createFolderRole({ folder: handbook, user: bob, role: "writer" });
  /** The revisions of the page as stored, oldest first. */
  const revisions = async () =>
    getTestDb().pageRevision.findMany({
      where: { page: { name: "history" } },
      orderBy: { number: "asc" },
      select: { number: true, content: true, user: { select: { username: true } }, via: true },
    });

  await page.goto("/folders/handbook?action=new");
  await fillContent(page, "# History\n\nFirst version");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog", { name: "Save page" }).getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/history.md");

  await page.goto("/folders/handbook/history.md?action=edit");
  await fillContent(page, "# History\n\nSecond version");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/history.md");

  expect(await revisions()).toEqual([
    { number: 1, content: "# History\n\nFirst version", user: { username: USER }, via: "web" },
    { number: 2, content: "# History\n\nSecond version", user: { username: USER }, via: "web" },
  ]);

  // Another user saves without a change: no revision, and the page stays as it is.
  const before = await getTestDb().page.findFirstOrThrow({ where: { name: "history" } });
  const other = await logInElsewhere(browser, "bob");
  await other.page.goto("/folders/handbook/history.md?action=edit");
  await other.page.getByRole("button", { name: "Save" }).click();
  await expect(other.page).toHaveURL("/folders/handbook/history.md");
  await expect(other.page.getByText(/^Last updated /)).toHaveText(by(USER));
  await other.context.close();
  expect(await revisions()).toHaveLength(2);
  expect(await getTestDb().page.findFirstOrThrow({ where: { name: "history" } })).toStrictEqual(before);
  expect(errors).toEqual([]);
});

test("editing a page makes the logged-in user its last editor in the page view and the list", async ({ page }) => {
  const errors = collectErrors(page);
  const bob = await createUser({ name: "bob" });
  await createPage({ folder: handbook, name: "edited", content: "# Edited", editor: bob, via: "mcp" });

  await page.goto("/folders/handbook/edited.md");
  await expect(page.getByText(/^Last updated /)).toHaveText(/^Last updated .+ by bob via mcp$/);
  await page.goto("/folders/handbook/edited.md?action=edit");
  await fillContent(page, "# Edited\n\nNew text");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/edited.md");
  await expect(page.getByText(/^Last updated /)).toHaveText(by(USER));
  await page.goto("/folders/handbook");
  await expect(page.getByRole("list", { name: "Contents" }).getByRole("listitem")).toHaveText([by(USER)]);
  expect(errors).toEqual([]);
});

test("a submission of the edit form with the login of an admin changes nothing and is not found", async ({
  page,
  context,
}) => {
  const edited = await createPage({ folder: handbook, name: "overview", content: "# Overview\n\nOld text" });
  // The user opens the form; then the browser gets the login of an admin, as if the admin had crafted the request.
  await page.goto("/folders/handbook/overview.md?action=edit");
  await fillContent(page, "# Changed\n\nNew text");
  await becomeUser(context, ADMIN_STORAGE_STATE);

  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  const stored = await getTestDb().page.findUniqueOrThrow({ where: { id: edited.id } });
  expect(stored).toStrictEqual(edited);
});

test.describe("a page changed after the editor was opened", () => {
  /** The folder of these tests, with the logged-in user and bob as Writers. */
  let team: Awaited<ReturnType<typeof createFolder>>;
  let bob: Awaited<ReturnType<typeof createUser>>;

  test.beforeEach(async () => {
    bob = await createUser({ name: "bob", mustChangePassword: false });
    team = await createFolder({
      name: "team",
      roles: [
        { user: { id: KNOWN_USER.id }, role: "writer" },
        { user: bob, role: "writer" },
      ],
    });
  });

  /** The message of a refused change, as the editor shows it above the content. */
  function changedMessage(page: BrowserPage) {
    return page.getByRole("main").getByRole("alert");
  }

  /** The time of the last change, as the page view shows it after "Last updated". */
  async function shownTime(page: BrowserPage, address: string): Promise<string> {
    await page.goto(address);
    return (await page.getByRole("article").locator("time").textContent()) ?? "";
  }

  test("refuses the save of the second editor and shows the content of the first with who changed it and when", async ({
    page,
    browser,
  }) => {
    const errors = collectErrors(page);
    const plan = await createPage({ folder: team, name: "plan", content: "# Plan\n\nFirst draft" });
    const other = await logInElsewhere(browser, "bob");

    // Both open the editor; bob saves first.
    await page.goto("/folders/team/plan.md?action=edit");
    await other.page.goto("/folders/team/plan.md?action=edit");
    await fillContent(other.page, "# Plan\n\nBob's version");
    await other.page.getByRole("button", { name: "Save" }).click();
    await expect(other.page).toHaveURL("/folders/team/plan.md");

    await fillContent(page, "# Plan\n\nAlice's version");
    await page.getByRole("button", { name: "Save" }).click();

    // The editor again, with the content as stored and the message that names bob and the time.
    await expect(page).toHaveURL("/folders/team/plan.md?action=edit&notice=changed");
    await expectContent(page, "# Plan\n\nBob's version");
    const time = await shownTime(other.page, "/folders/team/plan.md");
    await expect(changedMessage(page)).toHaveText(
      `This page was changed by bob via web at ${time} after you opened it.`,
    );
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).content).toBe(
      "# Plan\n\nBob's version",
    );

    // Saving the current content again is no longer refused; as it changes nothing, bob stays the last editor.
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/team/plan.md");
    await expect(page.getByText(/^Last updated /)).toHaveText(by("bob"));
    expect(errors).toEqual([]);
    await other.context.close();
  });

  test("names the channel mcp for a page changed through MCP after the editor was opened", async ({ page }) => {
    const plan = await createPage({ folder: team, name: "plan", content: "# Plan\n\nFirst draft" });

    await page.goto("/folders/team/plan.md?action=edit");
    // A change through MCP meanwhile, as a connection of bob stores it.
    await getTestDb().page.update({
      where: { id: plan.id },
      data: {
        content: "# Plan\n\nBy an agent",
        version: { increment: 1 },
        lastEditedById: bob.id,
        lastEditedVia: "mcp",
      },
    });
    await fillContent(page, "# Plan\n\nAlice's version");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/team/plan.md?action=edit&notice=changed");
    await expect(changedMessage(page)).toHaveText(/^This page was changed by bob via mcp at .+ after you opened it\.$/);
  });

  // The user's own save in another tab counts like the save of another user.
  test("refuses the save in a second tab after a save in the first", async ({ page, context }) => {
    await createPage({ folder: team, name: "plan", content: "# Plan\n\nFirst draft" });
    const second = await hydrating(await context.newPage());

    await page.goto("/folders/team/plan.md?action=edit");
    await second.goto("/folders/team/plan.md?action=edit");
    await fillContent(page, "# Plan\n\nFrom the first tab");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/team/plan.md");

    await fillContent(second, "# Plan\n\nFrom the second tab");
    await second.getByRole("button", { name: "Save" }).click();

    await expect(second).toHaveURL("/folders/team/plan.md?action=edit&notice=changed");
    await expectContent(second, "# Plan\n\nFrom the first tab");
    await expect(changedMessage(second)).toHaveText(
      new RegExp(`^This page was changed by ${USER} via web at .+ after you opened it\\.$`),
    );
  });

  // A rename counts as a change, and the editor is shown at the new address.
  test("refuses the save after a rename and shows the editor at the new address", async ({ page, browser }) => {
    const plan = await createPage({ folder: team, name: "plan", content: "# Plan\n\nFirst draft" });
    const other = await logInElsewhere(browser, "bob");

    await page.goto("/folders/team/plan.md?action=edit");
    await other.page.goto("/folders/team/plan.md?action=move-or-rename");
    const dialog = other.page.getByRole("dialog", { name: "Move or rename page" });
    await dialog.getByLabel("Name").fill("release-plan");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(other.page).toHaveURL("/folders/team/release-plan.md");

    await fillContent(page, "# Plan\n\nAlice's version");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/team/release-plan.md?action=edit&notice=changed");
    await expectContent(page, "# Plan\n\nFirst draft");
    await expect(changedMessage(page)).toHaveText(/^This page was changed by bob via web at .+ after you opened it\.$/);
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).content).toBe(
      "# Plan\n\nFirst draft",
    );
    await other.context.close();
  });

  // An editor opened before the feature submits no version; its save is refused once.
  test("refuses a save without a version and shows the current page with the message", async ({ page }) => {
    const plan = await createPage({ folder: team, name: "plan", content: "# Plan\n\nStored", editor: bob });

    await page.goto("/folders/team/plan.md?action=edit");
    await fillContent(page, "# Plan\n\nTyped");
    const save = page.getByRole("button", { name: "Save" });
    await save.evaluate(
      (button: HTMLButtonElement, field) =>
        button.form?.addEventListener("formdata", (event) => event.formData.delete(field)),
      VERSION_FIELD,
    );
    await save.click();

    await expect(page).toHaveURL("/folders/team/plan.md?action=edit&notice=changed");
    await expectContent(page, "# Plan\n\nStored");
    await expect(changedMessage(page)).toHaveText(/^This page was changed by bob via web at .+ after you opened it\.$/);
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).toStrictEqual(plan);
  });

  // A save without a change is refused like every other save based on an older version.
  test("refuses a save without a change in an editor opened before another change, and keeps that change", async ({
    page,
    browser,
  }) => {
    const errors = collectErrors(page);
    const plan = await createPage({ folder: team, name: "plan", content: "# Plan\n\nFirst draft" });
    const other = await logInElsewhere(browser, "bob");

    await page.goto("/folders/team/plan.md?action=edit");
    await other.page.goto("/folders/team/plan.md?action=edit");
    await fillContent(other.page, "# Plan\n\nBob's version");
    await other.page.getByRole("button", { name: "Save" }).click();
    await expect(other.page).toHaveURL("/folders/team/plan.md");
    await other.context.close();
    const stored = await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } });

    await page.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/team/plan.md?action=edit&notice=changed");
    await expectContent(page, "# Plan\n\nBob's version");
    await expect(changedMessage(page)).toHaveText(/^This page was changed by bob via web at .+ after you opened it\.$/);
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).toStrictEqual(stored);
    expect(errors).toEqual([]);
  });

  // Unchanged saves: an empty save changes nothing, so it does not refuse the save of another editor.
  test("stores the change of the second editor after the first saved without a change", async ({ page, browser }) => {
    const errors = collectErrors(page);
    const plan = await createPage({ folder: team, name: "plan", content: "# Plan\n\nFirst draft", version: 3 });
    const other = await logInElsewhere(browser, "bob");

    await page.goto("/folders/team/plan.md?action=edit");
    await other.page.goto("/folders/team/plan.md?action=edit");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/team/plan.md");

    await fillContent(other.page, "# Plan\n\nBob's version");
    await other.page.getByRole("button", { name: "Save" }).click();
    await expect(other.page).toHaveURL("/folders/team/plan.md");
    await expect(other.page.getByText(/^Last updated /)).toHaveText(by("bob"));
    await other.context.close();

    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).toMatchObject({
      content: "# Plan\n\nBob's version",
      version: 4,
      lastEditedById: bob.id,
    });
    expect(errors).toEqual([]);
  });

  test("a notice without an action, an unknown or a repeated notice shows the not-found page", async ({ page }) => {
    await createPage({ folder: team, name: "plan" });
    const tab = await createTab({ folder: team, name: "guides" });
    await createPage({ tab, name: "plan" });

    for (const address of [
      "/folders/team/plan.md?notice=changed",
      "/folders/team/plan.md?action=edit&notice=other",
      "/folders/team/plan.md?action=edit&notice=",
      "/folders/team/plan.md?action=edit&notice=changed&notice=changed",
      "/folders/team/guides/plan.md?notice=changed",
      "/folders/team/guides/plan.md?action=edit&notice=other",
    ]) {
      await expectNotFoundResponse(page.request, address);
    }
  });
});

test.describe("a save without a change", () => {
  /** The time of the last change, as the page view shows it after "Last updated". */
  function shownTime(page: BrowserPage) {
    return page.getByRole("article").locator("time");
  }

  // The page keeps its last editor, channel, time and version, and its revisions.
  test("leaves the page as it is, in the page view and the lists, and shows no notice", async ({ page }) => {
    const errors = collectErrors(page);
    const bob = await createUser({ name: "bob" });
    const updatedAt = new Date("2026-01-01T10:00:00Z");
    const tab = await createTab({ folder: handbook, name: "guides", editor: bob, via: "mcp" });
    const pages = [
      await createPage({
        folder: handbook,
        name: "direct",
        content: "# Direct\n\nFirst line\nSecond line",
        editor: bob,
        via: "mcp",
        updatedAt,
        version: 5,
      }),
      await createPage({ tab, name: "in-tab", content: "# In tab\n\nText", editor: bob, via: "mcp", updatedAt }),
    ];
    const revisions = await getTestDb().pageRevision.findMany({ orderBy: [{ pageId: "asc" }, { number: "asc" }] });

    for (const address of ["/folders/handbook/direct.md", "/folders/handbook/guides/in-tab.md"]) {
      await page.goto(address);
      const time = await shownTime(page).textContent();
      await page.goto(`${address}?action=edit`);
      await page.getByRole("button", { name: "Save" }).click();

      await expect(page).toHaveURL(address);
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
      await expect(page.getByText(/^Last updated /)).toHaveText(by("bob", "mcp"));
      await expect(shownTime(page)).toHaveText(time ?? "");
    }

    await page.goto("/folders/handbook");
    await expect(
      page.getByRole("list", { name: "Contents" }).getByRole("listitem").filter({ hasText: "Direct" }),
    ).toHaveText(by("bob", "mcp"));
    await page.goto("/folders/handbook/guides");
    await expect(page.getByRole("list", { name: "Pages" }).getByRole("listitem")).toHaveText([by("bob", "mcp")]);
    for (const stored of pages) {
      expect(await getTestDb().page.findUniqueOrThrow({ where: { id: stored.id } })).toStrictEqual(stored);
    }
    expect(await getTestDb().pageRevision.findMany({ orderBy: [{ pageId: "asc" }, { number: "asc" }] })).toEqual(
      revisions,
    );
    expect(errors).toEqual([]);
  });

  // The limits in force are checked also when the content is the stored one.
  test("of content over the length limit shows the length error and stores nothing", async ({ page }) => {
    const errors = collectErrors(page);
    const content = `# Long page\n\n${"x".repeat(CONTENT_MAX_LENGTH)}`;
    const created = await createPage({ folder: handbook, name: "long", content });

    await page.goto("/folders/handbook/long.md?action=edit");
    const field = await editorReady(page);
    await expectContent(page, content);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription("Content must be at most 100,000 characters");
    await expect(page).toHaveURL("/folders/handbook/long.md?action=edit");
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toStrictEqual(created);
    expect(errors).toEqual([]);
  });
});
