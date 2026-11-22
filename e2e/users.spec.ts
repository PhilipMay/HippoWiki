import type { Page } from "@playwright/test";

import { KNOWN_ADMIN, KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, becomeUser, NO_STORAGE_STATE, submitLogin, USER_STORAGE_STATE } from "./support/auth";
import { collectErrors, expectNotFound, expectNotFoundResponse } from "./support/browser";
import { createUser, getTestDb, resetTestDatabase } from "./support/database";
import { expect, hydrating, test } from "./support/test";

test.beforeEach(async () => {
  await resetTestDatabase();
});

/** The rows of the user list, in display order. */
function userRows(page: Page) {
  return page.getByRole("list", { name: "Users" }).getByRole("listitem");
}

test.describe("the admin", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("sees all users by name, with type, time of creation and a mark for a pending password change", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await createUser({ name: "zoe", mustChangePassword: false, createdAt: new Date("2026-03-01T10:00:00Z") });
    await createUser({ name: "bob", createdAt: new Date("2026-02-01T10:00:00Z") });
    await createUser({ name: "maria", type: "admin", createdAt: new Date("2026-02-02T10:00:00Z") });

    await page.goto("/users");

    await expect(page).toHaveTitle("Users – HippoWiki");
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
    const rows = userRows(page);
    await expect(rows).toHaveText([/^adminAdmin · /, /^aliceUser · /, /^bobUser · /, /^mariaAdmin · /, /^zoeUser · /]);
    const pending = "Password change pending";
    await expect(rows.nth(0)).not.toContainText(pending);
    await expect(rows.nth(1)).not.toContainText(pending);
    await expect(rows.nth(2)).toContainText(pending);
    await expect(rows.nth(3)).toContainText(pending);
    await expect(rows.nth(4)).not.toContainText(pending);
    await expect(rows.nth(2).getByRole("time")).toHaveAttribute("datetime", "2026-02-01T10:00:00.000Z");
    await expect(rows.nth(2)).toContainText("User · Created Feb 1, 2026");
    await expect(page.getByRole("link", { name: "New user" })).toBeVisible();
    // Neither the hidden email of a user nor anything of the password is shown.
    await expect(page.getByText(/hippowiki\.invalid|argon2/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("has the menu entries Users and Folder roles, the name and Log out, but no Folders", async ({ page }) => {
    await page.goto("/account");

    const banner = page.getByRole("banner");
    await expect(banner.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText([
      "Users",
      "Folder roles",
    ]);
    await expect(banner.getByRole("link", { name: KNOWN_ADMIN.name })).toBeVisible();
    await expect(banner.getByRole("button", { name: "Log out" })).toBeVisible();
    await banner.getByRole("link", { name: "Users" }).click();

    await expect(page).toHaveURL("/users");
    await expect(userRows(page)).toHaveText([new RegExp(`^${KNOWN_ADMIN.name}`), new RegExp(`^${KNOWN_USER.name}`)]);
  });

  test("unknown actions and views, and repeated or mixed ones, show the not-found page", async ({ page }) => {
    // In the browser once: the not-found page shows nothing of the list.
    await expectNotFound(page, "/users?action=anything");
    await expect(page.getByRole("list", { name: "Users" })).toHaveCount(0);

    for (const address of [
      "/users?action=new",
      "/users?view=all",
      "/users?action=create&action=create",
      "/users?action=create&view=all",
    ]) {
      await expectNotFoundResponse(page.request, address);
    }
  });
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

/** Opens the "New user" dialog, submits the name with the type and returns the dialog. */
async function submitNewUser(page: Page, name: string, type: "User" | "Admin" = "User") {
  await page.goto("/users?action=create");
  const dialog = newUserDialog(page);
  await dialog.getByLabel("User name").fill(name);
  await dialog.getByRole("radio", { name: type }).check();
  await dialog.getByRole("button", { name: "Create" }).click();
  return dialog;
}

/** Creates a user of the type through the dialog and returns the first password that the dialog shows. */
async function createUserInDialog(page: Page, name: string, type: "User" | "Admin" = "User"): Promise<string> {
  await submitNewUser(page, name, type);
  const password = await userCreatedDialog(page).getByLabel("First password").inputValue();
  expect(password).toMatch(FIRST_PASSWORD);
  return password;
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
    // "User" is chosen when the dialog opens, and the dialog says that the type is final.
    await expect(dialog.getByRole("radio", { name: "User" })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Admin" })).not.toBeChecked();
    await expect(dialog.getByRole("radiogroup", { name: "Type" })).toHaveAccessibleDescription(
      /The type cannot be changed later\./,
    );
    await dialog.getByLabel("User name").fill("jane-doe");
    await dialog.getByRole("button", { name: "Create" }).click();

    const created = userCreatedDialog(page);
    await expect(created).toBeVisible();
    await expect(newUserDialog(page)).toHaveCount(0);
    await expect(created.getByText("jane-doe", { exact: true })).toBeVisible();
    await expect(created).toContainText("The user jane-doe was created.");
    await expect(created.getByLabel("First password")).toHaveValue(FIRST_PASSWORD);
    await expect(created.getByLabel("First password")).not.toBeEditable();
    await expect(created.getByText(/shown only this once/)).toBeVisible();
    // No redirect: the password is neither part of the address nor of a page that the browser stores.
    await expect(page).toHaveURL("/users?action=create");
    // The list behind the dialog shows the new user, with the first password still to change.
    const rows = userRowsBehindDialog(page);
    await expect(rows).toHaveText([/^adminAdmin · /, /^aliceUser · /, /^jane-doeUser · /]);
    await expect(rows.nth(2)).toContainText("Password change pending");
    expect(await getTestDb().user.findUniqueOrThrow({ where: { username: "jane-doe" } })).toMatchObject({
      type: "user",
      mustChangePassword: true,
      email: "jane-doe@users.hippowiki.invalid",
    });

    await created.getByRole("link", { name: "Back to the user list" }).click();
    await expect(page).toHaveURL("/users");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("creates an admin, who appears with the type in the list", async ({ page }) => {
    await createUserInDialog(page, "maria", "Admin");

    const created = userCreatedDialog(page);
    await expect(created).toContainText("The admin maria was created.");
    await expect(userRowsBehindDialog(page)).toHaveText([/^adminAdmin · /, /^aliceUser · /, /^mariaAdmin · /]);
    expect((await getTestDb().user.findUniqueOrThrow({ where: { username: "maria" } })).type).toBe("admin");
  });

  // A missing type and the other types that are not one are refused in the same way (src/features/users/forms.test.ts).
  test("a crafted submission with an unknown type shows the error at the type, keeps the dialog open and creates nothing", async ({
    page,
  }) => {
    await page.goto("/users?action=create");
    const dialog = newUserDialog(page);
    await dialog.getByLabel("User name").fill("jane-doe");
    // Change the radio buttons of the form as a crafted request would.
    for (const radio of await dialog.getByRole("radio").all()) {
      await radio.evaluate((input: HTMLInputElement) => {
        input.value = "root";
      });
    }

    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(dialog.getByText("Choose the type of the account", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("radiogroup", { name: "Type" })).toHaveAccessibleDescription(
      /^Choose the type of the account/,
    );
    await expect(userCreatedDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL("/users?action=create");
    expect(await getTestDb().user.count()).toBe(2);
  });

  test("the type chosen before a name error is kept when the name is corrected", async ({ page }) => {
    const dialog = await submitNewUser(page, "alice", "Admin");
    await expect(dialog.getByText("Name is already in use")).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Admin" })).toBeChecked();

    await dialog.getByLabel("User name").fill("maria");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(userCreatedDialog(page)).toContainText("The admin maria was created.");
    expect((await getTestDb().user.findUniqueOrThrow({ where: { username: "maria" } })).type).toBe("admin");
  });

  test("the whole chain for a new admin: logs in, changes the password, lands on the user list and creates a user", async ({
    page,
    browser,
  }) => {
    const password = await createUserInDialog(page, "maria", "Admin");

    // The new admin, in a browser of their own.
    const adminContext = await browser.newContext({ storageState: NO_STORAGE_STATE });
    const adminPage = await hydrating(await adminContext.newPage());
    await adminPage.goto("/login");
    await submitLogin(adminPage, "maria", password);
    await expect(adminPage).toHaveURL("/change-password");
    await adminPage.getByLabel("Current password").fill(password);
    await adminPage.getByLabel(/^New password/).fill("my-own-password");
    await adminPage.getByLabel("Repeat new password").fill("my-own-password");
    await adminPage.getByRole("button", { name: "Change password" }).click();

    await expect(adminPage).toHaveURL("/users");
    const banner = adminPage.getByRole("banner");
    await expect(banner.getByRole("link", { name: "Folders" })).toHaveCount(0);
    await expect(banner.getByRole("link", { name: "maria" })).toBeVisible();
    await expect(adminPage.getByText("Password change pending")).toHaveCount(0);
    await createUserInDialog(adminPage, "jane-doe");
    expect((await getTestDb().user.findUniqueOrThrow({ where: { username: "jane-doe" } })).type).toBe("user");
    await adminContext.close();
  });

  test("the copy button puts the password on the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const password = await createUserInDialog(page, "jane-doe");
    const created = userCreatedDialog(page);

    await created.getByRole("button", { name: "Copy password" }).click();

    await expect(created.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(password);
  });

  test("when the browser refuses the clipboard, the dialog says so and the password stays to copy by hand", async ({
    page,
  }) => {
    // Without the permission to write the clipboard, the browser of the tests refuses it.
    const password = await createUserInDialog(page, "jane-doe");
    const created = userCreatedDialog(page);

    await created.getByRole("button", { name: "Copy password" }).click();

    await expect(created.getByRole("alert").filter({ hasText: "could not be copied" })).toHaveText(
      "The password could not be copied. Select it and copy it yourself.",
    );
    await expect(created.getByLabel("First password")).toHaveValue(password);
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

  // The rules of a name are tested in src/lib/names.test.ts and src/features/users/actions.test.ts, a taken name in
  // integration/user-service.test.ts; "a corrected name creates the user after an error" shows a taken name here.
  test("an empty name shows its error and keeps the dialog open", async ({ page }) => {
    const errors = collectErrors(page);

    const dialog = await submitNewUser(page, "");

    const field = dialog.getByLabel("User name");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription("Name is required");
    await expect(dialog).toBeVisible();
    await expect(field).toHaveValue("");
    await expect(field).toBeFocused();
    await expect(userCreatedDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL("/users?action=create");
    expect(await getTestDb().user.count()).toBe(2);
    expect(errors).toEqual([]);
  });

  test("a corrected name creates the user after an error", async ({ page }) => {
    const dialog = await submitNewUser(page, "alice");
    await expect(dialog.getByLabel("User name")).toHaveAccessibleDescription("Name is already in use");

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
    const userPage = await hydrating(await userContext.newPage());
    await userPage.goto("/login");
    await submitLogin(userPage, "jane-doe", password);

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
    // A user: the user list, but without "New user".
    await expect(userPage.getByRole("banner").getByRole("link", { name: "Users" })).toBeVisible();
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
    await becomeUser(context, USER_STORAGE_STATE);

    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page.getByLabel("First password")).toHaveCount(0);
    expect(await getTestDb().user.count()).toBe(2);
    expect(await getTestDb().user.findUnique({ where: { username: "jane-doe" } })).toBeNull();
  });
});

test.describe("a user", () => {
  test.use({ storageState: USER_STORAGE_STATE });

  test("sees all users by name, admins included, with type and time of creation, but no pending password change", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await createUser({ name: "zoe", mustChangePassword: false, createdAt: new Date("2026-03-01T10:00:00Z") });
    await createUser({ name: "bob", createdAt: new Date("2026-02-01T10:00:00Z") });
    await createUser({ name: "maria", type: "admin", createdAt: new Date("2026-02-02T10:00:00Z") });

    await page.goto("/users");

    await expect(page).toHaveTitle("Users – HippoWiki");
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
    const rows = userRows(page);
    // The same order as for an admin.
    await expect(rows).toHaveText([/^adminAdmin · /, /^aliceUser · /, /^bobUser · /, /^mariaAdmin · /, /^zoeUser · /]);
    await expect(rows.nth(2).getByRole("time")).toHaveAttribute("datetime", "2026-02-01T10:00:00.000Z");
    await expect(rows.nth(2)).toContainText("User · Created Feb 1, 2026");
    await expect(page.getByText("Password change pending")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "New user" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New user" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("gets the not-found page for the New user dialog and for unknown actions and views", async ({ page }) => {
    await expectNotFound(page, "/users?action=create");
    await expect(page.getByRole("list", { name: "Users" })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    for (const address of ["/users?action=anything", "/users?view=all"]) {
      await expectNotFoundResponse(page.request, address);
    }
  });

  test("has the menu entry Users, which leads to the list", async ({ page }) => {
    await page.goto("/folders");

    const banner = page.getByRole("banner");
    await expect(banner.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(["Folders", "Users"]);
    await banner.getByRole("link", { name: "Users" }).click();

    await expect(page).toHaveURL("/users");
    await expect(userRows(page)).toHaveText([new RegExp(`^${KNOWN_ADMIN.name}`), new RegExp(`^${KNOWN_USER.name}`)]);
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
