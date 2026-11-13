import type { Page } from "@playwright/test";

import { KNOWN_ADMIN, KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE } from "./support/auth";
import { collectErrors } from "./support/browser";
import { createApiToken, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

test.beforeEach(async () => {
  await resetTestDatabase();
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** A token as the dialog shows it: the prefix and 43 characters of base64url. */
const TOKEN = /^hw_[A-Za-z0-9_-]{43}$/;

/** The rows of the token list, in display order. */
function tokenRows(page: Page) {
  return page.getByRole("list", { name: "API tokens" }).getByRole("listitem");
}

/** The rows of the token list behind an open dialog, which hides the rest of the page from assistive technology. */
function tokenRowsBehindDialog(page: Page) {
  return page
    .getByRole("list", { name: "API tokens", includeHidden: true })
    .getByRole("listitem", { includeHidden: true });
}

function newTokenDialog(page: Page) {
  return page.getByRole("dialog", { name: "New token" });
}

function tokenCreatedDialog(page: Page) {
  return page.getByRole("dialog", { name: "Token created" });
}

/** Opens the "New token" dialog, fills in the name and returns the dialog. */
async function openNewToken(page: Page, name: string) {
  await page.goto("/account?action=create");
  const dialog = newTokenDialog(page);
  await dialog.getByLabel("Name").fill(name);
  return dialog;
}

async function expectNotFound(page: Page, address: string) {
  const response = await page.goto(address);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("the page shows the user name and an empty token list; the name in the header leads there", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/folders");

  await page.getByRole("banner").getByRole("link", { name: KNOWN_USER.name }).click();

  await expect(page).toHaveURL("/account");
  await expect(page).toHaveTitle("Account – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: KNOWN_USER.name })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "API tokens" })).toBeVisible();
  await expect(page.getByText("You have no API tokens yet.")).toBeVisible();
  await expect(page.getByRole("list", { name: "API tokens" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("creating a token with the defaults shows it once and lists it with read, 90 days and never used", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/account");

  await page.getByRole("link", { name: "New token" }).click();
  await expect(page).toHaveURL("/account?action=create");
  const dialog = newTokenDialog(page);
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await expect(dialog.getByLabel(/^read/)).toBeChecked();
  await expect(dialog.getByLabel(/^write/)).not.toBeChecked();
  await expect(dialog.getByLabel("90 days")).toBeChecked();
  await dialog.getByLabel("Name").fill("Claude Desktop");
  const before = Date.now();
  await dialog.getByRole("button", { name: "Create" }).click();

  const created = tokenCreatedDialog(page);
  await expect(created.getByText("Claude Desktop", { exact: true })).toBeVisible();
  const field = created.getByLabel("Token");
  await expect(field).toHaveValue(TOKEN);
  await expect(field).not.toBeEditable();
  await expect(created.getByText(/shown only this once/)).toBeVisible();
  const secret = await field.inputValue();
  // No redirect: the token is neither part of the address nor of a page that the browser stores.
  await expect(page).toHaveURL("/account?action=create");
  await expect(tokenRowsBehindDialog(page)).toHaveCount(1);

  // The database holds only the hash of the token.
  const stored = await getTestDb().apiToken.findMany();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    userId: KNOWN_USER.id,
    name: "Claude Desktop",
    scopes: ["read"],
    lastUsedAt: null,
  });
  expect(stored[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(stored)).not.toContain(secret);
  const expiresIn = (stored[0]?.expiresAt.getTime() ?? 0) - before;
  expect(expiresIn).toBeGreaterThanOrEqual(90 * DAY_MS - 1000);
  expect(expiresIn).toBeLessThan(90 * DAY_MS + 60 * 1000);

  await created.getByRole("link", { name: "Back to the account" }).click();
  await expect(page).toHaveURL("/account");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const rows = tokenRows(page);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("Claude Desktop");
  await expect(rows.nth(0)).toContainText("read");
  await expect(rows.nth(0)).not.toContainText("write");
  await expect(rows.nth(0)).toContainText("Last used never");
  await expect(rows.nth(0)).not.toContainText("Expired");
  await expect(rows.nth(0).getByRole("time").nth(1)).toHaveAttribute(
    "datetime",
    stored[0]?.expiresAt.toISOString() ?? "",
  );
  expect(await page.content()).not.toContain(secret);
  await page.goBack();
  await expect(newTokenDialog(page)).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  expect(errors).toEqual([]);
});

test("a token with both scopes and 365 days", async ({ page }) => {
  const dialog = await openNewToken(page, "deploy script");
  await dialog.getByLabel(/^write/).check();
  await dialog.getByLabel("365 days").check();
  const before = Date.now();

  await dialog.getByRole("button", { name: "Create" }).click();

  await expect(tokenCreatedDialog(page).getByLabel("Token")).toHaveValue(TOKEN);
  const stored = await getTestDb().apiToken.findFirstOrThrow();
  expect(stored.scopes).toEqual(["read", "write"]);
  expect(stored.expiresAt.getTime() - before).toBeGreaterThanOrEqual(365 * DAY_MS - 1000);
  await expect(tokenRowsBehindDialog(page).nth(0)).toContainText("write");
});

test("the copy button puts the token on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const dialog = await openNewToken(page, "laptop");
  await dialog.getByRole("button", { name: "Create" }).click();
  const created = tokenCreatedDialog(page);
  const secret = await created.getByLabel("Token").inputValue();

  await created.getByRole("button", { name: "Copy token" }).click();

  await expect(created.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);
});

test("the Escape key does not close the dialog that shows the token, and a reload loses it", async ({ page }) => {
  const dialog = await openNewToken(page, "laptop");
  await dialog.getByRole("button", { name: "Create" }).click();
  const created = tokenCreatedDialog(page);
  await expect(created.getByLabel("Token")).toHaveValue(TOKEN);
  const secret = await created.getByLabel("Token").inputValue();

  await page.keyboard.press("Escape");
  await expect(created.getByLabel("Token")).toHaveValue(secret);

  await page.reload();
  await expect(newTokenDialog(page).getByLabel("Name")).toHaveValue("");
  await expect(tokenCreatedDialog(page)).toHaveCount(0);
  expect(await page.content()).not.toContain(secret);
});

test("Cancel leads back to the account without creating a token", async ({ page }) => {
  const dialog = await openNewToken(page, "laptop");

  await dialog.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL("/account");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await getTestDb().apiToken.count()).toBe(0);
});

test.describe("field errors", () => {
  test("an empty name shows its error and keeps the entered values", async ({ page }) => {
    const errors = collectErrors(page);
    const dialog = await openNewToken(page, "   ");
    await dialog.getByLabel(/^write/).check();
    await dialog.getByLabel("30 days").check();

    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(dialog.getByText("Name is required", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Name")).toBeFocused();
    await expect(dialog.getByLabel("Name")).toHaveValue("   ");
    await expect(dialog.getByLabel(/^read/)).toBeChecked();
    await expect(dialog.getByLabel(/^write/)).toBeChecked();
    await expect(dialog.getByLabel("30 days")).toBeChecked();
    await expect(page).toHaveURL("/account?action=create");
    expect(await getTestDb().apiToken.count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test("a name of more than 50 characters shows its error", async ({ page }) => {
    const dialog = await openNewToken(page, "x".repeat(50));
    // The field takes at most 50 characters; a crafted request sends more.
    await dialog.locator("form").evaluate((form: HTMLFormElement) => {
      form.addEventListener("formdata", (event) => {
        event.formData.set("name", "x".repeat(51));
      });
    });

    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(dialog.getByText("Name must be at most 50 characters", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Name")).toHaveValue("x".repeat(50));
    expect(await getTestDb().apiToken.count()).toBe(0);
  });

  test("no scope shows its error and keeps the entered values", async ({ page }) => {
    const dialog = await openNewToken(page, "laptop");
    await dialog.getByLabel(/^read/).uncheck();

    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(dialog.getByText("Choose at least one scope", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel(/^read/)).toBeFocused();
    await expect(dialog.getByLabel(/^read/)).not.toBeChecked();
    await expect(dialog.getByLabel(/^write/)).not.toBeChecked();
    await expect(dialog.getByLabel("Name")).toHaveValue("laptop");
    await expect(dialog.getByLabel("90 days")).toBeChecked();
    expect(await getTestDb().apiToken.count()).toBe(0);
  });

  test("a corrected input creates the token after an error", async ({ page }) => {
    const dialog = await openNewToken(page, "");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog.getByText("Name is required")).toBeVisible();

    await dialog.getByLabel("Name").fill("laptop");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(tokenCreatedDialog(page).getByLabel("Token")).toHaveValue(TOKEN);
  });
});

test("the 21st token is refused with a message", async ({ page }) => {
  for (let index = 0; index < 20; index += 1) await createApiToken({ owner: KNOWN_USER });
  const dialog = await openNewToken(page, "one too many");

  await dialog.getByRole("button", { name: "Create" }).click();

  await expect(dialog.getByText(/You already have 20 tokens, the most allowed/)).toBeVisible();
  await expect(dialog.getByLabel("Name")).toHaveValue("one too many");
  expect(await getTestDb().apiToken.count()).toBe(20);
});

test("tokens are listed newest first; an expired token is listed as expired, a used one with its last use", async ({
  page,
}) => {
  const lastUsedAt = new Date("2026-02-03T10:00:00.000Z");
  await createApiToken({
    owner: KNOWN_USER,
    name: "old script",
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    expiresAt: new Date("2026-02-01T10:00:00.000Z"),
  });
  await createApiToken({ owner: KNOWN_USER, name: "laptop", scopes: ["read", "write"], lastUsedAt });

  await page.goto("/account");

  const rows = tokenRows(page);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("laptop");
  await expect(rows.nth(0)).not.toContainText("Expired");
  await expect(rows.nth(0)).toContainText("Last used");
  await expect(rows.nth(0).getByRole("time").nth(2)).toHaveAttribute("datetime", lastUsedAt.toISOString());
  await expect(rows.nth(1)).toContainText("old script");
  await expect(rows.nth(1)).toContainText("Expired");
  await expect(rows.nth(1)).toContainText("Last used never");
});

test("revoking asks first; after confirming, the token is gone from the list and the database", async ({ page }) => {
  const errors = collectErrors(page);
  const { token } = await createApiToken({ owner: KNOWN_USER, name: "laptop" });
  const { token: other } = await createApiToken({ owner: KNOWN_USER, name: "desktop" });
  await page.goto("/account");

  await page.getByRole("link", { name: "Revoke laptop" }).click();

  await expect(page).toHaveURL(`/account?action=revoke&token=${token.id}`);
  const dialog = page.getByRole("dialog", { name: "Revoke token" });
  await expect(dialog).toContainText("laptop");
  await expect(dialog).toContainText("stop working at once");
  expect(await getTestDb().apiToken.count()).toBe(2);

  await dialog.getByRole("button", { name: "Revoke" }).click();

  await expect(page).toHaveURL("/account");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tokenRows(page)).toHaveCount(1);
  await expect(tokenRows(page).nth(0)).toContainText("desktop");
  expect(await getTestDb().apiToken.findMany({ select: { id: true } })).toEqual([{ id: other.id }]);
  expect(errors).toEqual([]);
});

test("Cancel in the revoke dialog keeps the token", async ({ page }) => {
  const { token } = await createApiToken({ owner: KNOWN_USER, name: "laptop" });
  await page.goto(`/account?action=revoke&token=${token.id}`);

  await page.getByRole("dialog", { name: "Revoke token" }).getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL("/account");
  expect(await getTestDb().apiToken.count()).toBe(1);
});

test("a token that was revoked in the meantime shows the not-found page", async ({ page }) => {
  const { token } = await createApiToken({ owner: KNOWN_USER, name: "laptop" });
  await page.goto(`/account?action=revoke&token=${token.id}`);
  await getTestDb().apiToken.delete({ where: { id: token.id } });

  await page.getByRole("dialog", { name: "Revoke token" }).getByRole("button", { name: "Revoke" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});

test.describe("addresses that are not found", () => {
  test("the token of another user in the revoke address", async ({ page }) => {
    const { token } = await createApiToken({ owner: KNOWN_ADMIN, name: "admin token" });

    await expectNotFound(page, `/account?action=revoke&token=${token.id}`);
    await expect(page.getByText("admin token")).toHaveCount(0);
    expect(await getTestDb().apiToken.count()).toBe(1);
  });

  for (const address of [
    "/account?action=revoke&token=not-a-uuid",
    // A well-formed id that no token has.
    "/account?action=revoke&token=6f0c1a2b-3d4e-4f50-8a1b-2c3d4e5f6a7b",
    "/account?action=revoke",
    "/account?action=anything",
    "/account?view=all",
    "/account?action=create&action=create",
    "/account?token=0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01",
  ]) {
    test(address, async ({ page }) => {
      await expectNotFound(page, address);
    });
  }

  test("a token parameter with another action", async ({ page }) => {
    const { token } = await createApiToken({ owner: KNOWN_USER });

    await expectNotFound(page, `/account?action=create&token=${token.id}`);
    await expectNotFound(page, `/account?token=${token.id}`);
  });
});

test("a user sees only their own tokens", async ({ page }) => {
  await createApiToken({ owner: KNOWN_USER, name: "alice's token" });
  await createApiToken({ owner: KNOWN_ADMIN, name: "admin's token" });

  await page.goto("/account");

  await expect(tokenRows(page)).toHaveCount(1);
  await expect(tokenRows(page).nth(0)).toContainText("alice's token");
  await expect(page.getByText("admin's token")).toHaveCount(0);
});

test.describe("the admin", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("sees only their own tokens too", async ({ page }) => {
    const { token } = await createApiToken({ owner: KNOWN_USER, name: "alice's token" });
    await createApiToken({ owner: KNOWN_ADMIN, name: "admin's token" });

    await page.goto("/account");

    await expect(page.getByRole("heading", { level: 1, name: KNOWN_ADMIN.name })).toBeVisible();
    await expect(tokenRows(page)).toHaveCount(1);
    await expect(tokenRows(page).nth(0)).toContainText("admin's token");
    await expect(page.getByText("alice's token")).toHaveCount(0);
    await expectNotFound(page, `/account?action=revoke&token=${token.id}`);
  });
});
