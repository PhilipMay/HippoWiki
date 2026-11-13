import { readFileSync } from "node:fs";

import type { BrowserContext, Page } from "@playwright/test";

import { KNOWN_ADMIN, KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, NO_STORAGE_STATE, USER_STORAGE_STATE } from "./support/auth";
import { collectErrors } from "./support/browser";
import { createUser, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

test.beforeEach(async () => {
  await resetTestDatabase();
});

/** The rows of the user list, in display order. */
function userRows(page: Page) {
  return page.getByRole("list", { name: "Users" }).getByRole("listitem");
}

async function expectNotFound(page: Page, address: string) {
  const response = await page.goto(address);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Users" })).toHaveCount(0);
}

test.describe("the admin", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("sees all users by name, with the time of creation and a mark for a pending password change", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await createUser({ name: "zoe", mustChangePassword: false, createdAt: new Date("2026-03-01T10:00:00Z") });
    await createUser({ name: "bob", createdAt: new Date("2026-02-01T10:00:00Z") });

    await page.goto("/users");

    await expect(page).toHaveTitle("Users – HippoWiki");
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
    const rows = userRows(page);
    await expect(rows).toHaveText([/^admin/, /^alice/, /^bob/, /^zoe/]);
    const pending = "Password change pending";
    await expect(rows.nth(0)).not.toContainText(pending);
    await expect(rows.nth(1)).not.toContainText(pending);
    await expect(rows.nth(2)).toContainText(pending);
    await expect(rows.nth(3)).not.toContainText(pending);
    await expect(rows.nth(2).getByRole("time")).toHaveAttribute("datetime", "2026-02-01T10:00:00.000Z");
    await expect(rows.nth(2)).toContainText("Created Feb 1, 2026");
    // Neither the hidden email of a user nor anything of the password is shown.
    await expect(page.getByText(/hippowiki\.invalid|argon2/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("has the menu entry Users, which leads to the list", async ({ page }) => {
    await page.goto("/folders");

    await page.getByRole("banner").getByRole("link", { name: "Users" }).click();

    await expect(page).toHaveURL("/users");
    await expect(userRows(page)).toHaveText([new RegExp(`^${KNOWN_ADMIN.name}`), new RegExp(`^${KNOWN_USER.name}`)]);
  });

  for (const address of [
    "/users?action=anything",
    "/users?action=new",
    "/users?view=all",
    "/users?action=create&action=create",
    "/users?action=create&view=all",
  ]) {
    test(`${address} shows the not-found page`, async ({ page }) => {
      await expectNotFound(page, address);
    });
  }
});

/**
 * The rows of the user list behind an open dialog. The dialog hides the rest of the page from assistive technology,
 * so the rows are only found as hidden elements.
 */
function userRowsBehindDialog(page: Page) {
  return page.getByRole("list", { name: "Users", includeHidden: true }).getByRole("listitem", { includeHidden: true });
}

/** A generated first password: 20 letters and digits, without the ones that are easy to confuse. */
const FIRST_PASSWORD = /^[A-HJ-NP-Za-km-z2-9]{20}$/;

function newUserDialog(page: Page) {
  return page.getByRole("dialog", { name: "New user" });
}

function userCreatedDialog(page: Page) {
  return page.getByRole("dialog", { name: "User created" });
}

/** Opens the "New user" dialog, submits the name and returns the dialog. */
async function submitNewUser(page: Page, name: string) {
  await page.goto("/users?action=create");
  const dialog = newUserDialog(page);
  await dialog.getByLabel("User name").fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();
  return dialog;
}

/** Creates a user through the dialog and returns the first password that the dialog shows. */
async function createUserInDialog(page: Page, name: string): Promise<string> {
  await submitNewUser(page, name);
  const password = await userCreatedDialog(page).getByLabel("First password").inputValue();
  expect(password).toMatch(FIRST_PASSWORD);
  return password;
}

/** Replaces the login of the browser by the saved login of the known normal user. */
async function becomeNormalUser(context: BrowserContext) {
  const { cookies } = JSON.parse(readFileSync(USER_STORAGE_STATE, "utf8")) as {
    cookies: Parameters<BrowserContext["addCookies"]>[0];
  };
  await context.clearCookies();
  await context.addCookies(cookies);
}

test.describe("the admin, creating a user", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("opens the dialog with New user and gets a first password of 20 characters, shown once", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/users");

    await page.getByRole("link", { name: "New user" }).click();
    await expect(page).toHaveURL("/users?action=create");
    const dialog = newUserDialog(page);
    await expect(dialog.getByLabel("User name")).toBeFocused();
    await dialog.getByLabel("User name").fill("jane-doe");
    await dialog.getByRole("button", { name: "Create" }).click();

    const created = userCreatedDialog(page);
    await expect(created).toBeVisible();
    await expect(newUserDialog(page)).toHaveCount(0);
    await expect(created.getByText("jane-doe", { exact: true })).toBeVisible();
    await expect(created.getByLabel("First password")).toHaveValue(FIRST_PASSWORD);
    await expect(created.getByLabel("First password")).not.toBeEditable();
    await expect(created.getByText(/shown only this once/)).toBeVisible();
    // No redirect: the password is neither part of the address nor of a page that the browser stores.
    await expect(page).toHaveURL("/users?action=create");
    // The list behind the dialog shows the new user, with the first password still to change.
    const rows = userRowsBehindDialog(page);
    await expect(rows).toHaveText([/^admin/, /^alice/, /^jane-doe/]);
    await expect(rows.nth(2)).toContainText("Password change pending");
    expect(await getTestDb().user.findUniqueOrThrow({ where: { username: "jane-doe" } })).toMatchObject({
      mustChangePassword: true,
      email: "jane-doe@users.hippowiki.invalid",
    });

    await created.getByRole("link", { name: "Back to the user list" }).click();
    await expect(page).toHaveURL("/users");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the copy button puts the password on the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const password = await createUserInDialog(page, "jane-doe");
    const created = userCreatedDialog(page);

    await created.getByRole("button", { name: "Copy password" }).click();

    await expect(created.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(password);
  });

  test("after a reload the password is gone", async ({ page }) => {
    const password = await createUserInDialog(page, "jane-doe");

    await page.reload();

    // The address still opens the dialog, but as an empty form.
    await expect(newUserDialog(page).getByLabel("User name")).toHaveValue("");
    await expect(userCreatedDialog(page)).toHaveCount(0);
    await expect(page.getByLabel("First password")).toHaveCount(0);
    expect(await page.content()).not.toContain(password);
  });

  test("the password is not shown again in the list or under any address", async ({ page }) => {
    const password = await createUserInDialog(page, "jane-doe");
    await userCreatedDialog(page).getByRole("link", { name: "Back to the user list" }).click();
    await expect(page).toHaveURL("/users");

    expect(await page.content()).not.toContain(password);
    await page.goBack();
    await expect(newUserDialog(page)).toBeVisible();
    expect(await page.content()).not.toContain(password);
  });

  test("the Escape key closes the form but not the dialog that shows the password", async ({ page }) => {
    await page.goto("/users?action=create");
    await newUserDialog(page).getByLabel("User name").fill("jane-doe");
    await newUserDialog(page).getByRole("button", { name: "Create" }).click();
    const created = userCreatedDialog(page);
    await expect(created.getByLabel("First password")).toHaveValue(FIRST_PASSWORD);

    // A password that cannot be shown again must not be lost by a key.
    await page.keyboard.press("Escape");
    await expect(created.getByLabel("First password")).toHaveValue(FIRST_PASSWORD);
    await expect(page).toHaveURL("/users?action=create");

    await created.getByRole("link", { name: "Back to the user list" }).click();
    await page.goto("/users?action=create");
    await expect(newUserDialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL("/users");
  });

  test("Cancel leads back to the list without creating a user", async ({ page }) => {
    await page.goto("/users?action=create");
    await newUserDialog(page).getByLabel("User name").fill("jane-doe");

    await newUserDialog(page).getByRole("link", { name: "Cancel" }).click();

    await expect(page).toHaveURL("/users");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await getTestDb().user.count()).toBe(2);
  });

  for (const [what, name, error] of [
    ["a taken name", "alice", "Name is already in use"],
    ["the name of the admin", "admin", "Name is already in use"],
    ["a name that breaks the rule", "Jane Doe", "Use lowercase letters, digits and single hyphens"],
    ["a name of 2 characters", "ab", "Name must be at least 3 characters"],
    ["an empty name", "", "Name is required"],
  ] as const) {
    test(`${what} shows its error and keeps the dialog open`, async ({ page }) => {
      const errors = collectErrors(page);

      const dialog = await submitNewUser(page, name);

      await expect(dialog.getByText(error, { exact: true })).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("User name")).toHaveValue(name);
      await expect(dialog.getByLabel("User name")).toBeFocused();
      await expect(userCreatedDialog(page)).toHaveCount(0);
      await expect(page).toHaveURL("/users?action=create");
      expect(await getTestDb().user.count()).toBe(2);
      expect(errors).toEqual([]);
    });
  }

  test("a corrected name creates the user after an error", async ({ page }) => {
    const dialog = await submitNewUser(page, "alice");
    await expect(dialog.getByText("Name is already in use")).toBeVisible();

    await dialog.getByLabel("User name").fill("alice-2");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(userCreatedDialog(page).getByLabel("First password")).toHaveValue(FIRST_PASSWORD);
    await expect(userRowsBehindDialog(page)).toHaveText([/^admin/, /^alice/, /^alice-2/]);
  });

  test("a form submission with extra fields cannot choose the password or skip the password change", async ({
    page,
  }) => {
    await page.goto("/users?action=create");
    const dialog = newUserDialog(page);
    await dialog.getByLabel("User name").fill("jane-doe");
    const create = dialog.getByRole("button", { name: "Create" });
    // The Create button is tied to the dialog's form; add fields to that form as a crafted request would.
    await create.evaluate((button: HTMLButtonElement) => {
      for (const [name, value] of [
        ["password", "chosen-password"],
        ["mustChangePassword", "false"],
      ]) {
        const input = document.createElement("input");
        Object.assign(input, { type: "hidden", name, value });
        button.form?.append(input);
      }
    });
    await create.click();

    const password = userCreatedDialog(page).getByLabel("First password");
    await expect(password).toHaveValue(FIRST_PASSWORD);
    await expect(password).not.toHaveValue("chosen-password");
    expect((await getTestDb().user.findUniqueOrThrow({ where: { username: "jane-doe" } })).mustChangePassword).toBe(
      true,
    );
  });

  test("the whole chain: the new user logs in with the password, has to change it and reaches the folder list", async ({
    page,
    browser,
  }) => {
    const password = await createUserInDialog(page, "jane-doe");

    // The new user, in a browser of their own.
    const userContext = await browser.newContext({ storageState: NO_STORAGE_STATE });
    const userPage = await userContext.newPage();
    await userPage.goto("/login");
    await userPage.getByLabel("User name").fill("jane-doe");
    await userPage.getByLabel("Password").fill(password);
    await userPage.getByRole("button", { name: "Log in" }).click();

    await expect(userPage).toHaveURL("/change-password");
    await userPage.goto("/folders");
    await expect(userPage).toHaveURL("/change-password");
    await userPage.getByLabel("Current password").fill(password);
    await userPage.getByLabel(/^New password/).fill("my-own-password");
    await userPage.getByLabel("Repeat new password").fill("my-own-password");
    await userPage.getByRole("button", { name: "Change password" }).click();

    await expect(userPage).toHaveURL("/folders");
    await expect(userPage.getByRole("heading", { level: 1, name: "Folders" })).toBeVisible();
    await expect(userPage.getByRole("banner").getByText("jane-doe", { exact: true })).toBeVisible();
    // A normal user: no user list.
    await expect(userPage.getByRole("banner").getByRole("link", { name: "Users" })).toHaveCount(0);
    await userContext.close();
    // The admin sees that the first password is replaced.
    await page.goto("/users");
    await expect(userRows(page).nth(2)).toHaveText(/^jane-doe/);
    await expect(userRows(page).nth(2)).not.toContainText("Password change pending");
  });

  test("a submission of the form by a normal user creates no user and is not found", async ({ page, context }) => {
    // The admin opens the form; then the browser gets the login of a normal user, as if that user had crafted the
    // request of the form.
    await page.goto("/users?action=create");
    const dialog = newUserDialog(page);
    await dialog.getByLabel("User name").fill("jane-doe");
    await becomeNormalUser(context);

    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page.getByLabel("First password")).toHaveCount(0);
    expect(await getTestDb().user.count()).toBe(2);
    expect(await getTestDb().user.findUnique({ where: { username: "jane-doe" } })).toBeNull();
  });
});

test.describe("a normal user", () => {
  test.use({ storageState: USER_STORAGE_STATE });

  test("gets the not-found page for the New user dialog", async ({ page }) => {
    await expectNotFound(page, "/users?action=create");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("gets the not-found page for the user list", async ({ page }) => {
    await expectNotFound(page, "/users");
    await expect(page.getByText(KNOWN_ADMIN.name, { exact: true })).toHaveCount(0);
  });

  test("has no menu entry Users", async ({ page }) => {
    await page.goto("/folders");

    const banner = page.getByRole("banner");
    await expect(banner.getByRole("link", { name: "Folders" })).toBeVisible();
    await expect(banner.getByRole("link", { name: "Users" })).toHaveCount(0);
  });
});

test.describe("without a login", () => {
  test.use({ storageState: NO_STORAGE_STATE });

  test("the user list leads to the login page", async ({ page }) => {
    await page.goto("/users");

    await expect(page).toHaveURL("/login?next=%2Fusers");
    await expect(page.getByRole("list", { name: "Users" })).toHaveCount(0);
  });
});
