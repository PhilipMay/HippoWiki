import type { Browser, Page } from "@playwright/test";

import { logIn, NO_STORAGE_STATE } from "./support/auth";
import { collectErrors } from "./support/browser";
import { createUser, resetTestDatabase } from "./support/database";
import { expect, hydrating, test } from "./support/test";

// The users of these tests are their own, created by `createUser()` with the password change done, and log in
// themselves: logging out the other browsers ends sessions, and the saved sessions of the known users must stay valid
// for the other specs.
test.use({ storageState: NO_STORAGE_STATE });

const LOGGED_OUT_NOTICE = "Your other browsers were logged out.";

test.beforeEach(async () => {
  await resetTestDatabase();
});

/** Where a login of the type leads. */
function landingOf(type: "user" | "admin") {
  return type === "admin" ? "/users" : "/folders";
}

/** Creates an account of the given type with the password change done and logs in; returns the account. */
async function logInAsNew(page: Page, type: "user" | "admin" = "user") {
  const user = await createUser({ type, mustChangePassword: false });
  await logIn(page, user.name);
  await expect(page).toHaveURL(landingOf(type));
  return user;
}

/** Logs the account in in a browser context of its own, as a second browser of the same person. */
async function logInSecondBrowser(browser: Browser, name: string, type: "user" | "admin") {
  const context = await browser.newContext({ storageState: NO_STORAGE_STATE });
  const page = await hydrating(await context.newPage());
  await logIn(page, name);
  await expect(page).toHaveURL(landingOf(type));
  return { context, page };
}

function logOutDialog(page: Page) {
  return page.getByRole("dialog", { name: "Log out other browsers" });
}

for (const type of ["user", "admin"] as const) {
  test(`confirming logs out a second browser of the ${type} at its next request, and the first goes on`, async ({
    page,
    browser,
  }) => {
    const errors = collectErrors(page);
    const account = await logInAsNew(page, type);
    const second = await logInSecondBrowser(browser, account.name, type);
    await page.goto("/account");

    await page.getByRole("link", { name: "Log out other browsers" }).click();
    await expect(page).toHaveURL("/account?action=log-out-others");
    const dialog = logOutDialog(page);
    await expect(dialog).toContainText("this browser stays logged in");
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Log out other browsers" }).click();

    await expect(page.getByText(LOGGED_OUT_NOTICE)).toBeVisible();
    await expect(logOutDialog(page)).toHaveCount(0);
    await second.page.goto(landingOf(type));
    await expect(second.page).toHaveURL(/^[^?]*\/login/);
    await page.goto(landingOf(type));
    await expect(page).toHaveURL(landingOf(type));
    await second.context.close();
    expect(errors).toEqual([]);
  });
}

test("closing the dialog with Cancel or Escape ends nothing", async ({ page, browser }) => {
  const errors = collectErrors(page);
  const account = await logInAsNew(page);
  const second = await logInSecondBrowser(browser, account.name, "user");

  await page.goto("/account?action=log-out-others");
  await logOutDialog(page).getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL("/account");
  await expect(logOutDialog(page)).toHaveCount(0);

  await page.goto("/account?action=log-out-others");
  await expect(logOutDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL("/account");
  await expect(logOutDialog(page)).toHaveCount(0);

  await second.page.goto("/folders");
  await expect(second.page).toHaveURL("/folders");
  await second.context.close();
  expect(errors).toEqual([]);
});

test("the address opens the dialog directly, and confirming without another browser shows the notice once", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await logInAsNew(page);

  await page.goto("/account?action=log-out-others");
  await logOutDialog(page).getByRole("button", { name: "Log out other browsers" }).click();

  await expect(page.getByText(LOGGED_OUT_NOTICE)).toBeVisible();
  await expect(page).toHaveURL("/account");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(LOGGED_OUT_NOTICE)).toHaveCount(0);
  expect(errors).toEqual([]);
});
