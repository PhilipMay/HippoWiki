import type { Page } from "@playwright/test";

import { logIn, logInElsewhere, NO_STORAGE_STATE, submitLogin } from "./support/auth";
import { collectErrors, expectNotFound } from "./support/browser";
import { createGrant, createUser, getTestDb, resetTestDatabase, TEST_PASSWORD } from "./support/database";
import { listFolderStatus, mcpAddress } from "./support/oauth";
import { expect, hydrating, test } from "./support/test";

// The users of these tests are their own, created by `createUser()` with the password change done, and log in
// themselves: a change of the password ends all other sessions, and the saved sessions of the known users must stay
// valid for the other specs.
test.use({ storageState: NO_STORAGE_STATE });

const NEW_PASSWORD = "my-new-own-password";
const CHANGED_NOTICE = "Your password was changed, and your other browsers were logged out.";
const INVALID_CREDENTIALS = "Invalid user name or password";

test.beforeEach(async () => {
  await resetTestDatabase();
});

/** Creates a user of the given type with the password change done and logs in; returns the user. */
async function logInAsNew(page: Page, type: "user" | "admin" = "user", name?: string) {
  const user = await createUser({ name, type, mustChangePassword: false });
  await logIn(page, user.name);
  await expect(page).toHaveURL(type === "admin" ? "/users" : "/folders");
  return user;
}

function changeDialog(page: Page) {
  return page.getByRole("dialog", { name: "Change password" });
}

/** Fills the three fields of the dialog and submits it. */
async function submitChange(
  page: Page,
  { current = TEST_PASSWORD, next = NEW_PASSWORD, repeat = next }: { current?: string; next?: string; repeat?: string },
) {
  const dialog = changeDialog(page);
  await dialog.getByLabel("Current password").fill(current);
  // "New password" is the start of "Repeat new password" turned around, and required fields have an asterisk.
  await dialog.getByLabel(/^New password/).fill(next);
  await dialog.getByLabel("Repeat new password").fill(repeat);
  await dialog.getByRole("button", { name: "Change password" }).click();
}

/** The stored password hash of the user, to show that a refused change kept it. */
async function storedPassword(user: { id: string }) {
  return (await getTestDb().account.findFirstOrThrow({ where: { userId: user.id } })).password;
}

/** Logs out in the page, and asserts that the old password is refused and the new one logs in. */
async function expectNewPasswordOnly(page: Page, name: string, landing: string) {
  await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("/login");
  await submitLogin(page, name, TEST_PASSWORD);
  await expect(page.getByText(INVALID_CREDENTIALS)).toBeVisible();
  await submitLogin(page, name, NEW_PASSWORD);
  await expect(page).toHaveURL(landing);
}

for (const { type, landing } of [
  { type: "user", landing: "/folders" },
  { type: "admin", landing: "/users" },
] as const) {
  test(`a ${type} opens the dialog from the button, changes the password and logs in with the new one`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const user = await logInAsNew(page, type);
    await page.goto("/account");

    await page.getByRole("link", { name: "Change password" }).click();

    await expect(page).toHaveURL("/account?action=change-password");
    const dialog = changeDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Current password")).toBeFocused();
    await expect(dialog.getByText("All your other browsers are logged out with the change")).toBeVisible();
    for (const label of ["Current password", /^New password/, "Repeat new password"]) {
      await expect(dialog.getByLabel(label)).toHaveAttribute("type", "password");
    }
    await expect(dialog.getByLabel("Current password")).toHaveAttribute("autocomplete", "current-password");
    await expect(dialog.getByLabel(/^New password/)).toHaveAttribute("autocomplete", "new-password");

    await submitChange(page, {});

    await expect(page.getByText(CHANGED_NOTICE)).toBeVisible();
    await expect(changeDialog(page)).toHaveCount(0);
    await expectNewPasswordOnly(page, user.name, landing);
    expect(errors).toEqual([]);
  });
}

test("the address of the dialog opens it directly, and Cancel and Escape close it without a change", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const user = await logInAsNew(page);
  const before = await storedPassword(user);

  await page.goto("/account?action=change-password");
  await expect(changeDialog(page)).toBeVisible();
  await changeDialog(page).getByLabel("Current password").fill(TEST_PASSWORD);
  await changeDialog(page).getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL("/account");
  await expect(changeDialog(page)).toHaveCount(0);

  await page.goto("/account?action=change-password");
  await expect(changeDialog(page).getByLabel("Current password")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL("/account");
  await expect(changeDialog(page)).toHaveCount(0);

  expect(await storedPassword(user)).toBe(before);
  expect(errors).toEqual([]);
});

test.describe("a new password that breaks a rule", () => {
  for (const { what, input, field, error } of [
    {
      what: "a common one",
      input: { next: "password123" },
      field: /^New password/,
      error: "Password is too common, choose another one",
    },
    {
      what: "one built from the user name",
      input: { next: "alexander2026" },
      field: /^New password/,
      error: "Password must not be built only from the user name or the name of the wiki, digits and symbols",
    },
    {
      what: "one built from a context word",
      input: { next: "hippowiki2026" },
      field: /^New password/,
      error: "Password must not be built only from the user name or the name of the wiki, digits and symbols",
    },
    {
      what: "one equal to the current one",
      input: { next: TEST_PASSWORD },
      field: /^New password/,
      error: "New password must differ from the current one",
    },
    {
      what: "one that is too short",
      input: { next: "1234567" },
      field: /^New password/,
      error: "Password must be at least 8 characters",
    },
    {
      what: "one that is too long",
      input: { next: "p".repeat(129) },
      field: /^New password/,
      error: "Password must be at most 128 characters",
    },
    {
      what: "a repetition that differs",
      input: { repeat: "another-password" },
      field: "Repeat new password",
      error: "The two new passwords do not match",
    },
  ]) {
    test(`${what} is refused with the message of the forced change, and the old password still works`, async ({
      page,
    }) => {
      const errors = collectErrors(page);
      const user = await logInAsNew(page, "user", "alexander");
      const before = await storedPassword(user);
      await page.goto("/account?action=change-password");

      await submitChange(page, input);

      const dialog = changeDialog(page);
      await expect(dialog.getByText(error, { exact: true })).toBeVisible();
      await expect(dialog.getByLabel(field)).toBeFocused();
      // Errors of the rules keep what was entered.
      await expect(dialog.getByLabel("Current password")).toHaveValue(TEST_PASSWORD);
      expect(await storedPassword(user)).toBe(before);
      expect(errors).toEqual([]);
    });
  }
});

test("the change logs out a second browser of the user at its next request, and the first goes on", async ({
  page,
  browser,
}) => {
  const errors = collectErrors(page);
  const user = await logInAsNew(page);
  const other = await logInElsewhere(browser, user.name);
  await page.goto("/account?action=change-password");

  await submitChange(page, {});
  await expect(page.getByText(CHANGED_NOTICE)).toBeVisible();

  await other.page.goto("/folders");
  await expect(other.page).toHaveURL(/^[^?]*\/login/);
  await page.goto("/folders");
  await expect(page).toHaveURL("/folders");
  await expect(page.getByRole("banner").getByText(user.name, { exact: true })).toBeVisible();
  await other.context.close();
  expect(errors).toEqual([]);
});

test("the notice of the change is shown once: a reload shows no message", async ({ page }) => {
  const errors = collectErrors(page);
  await logInAsNew(page);
  await page.goto("/account?action=change-password");

  await submitChange(page, {});

  await expect(page.getByText(CHANGED_NOTICE)).toBeVisible();
  await expect(page).toHaveURL("/account");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(CHANGED_NOTICE)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe("wrong current passwords", () => {
  // The client address of the tests, after the one trusted proxy of the end-to-end server (`playwright.config.ts`).
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "192.0.2.30" } });

  test("after 5 the change waits, the password stays, and the login of the name waits too", async ({
    page,
    browser,
  }) => {
    const errors = collectErrors(page);
    const user = await logInAsNew(page);
    const before = await storedPassword(user);
    await page.goto("/account?action=change-password");
    const dialog = changeDialog(page);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await submitChange(page, { current: "wrong-password" });
      // The answer empties the field that was just filled: only then is the next change submitted.
      await expect(dialog.getByLabel("Current password")).toHaveValue("");
      await expect(dialog.getByText("Current password is wrong", { exact: true })).toBeVisible();
    }
    await submitChange(page, {});

    await expect(
      dialog.getByText("Too many wrong passwords. Please try again in 1 minute.", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByLabel("Current password")).toBeFocused();
    expect(await storedPassword(user)).toBe(before);

    const visitor = await browser.newContext({
      storageState: NO_STORAGE_STATE,
      extraHTTPHeaders: { "x-forwarded-for": "192.0.2.30" },
    });
    const loginPage = hydrating(await visitor.newPage());
    await logIn(loginPage, user.name);
    await expect(loginPage.getByText("Too many failed logins. Please try again in 1 minute.")).toBeVisible();
    await visitor.close();
    expect(errors).toEqual([]);
  });
});

test.describe("disconnecting the apps", () => {
  const DISCONNECTED_NOTICE =
    "Your password was changed, your other browsers were logged out, and all your apps were disconnected.";

  function choice(page: Page) {
    return changeDialog(page).getByRole("checkbox", { name: "Also disconnect all my apps" });
  }

  /** A user of its own, logged in, with two connected apps; returns the user and the apps. */
  async function userWithTwoApps(page: Page) {
    const user = await logInAsNew(page);
    const apps = [
      await createGrant({ owner: user, name: "First connector" }),
      await createGrant({ owner: user, name: "Second connector" }),
    ];
    return { user, apps };
  }

  test("ticked, it disconnects every app: they leave the list and their tokens are refused", async ({
    page,
    request,
  }) => {
    const errors = collectErrors(page);
    const { apps } = await userWithTwoApps(page);
    await page.goto("/account?action=change-password");
    await expect(choice(page)).not.toBeChecked();

    await choice(page).check();
    await submitChange(page, {});

    await expect(page.getByText(DISCONNECTED_NOTICE)).toBeVisible();
    await expect(page.getByText("No app is connected yet.", { exact: true })).toBeVisible();
    for (const { accessToken, folder } of apps) {
      expect(await listFolderStatus(request, accessToken, mcpAddress(folder))).toBe(401);
    }
    expect(errors).toEqual([]);
  });

  test("not ticked, every app stays and works", async ({ page, request }) => {
    const errors = collectErrors(page);
    const { apps } = await userWithTwoApps(page);
    await page.goto("/account?action=change-password");

    await submitChange(page, {});

    await expect(page.getByText(CHANGED_NOTICE)).toBeVisible();
    await expect(page.getByRole("list", { name: "Connected apps" }).getByRole("listitem")).toHaveCount(2);
    for (const { accessToken, folder } of apps) {
      expect(await listFolderStatus(request, accessToken, mcpAddress(folder))).toBe(200);
    }
    expect(errors).toEqual([]);
  });

  test("the choice stays ticked after an error of the form", async ({ page }) => {
    await userWithTwoApps(page);
    await page.goto("/account?action=change-password");

    await choice(page).check();
    await submitChange(page, { repeat: "another-password" });

    await expect(changeDialog(page).getByText("The two new passwords do not match", { exact: true })).toBeVisible();
    await expect(choice(page)).toBeChecked();
  });

  for (const type of ["user", "admin"] as const) {
    test(`a${type === "admin" ? "n admin" : " user without apps"} sees no such choice`, async ({ page }) => {
      await logInAsNew(page, type);

      await page.goto("/account?action=change-password");

      await expect(changeDialog(page).getByLabel("Current password")).toBeVisible();
      await expect(changeDialog(page).getByRole("checkbox")).toHaveCount(0);
    });
  }
});

test.describe("addresses that are not found", () => {
  for (const type of ["user", "admin"] as const) {
    test(`for a ${type}: an unknown action, an unknown notice and a notice with an action`, async ({ page }) => {
      await logInAsNew(page, type);

      for (const address of [
        "/account?action=change-passwords",
        "/account?notice=anything",
        "/account?notice=password-changed&action=change-password",
        "/account?notice=password-changed&notice=password-changed",
      ]) {
        await expectNotFound(page, address);
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
    });
  }
});
