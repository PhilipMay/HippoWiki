import type { Page } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { collectErrors } from "./support/browser";
import { createFolder, createPage, createTab, createUser, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

test.beforeEach(async () => {
  await resetTestDatabase();
});

/** The logged-in user of the tests. */
const ALICE = { id: KNOWN_USER.id };

async function expectNotFound(page: Page, address: string) {
  const response = await page.goto(address);

  expect(response?.status(), address).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
}

/** The items of the folder list, in display order. */
function listItems(page: Page) {
  return page.getByRole("list", { name: "Folders" }).getByRole("listitem");
}

/** Removes the role of the logged-in user on the folder, as an Owner would. */
async function removeOwnRole(folder: { id: string }) {
  await getTestDb().folderRole.deleteMany({ where: { folderId: folder.id, userId: KNOWN_USER.id } });
}

test.describe("without a role on a folder", () => {
  test("the user sees the folder neither in the list nor at any of its addresses", async ({ page }) => {
    const bob = await createUser({ name: "bob" });
    const hidden = await createFolder({ name: "hidden", roles: [{ user: bob, role: "owner" }] });
    const tab = await createTab({ folder: hidden, name: "guides" });
    await createPage({ folder: hidden, name: "intro" });
    await createPage({ tab, name: "setup" });
    const deleted = await createPage({ folder: hidden, name: "old", deletedAt: new Date() });
    await createFolder({ name: "mine" });

    await page.goto("/folders");
    await expect(listItems(page)).toHaveCount(1);
    await expect(listItems(page)).toHaveText([/^mine/]);

    for (const address of [
      "/folders/hidden",
      "/folders/hidden?action=new",
      "/folders/hidden?action=rename",
      "/folders/hidden?action=new-tab",
      "/folders/hidden?view=all",
      "/folders/hidden/guides",
      "/folders/hidden/guides?action=new",
      "/folders/hidden/guides?action=rename",
      "/folders/hidden/intro.md",
      "/folders/hidden/intro.md?action=edit",
      "/folders/hidden/intro.md?action=move-or-rename",
      "/folders/hidden/intro.md?action=delete",
      "/folders/hidden/guides/setup.md",
      "/folders/hidden/guides/setup.md?action=edit",
      "/deleted-pages/hidden",
      `/deleted-pages/hidden/${deleted.id}`,
    ]) {
      await expectNotFound(page, address);
    }
  });

  test("a new user without any role sees the hint, creates a folder and owns it", async ({ page }) => {
    const errors = collectErrors(page);
    const bob = await createUser({ name: "bob" });
    await createFolder({ name: "hidden", roles: [{ user: bob, role: "owner" }] });

    await page.goto("/folders");
    await expect(page.getByText("No folders yet")).toBeVisible();
    await expect(page.getByText("ask an Owner of a folder to give you a role")).toBeVisible();
    await page.getByRole("link", { name: "New folder" }).click();
    const dialog = page.getByRole("dialog", { name: "New folder" });
    await dialog.getByLabel("Name").fill("handbook");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/handbook");
    await expect(page.getByText("Your role: Owner")).toBeVisible();
    await page.goto("/folders");
    await expect(listItems(page)).toHaveText([/^handbook.*Owner$/]);
    await expect(page.getByText("No folders yet")).toHaveCount(0);
    expect(
      await getTestDb().folderRole.findMany({ select: { userId: true, role: true }, orderBy: { role: "asc" } }),
    ).toEqual([
      { userId: bob.id, role: "owner" },
      { userId: KNOWN_USER.id, role: "owner" },
    ]);
    expect(errors).toEqual([]);
  });

  test("the name of a folder the user cannot see is taken, and nothing else of it shows", async ({ page }) => {
    const bob = await createUser({ name: "bob" });
    await createFolder({ name: "project-x", roles: [{ user: bob, role: "owner" }] });

    await page.goto("/folders?action=new");
    const dialog = page.getByRole("dialog", { name: "New folder" });
    await dialog.getByLabel("Name").fill("project-x");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog.getByText("Name is already in use")).toBeVisible();
    await expect(page.getByText("bob")).toHaveCount(0);
    await expect(listItems(page)).toHaveCount(0);
    expect(await getTestDb().folder.count()).toBe(1);
  });

  test("a crafted form to create a page shows the not-found page and writes nothing", async ({ page }) => {
    const folder = await createFolder({ name: "handbook" });
    await page.goto("/folders/handbook?action=new");
    await page.getByLabel("Content").fill("# Secret");
    await page.getByRole("button", { name: "Save" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await removeOwnRole(folder);

    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    expect(await getTestDb().page.count()).toBe(0);
  });

  test("a crafted form to rename the folder shows the not-found page and writes nothing", async ({ page }) => {
    const folder = await createFolder({ name: "handbook" });
    await page.goto("/folders/handbook?action=rename");
    const dialog = page.getByRole("dialog", { name: "Rename folder" });
    await dialog.getByLabel("Name").fill("mine-now");
    await removeOwnRole(folder);

    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    expect((await getTestDb().folder.findUniqueOrThrow({ where: { id: folder.id } })).name).toBe("handbook");
  });
});

test("the folder list and the folder show the own role, for each of the four roles", async ({ page }) => {
  for (const [name, role] of [
    ["as-manager", "manager"],
    ["as-owner", "owner"],
    ["as-reader", "reader"],
    ["as-writer", "writer"],
  ] as const) {
    await createFolder({ name, roles: [{ user: ALICE, role }] });
  }

  await page.goto("/folders");
  await expect(listItems(page)).toHaveText([
    /^as-manager.*Manager$/,
    /^as-owner.*Owner$/,
    /^as-reader.*Reader$/,
    /^as-writer.*Writer$/,
  ]);

  for (const [name, label] of [
    ["as-reader", "Reader"],
    ["as-writer", "Writer"],
    ["as-manager", "Manager"],
    ["as-owner", "Owner"],
  ]) {
    await page.goto(`/folders/${name}`);
    await expect(page.getByText(`Your role: ${label}`)).toBeVisible();
  }
});
