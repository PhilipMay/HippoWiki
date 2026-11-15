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

/** Sets the role of the logged-in user on the folder, as an Owner would while a form of the user is open. */
async function setOwnRole(folder: { id: string }, role: "reader" | "writer" | "manager" | "owner") {
  await getTestDb().folderRole.updateMany({ where: { folderId: folder.id, userId: KNOWN_USER.id }, data: { role } });
}

/** The buttons and links of the main area that a role may or may not offer. */
const OFFERS = ["New page", "Edit", "Move or rename", "Delete", "Deleted pages", "New tab", "Rename"] as const;

async function expectOffers(page: Page, offered: readonly string[]) {
  const main = page.getByRole("main");
  for (const name of OFFERS) {
    await expect(main.getByRole("link", { name, exact: true }), name).toHaveCount(offered.includes(name) ? 1 : 0);
  }
}

test.describe("what each role may do", () => {
  test("a Reader reads the folder, a tab, a page and all pages, and is offered nothing else", async ({ page }) => {
    const errors = collectErrors(page);
    const folder = await createFolder({ name: "handbook", roles: [{ user: ALICE, role: "reader" }] });
    const tab = await createTab({ folder, name: "guides" });
    await createPage({ folder, name: "intro", title: "Intro" });
    await createPage({ tab, name: "setup", title: "Setup" });
    const deleted = await createPage({ folder, name: "old", deletedAt: new Date() });

    await page.goto("/folders/handbook");
    await expect(page.getByRole("link", { name: "All pages" })).toBeVisible();
    await expectOffers(page, []);
    await page.goto("/folders/handbook/guides");
    await expect(page.getByRole("heading", { level: 1, name: "guides" })).toBeVisible();
    await expectOffers(page, []);
    await page.goto("/folders/handbook/intro.md");
    await expect(page.getByRole("heading", { level: 1, name: "Intro" })).toBeVisible();
    await expectOffers(page, []);
    await page.goto("/folders/handbook/guides/setup.md");
    await expect(page.getByRole("heading", { level: 1, name: "Setup" })).toBeVisible();
    await expectOffers(page, []);
    await page.goto("/folders/handbook?view=all");
    await expect(page.getByRole("heading", { level: 1, name: "All pages" })).toBeVisible();
    expect(errors).toEqual([]);

    for (const address of [
      "/folders/handbook?action=new",
      "/folders/handbook?action=new-tab",
      "/folders/handbook?action=rename",
      "/folders/handbook/guides?action=new",
      "/folders/handbook/guides?action=rename",
      "/folders/handbook/intro.md?action=edit",
      "/folders/handbook/intro.md?action=move-or-rename",
      "/folders/handbook/intro.md?action=delete",
      "/folders/handbook/guides/setup.md?action=edit",
      "/deleted-pages/handbook",
      `/deleted-pages/handbook/${deleted.id}`,
      `/deleted-pages/handbook/${deleted.id}?action=restore`,
    ]) {
      await expectNotFound(page, address);
    }
  });

  test("a crafted form of each write of a Reader shows the not-found page and writes nothing", async ({ page }) => {
    const folder = await createFolder({ name: "handbook" });
    const tab = await createTab({ folder, name: "guides" });
    const intro = await createPage({ folder, name: "intro", title: "Intro" });
    const deleted = await createPage({ folder, name: "old", deletedAt: new Date() });
    const before = {
      folders: await getTestDb().folder.findMany(),
      tabs: await getTestDb().tab.findMany(),
      pages: await getTestDb().page.findMany({ orderBy: { name: "asc" } }),
    };
    const notFound = page.getByRole("heading", { level: 1, name: "Page not found" });

    /** Opens a form as Owner, lowers the role to Reader, submits it and sets the role back. */
    async function submitAsReader(address: string, fill: () => Promise<void>, submit: () => Promise<void>) {
      await setOwnRole(folder, "owner");
      await page.goto(address);
      await fill();
      await setOwnRole(folder, "reader");
      await submit();
      await expect(notFound, address).toBeVisible();
    }

    const save = (name: string) => () => page.getByRole("dialog").getByRole("button", { name }).click();
    await submitAsReader(
      "/folders/handbook?action=new",
      async () => {
        await page.getByLabel("Content").fill("# Crafted");
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
      },
      save("Save"),
    );
    await submitAsReader(
      "/folders/handbook/intro.md?action=edit",
      () => page.getByLabel("Content").fill("# Crafted"),
      () => page.getByRole("button", { name: "Save" }).click(),
    );
    await submitAsReader(
      "/folders/handbook/intro.md?action=move-or-rename",
      () => page.getByRole("dialog").getByLabel("Name").fill("crafted"),
      save("Save"),
    );
    await submitAsReader("/folders/handbook/intro.md?action=delete", async () => {}, save("Delete"));
    await submitAsReader(
      "/folders/handbook?action=new-tab",
      () => page.getByRole("dialog").getByLabel("Name").fill("crafted"),
      save("Save"),
    );
    await submitAsReader(
      "/folders/handbook/guides?action=rename",
      () => page.getByRole("dialog").getByLabel("Name").fill("crafted"),
      save("Save"),
    );
    await submitAsReader(
      "/folders/handbook?action=rename",
      () => page.getByRole("dialog").getByLabel("Name").fill("crafted"),
      save("Save"),
    );
    await submitAsReader(
      `/deleted-pages/handbook/${deleted.id}?action=restore`,
      () => page.getByRole("dialog").getByRole("radio", { name: "Directly in the folder" }).check(),
      save("Save"),
    );

    expect(await getTestDb().folder.findMany()).toStrictEqual(before.folders);
    expect(await getTestDb().tab.findMany()).toStrictEqual(before.tabs);
    expect(await getTestDb().page.findMany({ orderBy: { name: "asc" } })).toStrictEqual(before.pages);
    expect([tab.name, intro.name]).toEqual(["guides", "intro"]);
  });

  test("a Writer creates, edits, moves and renames a page, and is offered nothing of a Manager", async ({ page }) => {
    const errors = collectErrors(page);
    const folder = await createFolder({ name: "handbook", roles: [{ user: ALICE, role: "writer" }] });
    await createTab({ folder, name: "guides" });

    await page.goto("/folders/handbook");
    await expectOffers(page, ["New page"]);
    await page.getByRole("link", { name: "New page" }).click();
    await expect(page).toHaveURL("/folders/handbook?action=new");
    await page.getByLabel("Content", { exact: true }).fill("# Draft\n\nText");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/draft.md");
    await expectOffers(page, ["Edit", "Move or rename"]);

    await page.getByRole("main").getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL("/folders/handbook/draft.md?action=edit");
    await page.getByLabel("Content", { exact: true }).fill("# Draft\n\nEdited");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("article").getByText("Edited")).toBeVisible();

    await page.getByRole("main").getByRole("link", { name: "Move or rename" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("final");
    await dialog.getByRole("radio", { name: "Tab guides" }).check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides/final.md");

    await page.goto("/folders/handbook/guides");
    await expectOffers(page, ["New page"]);
    expect(errors).toEqual([]);
    for (const address of [
      "/folders/handbook/guides/final.md?action=delete",
      "/folders/handbook?action=new-tab",
      "/folders/handbook/guides?action=rename",
      "/folders/handbook?action=rename",
      "/deleted-pages/handbook",
    ]) {
      await expectNotFound(page, address);
    }
  });

  test("a Manager deletes, reads and restores a page, creates and renames a tab, and does not rename the folder", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const folder = await createFolder({ name: "handbook", roles: [{ user: ALICE, role: "manager" }] });
    const created = await createPage({ folder, name: "intro", title: "Intro" });

    await page.goto("/folders/handbook");
    await expectOffers(page, ["New page", "Deleted pages", "New tab"]);
    await page.goto("/folders/handbook/intro.md");
    await expectOffers(page, ["Edit", "Move or rename", "Delete"]);
    await page.getByRole("main").getByRole("link", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL("/folders/handbook");

    await page.getByRole("link", { name: "Deleted pages" }).click();
    await page.getByRole("main").getByRole("link", { name: /intro/ }).click();
    await expect(page).toHaveURL(`/deleted-pages/handbook/${created.id}`);
    await page.getByRole("main").getByRole("link", { name: "Restore" }).click();
    await page.getByRole("dialog").getByRole("radio", { name: "Directly in the folder" }).check();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/intro.md");

    await page.goto("/folders/handbook?action=new-tab");
    await page.getByRole("dialog").getByLabel("Name").fill("guides");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides");
    await expectOffers(page, ["New page", "Rename"]);
    await page.getByRole("main").getByRole("link", { name: "Rename" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill("news");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/news");
    expect(errors).toEqual([]);

    await expectNotFound(page, "/folders/handbook?action=rename");
  });

  test("a crafted form of a Manager to rename the folder shows the not-found page", async ({ page }) => {
    const folder = await createFolder({ name: "handbook" });
    await page.goto("/folders/handbook?action=rename");
    await page.getByRole("dialog").getByLabel("Name").fill("mine");
    await setOwnRole(folder, "manager");

    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    expect((await getTestDb().folder.findUniqueOrThrow({ where: { id: folder.id } })).name).toBe("handbook");
  });

  test("an Owner is offered everything and renames the folder", async ({ page }) => {
    await createFolder({ name: "handbook", roles: [{ user: ALICE, role: "owner" }] });

    await page.goto("/folders/handbook");
    await expectOffers(page, ["New page", "Deleted pages", "New tab", "Rename"]);
    await page.getByRole("main").getByRole("link", { name: "Rename" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill("guide");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/guide");
  });
});
