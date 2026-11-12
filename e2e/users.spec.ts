import type { Page } from "@playwright/test";

import { KNOWN_ADMIN, KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, NO_STORAGE_STATE, USER_STORAGE_STATE } from "./support/auth";
import { collectErrors } from "./support/browser";
import { createUser, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

test.beforeEach(async () => {
  await resetTestDatabase();
});

/** The rows of the user list, in display order. */
function userRows(page: Page) {
  return page.getByRole("list", { name: "Users" }).getByRole("listitem");
}

async function expectNotFound(page: Page, address: string) {
  const response = await page.goto(address);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Users" })).toHaveCount(0);
}

test.describe("the admin", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("sees all users by name, with the time of creation and a mark for a pending password change", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await createUser({ name: "zoe", mustChangePassword: false, createdAt: new Date("2026-03-01T10:00:00Z") });
    await createUser({ name: "bob", createdAt: new Date("2026-02-01T10:00:00Z") });

    await page.goto("/users");

    await expect(page).toHaveTitle("Users – HippoWiki");
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
    const rows = userRows(page);
    await expect(rows).toHaveText([/^admin/, /^alice/, /^bob/, /^zoe/]);
    const pending = "Password change pending";
    await expect(rows.nth(0)).not.toContainText(pending);
    await expect(rows.nth(1)).not.toContainText(pending);
    await expect(rows.nth(2)).toContainText(pending);
    await expect(rows.nth(3)).not.toContainText(pending);
    await expect(rows.nth(2).getByRole("time")).toHaveAttribute("datetime", "2026-02-01T10:00:00.000Z");
    await expect(rows.nth(2)).toContainText("Created Feb 1, 2026");
    // Neither the hidden email of a user nor anything of the password is shown.
    await expect(page.getByText(/hippowiki\.invalid|argon2/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("has the menu entry Users, which leads to the list", async ({ page }) => {
    await page.goto("/folders");

    await page.getByRole("banner").getByRole("link", { name: "Users" }).click();

    await expect(page).toHaveURL("/users");
    await expect(userRows(page)).toHaveText([new RegExp(`^${KNOWN_ADMIN.name}`), new RegExp(`^${KNOWN_USER.name}`)]);
  });

  for (const address of [
    "/users?action=anything",
    "/users?action=new",
    "/users?view=all",
    "/users?action=a&action=b",
  ]) {
    test(`${address} shows the not-found page`, async ({ page }) => {
      await expectNotFound(page, address);
    });
  }
});

test.describe("a normal user", () => {
  test.use({ storageState: USER_STORAGE_STATE });

  test("gets the not-found page for the user list", async ({ page }) => {
    await expectNotFound(page, "/users");
    await expect(page.getByText(KNOWN_ADMIN.name, { exact: true })).toHaveCount(0);
  });

  test("has no menu entry Users", async ({ page }) => {
    await page.goto("/folders");

    const banner = page.getByRole("banner");
    await expect(banner.getByRole("link", { name: "Folders" })).toBeVisible();
    await expect(banner.getByRole("link", { name: "Users" })).toHaveCount(0);
  });
});

test.describe("without a login", () => {
  test.use({ storageState: NO_STORAGE_STATE });

  test("the user list leads to the login page", async ({ page }) => {
    await page.goto("/users");

    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("list", { name: "Users" })).toHaveCount(0);
  });
});
