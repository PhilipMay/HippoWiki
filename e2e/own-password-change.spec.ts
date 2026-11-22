import type { Page } from "@playwright/test";

import { KNOWN_ADMIN, KNOWN_USER } from "../prisma/known-users";
import {
  ADMIN_STORAGE_STATE,
  logIn,
  logInElsewhere,
  NO_STORAGE_STATE,
  submitLogin,
  USER_STORAGE_STATE,
} from "./support/auth";
import { collectErrors, expectNotFound, expectNotFoundResponse } from "./support/browser";
import {
  createGrant,
  createUser,
  getTestDb,
  resetTestDatabase,
  storeFiveFailedLogins,
  TEST_PASSWORD,
} from "./support/database";
import { listFolderStatus, mcpAddress } from "./support/oauth";
import { expect, hydrating, test } from "./support/test";

// The tests change the password of the known user or the known admin with their saved logins: every reset puts back
// their passwords and the sessions of their saved logins, so a change ends nothing that a later test needs. One test
// logs in through the login page first, as a user of its own.
test.use({ storageState: USER_STORAGE_STATE });

const NEW_PASSWORD = "my-new-own-password";
const CHANGED_NOTICE = "Your password was changed, and your other browsers were logged out.";
const INVALID_CREDENTIALS = "Invalid user name or password";

test.beforeEach(async () => {
  await resetTestDatabase();
});

/** The saved logins of the known user and the known admin, for the tests that run as each type. */
const KNOWN_STATES = [
  { type: "user", storageState: USER_STORAGE_STATE },
  { type: "admin", storageState: ADMIN_STORAGE_STATE },
] as const;

function changeDialog(page: Page) {
  return page.getByRole("dialog", { name: "Change password" });
}

/** Fills the three fields of the dialog and submits it; the current password is that of the known user by default. */
async function submitChange(
  page: Page,
  {
    current = KNOWN_USER.password,
    next = NEW_PASSWORD,
    repeat = next,
  }: { current?: string; next?: string; repeat?: string },
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
async function expectNewPasswordOnly(page: Page, name: string, oldPassword: string, landing: string) {
  await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("/login");
  await submitLogin(page, name, oldPassword);
  await expect(page.getByText(INVALID_CREDENTIALS)).toBeVisible();
  await submitLogin(page, name, NEW_PASSWORD);
  await expect(page).toHaveURL(landing);
}

/**
 * Opens the dialog from the button of the account page, checks its fields, changes the password from the given one and
 * asserts that only the new password logs in afterwards.
 */
async function changeFromTheButton(page: Page, name: string, password: string, landing: string) {
  const errors = collectErrors(page);
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

  await submitChange(page, { current: password });

  await expect(page.getByText(CHANGED_NOTICE)).toBeVisible();
  await expect(changeDialog(page)).toHaveCount(0);
  await expectNewPasswordOnly(page, name, password, landing);
  expect(errors).toEqual([]);
}

test.describe("a user of its own who has logged in through the login page", () => {
  test.use({ storageState: NO_STORAGE_STATE });

  test("opens the dialog from the button, changes the password and logs in with the new one", async ({ page }) => {
    const user = await createUser({ mustChangePassword: false });
    await logIn(page, user.name);
    await expect(page).toHaveURL("/folders");

    await changeFromTheButton(page, user.name, TEST_PASSWORD, "/folders");
  });
});

test.describe("the known admin", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("opens the dialog from the button, changes the password and logs in with the new one", async ({ page }) => {
    await changeFromTheButton(page, KNOWN_ADMIN.name, KNOWN_ADMIN.password, "/users");
  });
});

test("the address of the dialog opens it directly, and Cancel and Escape close it without a change", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const before = await storedPassword(KNOWN_USER);

  await page.goto("/account?action=change-password");
  await expect(changeDialog(page)).toBeVisible();
  await changeDialog(page).getByLabel("Current password").fill(KNOWN_USER.password);
  await changeDialog(page).getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL("/account");
  await expect(changeDialog(page)).toHaveCount(0);

  await page.goto("/account?action=change-password");
  await expect(changeDialog(page).getByLabel("Current password")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL("/account");
  await expect(changeDialog(page)).toHaveCount(0);

  expect(await storedPassword(KNOWN_USER)).toBe(before);
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
      input: { next: `${KNOWN_USER.name}2026` },
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
      input: { next: KNOWN_USER.password },
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
      const before = await storedPassword(KNOWN_USER);
      await page.goto("/account?action=change-password");

      await submitChange(page, input);

      const dialog = changeDialog(page);
      await expect(dialog.getByText(error, { exact: true })).toBeVisible();
      await expect(dialog.getByLabel(field)).toBeFocused();
      // Errors of the rules keep what was entered.
      await expect(dialog.getByLabel("Current password")).toHaveValue(KNOWN_USER.password);
      expect(await storedPassword(KNOWN_USER)).toBe(before);
      expect(errors).toEqual([]);
    });
  }
});

test("the change logs out a second browser of the user at its next request, and the first goes on", async ({
  page,
  browser,
}) => {
  const errors = collectErrors(page);
  const other = await logInElsewhere(browser, KNOWN_USER.name, KNOWN_USER.password);
  await page.goto("/account?action=change-password");

  await submitChange(page, {});
  await expect(page.getByText(CHANGED_NOTICE)).toBeVisible();

  await other.page.goto("/folders");
  await expect(other.page).toHaveURL(/^[^?]*\/login/);
  await page.goto("/folders");
  await expect(page).toHaveURL("/folders");
  await expect(page.getByRole("banner").getByText(KNOWN_USER.name, { exact: true })).toBeVisible();
  await other.context.close();
  expect(errors).toEqual([]);
});

test("the notice of the change is shown once: a reload shows no message", async ({ page }) => {
  const errors = collectErrors(page);
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
    const before = await storedPassword(KNOWN_USER);
    await page.goto("/account?action=change-password");
    const dialog = changeDialog(page);
    // As five wrong current passwords leave the counts, which count like failed logins of the name.
    await storeFiveFailedLogins(KNOWN_USER.name, "192.0.2.30");

    await submitChange(page, {});

    await expect(
      dialog.getByText("Too many wrong passwords. Please try again in 1 minute.", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByLabel("Current password")).toBeFocused();
    expect(await storedPassword(KNOWN_USER)).toBe(before);

    const visitor = await browser.newContext({
      storageState: NO_STORAGE_STATE,
      extraHTTPHeaders: { "x-forwarded-for": "192.0.2.30" },
    });
    const loginPage = await hydrating(await visitor.newPage());
    await logIn(loginPage, KNOWN_USER.name, KNOWN_USER.password);
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

  /** Connects two apps of the known user; returns them. */
  async function twoApps() {
    return [
      await createGrant({ owner: KNOWN_USER, name: "First connector" }),
      await createGrant({ owner: KNOWN_USER, name: "Second connector" }),
    ];
  }

  test("ticked, it disconnects every app: they leave the list and their tokens are refused", async ({
    page,
    request,
  }) => {
    const errors = collectErrors(page);
    const apps = await twoApps();
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
    const apps = await twoApps();
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
    await twoApps();
    await page.goto("/account?action=change-password");

    await choice(page).check();
    await submitChange(page, { repeat: "another-password" });

    await expect(changeDialog(page).getByText("The two new passwords do not match", { exact: true })).toBeVisible();
    await expect(choice(page)).toBeChecked();
  });

  for (const { type, storageState } of KNOWN_STATES) {
    test.describe(`the known ${type}`, () => {
      test.use({ storageState });

      test(`a${type === "admin" ? "n admin" : " user without apps"} sees no such choice`, async ({ page }) => {
        await page.goto("/account?action=change-password");

        await expect(changeDialog(page).getByLabel("Current password")).toBeVisible();
        await expect(changeDialog(page).getByRole("checkbox")).toHaveCount(0);
      });
    });
  }
});

test.describe("addresses that are not found", () => {
  for (const { type, storageState } of KNOWN_STATES) {
    test.describe(`the known ${type}`, () => {
      test.use({ storageState });

      test(`for a ${type}: an unknown action, an unknown notice and a notice with an action`, async ({ page }) => {
        // In the browser once: the not-found page opens no dialog.
        await expectNotFound(page, "/account?notice=password-changed&action=change-password");
        await expect(page.getByRole("dialog")).toHaveCount(0);

        for (const address of [
          "/account?action=change-passwords",
          "/account?notice=anything",
          "/account?notice=password-changed&notice=password-changed",
        ]) {
          await expectNotFoundResponse(page.request, address);
        }
      });
    });
  }
});
