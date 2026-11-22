import type { Page } from "@playwright/test";

import { VERSION_FIELD } from "@/features/pages/fields";

import { KNOWN_USER } from "../prisma/known-users";
import { by, collectErrors, expectNotFound } from "./support/browser";
import { createFolder, createPage, createTab, createUser, getTestDb, resetTestDatabase } from "./support/database";
import { fillContent } from "./support/editor";
import { expect, hydrating, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

/** The "Delete page" dialog. */
function deleteDialog(page: Page) {
  return page.getByRole("dialog", { name: "Delete page" });
}

/** Opens the page at the address, deletes it through its "Delete" button and confirms the dialog. */
async function deleteThroughDialog(page: Page, address: string) {
  await page.goto(address);
  await page.getByRole("main").getByRole("link", { name: "Delete" }).click();
  await expect(page).toHaveURL(`${address}?action=delete`);
  await deleteDialog(page).getByRole("button", { name: "Delete" }).click();
}

/** The logged-in user of the tests, who makes every change through the GUI. */
const USER = KNOWN_USER.name;

test("deleting a page placed directly in a folder leads to the folder and removes it everywhere", async ({ page }) => {
  const errors = collectErrors(page);
  await createPage({ folder: handbook, name: "kept", title: "Kept page" });
  const removed = await createPage({ folder: handbook, name: "removed", title: "Removed page" });

  await deleteThroughDialog(page, "/folders/handbook/removed.md");

  await expect(page).toHaveURL("/folders/handbook");
  await expect(page.getByRole("list", { name: "Contents" }).getByRole("link")).toHaveText([/^Kept page/]);
  const stored = await getTestDb().page.findUniqueOrThrow({ where: { id: removed.id } });
  expect(stored).toMatchObject({ folderId: handbook.id, tabId: null, deletedAt: expect.any(Date) });
  expect(stored.updatedAt.getTime()).toBeGreaterThan(removed.updatedAt.getTime());

  await page.goto("/folders/handbook?view=all");
  const rows = page
    .getByRole("table", { name: "All pages" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });
  await expect(rows).toHaveText([/^kept\.md/]);
  expect(errors).toEqual([]);
  // The browser reports the 404 of the not-found page as a console error, so it is checked last.
  await expectNotFound(page, "/folders/handbook/removed.md");
});

test("deleting a page in a tab leads to the tab and puts it on top of the deleted pages", async ({ page }) => {
  const errors = collectErrors(page);
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ tab: guides, name: "kept", title: "Kept page" });
  await createPage({
    folder: handbook,
    name: "earlier",
    title: "Earlier",
    deletedAt: new Date("2026-01-01T00:00:00Z"),
  });
  const removed = await createPage({ tab: guides, name: "removed", title: "Removed page" });

  await deleteThroughDialog(page, "/folders/handbook/guides/removed.md");

  await expect(page).toHaveURL("/folders/handbook/guides");
  await expect(page.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^Kept page/]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: removed.id } })).toMatchObject({
    folderId: handbook.id,
    tabId: null,
    deletedAt: expect.any(Date),
  });

  await page.goto("/deleted-items/handbook");
  const table = page.getByRole("table", { name: "Deleted items" });
  await expect(table.getByRole("link")).toHaveText(["removed", "earlier"]);
  await expect(table.getByRole("link").first()).toHaveAttribute("href", `/deleted-items/handbook/${removed.id}`);
  expect(errors).toEqual([]);
  // The browser reports the 404 of the not-found page as a console error, so it is checked last.
  await expectNotFound(page, "/folders/handbook/guides/removed.md");
});

test("a page of the same name can be created at the same place right after deleting", async ({ page }) => {
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ tab: guides, name: "overview", title: "Old overview" });

  await deleteThroughDialog(page, "/folders/handbook/guides/overview.md");
  await expect(page).toHaveURL("/folders/handbook/guides");

  await page.goto("/folders/handbook/guides?action=new");
  await fillContent(page, "# Overview\n\nNew text");
  await page.getByRole("button", { name: "Save" }).click();
  const dialog = page.getByRole("dialog", { name: "Save page" });
  await expect(dialog.getByLabel("Name")).toHaveValue("overview");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/overview.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Overview"]);
});

test("the dialog names the page, and cancel keeps the page and leads back to it", async ({ page }) => {
  const errors = collectErrors(page);
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=delete");

  const dialog = deleteDialog(page);
  await expect(page).toHaveTitle("Kept page – HippoWiki");
  await expect(dialog).toHaveAccessibleDescription(
    "Delete the page kept.md? You can restore it later from the deleted items of its folder.",
  );
  await dialog.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL("/folders/handbook/kept.md");
  await expect(dialog).toHaveCount(0);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
  expect(errors).toEqual([]);
});

test("the Escape key closes the dialog and keeps the page", async ({ page }) => {
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=delete");
  await expect(deleteDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page).toHaveURL("/folders/handbook/kept.md");
  await expect(deleteDialog(page)).toHaveCount(0);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
});

// A page deleted after the dialog was opened is refused as before, whatever its version.
test("deleting a page that was deleted in the meantime shows an error in the dialog", async ({ page }) => {
  const created = await createPage({ folder: handbook, name: "soon-gone", title: "Soon gone" });

  await page.goto("/folders/handbook/soon-gone.md?action=delete");
  const deletedAt = new Date("2026-01-01T00:00:00Z");
  await getTestDb().page.update({ where: { id: created.id }, data: { deletedAt } });
  const dialog = deleteDialog(page);
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("This page no longer exists.");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ deletedAt });
});

test("the deleted pages and the deleted page show the logged-in user who deleted the page", async ({ page }) => {
  const errors = collectErrors(page);
  const bob = await createUser({ name: "bob" });
  const removed = await createPage({ folder: handbook, name: "removed", editor: bob, via: "mcp" });

  await deleteThroughDialog(page, "/folders/handbook/removed.md");
  await expect(page).toHaveURL("/folders/handbook");

  await page.goto("/deleted-items/handbook");
  const rows = page
    .getByRole("table", { name: "Deleted items" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });
  await expect(rows.getByRole("cell").nth(4)).toHaveText(USER);
  await expect(rows.getByRole("cell").nth(5)).toHaveText("web");
  await page.goto(`/deleted-items/handbook/${removed.id}`);
  await expect(page.getByRole("article").getByText(/^Deleted /)).toHaveText(by(USER));
  expect(errors).toEqual([]);
});

test.describe("a page changed after the dialog was opened", () => {
  /** The folder of these tests, with the logged-in user as Manager and bob as Writer. */
  let team: Awaited<ReturnType<typeof createFolder>>;
  let bob: Awaited<ReturnType<typeof createUser>>;

  test.beforeEach(async () => {
    bob = await createUser({ name: "bob", mustChangePassword: false });
    team = await createFolder({
      name: "team",
      roles: [
        { user: { id: KNOWN_USER.id }, role: "manager" },
        { user: bob, role: "writer" },
      ],
    });
  });

  test("refuses the delete after a content save and shows the message; confirming again deletes the page", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const plan = await createPage({ folder: team, name: "plan", content: "# Plan\n\nFirst draft" });

    // The dialog is open while bob saves the content in the browser.
    await page.goto("/folders/team/plan.md?action=delete");
    await getTestDb().page.update({
      where: { id: plan.id },
      data: {
        content: "# Plan\n\nBob's version",
        version: { increment: 1 },
        lastEditedById: bob.id,
        lastEditedVia: "web",
      },
    });

    const dialog = deleteDialog(page);
    await dialog.getByRole("button", { name: "Delete" }).click();

    // The dialog stays open with the message, and the page is still at its address.
    await expect(page).toHaveURL("/folders/team/plan.md?action=delete&notice=changed");
    await expect(dialog.getByRole("alert")).toHaveText(
      /^This page was changed by bob via web at .+ after you opened it\.$/,
    );
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).toMatchObject({
      deletedAt: null,
      content: "# Plan\n\nBob's version",
    });

    // Confirming again deletes the page.
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL("/folders/team");
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).deletedAt).not.toBeNull();
    expect(errors).toEqual([]);
  });

  test("names the channel mcp for a page changed through MCP after the dialog was opened", async ({ page }) => {
    const plan = await createPage({ folder: team, name: "plan", content: "# Plan\n\nFirst draft" });

    await page.goto("/folders/team/plan.md?action=delete");
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
    const dialog = deleteDialog(page);
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect(page).toHaveURL("/folders/team/plan.md?action=delete&notice=changed");
    await expect(dialog.getByRole("alert")).toHaveText(
      /^This page was changed by bob via mcp at .+ after you opened it\.$/,
    );
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).deletedAt).toBeNull();
  });

  // The dialog is shown again at the page's new address.
  test("refuses the delete after a rename and shows the dialog at the new address", async ({ page }) => {
    const plan = await createPage({ folder: team, name: "plan" });

    await page.goto("/folders/team/plan.md?action=delete");
    // Bob renames the page in the browser meanwhile.
    await getTestDb().page.update({
      where: { id: plan.id },
      data: { name: "release-plan", version: { increment: 1 }, lastEditedById: bob.id, lastEditedVia: "web" },
    });

    const dialog = deleteDialog(page);
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect(page).toHaveURL("/folders/team/release-plan.md?action=delete&notice=changed");
    await expect(dialog).toContainText("Delete the page release-plan.md?");
    await expect(dialog.getByRole("alert")).toHaveText(
      /^This page was changed by bob via web at .+ after you opened it\.$/,
    );
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).deletedAt).toBeNull();
  });

  // The second of two deletes of the same page finds it deleted, as before.
  test("the second of two deletes of the same page shows that it no longer exists", async ({ page, context }) => {
    await createPage({ folder: team, name: "plan" });
    const second = await hydrating(await context.newPage());

    await page.goto("/folders/team/plan.md?action=delete");
    await second.goto("/folders/team/plan.md?action=delete");
    await deleteDialog(page).getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL("/folders/team");

    await deleteDialog(second).getByRole("button", { name: "Delete" }).click();
    await expect(deleteDialog(second).getByRole("alert")).toHaveText("This page no longer exists.");
  });

  // A dialog opened before the feature submits no version; its delete is refused once.
  test("refuses a delete without a version, deletes nothing and shows the dialog with the message", async ({
    page,
  }) => {
    const plan = await createPage({ folder: team, name: "plan", editor: bob });

    await page.goto("/folders/team/plan.md?action=delete");
    const confirm = deleteDialog(page).getByRole("button", { name: "Delete" });
    await confirm.evaluate(
      (button: HTMLButtonElement, field) =>
        button.form?.addEventListener("formdata", (event) => event.formData.delete(field)),
      VERSION_FIELD,
    );
    await confirm.click();

    await expect(page).toHaveURL("/folders/team/plan.md?action=delete&notice=changed");
    await expect(deleteDialog(page).getByRole("alert")).toHaveText(
      /^This page was changed by bob via web at .+ after you opened it\.$/,
    );
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).toStrictEqual(plan);
  });
});
