import type { Browser, Page } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { logIn, NO_STORAGE_STATE, USER_STORAGE_STATE } from "./support/auth";
import { collectErrors } from "./support/browser";
import { getTestDb, resetTestDatabase } from "./support/database";
import { expect, hydrating, test } from "./support/test";

// The tests end the other sessions of the known user, whose saved login they use: every reset puts back the sessions of
// the saved logins, so the end of a session ends nothing that a later test needs. The second browser, whose session
// the tests end, logs in through the login page.
test.use({ storageState: USER_STORAGE_STATE });

const LOGGED_OUT_NOTICE = "Your other browsers were logged out.";

test.beforeEach(async () => {
  await resetTestDatabase();
});

/** Logs the account in in a browser context of its own, as a second browser of the same person. */
async function logInSecondBrowser(browser: Browser, { name, password }: { name: string; password: string }) {
  const context = await browser.newContext({ storageState: NO_STORAGE_STATE });
  const page = await hydrating(await context.newPage());
  await logIn(page, name, password);
  await expect(page).toHaveURL("/folders");
  return { context, page };
}

function logOutDialog(page: Page) {
  return page.getByRole("dialog", { name: "Log out other browsers" });
}

// For the known user; an admin ends the other sessions in the same way (integration/auth-service.test.ts), and the admin
// test of account.spec.ts checks the link of the admin.
test("confirming logs out a second browser at its next request, and the first goes on", async ({ page, browser }) => {
  const errors = collectErrors(page);
  const second = await logInSecondBrowser(browser, KNOWN_USER);
  await page.goto("/account");

  await page.getByRole("link", { name: "Log out other browsers" }).click();
  await expect(page).toHaveURL("/account?action=log-out-others");
  const dialog = logOutDialog(page);
  await expect(dialog).toContainText("this browser stays logged in");
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Log out other browsers" }).click();

  await expect(page.getByText(LOGGED_OUT_NOTICE)).toBeVisible();
  await expect(logOutDialog(page)).toHaveCount(0);
  await second.page.goto("/folders");
  await expect(second.page).toHaveURL(/^[^?]*\/login/);
  await page.goto("/folders");
  await expect(page).toHaveURL("/folders");
  await second.context.close();
  expect(errors).toEqual([]);
});

test("closing the dialog with Cancel or Escape ends nothing", async ({ page }) => {
  const errors = collectErrors(page);
  const account = KNOWN_USER;
  // The session of a second browser, as its login leaves it; the confirming tests above log one in for real.
  const second = await getTestDb().session.create({
    data: {
      userId: account.id,
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await page.goto("/account?action=log-out-others");
  await logOutDialog(page).getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL("/account");
  await expect(logOutDialog(page)).toHaveCount(0);

  await page.goto("/account?action=log-out-others");
  await expect(logOutDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL("/account");
  await expect(logOutDialog(page)).toHaveCount(0);

  expect(await getTestDb().session.count({ where: { userId: account.id } })).toBe(2);
  await expect(getTestDb().session.findUnique({ where: { id: second.id } })).resolves.not.toBeNull();
  expect(errors).toEqual([]);
});

test("the address opens the dialog directly, and confirming without another browser shows the notice once", async ({
  page,
}) => {
  const errors = collectErrors(page);

  await page.goto("/account?action=log-out-others");
  await logOutDialog(page).getByRole("button", { name: "Log out other browsers" }).click();

  await expect(page.getByText(LOGGED_OUT_NOTICE)).toBeVisible();
  await expect(page).toHaveURL("/account");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(LOGGED_OUT_NOTICE)).toHaveCount(0);
  expect(errors).toEqual([]);
});
