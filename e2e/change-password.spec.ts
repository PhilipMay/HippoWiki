import type { Page } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, logIn, NO_STORAGE_STATE, submitLogin, USER_STORAGE_STATE } from "./support/auth";
import { collectErrors } from "./support/browser";
import {
  createFolder,
  createFolderRole,
  createPage,
  createUser,
  getTestDb,
  resetTestDatabase,
  TEST_PASSWORD,
} from "./support/database";
import { expect, hydrating, test } from "./support/test";

// The users of these tests log in themselves, with a first password.
test.use({ storageState: NO_STORAGE_STATE });

const NEW_PASSWORD = "my-own-password";

/** The folder whose page the tests open; the new user of a test gets a role on it to read it. */
let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
  await createPage({ folder: handbook, name: "overview", content: "# Secret overview\n\nSecret text" });
});

/** Creates a user with a first password and logs in, which leads to the password change. */
async function logInWithFirstPassword(page: Page, name = "newcomer") {
  const user = await createUser({ name });
  await logIn(page, name);
  await expect(page).toHaveURL("/change-password");
  return user;
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
  { current = TEST_PASSWORD, next = NEW_PASSWORD, repeat = next }: { current?: string; next?: string; repeat?: string },
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

test("a user with a first password logs in and lands on the password change", async ({ page }) => {
  const errors = collectErrors(page);

  await logInWithFirstPassword(page);

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
  await expect(banner.getByText("newcomer", { exact: true })).toBeVisible();
  await expect(banner.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(banner.getByRole("navigation")).toHaveCount(0);
  // The account would only lead to the password change, so the name is no link yet.
  await expect(banner.getByRole("link", { name: "newcomer" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const [what, address] of [
  ["the home page", "/"],
  ["the folder list", "/folders"],
  ["a folder", "/folders/handbook"],
  ["a page", "/folders/handbook/overview.md"],
  ["an address with an action", "/folders?action=new"],
  ["a page with an action", "/folders/handbook/overview.md?action=edit"],
  ["the deleted pages of a folder", "/deleted-pages/handbook"],
  ["the login page", "/login"],
] as const) {
  test(`${what} (${address}) leads to the password change while it is pending`, async ({ page }) => {
    await logInWithFirstPassword(page);

    await page.goto(address);

    await expectChangePasswordPage(page);
  });
}

test("log out works while the password change is pending", async ({ page }) => {
  const user = await logInWithFirstPassword(page);

  await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();

  await expect(page).toHaveURL("/login");
  expect(await getTestDb().session.count({ where: { userId: user.id } })).toBe(0);
  // The change is still pending at the next login.
  await logIn(page, "newcomer");
  await expect(page).toHaveURL("/change-password");
});

test.describe("a rule that the new password breaks", () => {
  // Each case breaks one rule: its error shows at its field, which gets the focus, and the user stays on the form.
  for (const { what, name, input, field, error } of [
    {
      what: "a new password of 7 characters",
      name: "newcomer",
      input: { next: "1234567" },
      field: "New password",
      error: "Password must be at least 8 characters",
    },
    {
      what: "a new password of 129 characters",
      name: "newcomer",
      input: { next: "p".repeat(129) },
      field: "New password",
      error: "Password must be at most 128 characters",
    },
    {
      what: "a new password built from the user name",
      name: "alexander",
      input: { next: "Alexander2026" },
      field: "New password",
      error: "Password must not be built only from the user name or the name of the wiki, digits and symbols",
    },
    {
      what: "a new password built from the name of the wiki",
      name: "newcomer",
      input: { next: "hippowiki2026" },
      field: "New password",
      error: "Password must not be built only from the user name or the name of the wiki, digits and symbols",
    },
    {
      what: "a common new password",
      name: "newcomer",
      input: { next: "password123" },
      field: "New password",
      error: "Password is too common, choose another one",
    },
    {
      what: "a new password that is the current one",
      name: "newcomer",
      input: { next: TEST_PASSWORD },
      field: "New password",
      error: "New password must differ from the current one",
    },
    {
      what: "a repetition that differs",
      name: "newcomer",
      input: { repeat: "another-password" },
      field: "Repeat new password",
      error: "The two new passwords do not match",
    },
    {
      what: "a wrong current password",
      name: "newcomer",
      input: { current: "wrong-password" },
      field: "Current password",
      error: "Current password is wrong",
    },
    {
      what: "a missing current password",
      name: "newcomer",
      input: { current: "" },
      field: "Current password",
      error: "Current password is required",
    },
  ]) {
    test(`${what} shows its error and keeps the user on the form`, async ({ page }) => {
      const errors = collectErrors(page);
      const user = await logInWithFirstPassword(page, name);
      const before = await getTestDb().account.findFirstOrThrow({ where: { userId: user.id } });

      await submitChange(page, input);

      await expect(page.getByText(error, { exact: true })).toBeVisible();
      await expect(page.getByLabel(new RegExp(`^${field}`))).toBeFocused();
      await expectChangePasswordPage(page);
      // What was entered stays in the form, so that only the field with the error has to be typed again.
      await expect(newPasswordField(page)).toHaveValue(input.next ?? NEW_PASSWORD);
      // Nothing was changed: the first password still logs in and the change is still pending.
      expect(await getTestDb().account.findFirstOrThrow({ where: { userId: user.id } })).toStrictEqual(before);
      expect((await getTestDb().user.findUniqueOrThrow({ where: { id: user.id } })).mustChangePassword).toBe(true);
      await page.goto("/folders");
      await expectChangePasswordPage(page);
      expect(errors).toEqual([]);
    });
  }

  test("an empty form shows the errors of its fields together", async ({ page }) => {
    await logInWithFirstPassword(page);

    await page.getByRole("button", { name: "Change password" }).click();

    await expect(page.getByText("Current password is required")).toBeVisible();
    await expect(page.getByText("Password is required", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Current password")).toBeFocused();
    await expectChangePasswordPage(page);
  });

  test("the error goes away once the rule is kept, and the change goes through", async ({ page }) => {
    await logInWithFirstPassword(page);
    await submitChange(page, { repeat: "another-password" });
    await expect(page.getByText("The two new passwords do not match")).toBeVisible();

    await page.getByLabel("Repeat new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();

    await expect(page).toHaveURL("/folders");
  });
});

test("after the change the user lands on the folder list, and the next login needs the new password", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const user = await logInWithFirstPassword(page);
  await createFolderRole({ folder: handbook, user, role: "reader" });

  await submitChange(page, {});

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

test("the change logs out a second browser of the same user", async ({ page, browser }) => {
  const user = await logInWithFirstPassword(page);
  const otherContext = await browser.newContext({ storageState: NO_STORAGE_STATE });
  const otherPage = hydrating(await otherContext.newPage());
  await logIn(otherPage, "newcomer");
  await expect(otherPage).toHaveURL("/change-password");
  expect(await getTestDb().session.count({ where: { userId: user.id } })).toBe(2);

  await submitChange(page, {});
  await expect(page).toHaveURL("/folders");

  expect(await getTestDb().session.count({ where: { userId: user.id } })).toBe(1);
  await otherPage.goto("/folders");
  await expect(otherPage).toHaveURL("/login");
  // The browser that changed the password stays logged in.
  await page.reload();
  await expect(page.getByRole("banner").getByText("newcomer", { exact: true })).toBeVisible();
  await otherContext.close();
});

test("a form that is submitted in a second tab after the change leads to the folder list", async ({
  page,
  context,
}) => {
  await logInWithFirstPassword(page);
  const otherTab = hydrating(await context.newPage());
  await otherTab.goto("/change-password");
  await submitChange(page, {});
  await expect(page).toHaveURL("/folders");

  // The second tab still shows the form, but the change is done: there is nothing left to do.
  await otherTab.getByLabel("Current password").fill(NEW_PASSWORD);
  await newPasswordField(otherTab).fill("yet-another-password");
  await otherTab.getByLabel("Repeat new password").fill("yet-another-password");
  await otherTab.getByRole("button", { name: "Change password" }).click();

  await expect(otherTab).toHaveURL("/folders");
  await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();
  await logIn(page, "newcomer", NEW_PASSWORD);
  await expect(page).toHaveURL("/folders");
});

test("without a login the password change leads to the login page", async ({ page }) => {
  await page.goto("/change-password");

  await expect(page).toHaveURL("/login?next=%2Fchange-password");
});

test("a user with a first password reaches the address that asked for the login after the password change", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const newcomer = await createUser({ name: "newcomer" });
  await createFolderRole({ folder: handbook, user: newcomer, role: "writer" });

  await page.goto("/folders/handbook/overview.md?action=edit");
  await expect(page).toHaveURL("/login?next=%2Ffolders%2Fhandbook%2Foverview.md%3Faction%3Dedit");
  await submitLogin(page, "newcomer");

  // The password change comes first and keeps the way back.
  await expect(page).toHaveURL("/change-password?next=%2Ffolders%2Fhandbook%2Foverview.md%3Faction%3Dedit");
  await expect(page.getByRole("heading", { level: 1, name: "Change password" })).toBeVisible();
  await expect(page.getByText(/Secret/)).toHaveCount(0);
  await submitChange(page, {});

  await expect(page).toHaveURL("/folders/handbook/overview.md?action=edit");
  await expect(page.getByLabel("Content")).toHaveValue("# Secret overview\n\nSecret text");
  expect(errors).toEqual([]);
});

test("a rule that the new password breaks keeps the way back", async ({ page }) => {
  await createUser({ name: "newcomer" });
  await page.goto("/login?next=%2Faccount");
  await submitLogin(page, "newcomer");
  await expect(page).toHaveURL("/change-password?next=%2Faccount");

  await submitChange(page, { next: "short" });
  await expect(newPasswordField(page)).toHaveAttribute("aria-invalid", "true");
  await submitChange(page, {});

  await expect(page).toHaveURL("/account");
});

test("a crafted way back to another site leads to the folder list after the password change", async ({ page }) => {
  await logInWithFirstPassword(page);
  await page.goto("/change-password?next=https%3A%2F%2Fevil.example%2F");

  await submitChange(page, {});

  await expect(page).toHaveURL("/folders");
});

test("a new admin lands on the user list after the first password change", async ({ page }) => {
  const errors = collectErrors(page);
  await createUser({ name: "maria", type: "admin" });
  await logIn(page, "maria");
  await expectChangePasswordPage(page);

  await submitChange(page, {});

  await expect(page).toHaveURL("/users");
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Folders" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a new admin with a way back into the content lands on the user list after the change", async ({ page }) => {
  await createUser({ name: "maria", type: "admin" });
  await page.goto("/login?next=%2Ffolders%2Fteam");
  await submitLogin(page, "maria");
  await expect(page).toHaveURL("/change-password?next=%2Ffolders%2Fteam");

  await submitChange(page, {});

  await expect(page).toHaveURL("/users");
});

test.describe("an admin without a pending password change", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("who opens the password change lands on the user list", async ({ page }) => {
    await page.goto("/change-password?next=%2Ffolders");

    await expect(page).toHaveURL("/users");
  });
});

test.describe("a user without a pending password change", () => {
  test.use({ storageState: USER_STORAGE_STATE });

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
