import type { Locator, Page } from "@playwright/test";

import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import { PLACE_FIELD, VERSION_FIELD } from "@/features/pages/forms";

import { KNOWN_USER } from "../prisma/known-users";
import { logInElsewhere } from "./support/auth";
import { by, collectErrors, expectNotFound } from "./support/browser";
import { createFolder, createPage, createTab, createUser, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;
let guides: Awaited<ReturnType<typeof createTab>>;
let meetings: Awaited<ReturnType<typeof createTab>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
  // Created out of order: the dialog lists the tabs by name.
  meetings = await createTab({ folder: handbook, name: "meetings" });
  guides = await createTab({ folder: handbook, name: "guides" });
});

/** The "Move or rename page" dialog. */
function dialogOf(page: Page) {
  return page.getByRole("dialog", { name: "Move or rename page" });
}

function breadcrumbItems(page: Page) {
  return page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem");
}

/**
 * Submits the form of the dialog although "Save" is disabled while nothing changed, as a crafted request would, once
 * the dialog is hydrated and its form submits through its own handler.
 */
async function submitUnchanged(dialog: Locator) {
  await expect(dialog.getByLabel("Name")).toBeEditable();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await dialog.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
}

/** The logged-in user of the tests, who makes every change through the GUI. */
const USER = KNOWN_USER.name;

test("Move or rename opens the dialog with the current name, place and address", async ({ page }) => {
  const errors = collectErrors(page);
  const other = await createFolder({ name: "other" });
  await createTab({ folder: other, name: "elsewhere" });
  await createPage({ folder: handbook, name: "overview", title: "Overview" });

  await page.goto("/folders/handbook/overview.md");
  await page.getByRole("link", { name: "Move or rename" }).click();

  await expect(page).toHaveURL("/folders/handbook/overview.md?action=move-or-rename");
  await expect(page).toHaveTitle("Overview – HippoWiki");
  const dialog = dialogOf(page);
  const name = dialog.getByLabel("Name");
  await expect(name).toHaveValue("overview");
  await expect(name).toBeFocused();
  await expect(name).toHaveAccessibleDescription("Address: /folders/handbook/overview.md");
  // The folder itself and its tabs by name; tabs of other folders are no choice.
  const places = dialog.getByRole("radiogroup", { name: "Place" });
  await expect(places.getByRole("radio")).toHaveCount(3);
  await expect(places.locator("label")).toHaveText(["Directly in the folder", "Tab guides", "Tab meetings"]);
  await expect(dialog.getByRole("radio", { name: "Directly in the folder" })).toBeChecked();
  // The page stays visible behind the dialog.
  await expect(page.getByRole("article", { includeHidden: true })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("the address follows the typed name and the chosen place", async ({ page }) => {
  await createPage({ tab: guides, name: "overview", title: "Overview" });

  await page.goto("/folders/handbook/guides/overview.md?action=move-or-rename");
  const dialog = dialogOf(page);
  const name = dialog.getByLabel("Name");
  await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();
  await expect(name).toHaveAccessibleDescription("Address: /folders/handbook/guides/overview.md");

  await name.fill(" summary ");
  await expect(name).toHaveAccessibleDescription("Address: /folders/handbook/guides/summary.md");
  await dialog.getByRole("radio", { name: "Tab meetings" }).check();
  await expect(name).toHaveAccessibleDescription("Address: /folders/handbook/meetings/summary.md");
  await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
  await expect(name).toHaveAccessibleDescription("Address: /folders/handbook/summary.md");
});

// The dialog keeps "Save" disabled, and Enter without effect, while name and place are those of the page.
test("the dialog keeps Save disabled, and Enter without effect, while name and place are unchanged", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const kept = await createPage({ tab: guides, name: "kept", title: "Kept page" });
  // The submissions of the dialog: each save is a POST to the address of the dialog.
  const saves: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") saves.push(request.url());
  });

  await page.goto("/folders/handbook/guides/kept.md?action=move-or-rename");
  const dialog = dialogOf(page);
  const field = dialog.getByLabel("Name");
  const save = dialog.getByRole("button", { name: "Save" });
  const hint = (address: string) => `Address: ${address}`;
  await expect(field).toBeEditable();
  await expect(field).toHaveValue("kept");
  await expect(save).toBeDisabled();
  await expect(field).toHaveAccessibleDescription(hint("/folders/handbook/guides/kept.md"));

  await field.fill("other");
  await expect(save).toBeEnabled();
  for (const unchanged of ["kept", " kept "]) {
    await field.fill(unchanged);
    await expect(save).toBeDisabled();
    await expect(field).toHaveAccessibleDescription(hint("/folders/handbook/guides/kept.md"));
  }
  await dialog.getByRole("radio", { name: "Tab meetings" }).check();
  await expect(save).toBeEnabled();
  await expect(field).toHaveAccessibleDescription(hint("/folders/handbook/meetings/kept.md"));
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await expect(save).toBeDisabled();

  await field.press("Enter");
  // An empty name differs from the current one, so Save is enabled and the server answers. Once its answer is shown,
  // a submission of the Enter before would have been sent as well.
  await field.fill("");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(field).toHaveAccessibleDescription("Name is required");
  expect(saves).toHaveLength(1);
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL("/folders/handbook/guides/kept.md?action=move-or-rename");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toStrictEqual(kept);
  expect(errors).toEqual([]);
});

test("renaming a page in the folder shows it at its new address", async ({ page }) => {
  const errors = collectErrors(page);
  const renamed = await createPage({ folder: handbook, name: "old-name", content: "# Renamed page\n\nBody" });

  await page.goto("/folders/handbook/old-name.md");
  await page.getByRole("link", { name: "Move or rename" }).click();
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill(" new-name ");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/new-name.md");
  await expect(page).toHaveTitle("Renamed page – HippoWiki");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(breadcrumbItems(page)).toHaveText(["Folders", "handbook", "new-name.md"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: renamed.id } })).toMatchObject({
    name: "new-name",
    title: "Renamed page",
    content: "# Renamed page\n\nBody",
    folderId: handbook.id,
    tabId: null,
  });
  expect(errors).toEqual([]);

  for (const oldAddress of ["/folders/handbook/old-name.md", "/folders/handbook/old-name.md?action=edit"]) {
    await expectNotFound(page, oldAddress);
  }
});

test("renaming a page in a tab keeps it in the tab", async ({ page }) => {
  const renamed = await createPage({ tab: guides, name: "old-name", content: "# Renamed page\n\nBody" });

  await page.goto("/folders/handbook/guides/old-name.md");
  await page.getByRole("link", { name: "Move or rename" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/old-name.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("new-name");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/new-name.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Renamed page"]);
  await expect(breadcrumbItems(page)).toHaveText(["Folders", "handbook", "guides", "new-name.md"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: renamed.id } })).toMatchObject({
    name: "new-name",
    title: "Renamed page",
    content: "# Renamed page\n\nBody",
    tabId: guides.id,
  });

  await expectNotFound(page, "/folders/handbook/guides/old-name.md");
});

test("moving a page from the folder into a tab shows it at its new address", async ({ page }) => {
  const errors = collectErrors(page);
  const moved = await createPage({ folder: handbook, name: "moved", content: "# Moved page\n\nBody" });

  await page.goto("/folders/handbook/moved.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/moved.md");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Moved page"]);
  await expect(breadcrumbItems(page)).toHaveText(["Folders", "handbook", "guides", "moved.md"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: moved.id } })).toMatchObject({
    name: "moved",
    title: "Moved page",
    content: "# Moved page\n\nBody",
    folderId: handbook.id,
    tabId: guides.id,
  });
  expect(errors).toEqual([]);

  await expectNotFound(page, "/folders/handbook/moved.md");
});

test("moving a page from a tab back to the folder shows it at its new address", async ({ page }) => {
  const moved = await createPage({ tab: guides, name: "moved", title: "Moved page" });

  await page.goto("/folders/handbook/guides/moved.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/moved.md");
  await expect(breadcrumbItems(page)).toHaveText(["Folders", "handbook", "moved.md"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: moved.id } })).toMatchObject({
    name: "moved",
    folderId: handbook.id,
    tabId: null,
  });

  await expectNotFound(page, "/folders/handbook/guides/moved.md");
});

test("moving a page from one tab to another shows it at its new address", async ({ page }) => {
  const moved = await createPage({ tab: guides, name: "moved", title: "Moved page" });

  await page.goto("/folders/handbook/guides/moved.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByRole("radio", { name: "Tab meetings" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/meetings/moved.md");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: moved.id } })).toMatchObject({
    folderId: handbook.id,
    tabId: meetings.id,
  });

  await expectNotFound(page, "/folders/handbook/guides/moved.md");
  // The page is listed in its new tab only.
  await page.goto("/folders/handbook/meetings");
  await expect(page.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^Moved page/]);
  await page.goto("/folders/handbook/guides");
  await expect(page.getByText("No pages yet")).toBeVisible();
});

test("renaming and moving a page together shows it at its new address", async ({ page }) => {
  const changed = await createPage({ tab: guides, name: "old-name", content: "# Changed page\n\nBody" });

  await page.goto("/folders/handbook/guides/old-name.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("new-name");
  await dialog.getByRole("radio", { name: "Tab meetings" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/meetings/new-name.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Changed page"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: changed.id } })).toMatchObject({
    name: "new-name",
    title: "Changed page",
    content: "# Changed page\n\nBody",
    tabId: meetings.id,
  });

  await expectNotFound(page, "/folders/handbook/guides/old-name.md");
  await expectNotFound(page, "/folders/handbook/guides/new-name.md");
});

test("a name taken at the target shows the error at the name field and the page stays unchanged", async ({ page }) => {
  const errors = collectErrors(page);
  const other = await createFolder({ name: "other" });
  await createPage({ tab: guides, name: "overview", title: "Guides overview" });
  await createPage({ folder: handbook, name: "taken", title: "Folder page" });
  await createPage({ folder: other, name: "free-here", title: "Page of another folder" });
  const kept = await createPage({ tab: meetings, name: "overview", title: "Meetings overview" });

  await page.goto("/folders/handbook/meetings/overview.md?action=move-or-rename");
  const dialog = dialogOf(page);
  const name = dialog.getByLabel("Name");

  // Moving only: the same name is taken in the chosen tab.
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription("Name is already in use");
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("overview");
  await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();
  await expect(page).toHaveURL("/folders/handbook/meetings/overview.md?action=move-or-rename");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);

  // Renaming and moving: the new name is taken directly in the folder.
  await name.fill("taken");
  await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(name).toHaveAccessibleDescription("Name is already in use");
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("taken");
  await expect(dialog.getByRole("radio", { name: "Directly in the folder" })).toBeChecked();
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);

  // A name that only a page of another folder uses is free.
  await name.fill("free-here");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/folders/handbook/free-here.md");
  expect(errors).toEqual([]);
});

test("an invalid name shows the error at the name field and writes nothing", async ({ page }) => {
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=move-or-rename");
  const dialog = dialogOf(page);
  const name = dialog.getByLabel("Name");
  await name.fill("Not Valid");
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(name).toHaveAccessibleDescription("Use lowercase letters, digits and single hyphens");
  await expect(name).toHaveValue("Not Valid");
  await expect(name).toBeFocused();
  await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();

  await name.fill(" ");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(name).toHaveAccessibleDescription("Name is required");

  await expect(page).toHaveURL("/folders/handbook/kept.md?action=move-or-rename");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
});

test("a page whose content is above the content limit can be moved and renamed", async ({ page }) => {
  // Stored directly, as if the limit had been lowered after the page was saved.
  const content = `# Big page\n\n${"x".repeat(CONTENT_MAX_LENGTH)}`;
  expect(content.length).toBeGreaterThan(CONTENT_MAX_LENGTH);
  const big = await createPage({ folder: handbook, name: "big", content });

  await page.goto("/folders/handbook/big.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("still-big");
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/still-big.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Big page"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: big.id } })).toMatchObject({
    name: "still-big",
    tabId: guides.id,
    title: "Big page",
    content,
  });
});

// The page keeps its last editor, channel, time and version, and the browser shows its address.
test("saving the dialog unchanged keeps the page where it is", async ({ page }) => {
  const errors = collectErrors(page);
  const bob = await createUser({ name: "bob" });
  const kept = await createPage({ tab: guides, name: "kept", title: "Kept page", editor: bob, via: "mcp", version: 3 });

  await page.goto("/folders/handbook/guides/kept.md?action=move-or-rename");
  await submitUnchanged(dialogOf(page));

  await expect(page).toHaveURL("/folders/handbook/guides/kept.md");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // No notice on the page; the empty alert of the Next.js route announcer lies outside it.
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByText(/^Last updated /)).toHaveText(by("bob", "mcp"));
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toStrictEqual(kept);
  expect(errors).toEqual([]);
});

test("Cancel returns to the page and changes nothing", async ({ page }) => {
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("other-name");
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL("/folders/handbook/kept.md");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
});

test("the Escape key returns to the page and changes nothing", async ({ page }) => {
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("other-name");
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await page.keyboard.press("Escape");

  await expect(page).toHaveURL("/folders/handbook/kept.md");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
});

test("moving into a tab that no longer exists shows an error and the page stays where it was", async ({ page }) => {
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("new-name");
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await getTestDb().tab.delete({ where: { id: guides.id } });
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("This tab no longer exists.");
  await expect(dialog.getByLabel("Name")).toHaveValue("new-name");
  await expect(page).toHaveURL("/folders/handbook/kept.md?action=move-or-rename");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
});

test("a crafted move into a tab of another folder is refused", async ({ page }) => {
  const other = await createFolder({ name: "other" });
  const foreignTab = await createTab({ folder: other, name: "foreign" });
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });

  await page.goto("/folders/handbook/kept.md?action=move-or-rename");
  const dialog = dialogOf(page);
  const save = dialog.getByRole("button", { name: "Save" });
  // A new name enables "Save".
  await dialog.getByLabel("Name").fill("moved");
  // Send the tab of another folder as the target, as a crafted request would. It is set in the submitted form data, not
  // in a radio button: React writes a radio button's value back whenever it renders the button again, e.g. on focus.
  await save.evaluate(
    (button: HTMLButtonElement, { field, tabId }) =>
      button.form?.addEventListener("formdata", (event) => event.formData.set(field, tabId)),
    { field: PLACE_FIELD, tabId: foreignTab.id },
  );
  await save.click();

  await expect(dialog.getByRole("alert")).toHaveText("This tab no longer exists.");
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toEqual(kept);
  await expectNotFound(page, "/folders/other/foreign/moved.md");
});

// A page deleted after the dialog was opened is refused as before, whatever its version.
test("saving a page that was deleted in the meantime shows an error in the dialog", async ({ page }) => {
  const created = await createPage({ folder: handbook, name: "soon-gone", title: "Soon gone" });

  await page.goto("/folders/handbook/soon-gone.md?action=move-or-rename");
  // Deleted by another user while the dialog is open.
  await getTestDb().page.update({ where: { id: created.id }, data: { deletedAt: new Date() } });
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("new-name");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("This page no longer exists.");
  await expect(dialog.getByLabel("Name")).toHaveValue("new-name");
  expect((await getTestDb().page.findUniqueOrThrow({ where: { id: created.id } })).name).toBe("soon-gone");
});

test("a page can be renamed to the name of a deleted page", async ({ page }) => {
  const kept = await createPage({ folder: handbook, name: "kept", title: "Kept page" });
  const removed = await createPage({ folder: handbook, name: "removed", deletedAt: new Date() });

  await page.goto("/folders/handbook/kept.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("removed");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/removed.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Kept page"]);
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: kept.id } })).toMatchObject({
    name: "removed",
    tabId: null,
    deletedAt: null,
  });
  expect(await getTestDb().page.findUniqueOrThrow({ where: { id: removed.id } })).toEqual(removed);
});

test("a folder without tabs offers only the folder itself", async ({ page }) => {
  const plain = await createFolder({ name: "plain" });
  await createPage({ folder: plain, name: "alone", title: "Alone" });

  await page.goto("/folders/plain/alone.md?action=move-or-rename");

  const dialog = dialogOf(page);
  await expect(dialog.getByRole("radio")).toHaveCount(1);
  await expect(dialog.getByRole("radio", { name: "Directly in the folder" })).toBeChecked();
});

for (const address of [
  "/folders/handbook/in-folder.md?action=rename",
  "/folders/handbook/in-folder.md?action=move",
  "/folders/handbook/guides/in-guides.md?action=rename",
  "/folders/handbook/guides/in-guides.md?action=move",
  "/folders/handbook?action=move-or-rename",
  "/folders/handbook/guides?action=move-or-rename",
  "/folders/handbook/in-folder.md?action=move-or-rename&action=move-or-rename",
  "/folders/handbook/no-such-page.md?action=move-or-rename",
  "/folders/handbook/guides/no-such-page.md?action=move-or-rename",
]) {
  test(`${address} shows the not-found page`, async ({ page }) => {
    await createPage({ folder: handbook, name: "in-folder", title: "In folder" });
    await createPage({ tab: guides, name: "in-guides", title: "In guides" });

    await expectNotFound(page, address);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("moving or renaming a page makes the logged-in user its last editor in the page view and the lists", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const bob = await createUser({ name: "bob" });
  await createPage({ folder: handbook, name: "moved", content: "# Moved page", editor: bob });
  await createPage({ tab: guides, name: "kept", content: "# Kept page", editor: bob });

  await page.goto("/folders/handbook/moved.md?action=move-or-rename");
  const dialog = dialogOf(page);
  await dialog.getByLabel("Name").fill("renamed");
  await dialog.getByRole("radio", { name: "Tab guides" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL("/folders/handbook/guides/renamed.md");
  await expect(page.getByText(/^Last updated /)).toHaveText(by(USER));
  await page.goto("/folders/handbook/guides");
  const items = page.getByRole("list", { name: "Pages" }).getByRole("listitem");
  await expect(items).toHaveText([/^Kept page/, /^Moved page/]);
  await expect(items).toHaveText([by("bob"), by(USER)]);
  expect(errors).toEqual([]);
});

test.describe("a page changed after the dialog was opened", () => {
  /** The folder of these tests, with the logged-in user and bob as Writers, and its tab. */
  let team: Awaited<ReturnType<typeof createFolder>>;
  let bob: Awaited<ReturnType<typeof createUser>>;
  let teamGuides: Awaited<ReturnType<typeof createTab>>;

  test.beforeEach(async () => {
    bob = await createUser({ name: "bob", mustChangePassword: false });
    team = await createFolder({
      name: "team",
      roles: [
        { user: { id: KNOWN_USER.id }, role: "writer" },
        { user: bob, role: "writer" },
      ],
    });
    teamGuides = await createTab({ folder: team, name: "guides" });
  });

  test("refuses the move after a content save and shows the stored name and place with who changed it and when", async ({
    page,
    browser,
  }) => {
    const errors = collectErrors(page);
    const plan = await createPage({ folder: team, name: "plan", content: "# Plan\n\nFirst draft" });
    const other = await logInElsewhere(browser, "bob");

    // The dialog is open while bob saves the content.
    await page.goto("/folders/team/plan.md?action=move-or-rename");
    await other.page.goto("/folders/team/plan.md?action=edit");
    await other.page.getByLabel("Content").fill("# Plan\n\nBob's version");
    await other.page.getByRole("button", { name: "Save" }).click();
    await expect(other.page).toHaveURL("/folders/team/plan.md");
    const time = (await other.page.getByRole("article").locator("time").textContent()) ?? "";

    const dialog = dialogOf(page);
    await dialog.getByLabel("Name").fill("new-plan");
    await dialog.getByRole("radio", { name: "Tab guides" }).check();
    await dialog.getByRole("button", { name: "Save" }).click();

    // The dialog stays open with the name and place as stored and the message.
    await expect(page).toHaveURL("/folders/team/plan.md?action=move-or-rename&notice=changed");
    await expect(dialog.getByRole("alert")).toHaveText(
      `This page was changed by bob via web at ${time} after you opened it.`,
    );
    await expect(dialog.getByLabel("Name")).toHaveValue("plan");
    await expect(dialog.getByRole("radio", { name: "Directly in the folder" })).toBeChecked();
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).toMatchObject({
      name: "plan",
      tabId: null,
    });

    // The dialog shows the page as stored, so nothing is changed until the name or place is.
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    // Saving the dialog again moves the page.
    await dialog.getByLabel("Name").fill("new-plan");
    await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
    await dialog.getByRole("radio", { name: "Tab guides" }).check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/team/guides/new-plan.md");
    expect(errors).toEqual([]);
    await other.context.close();
  });

  test("names the channel mcp for a page changed through MCP after the dialog was opened", async ({ page }) => {
    const plan = await createPage({ folder: team, name: "plan", content: "# Plan\n\nFirst draft" });

    await page.goto("/folders/team/plan.md?action=move-or-rename");
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
    const dialog = dialogOf(page);
    await dialog.getByLabel("Name").fill("new-plan");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/team/plan.md?action=move-or-rename&notice=changed");
    await expect(dialog.getByRole("alert")).toHaveText(
      /^This page was changed by bob via mcp at .+ after you opened it\.$/,
    );
  });

  // An unchanged save of the dialog does not refuse the editor that another user has open.
  test("an unchanged save of the dialog keeps the editor of another user from being refused", async ({
    page,
    browser,
  }) => {
    const errors = collectErrors(page);
    const plan = await createPage({ folder: team, name: "plan", content: "# Plan\n\nFirst draft" });
    const other = await logInElsewhere(browser, "bob");

    await other.page.goto("/folders/team/plan.md?action=edit");
    await other.page.getByLabel("Content").fill("# Plan\n\nBob's version");

    await page.goto("/folders/team/plan.md?action=move-or-rename");
    await submitUnchanged(dialogOf(page));
    await expect(page).toHaveURL("/folders/team/plan.md");
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).toStrictEqual(plan);

    await other.page.getByRole("button", { name: "Save" }).click();
    await expect(other.page).toHaveURL("/folders/team/plan.md");
    await expect(other.page.getByRole("article").getByText("Bob's version")).toBeVisible();
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).toMatchObject({
      content: "# Plan\n\nBob's version",
      lastEditedById: bob.id,
      version: 2,
    });
    expect(errors).toEqual([]);
    await other.context.close();
  });

  // An unchanged save based on an older version is refused like every other save.
  test("refuses an unchanged save after a content save and shows the dialog with who changed the page and when", async ({
    page,
  }) => {
    const plan = await createPage({ tab: teamGuides, name: "plan" });

    await page.goto("/folders/team/guides/plan.md?action=move-or-rename");
    await getTestDb().page.update({
      where: { id: plan.id },
      data: { content: "# Plan\n\nBy bob", version: { increment: 1 }, lastEditedById: bob.id, lastEditedVia: "web" },
    });
    const dialog = dialogOf(page);
    await submitUnchanged(dialog);

    await expect(page).toHaveURL("/folders/team/guides/plan.md?action=move-or-rename&notice=changed");
    await expect(dialog.getByRole("alert")).toHaveText(
      /^This page was changed by bob via web at .+ after you opened it\.$/,
    );
    await expect(dialog.getByLabel("Name")).toHaveValue("plan");
    await expect(dialog.getByRole("radio", { name: "Tab guides" })).toBeChecked();
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).toMatchObject({
      version: 2,
      lastEditedById: bob.id,
    });

    // "Save" stays disabled until the place changes; then saving moves the page.
    const save = dialog.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    await dialog.getByRole("radio", { name: "Directly in the folder" }).check();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page).toHaveURL("/folders/team/plan.md");
  });

  // The dialog is shown again at the page's new address, with the new name.
  test("refuses the rename after a rename by another user and shows the dialog at the new address", async ({
    page,
    browser,
  }) => {
    const plan = await createPage({ folder: team, name: "plan" });
    const other = await logInElsewhere(browser, "bob");

    await page.goto("/folders/team/plan.md?action=move-or-rename");
    await other.page.goto("/folders/team/plan.md?action=move-or-rename");
    await dialogOf(other.page).getByLabel("Name").fill("release-plan");
    await dialogOf(other.page).getByRole("button", { name: "Save" }).click();
    await expect(other.page).toHaveURL("/folders/team/release-plan.md");

    const dialog = dialogOf(page);
    await dialog.getByLabel("Name").fill("my-plan");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/team/release-plan.md?action=move-or-rename&notice=changed");
    await expect(dialog.getByLabel("Name")).toHaveValue("release-plan");
    await expect(dialog.getByRole("alert")).toHaveText(
      /^This page was changed by bob via web at .+ after you opened it\.$/,
    );
    expect((await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).name).toBe("release-plan");

    // "Save" is disabled for the new name until it is changed; then saving renames the page.
    const save = dialog.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    await dialog.getByLabel("Name").fill("my-plan");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page).toHaveURL("/folders/team/my-plan.md");
    await other.context.close();
  });

  // A dialog opened before the feature submits no version; its save is refused once.
  test("refuses a save without a version and shows the stored name and place with the message", async ({ page }) => {
    const plan = await createPage({ folder: team, name: "plan", editor: bob });

    await page.goto("/folders/team/plan.md?action=move-or-rename");
    const dialog = dialogOf(page);
    await dialog.getByLabel("Name").fill("new-plan");
    await dialog.getByRole("radio", { name: "Tab guides" }).check();
    const save = dialog.getByRole("button", { name: "Save" });
    await save.evaluate(
      (button: HTMLButtonElement, field) =>
        button.form?.addEventListener("formdata", (event) => event.formData.delete(field)),
      VERSION_FIELD,
    );
    await save.click();

    await expect(page).toHaveURL("/folders/team/plan.md?action=move-or-rename&notice=changed");
    await expect(dialog.getByLabel("Name")).toHaveValue("plan");
    await expect(dialog.getByRole("radio", { name: "Directly in the folder" })).toBeChecked();
    await expect(dialog.getByRole("alert")).toHaveText(
      /^This page was changed by bob via web at .+ after you opened it\.$/,
    );
    expect(await getTestDb().page.findUniqueOrThrow({ where: { id: plan.id } })).toStrictEqual(plan);
    await expect(save).toBeDisabled();
  });
});
