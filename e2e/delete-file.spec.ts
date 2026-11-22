// Deleting a file from its details page, the deleted files among the deleted items of the folder, their view and their
// restore, and the files that go with a deleted tab.

import type { Page as BrowserPage } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { collectErrors, expectNotFound } from "./support/browser";
import {
  createFile,
  createFolder,
  createPage,
  createTab,
  getTestDb,
  resetTestDatabase,
  setOwnRole,
} from "./support/database";
import { expectFileNotFound, pngBytes, uploadFile } from "./support/files";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;
let guides: Awaited<ReturnType<typeof createTab>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
  guides = await createTab({ folder: handbook, name: "guides" });
});

/** The rows of the list "Deleted items", each as its cells. */
async function deletedRows(page: BrowserPage): Promise<string[][]> {
  const rows = page.getByRole("table", { name: "Deleted items" }).getByRole("row");
  const all = await rows.all();
  return Promise.all(all.slice(1).map(async (row) => (await row.getByRole("cell").allTextContents()).slice(0, 3)));
}

test("a Manager deletes a file: it leaves the section Files, both its addresses and its links show it as missing", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await setOwnRole(handbook, "manager");
  await createFile({ tab: guides, name: "diagram.png" });
  await createPage({ folder: handbook, name: "setup", content: "# Setup\n\n![[guides/diagram.png]]" });

  await page.goto("/folders/handbook/guides/diagram.png");
  await page.getByRole("link", { name: "Delete" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/diagram.png?action=delete");
  const dialog = page.getByRole("dialog", { name: "Delete file" });
  await expect(dialog).toContainText("Delete the file diagram.png?");
  await expect(dialog).toContainText("Its links in 1 page will show as missing.");
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides");
  await expect(page.getByRole("region", { name: "Files" })).toHaveCount(0);
  // Before the not-found pages, whose answer 404 the browser reports as an error.
  expect(errors).toEqual([]);
  await expectNotFound(page, "/folders/handbook/guides/diagram.png");
  await expectFileNotFound(page, "/files/handbook/guides/diagram.png");
  await page.goto("/folders/handbook/setup.md");
  await expect(page.getByRole("article").getByText("guides/diagram.png")).toHaveAccessibleDescription(
    "File does not exist",
  );
});

test("a deleted file is listed with a deleted page, shows its details and versions with only Restore, and is restored with all its versions", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await createFile({
    folder: handbook,
    name: "report.pdf",
    versions: [{}, {}],
    deletedAt: new Date("2026-11-21T10:00:00Z"),
  });
  await createPage({
    folder: handbook,
    name: "old-notes",
    title: "Old notes",
    deletedAt: new Date("2026-11-20T10:00:00Z"),
  });

  await page.goto("/folders/handbook");
  await page.getByRole("link", { name: "Deleted items" }).click();
  await expect(page).toHaveURL("/deleted-items/handbook");
  expect(await deletedRows(page)).toEqual([
    ["report.pdf", "File", "PDF"],
    ["old-notes", "Page", "Old notes"],
  ]);

  await page.getByRole("link", { name: "report.pdf" }).click();
  await expect(page).toHaveTitle("Deleted: report.pdf – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("report.pdf");
  await expect(page.getByRole("table", { name: "Details" })).toContainText("PDF");
  const versions = page.getByRole("table", { name: "Versions" });
  await expect(versions.getByRole("row")).toHaveCount(3);
  await expect(versions.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("link")).toHaveText([
    "Folders",
    "handbook",
    "Deleted items",
    "Restore",
  ]);
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);

  await page.getByRole("link", { name: "Restore" }).click();
  const dialog = page.getByRole("dialog", { name: "Restore file" });
  await expect(dialog.getByLabel("Name")).toHaveValue("report.pdf");
  await expect(dialog.getByRole("radio", { checked: true })).toHaveCount(0);
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await expect(dialog).toContainText("Address: /folders/handbook/guides/report.pdf");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/report.pdf");
  await expect(page.getByRole("table", { name: "Versions" }).getByRole("link", { name: /^Version/ })).toHaveText([
    "Version 2",
    "Version 1",
  ]);
  await page.goto("/folders/handbook/guides");
  await expect(page.getByRole("region", { name: "Files" }).getByRole("link", { name: "report.pdf" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a restore under a taken name is refused at the name field and restores nothing", async ({ page }) => {
  const deleted = await createFile({ folder: handbook, name: "diagram.png", deletedAt: new Date() });
  await createFile({ folder: handbook, name: "diagram.png" });

  await page.goto(`/deleted-items/handbook/${deleted.id}?action=restore`);
  const dialog = page.getByRole("dialog", { name: "Restore file" });
  await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByLabel("Name")).toHaveAccessibleDescription("Name is already in use");

  expect(await getTestDb().file.findUniqueOrThrow({ where: { id: deleted.id } })).toMatchObject({
    deletedAt: expect.any(Date),
  });
});

test("a Writer is offered no Delete, and the addresses of delete and of the deleted file show the not-found page", async ({
  page,
}) => {
  await createFile({ tab: guides, name: "diagram.png" });
  const deleted = await createFile({ folder: handbook, name: "gone.png", deletedAt: new Date() });
  await setOwnRole(handbook, "writer");

  await page.goto("/folders/handbook/guides/diagram.png");
  await expect(page.getByRole("link", { name: "Move or rename" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Delete" })).toHaveCount(0);
  await expectNotFound(page, "/folders/handbook/guides/diagram.png?action=delete");
  await expectNotFound(page, `/deleted-items/handbook/${deleted.id}`);
  await expectNotFound(page, `/deleted-items/handbook/${deleted.id}?action=restore`);
});

test("a new version uploaded after the delete dialog was opened makes the delete show the message", async ({
  page,
}) => {
  const file = await createFile({ tab: guides, name: "diagram.png" });

  await page.goto("/folders/handbook/guides/diagram.png?action=delete");
  const dialog = page.getByRole("dialog", { name: "Delete file" });
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeEnabled();
  const upload = await uploadFile(page, {
    folder: "handbook",
    tab: "guides",
    name: "diagram.png",
    bytes: await pngBytes(50, 50),
    replace: file.lockVersion,
  });
  expect(upload.ok()).toBe(true);
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/diagram.png?action=delete&notice=changed");
  await expect(dialog.getByRole("alert")).toContainText(`This file was changed by ${KNOWN_USER.name} via web at`);
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides");
  expect(await getTestDb().file.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
    deletedAt: expect.any(Date),
  });
});

test("deleting a tab with two files names them, and both are among the deleted items and can be restored", async ({
  page,
}) => {
  await createPage({ tab: guides, name: "setup", title: "Setup" });
  const report = await createFile({ tab: guides, name: "report.pdf" });
  await createFile({ tab: guides, name: "diagram.png" });

  await page.goto("/folders/handbook/guides?action=delete");
  const dialog = page.getByRole("dialog", { name: "Delete tab" });
  await expect(dialog).toContainText("Its 1 page and 2 files are deleted with it.");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/folders/handbook");

  await page.goto("/deleted-items/handbook");
  expect((await deletedRows(page)).map(([name, kind]) => `${kind} ${name}`).sort()).toEqual([
    "File diagram.png",
    "File report.pdf",
    "Page setup",
  ]);
  await page.goto(`/deleted-items/handbook/${report.id}?action=restore`);
  const restore = page.getByRole("dialog", { name: "Restore file" });
  await restore.getByRole("radio", { name: "Directly in the folder" }).check();
  await restore.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/report.pdf");
});
