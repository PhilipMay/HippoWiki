import type { Page } from "@playwright/test";

import { VERSION_FIELD } from "@/features/pages/forms";
import { CONTENT_MAX_TABLE_CELLS } from "@/features/pages/limits";
import { CONTENT_TABLE_CELLS_MESSAGE } from "@/features/pages/schema";

import { KNOWN_USER } from "../prisma/known-users";
import { collectErrors, expectNotFound } from "./support/browser";
import {
  createFolder,
  createPage,
  createRevisions,
  createUser,
  getTestDb,
  resetTestDatabase,
  setOwnRole,
} from "./support/database";
import { expect, test } from "./support/test";

/** The known user, who is logged in. */
const ALICE = { id: KNOWN_USER.id };

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook", roles: [{ user: ALICE, role: "writer" }] });
});

/** The "Revert page" dialog. */
function revertDialog(page: Page) {
  return page.getByRole("dialog", { name: "Revert page" });
}

/** The page "intro" with three revisions "One", "Two" and "Three"; its content is that of revision 3. */
async function pageWithThreeRevisions() {
  const intro = await createPage({ folder: handbook, name: "intro", content: "# Intro\n\nOne" });
  await createRevisions({ page: intro, count: 2, content: (number) => `# Intro\n\n${["Two", "Three"][number - 2]}` });
  return intro;
}

/** The content and the number of revisions of the page as stored. */
async function stored(pageId: string) {
  const { content, version } = await getTestDb().page.findUniqueOrThrow({ where: { id: pageId } });
  return { content, version, revisions: await getTestDb().pageRevision.count({ where: { pageId } }) };
}

test("a Writer reverts a page to an old revision: closing the dialog changes nothing, confirming records a new revision", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const intro = await pageWithThreeRevisions();

  await page.goto("/folders/handbook/intro.md?view=revision&revision=1");
  await page.getByRole("link", { name: "Revert" }).click();
  await expect(page).toHaveURL("/folders/handbook/intro.md?action=revert&revision=1");
  await expect(page).toHaveTitle("Revert Intro – HippoWiki");
  await expect(revertDialog(page)).toContainText(/Set the page back to revision 1 of .+ by .+ via web\?/);

  await revertDialog(page).getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL("/folders/handbook/intro.md?view=revision&revision=1");
  expect(await stored(intro.id)).toEqual({ content: "# Intro\n\nThree", version: 1, revisions: 3 });

  await page.getByRole("link", { name: "Revert" }).click();
  await revertDialog(page).getByRole("button", { name: "Revert" }).click();

  await expect(page).toHaveURL("/folders/handbook/intro.md");
  await expect(page.getByRole("article").getByText("One", { exact: true })).toBeVisible();
  expect(await stored(intro.id)).toEqual({ content: "# Intro\n\nOne", version: 2, revisions: 4 });

  await page.goto("/folders/handbook/intro.md?view=history");
  await expect(page.getByRole("list", { name: "Revisions" }).getByRole("link").first()).toHaveText(
    /^Revision 4.+ by alice via web · Intro · Reverted to revision 1$/,
  );
  expect(errors).toEqual([]);
});

test("a Reader sees Compare but no Revert, gets the not-found page at the revert address, and a revert submitted as a Reader changes nothing", async ({
  page,
}) => {
  const intro = await pageWithThreeRevisions();
  await setOwnRole(handbook, "reader");

  await page.goto("/folders/handbook/intro.md?view=revision&revision=2");
  await expect(page.getByRole("button", { name: "Compare" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Revert" })).toHaveCount(0);
  await expectNotFound(page, "/folders/handbook/intro.md?action=revert&revision=2");

  // The dialog was opened as a Writer; the role is lowered before it is submitted.
  await setOwnRole(handbook, "writer");
  await page.goto("/folders/handbook/intro.md?action=revert&revision=2");
  await expect(revertDialog(page).getByRole("button", { name: "Revert" })).toBeEnabled();
  await setOwnRole(handbook, "reader");
  await revertDialog(page).getByRole("button", { name: "Revert" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  expect(await stored(intro.id)).toEqual({ content: "# Intro\n\nThree", version: 1, revisions: 3 });
});

test("the newest revision and an older one with the content of the page offer no Revert, and their revert address is not found", async ({
  page,
}) => {
  const intro = await pageWithThreeRevisions();
  // Revision 4 goes back to the content of revision 2, so revision 2 has the content of the page now.
  await createRevisions({ page: intro, count: 1, content: () => "# Intro\n\nTwo", revertedTo: () => 2 });

  for (const revision of [4, 2]) {
    await page.goto(`/folders/handbook/intro.md?view=revision&revision=${revision}`);
    await expect(page.getByRole("button", { name: "Compare" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Revert" })).toHaveCount(0);
    await expectNotFound(page, `/folders/handbook/intro.md?action=revert&revision=${revision}`);
  }
  await page.goto("/folders/handbook/intro.md?view=revision&revision=3");
  await expect(page.getByRole("link", { name: "Revert" })).toBeVisible();

  for (const address of [
    "/folders/handbook/intro.md?action=revert",
    "/folders/handbook/intro.md?action=revert&revision=",
    "/folders/handbook/intro.md?action=revert&revision=0",
    "/folders/handbook/intro.md?action=revert&revision=5",
    "/folders/handbook/intro.md?action=revert&revision=1&revision=3",
    "/folders/handbook/intro.md?action=revert&revision=1&view=revision",
    "/folders/handbook/intro.md?action=revert&revision=1&format=raw",
    "/folders/handbook/intro.md?action=edit&revision=1",
  ]) {
    await expectNotFound(page, address);
  }
});

test("a revert opened before another user's save is refused with who changed the page, how and when, and the page keeps that save", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const bob = await createUser({ name: "bob" });
  const intro = await pageWithThreeRevisions();

  await page.goto("/folders/handbook/intro.md?action=revert&revision=1");
  await expect(revertDialog(page).getByRole("button", { name: "Revert" })).toBeEnabled();
  // Bob saves through MCP while the dialog is open.
  await createRevisions({ page: intro, count: 1, content: () => "# Intro\n\nBob's text", editor: bob, via: "mcp" });
  await getTestDb().page.update({
    where: { id: intro.id },
    data: { version: 2, lastEditedById: bob.id, lastEditedVia: "mcp" },
  });

  await revertDialog(page).getByRole("button", { name: "Revert" }).click();

  await expect(page).toHaveURL("/folders/handbook/intro.md?action=revert&revision=1&notice=changed");
  await expect(revertDialog(page).getByRole("alert")).toHaveText(
    /^This page was changed by bob via mcp at .+ after you opened it\.$/,
  );
  expect(await stored(intro.id)).toEqual({ content: "# Intro\n\nBob's text", version: 2, revisions: 4 });

  // Confirming again, with the page as it is now, reverts it.
  await revertDialog(page).getByRole("button", { name: "Revert" }).click();
  await expect(page).toHaveURL("/folders/handbook/intro.md");
  expect(await stored(intro.id)).toEqual({ content: "# Intro\n\nOne", version: 3, revisions: 5 });
  expect(errors).toEqual([]);
});

test("a revert without a version is refused with the message, and the page stays as it was", async ({ page }) => {
  const bob = await createUser({ name: "bob" });
  const intro = await createPage({ folder: handbook, name: "intro", content: "# Intro\n\nOne", editor: bob });
  await createRevisions({ page: intro, count: 1, content: () => "# Intro\n\nTwo", editor: bob });

  await page.goto("/folders/handbook/intro.md?action=revert&revision=1");
  const confirm = revertDialog(page).getByRole("button", { name: "Revert" });
  // A dialog that submits no version, as one opened before the version existed, or a crafted request.
  await confirm.evaluate(
    (button: HTMLButtonElement, field) =>
      button.form?.addEventListener("formdata", (event) => event.formData.delete(field)),
    VERSION_FIELD,
  );
  await confirm.click();

  await expect(page).toHaveURL("/folders/handbook/intro.md?action=revert&revision=1&notice=changed");
  await expect(revertDialog(page).getByRole("alert")).toHaveText(
    /^This page was changed by bob via web at .+ after you opened it\.$/,
  );
  expect(await stored(intro.id)).toEqual({ content: "# Intro\n\nTwo", version: 1, revisions: 2 });
});

test("a revert after a rename meanwhile is refused and shows the dialog at the new address", async ({ page }) => {
  const bob = await createUser({ name: "bob" });
  const intro = await pageWithThreeRevisions();

  await page.goto("/folders/handbook/intro.md?action=revert&revision=1");
  await expect(revertDialog(page).getByRole("button", { name: "Revert" })).toBeEnabled();
  // Bob renames the page while the dialog is open; a rename records no revision.
  await getTestDb().page.update({
    where: { id: intro.id },
    data: { name: "start", version: { increment: 1 }, lastEditedById: bob.id, lastEditedVia: "web" },
  });
  await revertDialog(page).getByRole("button", { name: "Revert" }).click();

  await expect(page).toHaveURL("/folders/handbook/start.md?action=revert&revision=1&notice=changed");
  await expect(revertDialog(page).getByRole("alert")).toHaveText(
    /^This page was changed by bob via web at .+ after you opened it\.$/,
  );
  expect(await stored(intro.id)).toEqual({ content: "# Intro\n\nThree", version: 2, revisions: 3 });

  // Confirming again, at the new address, reverts the page.
  await revertDialog(page).getByRole("button", { name: "Revert" }).click();
  await expect(page).toHaveURL("/folders/handbook/start.md");
  expect(await stored(intro.id)).toEqual({ content: "# Intro\n\nOne", version: 3, revisions: 4 });
});

test("a revert of a page deleted meanwhile shows that it no longer exists, and nothing is recorded", async ({
  page,
}) => {
  const intro = await pageWithThreeRevisions();

  await page.goto("/folders/handbook/intro.md?action=revert&revision=1");
  await expect(revertDialog(page).getByRole("button", { name: "Revert" })).toBeEnabled();
  await getTestDb().page.update({ where: { id: intro.id }, data: { deletedAt: new Date() } });
  await revertDialog(page).getByRole("button", { name: "Revert" }).click();

  await expect(revertDialog(page).getByRole("alert")).toHaveText("This page no longer exists.");
  expect(await stored(intro.id)).toEqual({ content: "# Intro\n\nThree", version: 1, revisions: 3 });
});

test("reverting to a revision that breaks the table cell limit shows the message of that limit, and the page stays as it was", async ({
  page,
}) => {
  const intro = await pageWithThreeRevisions();
  // A revision stored before the limit existed.
  const table = `# Intro\n\n| a |\n| - |\n${"| x |\n".repeat(CONTENT_MAX_TABLE_CELLS)}`;
  await getTestDb().pageRevision.update({
    where: { pageId_number: { pageId: intro.id, number: 1 } },
    data: { content: table },
  });

  await page.goto("/folders/handbook/intro.md?action=revert&revision=1");
  await revertDialog(page).getByRole("button", { name: "Revert" }).click();

  await expect(revertDialog(page).getByRole("alert")).toContainText(CONTENT_TABLE_CELLS_MESSAGE);
  expect(await stored(intro.id)).toEqual({ content: "# Intro\n\nThree", version: 1, revisions: 3 });
});
