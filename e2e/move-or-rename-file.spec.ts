// Moving and renaming a file from its details page: the dialog, the update of its links and embeds in the pages of the
// folder, the roles, and a file changed after the dialog was opened.

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
import { pngBytes, uploadFile } from "./support/files";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;
let guides: Awaited<ReturnType<typeof createTab>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
  guides = await createTab({ folder: handbook, name: "guides" });
});

/** The "Move or rename file" dialog. */
function dialogOf(page: BrowserPage) {
  return page.getByRole("dialog", { name: "Move or rename file" });
}

/** The content of the page as stored. */
async function contentOf(name: string): Promise<string> {
  return (await getTestDb().page.findFirstOrThrow({ where: { name, deletedAt: null } })).content;
}

test("renaming a file updates every page that shows or links it, says how many beforehand, and keeps its versions", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await createFile({ tab: guides, name: "diagram.png", versions: [{}, {}] });
  await createPage({ folder: handbook, name: "setup", content: "# Setup\n\n![[guides/diagram.png|The network]]" });
  await createPage({ tab: guides, name: "overview", content: "# Overview\n\nSee [[guides/diagram.png]]." });
  await createPage({ folder: handbook, name: "other", content: "# Other\n\n[[guides/diagram]]" });

  await page.goto("/folders/handbook/guides/diagram.png");
  await page.getByRole("link", { name: "Move or rename" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/diagram.png?action=move-or-rename");
  const dialog = dialogOf(page);
  await expect(dialog).toContainText("Links in 2 pages will be updated.");
  const name = dialog.getByLabel("Name");
  await expect(name).toHaveValue("diagram.png");
  await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await name.fill("network.png");
  await expect(dialog).toContainText("Address: /folders/handbook/guides/network.png");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/network.png");
  await expect(page.getByRole("table", { name: "Versions" }).getByRole("link", { name: /^Version/ })).toHaveText([
    "Version 2",
    "Version 1",
  ]);
  await expect(page.getByRole("region", { name: "Shown or linked from" }).getByRole("link")).toHaveText([
    "Overview",
    "Setup",
  ]);
  expect(await contentOf("setup")).toBe("# Setup\n\n![[guides/network.png|The network]]");
  expect(await contentOf("overview")).toBe("# Overview\n\nSee [[guides/network.png]].");
  expect(await contentOf("other")).toBe("# Other\n\n[[guides/diagram]]");
  await page.goto("/folders/handbook/setup.md");
  await expect(page.getByRole("article").getByRole("img", { name: "The network" })).toHaveAttribute(
    "src",
    "/files/handbook/guides/network.png",
  );
  await page.goto("/folders/handbook/setup.md?view=history");
  await expect(page.getByRole("list", { name: "Revisions" }).getByRole("listitem").first()).toContainText(
    "Links updated after a move or rename",
  );
  expect(errors).toEqual([]);
});

test("moving a file from a tab into the folder lists it there, and a file without links says so", async ({ page }) => {
  await createFile({ tab: guides, name: "report.pdf" });

  await page.goto("/folders/handbook/guides/report.pdf?action=move-or-rename");
  const dialog = dialogOf(page);
  await expect(dialog).toContainText("No page shows or links this file.");
  await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
  await expect(dialog).toContainText("Address: /folders/handbook/report.pdf");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/report.pdf");
  await page.goto("/folders/handbook");
  await expect(page.getByRole("region", { name: "Files" }).getByRole("link", { name: "report.pdf" })).toBeVisible();
  await page.goto("/folders/handbook/guides");
  await expect(page.getByRole("region", { name: "Files" })).toHaveCount(0);
});

test("a name with another extension and a taken name are refused at the name field and change nothing", async ({
  page,
}) => {
  const file = await createFile({ tab: guides, name: "diagram.png" });
  await createFile({ tab: guides, name: "taken.png" });

  await page.goto("/folders/handbook/guides/diagram.png?action=move-or-rename");
  const dialog = dialogOf(page);
  const name = dialog.getByLabel("Name");
  await name.fill("diagram.jpg");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(name).toHaveAccessibleDescription("The name must end in .png, because the type of a file cannot change");
  await name.fill("taken.png");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(name).toHaveAccessibleDescription("Name is already in use");

  expect(await getTestDb().file.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
    name: "diagram.png",
    lockVersion: file.lockVersion,
    updatedAt: file.updatedAt,
  });
});

test("a Reader is offered no Move or rename, and its address shows the not-found page", async ({ page }) => {
  await createFile({ tab: guides, name: "diagram.png" });
  await setOwnRole(handbook, "reader");

  await page.goto("/folders/handbook/guides/diagram.png");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("diagram.png");
  await expect(page.getByRole("link", { name: "Move or rename" })).toHaveCount(0);
  await expectNotFound(page, "/folders/handbook/guides/diagram.png?action=move-or-rename");
});

test("a new version uploaded after the dialog was opened makes the rename show the message, and confirming again stores it", async ({
  page,
}) => {
  const file = await createFile({ tab: guides, name: "diagram.png" });

  await page.goto("/folders/handbook/guides/diagram.png?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("network.png");
  const upload = await uploadFile(page, {
    folder: "handbook",
    tab: "guides",
    name: "diagram.png",
    bytes: await pngBytes(50, 50),
    replace: file.lockVersion,
  });
  expect(upload.ok()).toBe(true);
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/diagram.png?action=move-or-rename&notice=changed");
  await expect(dialog.getByRole("alert")).toContainText(`This file was changed by ${KNOWN_USER.name} via web at`);
  await expect(dialog.getByLabel("Name")).toHaveValue("diagram.png");
  await dialog.getByLabel("Name").fill("network.png");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/network.png");
  expect(await getTestDb().file.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
    name: "network.png",
    lockVersion: file.lockVersion + 2,
  });
});
