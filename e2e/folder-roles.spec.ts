import type { Page } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, becomeUser, logInElsewhere } from "./support/auth";
import { collectErrors, expectNotFound, expectNotFoundResponse } from "./support/browser";
import {
  createFolder,
  createFolderRole,
  createPage,
  createTab,
  createUser,
  getTestDb,
  resetTestDatabase,
  setOwnRole,
} from "./support/database";
import { fillContent } from "./support/editor";
import { expect, test } from "./support/test";

test.beforeEach(async () => {
  await resetTestDatabase();
});

/** The logged-in user of the tests. */
const ALICE = { id: KNOWN_USER.id };

/** The items of the folder list, in display order. */
function listItems(page: Page) {
  return page.getByRole("list", { name: "Folders" }).getByRole("listitem");
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

    // One address per kind of route: the role is checked before the action or view is read.
    for (const address of [
      "/folders/hidden?action=new",
      "/folders/hidden/guides",
      "/folders/hidden/intro.md?action=edit",
      "/folders/hidden/guides/setup.md",
      "/deleted-items/hidden",
      `/deleted-items/hidden/${deleted.id}`,
    ]) {
      await expectNotFoundResponse(page.request, address);
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

  // A crafted form of a user who lost the role is refused like one of a role too low (src/features/pages/actions.test.ts,
  // src/features/folders/actions.test.ts and integration/folder-role-service.test.ts).
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

/** The buttons and links of the main area that a role may or may not offer. */
const OFFERS = ["New page", "Edit", "Move or rename", "Delete", "Deleted items", "New tab", "Rename"] as const;

async function expectOffers(page: Page, offered: readonly string[]) {
  const main = page.getByRole("main");
  for (const name of OFFERS) {
    await expect(main.getByRole("link", { name, exact: true }), name).toHaveCount(offered.includes(name) ? 1 : 0);
  }
}

/**
 * Opens a form as Owner, lowers the own role on the folder to the given one, submits the form and expects the
 * not-found page, as a crafted request of a user with that role gets it. The role is set back to Owner first.
 */
async function submitAs(
  page: Page,
  folder: { id: string },
  role: "reader" | "writer" | "manager",
  address: string,
  fill: () => Promise<void>,
  submit: () => Promise<void>,
) {
  await setOwnRole(folder, "owner");
  await page.goto(address);
  await fill();
  await setOwnRole(folder, role);
  await submit();
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" }), address).toBeVisible();
}

/** Clicks the button of the open dialog with the given name. */
function clickInDialog(page: Page, name: string) {
  return () => page.getByRole("dialog").getByRole("button", { name }).click();
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

    // One address per kind of route; the lowest role of each action is in the unit tests of `folderAddressOf()`,
    // `tabAddressOf()` and `pageAddressOf()`.
    for (const address of [
      "/folders/handbook?action=new-tab",
      "/folders/handbook/guides?action=new",
      "/folders/handbook/intro.md?action=edit",
      "/folders/handbook/guides/setup.md?action=move-or-rename",
      "/deleted-items/handbook",
      `/deleted-items/handbook/${deleted.id}?action=restore`,
    ]) {
      await expectNotFoundResponse(page.request, address);
    }
  });

  test("an action beyond the role shows the not-found page under the plain title", async ({ page }) => {
    const folder = await createFolder({ name: "handbook", roles: [{ user: ALICE, role: "reader" }] });
    const tab = await createTab({ folder, name: "guides" });
    await createPage({ folder, name: "intro", title: "Intro" });
    await createPage({ tab, name: "setup", title: "Setup" });

    // The title and the page decide alike, so the not-found page of an action is not titled like the action. One
    // address per kind of route, the title read from the HTML.
    for (const address of [
      "/folders/handbook?action=new",
      "/folders/handbook/guides?action=new",
      "/folders/handbook/intro.md?action=edit",
      "/folders/handbook/guides/setup.md?action=revert&revision=1",
    ]) {
      await expectNotFoundResponse(page.request, address);
      const html = await (await page.request.get(address)).text();
      expect(html.match(/<title>([^<]*)<\/title>/)?.[1], address).toBe("HippoWiki");
    }
  });

  // One editor form and one dialog form; every other write of a Reader is refused by the same check
  // (src/features/pages/actions.test.ts, src/features/folders/actions.test.ts and the services).
  test("a crafted form of a write of a Reader shows the not-found page and writes nothing", async ({ page }) => {
    const folder = await createFolder({ name: "handbook" });
    await createPage({ folder, name: "intro", title: "Intro" });
    const before = {
      tabs: await getTestDb().tab.findMany(),
      pages: await getTestDb().page.findMany({ orderBy: { name: "asc" } }),
    };
    const submitAsReader = (address: string, fill: () => Promise<void>, submit: () => Promise<void>) =>
      submitAs(page, folder, "reader", address, fill, submit);
    await submitAsReader(
      "/folders/handbook/intro.md?action=edit",
      () => fillContent(page, "# Crafted"),
      () => page.getByRole("button", { name: "Save" }).click(),
    );
    await submitAsReader(
      "/folders/handbook?action=new-tab",
      () => page.getByRole("dialog").getByLabel("Name").fill("crafted"),
      clickInDialog(page, "Save"),
    );

    expect(await getTestDb().tab.findMany()).toStrictEqual(before.tabs);
    expect(await getTestDb().page.findMany({ orderBy: { name: "asc" } })).toStrictEqual(before.pages);
  });

  test("a Writer creates, edits, moves and renames a page, and is offered nothing of a Manager", async ({ page }) => {
    const errors = collectErrors(page);
    const folder = await createFolder({ name: "handbook", roles: [{ user: ALICE, role: "writer" }] });
    await createTab({ folder, name: "guides" });
    const deleted = await createPage({ folder, name: "old", deletedAt: new Date() });

    await page.goto("/folders/handbook");
    await expectOffers(page, ["New page"]);
    await page.getByRole("link", { name: "New page" }).click();
    await expect(page).toHaveURL("/folders/handbook?action=new");
    await fillContent(page, "# Draft\n\nText");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/draft.md");
    await expectOffers(page, ["Edit", "Move or rename"]);

    await page.getByRole("main").getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL("/folders/handbook/draft.md?action=edit");
    await fillContent(page, "# Draft\n\nEdited");
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
    // One address per kind of route.
    for (const address of [
      "/folders/handbook/guides/final.md?action=delete",
      "/folders/handbook?action=new-tab",
      "/folders/handbook/guides?action=rename",
      "/deleted-items/handbook",
      `/deleted-items/handbook/${deleted.id}?action=restore`,
    ]) {
      await expectNotFoundResponse(page.request, address);
    }
  });

  // One form; the other functions of a Manager are refused for a Writer by the same check.
  test("a crafted form of a function of a Manager, submitted as a Writer, shows the not-found page and writes nothing", async ({
    page,
  }) => {
    const folder = await createFolder({ name: "handbook" });
    await createPage({ folder, name: "intro", title: "Intro" });
    const before = await getTestDb().page.findMany({ orderBy: { name: "asc" } });

    await submitAs(
      page,
      folder,
      "writer",
      "/folders/handbook/intro.md?action=delete",
      async () => {},
      clickInDialog(page, "Delete"),
    );

    expect(await getTestDb().page.findMany({ orderBy: { name: "asc" } })).toStrictEqual(before);
  });

  test("a Manager deletes, reads and restores a page, creates, renames and deletes a tab, and does not rename the folder", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const folder = await createFolder({ name: "handbook", roles: [{ user: ALICE, role: "manager" }] });
    const created = await createPage({ folder, name: "intro", title: "Intro" });

    await page.goto("/folders/handbook");
    await expectOffers(page, ["New page", "Deleted items", "New tab"]);
    await page.goto("/folders/handbook/intro.md");
    await expectOffers(page, ["Edit", "Move or rename", "Delete"]);
    await page.getByRole("main").getByRole("link", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL("/folders/handbook");

    await page.getByRole("link", { name: "Deleted items" }).click();
    await page.getByRole("main").getByRole("link", { name: /intro/ }).click();
    await expect(page).toHaveURL(`/deleted-items/handbook/${created.id}`);
    await page.getByRole("main").getByRole("link", { name: "Restore" }).click();
    await page.getByRole("dialog").getByRole("radio", { name: "Directly in the folder" }).check();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/intro.md");

    await page.goto("/folders/handbook?action=new-tab");
    await page.getByRole("dialog").getByLabel("Name").fill("guides");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides");
    await expectOffers(page, ["New page", "Rename", "Delete"]);
    await page.getByRole("main").getByRole("link", { name: "Rename" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill("news");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/handbook/news");
    await page.getByRole("main").getByRole("link", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL("/folders/handbook");
    expect(await getTestDb().tab.count()).toBe(0);
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
    const folder = await createFolder({ name: "handbook", roles: [{ user: ALICE, role: "owner" }] });
    await createTab({ folder, name: "guides" });

    await page.goto("/folders/handbook/guides");
    await expectOffers(page, ["New page", "Rename", "Delete"]);
    await page.goto("/folders/handbook");
    await expectOffers(page, ["New page", "Deleted items", "New tab", "Rename"]);
    await page.getByRole("main").getByRole("link", { name: "Rename" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill("guide");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/guide");
  });
});

test.describe("the roles view", () => {
  test("a Reader opens Roles from the folder and sees every user with a role, Owners first, without controls", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const [zoe, anna, ben, dave] = [
      await createUser({ name: "zoe" }),
      await createUser({ name: "anna" }),
      await createUser({ name: "ben" }),
      await createUser({ name: "dave" }),
    ];
    await createFolder({
      name: "project-x",
      roles: [
        { user: ALICE, role: "reader" },
        { user: zoe, role: "owner" },
        { user: ben, role: "writer" },
        { user: anna, role: "owner" },
        { user: dave, role: "reader" },
      ],
    });

    await page.goto("/folders/project-x");
    await page.getByRole("main").getByRole("link", { name: "Roles" }).click();

    await expect(page).toHaveURL("/folders/project-x?view=roles");
    await expect(page).toHaveTitle("Roles – project-x – HippoWiki");
    await expect(page.getByRole("heading", { level: 1, name: "Roles" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Roles" }).getByRole("listitem")).toHaveText([
      "annaOwner",
      "zoeOwner",
      "benWriter",
      "aliceReader",
      "daveReader",
    ]);
    await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("combobox")).toHaveCount(0);
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "project-x" }).click();
    await expect(page).toHaveURL("/folders/project-x");
    expect(errors).toEqual([]);
  });

  test("a user without a role sees the not-found page at the roles view", async ({ page }) => {
    const bob = await createUser({ name: "bob" });
    await createFolder({ name: "project-x", roles: [{ user: bob, role: "owner" }] });

    await expectNotFound(page, "/folders/project-x?view=roles");
    await expectNotFound(page, "/folders/project-x?view=roles&action=rename");
  });
});

/** The "Give role" dialog. */
function giveRoleDialog(page: Page) {
  return page.getByRole("dialog", { name: "Give role" });
}

test.describe("giving a role", () => {
  test("an Owner gives a Writer role from the roles view, lands on the folder and sees the user in the roles", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await createUser({ name: "bob" });
    await createFolder({ name: "project-x", editor: await aliceUser() });

    await page.goto("/folders/project-x?view=roles");
    await page.getByRole("main").getByRole("link", { name: "Give role" }).click();
    await expect(page).toHaveURL("/folders/project-x?action=give-role");
    const dialog = giveRoleDialog(page);
    await dialog.getByLabel("User").selectOption("bob");
    await dialog.getByRole("radio", { name: "Writer" }).check();
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL("/folders/project-x");
    await page.goto("/folders/project-x?view=roles");
    await expect(page.getByRole("list", { name: "Roles" }).getByRole("listitem")).toHaveCount(2);
    await expect(roleOf(page, "alice")).toHaveValue("owner");
    await expect(roleOf(page, "bob")).toHaveValue("writer");
    expect(errors).toEqual([]);
  });

  test("the dialog puts the focus on the user once it is open", async ({ page }) => {
    await createUser({ name: "bob" });
    await createFolder({ name: "project-x", editor: await aliceUser() });

    await page.goto("/folders/project-x?action=give-role");

    await expect(giveRoleDialog(page).getByLabel("User")).toBeFocused();
  });

  test("saving without a user shows choose a user at the field and gives no role", async ({ page }) => {
    await createUser({ name: "bob" });
    await createFolder({ name: "project-x", editor: await aliceUser() });

    await page.goto("/folders/project-x?action=give-role");
    const dialog = giveRoleDialog(page);
    await dialog.getByRole("radio", { name: "Writer" }).check();
    await dialog.getByRole("button", { name: "Save" }).click();

    const user = dialog.getByLabel("User");
    await expect(user).toHaveAttribute("aria-invalid", "true");
    await expect(user).toHaveAccessibleDescription("Choose a user");
    await expect(user).toBeFocused();
    await expect(dialog.getByRole("radio", { name: "Writer" })).toBeChecked();
    await expect(page).toHaveURL("/folders/project-x?action=give-role");
    expect(await getTestDb().folderRole.count()).toBe(1);
  });

  test("giving a role to a user who got one meanwhile shows an error at the user and keeps that role", async ({
    page,
  }) => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "project-x", editor: await aliceUser() });

    await page.goto("/folders/project-x?action=give-role");
    const dialog = giveRoleDialog(page);
    await dialog.getByLabel("User").selectOption("bob");
    await dialog.getByRole("radio", { name: "Owner" }).check();
    // Another Owner gives bob a role while the dialog is open.
    const given = await createFolderRole({ folder, user: bob, role: "reader" });
    await dialog.getByRole("button", { name: "Save" }).click();

    const user = dialog.getByLabel("User");
    await expect(user).toHaveAccessibleDescription("This user already has a role on the folder");
    await expect(user).toBeFocused();
    expect(await getTestDb().folderRole.findFirstOrThrow({ where: { userId: bob.id } })).toStrictEqual(given);
  });

  test("the list of the dialog has no admin and no user who has a role, and Cancel leads to the folder", async ({
    page,
  }) => {
    const [bob] = [await createUser({ name: "bob" }), await createUser({ name: "dave" })];
    await createUser({ name: "maria", type: "admin" });
    await createFolder({
      name: "project-x",
      editor: await aliceUser(),
      roles: [
        { user: ALICE, role: "owner" },
        { user: bob, role: "reader" },
      ],
    });

    await page.goto("/folders/project-x?action=give-role");

    const options = giveRoleDialog(page).getByLabel("User").locator("option");
    await expect(options).toHaveText(["Choose a user", "dave"]);
    await giveRoleDialog(page).getByRole("link", { name: "Cancel" }).click();
    await expect(page).toHaveURL("/folders/project-x");
  });

  // That an Owner may give roles is shown by alice; the role is read as stored, so bob's next request has it.
  test("an Owner makes another user Owner", async ({ page }) => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "project-x", editor: await aliceUser() });

    await page.goto("/folders/project-x?action=give-role");
    await giveRoleDialog(page).getByLabel("User").selectOption("bob");
    await giveRoleDialog(page).getByRole("radio", { name: "Owner" }).check();
    await giveRoleDialog(page).getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL("/folders/project-x");

    expect(
      await getTestDb().folderRole.findUniqueOrThrow({
        where: { folderId_userId: { folderId: folder.id, userId: bob.id } },
        select: { role: true },
      }),
    ).toEqual({ role: "owner" });
  });

  test("with every user holding a role, the dialog says so and offers no Save", async ({ page }) => {
    const bob = await createUser({ name: "bob" });
    await createFolder({
      name: "project-x",
      editor: await aliceUser(),
      roles: [
        { user: ALICE, role: "owner" },
        { user: bob, role: "writer" },
      ],
    });

    await page.goto("/folders/project-x?action=give-role");

    const dialog = giveRoleDialog(page);
    await expect(dialog.getByText("Every user already has a role on this folder")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
    await expect(dialog.getByRole("link", { name: "Cancel" })).toBeVisible();
  });

  for (const role of ["manager", "writer", "reader"] as const) {
    test(`a ${role} sees no Give role, and its address shows the not-found page`, async ({ page }) => {
      await createUser({ name: "bob" });
      await createFolder({ name: "project-x", roles: [{ user: ALICE, role }] });

      await page.goto("/folders/project-x?view=roles");
      await expect(page.getByRole("heading", { level: 1, name: "Roles" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Give role" })).toHaveCount(0);
      await expectNotFound(page, "/folders/project-x?action=give-role");
    });
  }
});

/** The logged-in user as a row of the database, to be the last editor of a folder, so that no other user is created. */
async function aliceUser() {
  return getTestDb().user.findUniqueOrThrow({ where: { id: KNOWN_USER.id } });
}

/** The role choice of a user in the roles view of an Owner. */
function roleOf(page: Page, name: string) {
  return page.getByRole("main").getByLabel(`Role of ${name}`, { exact: true });
}

test.describe("changing and removing roles", () => {
  test("an Owner changes a Writer to a Manager and removes a Reader with one click each", async ({ page }) => {
    const errors = collectErrors(page);
    const [bob, dave] = [await createUser({ name: "bob" }), await createUser({ name: "dave" })];
    await createFolder({
      name: "project-x",
      editor: await aliceUser(),
      roles: [
        { user: ALICE, role: "owner" },
        { user: bob, role: "writer" },
        { user: dave, role: "reader" },
      ],
    });

    await page.goto("/folders/project-x?view=roles");
    await roleOf(page, "bob").selectOption("manager");
    await expect(roleOf(page, "bob")).toHaveValue("manager");
    await page.getByRole("button", { name: "Remove the role of dave" }).click();

    await expect(roleOf(page, "dave")).toHaveCount(0);
    await expect(page).toHaveURL("/folders/project-x?view=roles");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await getTestDb().folderRole.findMany({ select: { userId: true, role: true }, orderBy: { role: "asc" } }),
    ).toEqual([
      { userId: bob.id, role: "manager" },
      { userId: KNOWN_USER.id, role: "owner" },
    ]);
    expect(errors).toEqual([]);
  });

  test("an Owner lowers another Owner to Writer", async ({ page }) => {
    const bob = await createUser({ name: "bob" });
    await createFolder({
      name: "project-x",
      roles: [
        { user: ALICE, role: "owner" },
        { user: bob, role: "owner" },
      ],
    });

    await page.goto("/folders/project-x?view=roles");
    await roleOf(page, "bob").selectOption("writer");

    await expect(roleOf(page, "bob")).toHaveValue("writer");
    await expect(page.getByRole("list", { name: "Roles" }).getByRole("listitem").first()).toContainText("alice");
  });

  test("on a folder with two Owners, an Owner lowers the own role after confirming and loses the controls", async ({
    page,
  }) => {
    const bob = await createUser({ name: "bob" });
    await createFolder({
      name: "project-x",
      roles: [
        { user: ALICE, role: "owner" },
        { user: bob, role: "owner" },
      ],
    });

    await page.goto("/folders/project-x?view=roles");
    await roleOf(page, "alice").selectOption("reader");
    const confirm = page.getByRole("dialog", { name: "Change your role" });
    await expect(confirm).toContainText("Reader");
    await confirm.getByRole("button", { name: "Change my role" }).click();

    await expect(page).toHaveURL("/folders/project-x?view=roles");
    await expect(page.getByRole("list", { name: "Roles" }).getByRole("listitem")).toHaveText([
      "bobOwner",
      "aliceReader",
    ]);
    await expect(page.getByRole("main").getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Give role" })).toHaveCount(0);
  });

  test("cancelling the confirmation keeps the own role", async ({ page }) => {
    const bob = await createUser({ name: "bob" });
    await createFolder({
      name: "project-x",
      roles: [
        { user: ALICE, role: "owner" },
        { user: bob, role: "owner" },
      ],
    });

    await page.goto("/folders/project-x?view=roles");
    await page.getByRole("button", { name: "Remove the role of alice" }).click();
    await page.getByRole("dialog", { name: "Remove your role" }).getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(roleOf(page, "alice")).toHaveValue("owner");
    expect(await getTestDb().folderRole.count()).toBe(2);
  });

  test("an Owner who removes the own role confirms and lands on the folder list, without the folder", async ({
    page,
  }) => {
    const bob = await createUser({ name: "bob" });
    await createFolder({
      name: "project-x",
      roles: [
        { user: ALICE, role: "owner" },
        { user: bob, role: "owner" },
      ],
    });

    await page.goto("/folders/project-x?view=roles");
    await page.getByRole("button", { name: "Remove the role of alice" }).click();
    await page
      .getByRole("dialog", { name: "Remove your role" })
      .getByRole("button", { name: "Remove my role" })
      .click();

    await expect(page).toHaveURL("/folders");
    await expect(page.getByText("No folders yet")).toBeVisible();
  });

  for (const intent of ["change", "remove"] as const) {
    test(`a ${intent} of a role that another Owner removed meanwhile says so and writes nothing`, async ({ page }) => {
      const bob = await createUser({ name: "bob" });
      await createFolder({
        name: "project-x",
        roles: [
          { user: ALICE, role: "owner" },
          { user: bob, role: "reader" },
        ],
      });

      await page.goto("/folders/project-x?view=roles");
      await expect(roleOf(page, "bob")).toBeEnabled();
      // Another Owner removes the role of bob while the view is open.
      await getTestDb().folderRole.deleteMany({ where: { userId: bob.id } });
      if (intent === "change") await roleOf(page, "bob").selectOption("writer");
      else await page.getByRole("button", { name: "Remove the role of bob" }).click();

      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        "This user no longer has a role on the folder.",
      );
      await expect(page).toHaveURL("/folders/project-x?view=roles");
      expect(await getTestDb().folderRole.findMany({ select: { userId: true, role: true } })).toEqual([
        { userId: KNOWN_USER.id, role: "owner" },
      ]);
    });
  }

  test("cancelling the confirmation of a change of the own role keeps the own role", async ({ page }) => {
    const bob = await createUser({ name: "bob" });
    await createFolder({
      name: "project-x",
      roles: [
        { user: ALICE, role: "owner" },
        { user: bob, role: "owner" },
      ],
    });
    const before = await getTestDb().folderRole.findMany({ orderBy: { id: "asc" } });

    await page.goto("/folders/project-x?view=roles");
    await roleOf(page, "alice").selectOption("reader");
    await page.getByRole("dialog", { name: "Change your role" }).getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(roleOf(page, "alice")).toHaveValue("owner");
    expect(await getTestDb().folderRole.findMany({ orderBy: { id: "asc" } })).toStrictEqual(before);
  });

  test("the only Owner can neither lower nor remove the own role, and is told why", async ({ page }) => {
    const bob = await createUser({ name: "bob" });
    await createFolder({
      name: "project-x",
      roles: [
        { user: ALICE, role: "owner" },
        { user: bob, role: "manager" },
      ],
    });

    await page.goto("/folders/project-x?view=roles");
    await roleOf(page, "alice").selectOption("writer");
    await page
      .getByRole("dialog", { name: "Change your role" })
      .getByRole("button", { name: "Change my role" })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(/A folder needs at least one Owner/);
    await page.getByRole("button", { name: "Remove the role of alice" }).click();
    await page
      .getByRole("dialog", { name: "Remove your role" })
      .getByRole("button", { name: "Remove my role" })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(/A folder needs at least one Owner/);

    await page.reload();
    await expect(roleOf(page, "alice")).toHaveValue("owner");
    expect(await getTestDb().folderRole.count({ where: { userId: KNOWN_USER.id, role: "owner" } })).toBe(1);
  });

  // A crafted Remove and a crafted Give role of a Manager are refused by the same check
  // (integration/folder-role-service.test.ts), and "a manager sees no Give role" above shows its address.
  test("a Manager sees no controls, and a crafted change of a Manager changes nothing", async ({ page }) => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({
      name: "project-x",
      roles: [
        { user: ALICE, role: "owner" },
        { user: bob, role: "reader" },
      ],
    });

    // Opened as Owner; then the role is lowered to Manager, as if the Manager had crafted the request. The refused
    // action answers like one that does not exist, and the view shows itself as a Manager sees it, without controls.
    await page.goto("/folders/project-x?view=roles");
    await setOwnRole(folder, "manager");
    await roleOf(page, "bob").selectOption("owner");

    await expect(page.getByRole("main").getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Roles" }).getByRole("listitem")).toHaveText([
      "aliceManager",
      "bobReader",
    ]);
    expect(await getTestDb().folderRole.findFirstOrThrow({ where: { userId: bob.id } })).toMatchObject({
      role: "reader",
    });
  });

  // The select sends no change for the selected role, so the role of bob is set meanwhile, as another Owner
  // would set it; the change the Owner then chooses is the role bob has, as a crafted request would send it.
  test("a change to the role a user has keeps the role and its time, and the Owner stays in the roles view", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({
      name: "project-x",
      editor: await aliceUser(),
      roles: [
        { user: ALICE, role: "owner" },
        { user: bob, role: "reader" },
      ],
    });
    const where = { folderId_userId: { folderId: folder.id, userId: bob.id } };

    await page.goto("/folders/project-x?view=roles");
    await expect(roleOf(page, "bob")).toBeEnabled();
    const before = await getTestDb().folderRole.update({ where, data: { role: "manager" } });
    await roleOf(page, "bob").selectOption("manager");

    await expect(roleOf(page, "bob")).toHaveValue("manager");
    await expect(page).toHaveURL("/folders/project-x?view=roles");
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    expect(await getTestDb().folderRole.findUniqueOrThrow({ where })).toStrictEqual(before);
    expect(errors).toEqual([]);
  });

  // A change to the same role and a value that is no role are checked like every change
  // (integration/folder-role-service.test.ts and src/features/folder-roles/schema.test.ts).
  test("a change of a role takes effect with the next request of the user it concerns", async ({ page, browser }) => {
    const bob = await createUser({ name: "bob", mustChangePassword: false });
    const folder = await createFolder({
      name: "project-x",
      roles: [
        { user: ALICE, role: "owner" },
        { user: bob, role: "writer" },
      ],
    });
    await createPage({ folder, name: "intro", title: "Intro" });
    const other = await logInElsewhere(browser, "bob");
    await other.page.goto("/folders/project-x/intro.md");
    await expect(other.page.getByRole("main").getByRole("link", { name: "Edit" })).toBeVisible();
    await expect(other.page.getByRole("main").getByRole("link", { name: "Delete" })).toHaveCount(0);

    // The Owner makes bob a Manager: bob's next page shows "Delete".
    await page.goto("/folders/project-x?view=roles");
    await roleOf(page, "bob").selectOption("manager");
    await expect(roleOf(page, "bob")).toHaveValue("manager");
    await other.page.reload();
    await expect(other.page.getByRole("main").getByRole("link", { name: "Delete" })).toBeVisible();

    // The Owner removes bob's role while bob has the folder open: bob's next click shows the not-found page.
    await other.page.goto("/folders/project-x");
    await page.getByRole("button", { name: "Remove the role of bob" }).click();
    await expect(roleOf(page, "bob")).toHaveCount(0);
    await other.page.getByRole("main").getByRole("link", { name: /intro/ }).click();
    await expect(other.page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await other.context.close();
  });
});

test.describe("the admin overview", () => {
  test.describe("with the login of the admin", () => {
    test.use({ storageState: ADMIN_STORAGE_STATE });

    test("Folder roles in the header leads to every folder with its users and roles", async ({ page }) => {
      const errors = collectErrors(page);
      const [zoe, anna, ben] = [
        await createUser({ name: "zoe" }),
        await createUser({ name: "anna" }),
        await createUser({ name: "ben" }),
      ];
      const editor = await aliceUser();
      await createFolder({
        name: "project-x",
        editor,
        roles: [
          { user: ben, role: "reader" },
          { user: zoe, role: "owner" },
          { user: ALICE, role: "writer" },
          { user: anna, role: "owner" },
        ],
      });
      await createFolder({ name: "handbook", editor, roles: [{ user: ALICE, role: "manager" }] });
      await createFolder({ name: "orphan", editor, roles: [] });

      await page.goto("/users");
      await page.getByRole("banner").getByRole("link", { name: "Folder roles" }).click();

      await expect(page).toHaveURL("/folder-roles");
      await expect(page).toHaveTitle("Folder roles – HippoWiki");
      const rows = page.getByRole("table", { name: "Folder roles" }).getByRole("row");
      await expect(rows).toHaveText([
        "FolderRoles",
        "handbookalice (Manager)",
        "orphanNobody",
        "project-xanna (Owner), zoe (Owner), alice (Writer), ben (Reader)",
      ]);
      // Nothing else of the content, and no controls.
      await expect(page.getByRole("main").getByRole("link")).toHaveCount(0);
      await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
      await expect(page.getByRole("main").getByRole("combobox")).toHaveCount(0);
      await expect(page.getByRole("banner").getByRole("link", { name: "Folders" })).toHaveCount(0);
      expect(errors).toEqual([]);

      for (const address of [
        "/folders",
        "/folders/project-x",
        "/deleted-items/handbook",
        "/folder-roles?action=give-role",
      ]) {
        await expectNotFoundResponse(page.request, address);
      }
    });
  });

  test("a user has no Folder roles in the header, and its address shows the not-found page", async ({ page }) => {
    await createFolder({ name: "project-x" });

    await page.goto("/folders");
    await expect(page.getByRole("banner").getByRole("link", { name: "Folder roles" })).toHaveCount(0);
    await expectNotFound(page, "/folder-roles");
  });

  // One form; the other forms of roles and folders are refused for an admin by the same check (the actions and the
  // services of folder-roles and folders, and "an admin" of integration/folder-service.test.ts).
  test("a form submitted with the login of the admin gives no role", async ({ page, context }) => {
    const bob = await createUser({ name: "bob" });
    await createUser({ name: "dave" });
    await createFolder({
      name: "project-x",
      editor: await aliceUser(),
      roles: [
        { user: ALICE, role: "owner" },
        { user: bob, role: "writer" },
      ],
    });
    const before = await getTestDb().folderRole.findMany({ orderBy: { id: "asc" } });
    const notFound = page.getByRole("heading", { level: 1, name: "Page not found" });

    // Each form is opened by the Owner; then the browser gets the login of the admin, as if the admin had crafted it.
    await page.goto("/folders/project-x?action=give-role");
    await giveRoleDialog(page).getByLabel("User").selectOption("dave");
    await becomeUser(context, ADMIN_STORAGE_STATE);
    await giveRoleDialog(page).getByRole("button", { name: "Save" }).click();
    await expect(notFound).toBeVisible();

    expect(await getTestDb().folderRole.findMany({ orderBy: { id: "asc" } })).toStrictEqual(before);
    // No folder ever shows an admin in its roles.
    expect(await getTestDb().folderRole.count({ where: { user: { type: "admin" } } })).toBe(0);
  });
});
