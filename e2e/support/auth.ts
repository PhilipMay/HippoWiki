// The logins that the end-to-end tests share. The setup project (e2e/auth.setup.ts) logs in once as each known user
// and saves the browser state and the rows of the sessions here; the tests start with a saved state instead of
// logging in again, and `resetTestDatabase()` puts the session rows back after it has emptied the tables.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import { TEST_PASSWORD } from "./database";
import { expect, hydrating } from "./test";

/** The directory of the saved logins; ignored by Git and removed before every run. */
export const AUTH_DIRECTORY = fileURLToPath(new URL("../.auth/", import.meta.url));

/** The browser state of the known normal user; the `chromium` project uses it for every test. */
export const USER_STORAGE_STATE = `${AUTH_DIRECTORY}user.json`;

/** The browser state of the known admin; a spec that needs the admin sets it with `test.use()`. */
export const ADMIN_STORAGE_STATE = `${AUTH_DIRECTORY}admin.json`;

/** The rows of the sessions behind the two browser states, as JSON. */
export const SESSIONS_FILE = `${AUTH_DIRECTORY}sessions.json`;

/** The browser state of a visitor who is not logged in; a spec that needs no user sets it with `test.use()`. */
export const NO_STORAGE_STATE = { cookies: [], origins: [] };

/**
 * Replaces the login of the browser by a saved login, such as `USER_STORAGE_STATE` or `ADMIN_STORAGE_STATE`. A test
 * opens a form with one login and submits it with the other, as if the other user had crafted the request.
 */
export async function becomeUser(context: BrowserContext, storageState: string): Promise<void> {
  const { cookies } = JSON.parse(readFileSync(storageState, "utf8")) as {
    cookies: Parameters<BrowserContext["addCookies"]>[0];
  };
  await context.clearCookies();
  await context.addCookies(cookies);
}

/**
 * Logs in as the given user in a browser context of its own, as another person working at the same time would, or as
 * a second browser of the same user. The user is one of `createUser()`, with `TEST_PASSWORD` and
 * `mustChangePassword: false`, unless another password is given, such as that of a known user. The test closes the
 * context when it is done.
 */
export async function logInElsewhere(
  browser: Browser,
  name: string,
  password?: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: NO_STORAGE_STATE });
  const page = await hydrating(await context.newPage());
  await logIn(page, name, password);
  await expect(page).toHaveURL("/folders");
  return { context, page };
}

/** Fills the login form of the open page with the user name and the password and submits it. */
export async function submitLogin(page: Page, name: string, password: string = TEST_PASSWORD): Promise<void> {
  await page.getByLabel("User name").fill(name);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

/** Opens the login page and submits the login form; the test asserts where the login leads. */
export async function logIn(page: Page, name: string, password: string = TEST_PASSWORD): Promise<void> {
  await page.goto("/login");
  await submitLogin(page, name, password);
}
