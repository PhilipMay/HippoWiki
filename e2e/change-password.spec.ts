import type { Page } from "@playwright/test";

import { KNOWN_ADMIN, KNOWN_USER, type KnownUser } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, logIn, NO_STORAGE_STATE, submitLogin, USER_STORAGE_STATE } from "./support/auth";
import { collectErrors } from "./support/browser";
import {
  createFolder,
  createFolderRole,
  createPage,
  createUser,
  getTestDb,
  resetTestDatabase,
  storeFiveFailedLogins,
  TEST_PASSWORD,
} from "./support/database";
import { expectContent } from "./support/editor";
import { expect, hydrating, test } from "./support/test";

// The tests run as the known user with the saved login, whose password change a test makes pending on the row of the
// user: every reset puts the password and the saved sessions back. One test logs in through the login page, with a
// user of its own and a first password.
test.use({ storageState: USER_STORAGE_STATE });

const NEW_PASSWORD = "my-own-password";

/** The folder whose page the tests open; the known user is its Owner. */
let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
  await createPage({ folder: handbook, name: "overview", content: "# Secret overview\n\nSecret text" });
});

/** Makes the password change of the known user or admin pending, as for a first password. */
async function makeChangePending(known: KnownUser = KNOWN_USER) {
  await getTestDb().user.update({ where: { id: known.id }, data: { mustChangePassword: true } });
}

/** Makes the password change of the known user pending and opens it, with the saved login of the user. */
async function openPendingChange(page: Page) {
  await makeChangePending();
  await page.goto("/change-password");
  await expect(page).toHaveURL("/change-password");
}

/** The stored password hash of the known user, to show that a refused change kept it. */
async function storedAccount() {
  return getTestDb().account.findFirstOrThrow({ where: { userId: KNOWN_USER.id } });
}

/**
 * The "New password" field. Its label is the start of the label of "Repeat new password" turned around: a search for
 * the text alone would find both, and required fields have an asterisk after their label, so no exact match either.
 */
function newPasswordField(page: Page) {
  return page.getByLabel(/^New password/);
}

/** Fills the three fields of the password change and submits it. */
async function submitChange(
  page: Page,
  {
    current = KNOWN_USER.password,
    next = NEW_PASSWORD,
    repeat = next,
  }: { current?: string; next?: string; repeat?: string },
) {
  await page.getByLabel("Current password").fill(current);
  await newPasswordField(page).fill(next);
  await page.getByLabel("Repeat new password").fill(repeat);
  await page.getByRole("button", { name: "Change password" }).click();
}

async function expectChangePasswordPage(page: Page) {
  await expect(page).toHaveURL("/change-password");
  await expect(page.getByRole("heading", { level: 1, name: "Change password" })).toBeVisible();
  await expect(page.getByText(/Secret/)).toHaveCount(0);
}

test("a user with a pending password change sees its form", async ({ page }) => {
  const errors = collectErrors(page);

  await openPendingChange(page);

  await expect(page).toHaveTitle("Change password – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: "Change password" })).toBeVisible();
  await expect(page.getByLabel("Current password")).toBeFocused();
  for (const field of [
    page.getByLabel("Current password"),
    newPasswordField(page),
    page.getByLabel("Repeat new password"),
  ]) {
    await expect(field).toHaveAttribute("type", "password");
  }
  // The hint under "New password" names the lengths and the rules of a new password.
  await expect(
    page.getByText(
      "8 to 128 characters, not built from your user name or the name of the wiki, and not a common password",
      { exact: true },
    ),
  ).toBeVisible();
  // The header shows who is logged in and lets the user log out, but has no menu yet.
  const banner = page.getByRole("banner");
  await expect(banner.getByText(KNOWN_USER.name, { exact: true })).toBeVisible();
  await expect(banner.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(banner.getByRole("navigation")).toHaveCount(0);
  // The account would only lead to the password change, so the name is no link yet.
  await expect(banner.getByRole("link", { name: KNOWN_USER.name })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Which addresses wait for the change is tested in src/features/auth/session.test.ts (`requireUser()`).
test("every kind of address leads to the password change while it is pending", async ({ page }) => {
  await makeChangePending();

  for (const [what, address] of [
    ["the home page", "/"],
    ["the folder list", "/folders"],
    ["a folder", "/folders/handbook"],
    ["a page", "/folders/handbook/overview.md"],
    ["an address with an action", "/folders?action=new"],
    ["a page with an action", "/folders/handbook/overview.md?action=edit"],
    ["the deleted items of a folder", "/deleted-items/handbook"],
    ["the login page", "/login"],
  ] as const) {
    await page.goto(address);

    await expect(page, `${what} (${address})`).toHaveURL("/change-password");
    await expectChangePasswordPage(page);
  }
});

test("log out works while the password change is pending", async ({ page }) => {
  await openPendingChange(page);

  await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();

  await expect(page).toHaveURL("/login");
  expect(await getTestDb().session.count({ where: { userId: KNOWN_USER.id } })).toBe(0);
  // The change is still pending for the next login.
  expect((await getTestDb().user.findUniqueOrThrow({ where: { id: KNOWN_USER.id } })).mustChangePassword).toBe(true);
});

test.describe("a rule that the new password breaks", () => {
  // Each case breaks one rule: its error shows at its field, which gets the focus, and the user stays on the form.
  // The other rules of a new password give their errors in the same way; they are tested in
  // src/features/auth/schema.test.ts and src/features/users/schema.test.ts.
  for (const { what, input, field, error, emptied } of [
    {
      what: "a repetition that differs",
      input: { repeat: "another-password" },
      field: "Repeat new password",
      error: "The two new passwords do not match",
    },
    {
      what: "a wrong current password",
      input: { current: "wrong-password" },
      field: "Current password",
      error: "Current password is wrong",
      emptied: true,
    },
  ]) {
    test(`${what} shows its error and keeps the user on the form`, async ({ page }) => {
      const errors = collectErrors(page);
      await openPendingChange(page);
      const before = await storedAccount();

      await submitChange(page, input);

      await expect(page.getByText(error, { exact: true })).toBeVisible();
      await expect(page.getByLabel(new RegExp(`^${field}`))).toBeFocused();
      await expectChangePasswordPage(page);
      if (emptied) {
        // A refused current password empties the passwords, so that it is not submitted again by mistake.
        for (const field of [
          page.getByLabel("Current password"),
          newPasswordField(page),
          page.getByLabel("Repeat new password"),
        ]) {
          await expect(field).toHaveValue("");
        }
      } else {
        // What was entered stays in the form, so that only the field with the error has to be typed again.
        await expect(newPasswordField(page)).toHaveValue(NEW_PASSWORD);
      }
      // Nothing was changed: the current password still logs in and the change is still pending.
      expect(await storedAccount()).toStrictEqual(before);
      expect((await getTestDb().user.findUniqueOrThrow({ where: { id: KNOWN_USER.id } })).mustChangePassword).toBe(
        true,
      );
      await page.goto("/folders");
      await expectChangePasswordPage(page);
      expect(errors).toEqual([]);
    });
  }

  test("an empty form shows the errors of its fields together", async ({ page }) => {
    await openPendingChange(page);

    await page.getByRole("button", { name: "Change password" }).click();

    await expect(page.getByText("Current password is required")).toBeVisible();
    await expect(page.getByText("Password is required", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Current password")).toBeFocused();
    await expectChangePasswordPage(page);
  });

  test("the error goes away once the rule is kept, and the change goes through", async ({ page }) => {
    await openPendingChange(page);
    await submitChange(page, { repeat: "another-password" });
    await expect(page.getByText("The two new passwords do not match")).toBeVisible();

    await page.getByLabel("Repeat new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();

    await expect(page).toHaveURL("/folders");
  });
});

test.describe("wrong current passwords", () => {
  // The client address of the tests, after the one trusted proxy of the end-to-end server (`playwright.config.ts`).
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "192.0.2.20" } });

  // That each wrong current password is counted is tested in integration/auth-service.test.ts.
  test("count like failed logins: after 5 the change waits, and so does the login of the name", async ({ page }) => {
    const errors = collectErrors(page);
    await openPendingChange(page);
    const before = await storedAccount();
    // As five wrong current passwords leave the counts.
    await storeFiveFailedLogins(KNOWN_USER.name, "192.0.2.20");

    await submitChange(page, {});

    await expect(
      page.getByText("Too many wrong passwords. Please try again in 1 minute.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Current password")).toBeFocused();
    await expect(page.getByLabel("Current password")).toHaveValue("");
    await expectChangePasswordPage(page);
    expect(await storedAccount()).toStrictEqual(before);

    await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL("/login");
    await submitLogin(page, KNOWN_USER.name, KNOWN_USER.password);
    await expect(page.getByText("Too many failed logins. Please try again in 1 minute.")).toBeVisible();
    await expect(page).toHaveURL("/login");
    expect(errors).toEqual([]);
  });
});

test.describe("a user of its own with a first password", () => {
  // The one test that logs in through the login page, for the whole way of a first password.
  test.use({ storageState: NO_STORAGE_STATE });

  test("logs in, lands on the password change, then on the folder list, and the next login needs the new password", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const user = await createUser({ name: "newcomer" });
    await createFolderRole({ folder: handbook, user, role: "reader" });
    await logIn(page, "newcomer");
    await expectChangePasswordPage(page);

    await submitChange(page, { current: TEST_PASSWORD });

    await expect(page).toHaveURL("/folders");
    await expect(page.getByRole("heading", { level: 1, name: "Folders" })).toBeVisible();
    const banner = page.getByRole("banner");
    await expect(banner.getByText("newcomer", { exact: true })).toBeVisible();
    await expect(banner.getByRole("link", { name: "Folders" })).toBeVisible();
    await expect(banner.getByRole("link", { name: "newcomer" })).toHaveAttribute("href", "/account");
    expect((await getTestDb().user.findUniqueOrThrow({ where: { id: user.id } })).mustChangePassword).toBe(false);
    // The content is open now.
    await page.goto("/folders/handbook/overview.md");
    await expect(page.getByRole("heading", { level: 1, name: "Secret overview" })).toBeVisible();
    expect(errors).toEqual([]);

    await banner.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL("/login");
    await logIn(page, "newcomer", TEST_PASSWORD);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Invalid user name or password");
    await logIn(page, "newcomer", NEW_PASSWORD);
    await expect(page).toHaveURL("/folders");
  });

  test("without a login the password change leads to the login page", async ({ page }) => {
    await page.goto("/change-password");

    await expect(page).toHaveURL("/login?next=%2Fchange-password");
  });
});

test("the change logs out a second browser of the same user", async ({ page, browser }) => {
  await openPendingChange(page);
  // The second browser has a session of its own, which the change ends.
  const otherContext = await browser.newContext({ storageState: NO_STORAGE_STATE });
  const otherPage = await hydrating(await otherContext.newPage());
  await logIn(otherPage, KNOWN_USER.name, KNOWN_USER.password);
  await expect(otherPage).toHaveURL("/change-password");
  expect(await getTestDb().session.count({ where: { userId: KNOWN_USER.id } })).toBe(2);

  await submitChange(page, {});
  await expect(page).toHaveURL("/folders");

  expect(await getTestDb().session.count({ where: { userId: KNOWN_USER.id } })).toBe(1);
  await otherPage.goto("/folders");
  await expect(otherPage).toHaveURL("/login");
  // The browser that changed the password stays logged in.
  await page.reload();
  await expect(page.getByRole("banner").getByText(KNOWN_USER.name, { exact: true })).toBeVisible();
  await otherContext.close();
});

test("a form that is submitted in a second tab after the change leads to the folder list", async ({
  page,
  context,
}) => {
  await openPendingChange(page);
  const otherTab = await hydrating(await context.newPage());
  await otherTab.goto("/change-password");
  await submitChange(page, {});
  await expect(page).toHaveURL("/folders");
  const changed = await storedAccount();

  // The second tab still shows the form, but the change is done: there is nothing left to do.
  await otherTab.getByLabel("Current password").fill(NEW_PASSWORD);
  await newPasswordField(otherTab).fill("yet-another-password");
  await otherTab.getByLabel("Repeat new password").fill("yet-another-password");
  await otherTab.getByRole("button", { name: "Change password" }).click();

  await expect(otherTab).toHaveURL("/folders");
  // The password stays the one of the first change.
  expect(await storedAccount()).toStrictEqual(changed);
});

// A login with a way back leads to the password change with it (src/features/auth/actions.test.ts).
test("a user with a pending password change reaches the way back after the change", async ({ page }) => {
  const errors = collectErrors(page);
  await makeChangePending();

  await page.goto("/change-password?next=%2Ffolders%2Fhandbook%2Foverview.md%3Faction%3Dedit");

  // The password change comes first and keeps the way back.
  await expect(page).toHaveURL("/change-password?next=%2Ffolders%2Fhandbook%2Foverview.md%3Faction%3Dedit");
  await expect(page.getByRole("heading", { level: 1, name: "Change password" })).toBeVisible();
  await expect(page.getByText(/Secret/)).toHaveCount(0);
  await submitChange(page, {});

  await expect(page).toHaveURL("/folders/handbook/overview.md?action=edit");
  await expectContent(page, "# Secret overview\n\nSecret text");
  expect(errors).toEqual([]);
});

test("a rule that the new password breaks keeps the way back", async ({ page }) => {
  await makeChangePending();
  await page.goto("/change-password?next=%2Faccount");

  await submitChange(page, { next: "short" });
  await expect(newPasswordField(page)).toHaveAttribute("aria-invalid", "true");
  await submitChange(page, {});

  await expect(page).toHaveURL("/account");
});

test.describe("an admin with a pending password change", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("lands on the user list after the change", async ({ page }) => {
    const errors = collectErrors(page);
    await makeChangePending(KNOWN_ADMIN);
    await page.goto("/users");
    await expectChangePasswordPage(page);

    await submitChange(page, { current: KNOWN_ADMIN.password });

    await expect(page).toHaveURL("/users");
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Folders" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe("an admin without a pending password change", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("who opens the password change lands on the user list", async ({ page }) => {
    await page.goto("/change-password?next=%2Ffolders");

    await expect(page).toHaveURL("/users");
  });
});

test.describe("a user without a pending password change", () => {
  test("who opens the password change lands on the folder list", async ({ page }) => {
    await page.goto("/change-password");

    await expect(page).toHaveURL("/folders");
    await expect(page.getByRole("banner").getByText(KNOWN_USER.name, { exact: true })).toBeVisible();
  });

  test("/change-password?action=new shows the not-found page", async ({ page }) => {
    const response = await page.goto("/change-password?action=new");

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });
});
