import type { Page } from "@playwright/test";

import { KNOWN_ADMIN, KNOWN_USER } from "../prisma/known-users";
import { collectErrors } from "./support/browser";
import { createUser, getTestDb, resetTestDatabase, TEST_PASSWORD } from "./support/database";
import { expect, test } from "./support/test";

test.beforeEach(async () => {
  await resetTestDatabase();
});

const INVALID_CREDENTIALS = "Invalid user name or password";

/** The error message above the login form. Next.js has an alert of its own outside `main`, its route announcer. */
function formAlert(page: Page) {
  return page.getByRole("main").getByRole("alert");
}

/** Fills the login form and submits it. */
async function submitLogin(page: Page, name: string, password: string) {
  await page.getByLabel("User name").fill(name);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

/** Opens the login page and logs in. */
async function logIn(page: Page, { name, password }: { name: string; password: string }) {
  await page.goto("/login");
  await submitLogin(page, name, password);
  await expect(page).toHaveURL("/folders");
}

test("the login page shows the form and no user in the header", async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto("/login");

  await expect(page).toHaveTitle("Log in – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
  await expect(page.getByLabel("User name")).toBeFocused();
  await expect(page.getByLabel("User name")).toHaveValue("");
  await expect(page.getByLabel("Password")).toHaveAttribute("type", "password");
  await expect(page.getByRole("banner").getByRole("button", { name: "Log out" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a login leads to the folder list and the header shows the name", async ({ page }) => {
  const errors = collectErrors(page);

  await logIn(page, KNOWN_USER);

  await expect(page.getByRole("heading", { level: 1, name: "Folders" })).toBeVisible();
  const banner = page.getByRole("banner");
  await expect(banner.getByText(KNOWN_USER.name, { exact: true })).toBeVisible();
  await expect(banner.getByRole("button", { name: "Log out" })).toBeVisible();
  expect(await getTestDb().session.count({ where: { userId: KNOWN_USER.id } })).toBe(1);
  expect(errors).toEqual([]);
});

test("the admin logs in like every other user", async ({ page }) => {
  await logIn(page, KNOWN_ADMIN);

  await expect(page.getByRole("banner").getByText(KNOWN_ADMIN.name, { exact: true })).toBeVisible();
});

test("the Enter key in the password field logs in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("User name").fill(KNOWN_USER.name);
  await page.getByLabel("Password").fill(KNOWN_USER.password);

  await page.getByLabel("Password").press("Enter");

  await expect(page).toHaveURL("/folders");
});

test("a name with spaces around it logs in", async ({ page }) => {
  await page.goto("/login");

  await submitLogin(page, `  ${KNOWN_USER.name} `, KNOWN_USER.password);

  await expect(page).toHaveURL("/folders");
  await expect(page.getByRole("banner").getByText(KNOWN_USER.name, { exact: true })).toBeVisible();
});

test("the session cookie is not readable by scripts and lasts 30 days", async ({ page, context }) => {
  const before = Date.now() / 1000;

  await logIn(page, KNOWN_USER);

  // The cookie is `Secure`, with the prefix that goes with it, in a production build only.
  const production = process.env.HIPPOWIKI_E2E_SERVER === "production";
  const cookies = await context.cookies();
  expect(cookies.map(({ name }) => name)).toEqual([
    production ? "__Secure-better-auth.session_token" : "better-auth.session_token",
  ]);
  const [cookie] = cookies;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", secure: production });
  const lifetime = (cookie?.expires ?? 0) - before;
  expect(lifetime).toBeGreaterThan(30 * 24 * 60 * 60 - 60);
  expect(lifetime).toBeLessThan(30 * 24 * 60 * 60 + 60);
  expect(await page.evaluate(() => document.cookie)).toBe("");
});

test("a wrong password and an unknown name show the same message, and the name stays in the form", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/login");

  await submitLogin(page, KNOWN_USER.name, "wrong-password");

  const alert = formAlert(page);
  await expect(alert).toHaveText(INVALID_CREDENTIALS);
  await expect(page).toHaveURL("/login");
  await expect(page.getByLabel("User name")).toHaveValue(KNOWN_USER.name);
  await expect(page.getByLabel("Password")).toHaveValue("");

  await submitLogin(page, "nobody", "wrong-password");

  await expect(alert).toHaveText(INVALID_CREDENTIALS);
  await expect(page).toHaveURL("/login");
  await expect(page.getByLabel("User name")).toHaveValue("nobody");
  await expect(page.getByLabel("Password")).toHaveValue("");
  await expect(page.getByRole("banner").getByRole("button", { name: "Log out" })).toHaveCount(0);
  expect(await getTestDb().session.count()).toBe(0);
  expect(errors).toEqual([]);
});

test("a name that cannot belong to a user and a password in another case show the same message", async ({ page }) => {
  await page.goto("/login");

  await submitLogin(page, "Not A Name!", KNOWN_USER.password);
  await expect(formAlert(page)).toHaveText(INVALID_CREDENTIALS);
  await expect(page.getByLabel("User name")).toHaveValue("Not A Name!");

  await submitLogin(page, KNOWN_USER.name, KNOWN_USER.password.toUpperCase());
  await expect(formAlert(page)).toHaveText(INVALID_CREDENTIALS);
  expect(await getTestDb().session.count()).toBe(0);
});

test("the right password logs in after a failed attempt", async ({ page }) => {
  await page.goto("/login");
  await submitLogin(page, KNOWN_USER.name, "wrong-password");
  await expect(formAlert(page)).toHaveText(INVALID_CREDENTIALS);

  await page.getByLabel("Password").fill(KNOWN_USER.password);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL("/folders");
});

test("an empty form shows an error at each field and focuses the first one", async ({ page }) => {
  await page.goto("/login");

  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByText("User name is required")).toBeVisible();
  await expect(page.getByText("Password is required")).toBeVisible();
  await expect(page.getByLabel("User name")).toBeFocused();
  await expect(formAlert(page)).toHaveCount(0);
  await expect(page).toHaveURL("/login");
});

test("a missing password shows its error, keeps the name and focuses the password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("User name").fill(KNOWN_USER.name);

  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByText("Password is required")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeFocused();
  await expect(page.getByLabel("User name")).toHaveValue(KNOWN_USER.name);
});

test("a user with a first password can log in", async ({ page }) => {
  const user = await createUser({ name: "newcomer" });

  await logIn(page, { name: user.username, password: TEST_PASSWORD });

  await expect(page.getByRole("banner").getByText("newcomer", { exact: true })).toBeVisible();
});

test("log out leads to the login page and the header shows no name", async ({ page }) => {
  const errors = collectErrors(page);
  await logIn(page, KNOWN_USER);

  await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();

  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
  const banner = page.getByRole("banner");
  await expect(banner.getByText(KNOWN_USER.name, { exact: true })).toHaveCount(0);
  await expect(banner.getByRole("button", { name: "Log out" })).toHaveCount(0);
  expect(await getTestDb().session.count()).toBe(0);
  expect(await page.context().cookies()).toEqual([]);
  expect(errors).toEqual([]);
});

test("a new login after a logout works", async ({ page }) => {
  await logIn(page, KNOWN_USER);
  await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("/login");

  await submitLogin(page, KNOWN_ADMIN.name, KNOWN_ADMIN.password);

  await expect(page).toHaveURL("/folders");
  await expect(page.getByRole("banner").getByText(KNOWN_ADMIN.name, { exact: true })).toBeVisible();
});

test("a logged-in user who opens the login page lands on the folder list", async ({ page }) => {
  await logIn(page, KNOWN_USER);

  await page.goto("/login");

  await expect(page).toHaveURL("/folders");
  await expect(page.getByRole("heading", { level: 1, name: "Folders" })).toBeVisible();
});

test("a user can be logged in in two browsers, and a logout ends only one of the sessions", async ({
  page,
  browser,
}) => {
  await logIn(page, KNOWN_USER);
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await otherPage.goto("/login");
  await submitLogin(otherPage, KNOWN_USER.name, KNOWN_USER.password);
  await expect(otherPage).toHaveURL("/folders");
  expect(await getTestDb().session.count({ where: { userId: KNOWN_USER.id } })).toBe(2);

  await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("/login");

  expect(await getTestDb().session.count({ where: { userId: KNOWN_USER.id } })).toBe(1);
  await otherPage.reload();
  await expect(otherPage.getByRole("banner").getByText(KNOWN_USER.name, { exact: true })).toBeVisible();
  await otherContext.close();
});

for (const address of ["/login?action=new", "/login?view=all"]) {
  test(`${address} shows the not-found page`, async ({ page }) => {
    const response = await page.goto(address);

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });
}
