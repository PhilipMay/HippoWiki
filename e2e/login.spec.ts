import type { Browser, Page } from "@playwright/test";

import { KNOWN_ADMIN, KNOWN_USER } from "../prisma/known-users";
import { NO_STORAGE_STATE } from "./support/auth";
import { collectErrors } from "./support/browser";
import { createUser, getTestDb, resetTestDatabase, TEST_PASSWORD } from "./support/database";
import { expect, test } from "./support/test";

/**
 * The client address of the visitor of every test. The test server trusts one reverse proxy
 * (`HIPPOWIKI_TRUSTED_PROXIES=1` in `playwright.config.ts`), so the rightmost entry of `X-Forwarded-For` is the
 * client address; a test that needs another one opens a browser context of its own (`openLoginFrom()`).
 */
const VISITOR_ADDRESS = "192.0.2.10";

// The login is tested as a visitor who is not logged in yet.
test.use({ storageState: NO_STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": VISITOR_ADDRESS } });

/** The ids of the sessions of the saved logins, which every reset puts back; the tests count the other ones. */
let savedSessionIds: string[];

test.beforeEach(async () => {
  await resetTestDatabase();
  savedSessionIds = (await getTestDb().session.findMany({ select: { id: true } })).map(({ id }) => id);
});

/** How many sessions the logins of the test have started and not ended, of all users or of one. */
function newSessionCount(userId?: string): Promise<number> {
  return getTestDb().session.count({ where: { id: { notIn: savedSessionIds }, userId } });
}

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
  expect(await newSessionCount(KNOWN_USER.id)).toBe(1);
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
  expect(await newSessionCount()).toBe(0);
  expect(errors).toEqual([]);
});

test("a name that cannot belong to a user and a password in another case show the same message", async ({ page }) => {
  await page.goto("/login");

  await submitLogin(page, "Not A Name!", KNOWN_USER.password);
  await expect(formAlert(page)).toHaveText(INVALID_CREDENTIALS);
  await expect(page.getByLabel("User name")).toHaveValue("Not A Name!");

  await submitLogin(page, KNOWN_USER.name, KNOWN_USER.password.toUpperCase());
  // The alert shows the same text already, so the emptied password field tells that the answer has arrived. Without
  // the wait the next test would reset the database while this login is still being counted.
  await expect(page.getByLabel("Password")).toHaveValue("");
  await expect(formAlert(page)).toHaveText(INVALID_CREDENTIALS);
  expect(await newSessionCount()).toBe(0);
});

test("the right password logs in after a failed attempt", async ({ page }) => {
  await page.goto("/login");
  await submitLogin(page, KNOWN_USER.name, "wrong-password");
  await expect(formAlert(page)).toHaveText(INVALID_CREDENTIALS);

  await page.getByLabel("Password").fill(KNOWN_USER.password);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL("/folders");
});

const WAIT_ONE_MINUTE = "Too many failed logins. Please try again in 1 minute.";

/** Submits a wrong password for the name five times; each one is answered like any wrong password. */
async function failFiveLogins(page: Page, name: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await submitLogin(page, name, "wrong-password");
    await expect(formAlert(page)).toHaveText(INVALID_CREDENTIALS);
    // The password field is emptied when the answer has arrived; only then is the next attempt typed.
    await expect(page.getByLabel("Password")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Log in" })).toBeEnabled();
  }
}

test("after five wrong passwords the right one is refused with the message of the wait", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/login");
  await failFiveLogins(page, KNOWN_USER.name);

  await submitLogin(page, KNOWN_USER.name, KNOWN_USER.password);

  await expect(formAlert(page)).toHaveText(WAIT_ONE_MINUTE);
  await expect(page).toHaveURL("/login");
  await expect(page.getByLabel("User name")).toHaveValue(KNOWN_USER.name);
  await expect(page.getByLabel("Password")).toHaveValue("");
  expect(await newSessionCount()).toBe(0);
  expect(await getTestDb().loginAttempt.findMany()).toMatchObject([{ username: KNOWN_USER.name, failures: 5 }]);
  expect(errors).toEqual([]);
});

test("once the wait is over, the right password logs in", async ({ page }) => {
  await page.goto("/login");
  await failFiveLogins(page, KNOWN_USER.name);
  await submitLogin(page, KNOWN_USER.name, KNOWN_USER.password);
  await expect(formAlert(page)).toHaveText(WAIT_ONE_MINUTE);

  // As if a minute had passed: the stored time of the last failure is moved back.
  await getTestDb().loginAttempt.updateMany({
    where: { username: KNOWN_USER.name },
    data: { lastFailedAt: new Date(Date.now() - 61_000) },
  });
  await submitLogin(page, KNOWN_USER.name, KNOWN_USER.password);

  await expect(page).toHaveURL("/folders");
  await expect(page.getByRole("banner").getByText(KNOWN_USER.name, { exact: true })).toBeVisible();
  expect(await getTestDb().loginAttempt.count()).toBe(0);
});

test("an unknown name shows the same messages as a known one, also for the wait", async ({ page }) => {
  await page.goto("/login");
  await failFiveLogins(page, "nobody");

  await submitLogin(page, "nobody", "wrong-password");

  await expect(formAlert(page)).toHaveText(WAIT_ONE_MINUTE);
  expect(await getTestDb().loginAttempt.findMany()).toMatchObject([{ username: "nobody", failures: 5 }]);
});

test("the wait of one name does not hold back another user", async ({ page }) => {
  await getTestDb().loginAttempt.create({
    data: { username: KNOWN_USER.name, clientAddress: VISITOR_ADDRESS, failures: 9, lastFailedAt: new Date() },
  });
  await page.goto("/login");

  await submitLogin(page, KNOWN_USER.name, KNOWN_USER.password);
  await expect(formAlert(page)).toHaveText("Too many failed logins. Please try again in 15 minutes.");

  await submitLogin(page, KNOWN_ADMIN.name, KNOWN_ADMIN.password);
  await expect(page).toHaveURL("/folders");
});

test("with 20 logins for a name within the hour, the right password waits for the rest of the hour", async ({
  page,
}) => {
  await getTestDb().loginWindow.create({
    data: { username: KNOWN_USER.name, attempts: 20, startedAt: new Date() },
  });
  await page.goto("/login");

  await submitLogin(page, KNOWN_USER.name, KNOWN_USER.password);

  await expect(formAlert(page)).toHaveText("Too many failed logins. Please try again in 60 minutes.");
  expect(await newSessionCount()).toBe(0);

  await submitLogin(page, KNOWN_ADMIN.name, KNOWN_ADMIN.password);
  await expect(page).toHaveURL("/folders");
});

/**
 * Opens the login page in a browser context of its own that sends the given `X-Forwarded-For`, as a visitor from
 * another address. The page is closed with its context at the end of the test.
 */
async function openLoginFrom(browser: Browser, forwardedFor: string): Promise<Page> {
  const context = await browser.newContext({
    storageState: NO_STORAGE_STATE,
    extraHTTPHeaders: { "x-forwarded-for": forwardedFor },
  });
  const page = await context.newPage();
  await page.goto("/login");
  // Only the page of the fixture waits for hydration by itself (`support/test.ts`).
  await page.locator('html[data-hydrated="true"]').waitFor({ state: "attached" });
  return page;
}

test.describe("the wait per client address", () => {
  test("after five wrong passwords from one address the right one waits there and logs in from another", async ({
    page,
    browser,
  }) => {
    await page.goto("/login");
    await failFiveLogins(page, KNOWN_USER.name);

    await submitLogin(page, KNOWN_USER.name, KNOWN_USER.password);
    await expect(formAlert(page)).toHaveText(WAIT_ONE_MINUTE);
    expect(await getTestDb().loginAttempt.findMany()).toMatchObject([
      { username: KNOWN_USER.name, clientAddress: VISITOR_ADDRESS, failures: 5 },
    ]);

    const ownerPage = await openLoginFrom(browser, "198.51.100.9");
    await submitLogin(ownerPage, KNOWN_USER.name, KNOWN_USER.password);

    await expect(ownerPage).toHaveURL("/folders");
    expect(await newSessionCount(KNOWN_USER.id)).toBe(1);
    await ownerPage.context().close();
  });

  test("a forged entry to the left of the address gives no new budget", async ({ browser }) => {
    const strangerPage = await openLoginFrom(browser, "203.0.113.7");
    await failFiveLogins(strangerPage, KNOWN_USER.name);

    const forgingPage = await openLoginFrom(browser, "198.51.100.9, 203.0.113.7");
    await submitLogin(forgingPage, KNOWN_USER.name, KNOWN_USER.password);

    await expect(formAlert(forgingPage)).toHaveText(WAIT_ONE_MINUTE);
    expect(await getTestDb().loginAttempt.findMany()).toMatchObject([
      { username: KNOWN_USER.name, clientAddress: "203.0.113.7", failures: 5 },
    ]);
    await strangerPage.context().close();
    await forgingPage.context().close();
  });

  test("a header that is not an address counts in the shared group", async ({ browser }) => {
    const page = await openLoginFrom(browser, "unknown");

    await submitLogin(page, KNOWN_USER.name, "wrong-password");

    await expect(formAlert(page)).toHaveText(INVALID_CREDENTIALS);
    expect(await getTestDb().loginAttempt.findMany()).toMatchObject([
      { username: KNOWN_USER.name, clientAddress: "shared", failures: 1 },
    ]);
    await page.context().close();
  });
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

test("a user with a first password can log in, and is led to the password change", async ({ page }) => {
  const user = await createUser({ name: "newcomer" });
  await page.goto("/login");

  await submitLogin(page, user.username, TEST_PASSWORD);

  // What happens there is tested in change-password.spec.ts.
  await expect(page).toHaveURL("/change-password");
  await expect(page.getByRole("banner").getByText("newcomer", { exact: true })).toBeVisible();
  expect(await newSessionCount(user.id)).toBe(1);
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
  expect(await newSessionCount()).toBe(0);
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
  const otherContext = await browser.newContext({ storageState: NO_STORAGE_STATE });
  const otherPage = await otherContext.newPage();
  await otherPage.goto("/login");
  await submitLogin(otherPage, KNOWN_USER.name, KNOWN_USER.password);
  await expect(otherPage).toHaveURL("/folders");
  expect(await newSessionCount(KNOWN_USER.id)).toBe(2);

  await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("/login");

  expect(await newSessionCount(KNOWN_USER.id)).toBe(1);
  await otherPage.reload();
  await expect(otherPage.getByRole("banner").getByText(KNOWN_USER.name, { exact: true })).toBeVisible();
  await otherContext.close();
});

test("an address opened without a login leads back to it after the login", async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto("/account?action=create");
  await expect(page).toHaveURL("/login?next=%2Faccount%3Faction%3Dcreate");
  await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
  await submitLogin(page, KNOWN_USER.name, KNOWN_USER.password);

  await expect(page).toHaveURL("/account?action=create");
  await expect(page.getByRole("dialog", { name: "New token" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a failed login keeps the way back for the next attempt", async ({ page }) => {
  await page.goto("/login?next=%2Faccount");

  await submitLogin(page, KNOWN_USER.name, "wrong-password");
  await expect(formAlert(page)).toHaveText(INVALID_CREDENTIALS);
  await expect(page.getByLabel("Password")).toHaveValue("");
  await submitLogin(page, KNOWN_USER.name, KNOWN_USER.password);

  await expect(page).toHaveURL("/account");
});

for (const next of ["https://evil.example/", "//evil.example/", "/\\evil.example/", "javascript:alert(1)"]) {
  test(`a crafted way back to another site (${next}) leads to the folder list`, async ({ page }) => {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);

    await submitLogin(page, KNOWN_USER.name, KNOWN_USER.password);

    await expect(page).toHaveURL("/folders");
    await expect(page.getByRole("heading", { level: 1, name: "Folders" })).toBeVisible();
  });
}

test("a way back that a crafted request puts into the form leads to the folder list", async ({ page }) => {
  await page.goto("/login?next=%2Faccount");
  // The page checks the search parameter; the action checks the submitted field again.
  await page
    .getByRole("main")
    .locator("form")
    .evaluate((form: HTMLFormElement) => {
      form.addEventListener("formdata", (event) => {
        event.formData.set("next", "https://evil.example/");
      });
    });

  await submitLogin(page, KNOWN_USER.name, KNOWN_USER.password);

  await expect(page).toHaveURL("/folders");
});

test("a logged-in user who opens the login page with a way back lands there", async ({ page }) => {
  await logIn(page, KNOWN_USER);

  await page.goto("/login?next=%2Faccount");
  await expect(page).toHaveURL("/account");

  await page.goto("/login?next=https%3A%2F%2Fevil.example%2F");
  await expect(page).toHaveURL("/folders");
});

for (const address of ["/login?action=new", "/login?view=all"]) {
  test(`${address} shows the not-found page`, async ({ page }) => {
    const response = await page.goto(address);

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });
}
