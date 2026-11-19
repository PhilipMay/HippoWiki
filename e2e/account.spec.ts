import type { Page } from "@playwright/test";

import { KNOWN_ADMIN, KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, NO_STORAGE_STATE, submitLogin } from "./support/auth";
import { collectErrors, expectNotFound } from "./support/browser";
import {
  createFolder,
  createFolderRole,
  createGrant,
  createUser,
  getTestDb,
  resetTestDatabase,
} from "./support/database";
import { connect, listFolderStatus, mcpAddress, refresh, registerClient } from "./support/oauth";
import { expect, hydrating, test } from "./support/test";

/** The folder "projects", of which the known user is Owner, and its MCP address for Reader. */
let projects: { id: string };
let reader: string;

test.beforeEach(async () => {
  await resetTestDatabase();
  projects = await createFolder({ name: "projects" });
  reader = mcpAddress(projects);
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** The rows of the list of connected apps, in display order. */
function appRows(page: Page) {
  return page.getByRole("list", { name: "Connected apps" }).getByRole("listitem");
}

function revokeDialog(page: Page) {
  return page.getByRole("dialog", { name: "Revoke app" });
}

test("a user without apps sees the user name and that no app is connected; the name in the header leads there", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/folders");

  await page.getByRole("banner").getByRole("link", { name: KNOWN_USER.name }).click();

  await expect(page).toHaveURL("/account");
  await expect(page).toHaveTitle("Account – HippoWiki");
  await expect(page.getByRole("heading", { level: 1, name: KNOWN_USER.name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Change password" })).toHaveAttribute(
    "href",
    "/account?action=change-password",
  );
  await expect(page.getByRole("heading", { level: 2, name: "Connected apps" })).toBeVisible();
  await expect(page.getByText("No app is connected yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Connected apps" })).toHaveCount(0);
  // Nothing else: no address, no instructions, nothing about tokens or scopes, and no way to create a token.
  await expect(page.getByText(/\/mcp|connect an app|token|scope/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "New token" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("creating a token is not found", async ({ page }) => {
  await expectNotFound(page, "/account?action=create");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await getTestDb().oAuthGrant.count()).toBe(0);
});

test("apps are listed newest first with their name, connection time, expiry or Expired, and last use or never", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const lastUsedAt = new Date("2026-02-03T10:00:00.000Z");
  const old = await createGrant({
    owner: KNOWN_USER,
    name: "Old connector",
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    expiresAt: new Date("2026-02-01T10:00:00.000Z"),
  });
  const recent = await createGrant({ owner: KNOWN_USER, name: "Example connector", lastUsedAt });

  await page.goto("/account");

  const rows = appRows(page);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Example connector");
  await expect(rows.nth(0)).toContainText("Connected ");
  await expect(rows.nth(0).getByRole("time").nth(0)).toHaveAttribute("datetime", recent.grant.createdAt.toISOString());
  await expect(rows.nth(0)).toContainText("Expires ");
  await expect(rows.nth(0)).not.toContainText("Expired");
  await expect(rows.nth(0).getByRole("time").nth(2)).toHaveAttribute("datetime", lastUsedAt.toISOString());
  await expect(rows.nth(0).getByRole("link", { name: "Revoke Example connector" })).toBeVisible();
  await expect(rows.nth(1)).toContainText("Old connector");
  await expect(rows.nth(1).getByText("Expired", { exact: true })).toBeVisible();
  await expect(rows.nth(1).getByRole("time").nth(1)).toHaveAttribute("datetime", old.grant.expiresAt.toISOString());
  await expect(rows.nth(1)).toContainText("Last used never");
  // No scopes and no secrets of the grants.
  await expect(page.getByText(/token|scope|\bread\b/i)).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain(recent.accessToken);
  expect(html).not.toContain("hwa_");
  expect(errors).toEqual([]);
});

test("an app connected through OAuth is listed, and a use through /mcp shows as its last use", async ({
  page,
  request,
}) => {
  const errors = collectErrors(page);
  const tokens = await connect(page, request, await registerClient(request, "Example connector"), reader);

  await page.goto("/account");

  const rows = appRows(page);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("Example connector");
  await expect(rows.nth(0)).toContainText("Last used never");
  const html = await page.content();
  expect(html).not.toContain(tokens.access_token);
  expect(html).not.toContain(tokens.refresh_token);
  expect(html).not.toContain("hwr_");

  expect(await listFolderStatus(request, tokens.access_token, reader)).toBe(200);
  await page.reload();
  await expect(appRows(page).nth(0)).not.toContainText("Last used never");
  expect(errors).toEqual([]);
});

test("two connections of the same app to different addresses are two entries, each with its folder and role", async ({
  page,
  request,
}) => {
  const errors = collectErrors(page);
  const notes = await createFolder({ name: "notes" });
  const clientId = await registerClient(request, "Example connector");
  await connect(page, request, clientId, mcpAddress(projects, "writer"));
  await connect(page, request, clientId, mcpAddress(notes, "reader"));

  await page.goto("/account");

  const rows = appRows(page);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Example connector");
  await expect(rows.nth(0)).toContainText("Folder notes · Role Reader");
  await expect(rows.nth(1)).toContainText("Example connector");
  await expect(rows.nth(1)).toContainText("Folder projects · Role Writer");
  await expect(page.getByRole("link", { name: "Revoke Example connector on projects as Writer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Revoke Example connector on notes as Reader" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a connection to the Manager address is listed with its folder and the role Manager", async ({
  page,
  request,
}) => {
  const errors = collectErrors(page);
  const clientId = await registerClient(request, "Example connector");
  await connect(page, request, clientId, mcpAddress(projects, "manager"));

  await page.goto("/account");

  const rows = appRows(page);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("Folder projects · Role Manager");
  await expect(page.getByRole("link", { name: "Revoke Example connector on projects as Manager" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("after the folder is renamed the list shows its new name", async ({ page }) => {
  await createGrant({ owner: KNOWN_USER, folder: projects, name: "Example connector" });
  await getTestDb().folder.update({ where: { id: projects.id }, data: { name: "renamed" } });

  await page.goto("/account");

  await expect(appRows(page).nth(0)).toContainText("Folder renamed · Role Reader");
});

test("revoking asks first, then removes the app and ends its access token and its refresh token at once", async ({
  page,
  request,
}) => {
  const errors = collectErrors(page);
  const clientId = await registerClient(request, "Example connector");
  const tokens = await connect(page, request, clientId, reader);
  const { grant: other } = await createGrant({ owner: KNOWN_USER, createdAt: new Date(Date.now() - DAY_MS) });
  const grant = await getTestDb().oAuthGrant.findFirstOrThrow({ where: { clientId: { not: other.clientId } } });
  expect(await listFolderStatus(request, tokens.access_token, reader)).toBe(200);
  await page.goto("/account");

  await page.getByRole("link", { name: "Revoke Example connector" }).click();

  await expect(page).toHaveURL(`/account?action=revoke&app=${grant.id}`);
  const dialog = revokeDialog(page);
  await expect(dialog).toContainText("Revoke the access of the connected app Example connector?");
  await expect(dialog).toContainText("has to be connected again");
  await expect(dialog.getByText(/token/i)).toHaveCount(0);
  // Nothing happens before the user confirms.
  expect(await listFolderStatus(request, tokens.access_token, reader)).toBe(200);

  await dialog.getByRole("button", { name: "Revoke" }).click();

  await expect(page).toHaveURL("/account");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(appRows(page)).toHaveCount(1);
  await expect(page.getByText("Example connector")).toHaveCount(0);
  expect(await getTestDb().oAuthGrant.findMany({ select: { id: true } })).toEqual([{ id: other.id }]);
  expect(await listFolderStatus(request, tokens.access_token, reader)).toBe(401);
  const refreshed = await refresh(request, clientId, tokens.refresh_token);
  expect(refreshed.status()).toBe(400);
  expect(await refreshed.json()).toMatchObject({ error: "invalid_grant" });
  // The app can be connected again.
  const again = await connect(page, request, clientId, reader);
  expect(await listFolderStatus(request, again.access_token, reader)).toBe(200);
  expect(errors).toEqual([]);
});

test("Cancel in the revoke dialog keeps the app", async ({ page }) => {
  const { grant } = await createGrant({ owner: KNOWN_USER, name: "Example connector" });
  await page.goto(`/account?action=revoke&app=${grant.id}`);

  await revokeDialog(page).getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL("/account");
  await expect(appRows(page)).toHaveCount(1);
  expect(await getTestDb().oAuthGrant.count()).toBe(1);
});

test("the Escape key closes the revoke dialog and keeps the app", async ({ page }) => {
  const { grant } = await createGrant({ owner: KNOWN_USER, name: "Example connector" });
  await page.goto(`/account?action=revoke&app=${grant.id}`);
  await expect(revokeDialog(page)).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page).toHaveURL("/account");
  await expect(revokeDialog(page)).toHaveCount(0);
  await expect(appRows(page)).toHaveCount(1);
  expect(await getTestDb().oAuthGrant.count()).toBe(1);
});

test("an app that was revoked in the meantime shows the not-found page", async ({ page }) => {
  const { grant } = await createGrant({ owner: KNOWN_USER, name: "Example connector" });
  await page.goto(`/account?action=revoke&app=${grant.id}`);
  await getTestDb().oAuthGrant.delete({ where: { id: grant.id } });

  await revokeDialog(page).getByRole("button", { name: "Revoke" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});

test.describe("addresses that are not found", () => {
  test("the former address with token= of an own app", async ({ page }) => {
    const { grant } = await createGrant({ owner: KNOWN_USER });

    await expectNotFound(page, `/account?action=revoke&token=${grant.id}`);

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectNotFound(page, `/account?token=${grant.id}`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await getTestDb().oAuthGrant.count()).toBe(1);
  });

  test("the app of another user in the revoke address", async ({ page }) => {
    const bob = await createUser({ name: "bob", mustChangePassword: false });
    const { grant } = await createGrant({ owner: bob, name: "Bob's connector" });

    await expectNotFound(page, `/account?action=revoke&app=${grant.id}`);

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Bob's connector")).toHaveCount(0);
    expect(await getTestDb().oAuthGrant.count()).toBe(1);
  });

  test("an app without the action revoke", async ({ page }) => {
    const { grant } = await createGrant({ owner: KNOWN_USER });

    await expectNotFound(page, `/account?app=${grant.id}`);

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectNotFound(page, `/account?action=create&app=${grant.id}`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  for (const address of [
    "/account?action=revoke&app=not-a-uuid",
    // A well-formed id that no app has.
    "/account?action=revoke&app=6f0c1a2b-3d4e-4f50-8a1b-2c3d4e5f6a7b",
    "/account?action=revoke",
    "/account?action=anything",
    "/account?view=all",
    "/account?action=revoke&action=revoke",
  ]) {
    test(address, async ({ page }) => {
      await expectNotFound(page, address);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  }
});

test("a user sees only their own apps, also when another user connects one", async ({ page, request, browser }) => {
  // Another user connects an app in a browser of their own.
  const bob = await createUser({ name: "bob", mustChangePassword: false });
  await createFolderRole({ folder: projects, user: bob, role: "reader" });
  const bobContext = await browser.newContext({ storageState: NO_STORAGE_STATE });
  const bobPage = hydrating(await bobContext.newPage());
  await bobPage.goto("/login");
  await submitLogin(bobPage, "bob");
  await expect(bobPage).toHaveURL("/folders");
  const tokens = await connect(bobPage, bobContext.request, await registerClient(request, "Bob's connector"), reader);
  await bobContext.close();
  const bobsGrant = await getTestDb().oAuthGrant.findFirstOrThrow({ where: { userId: bob.id } });
  await createGrant({ owner: KNOWN_USER, name: "Alice's connector" });

  await page.goto("/account");

  await expect(appRows(page)).toHaveCount(1);
  await expect(appRows(page).nth(0)).toContainText("Alice's connector");
  await expect(page.getByText("Bob's connector")).toHaveCount(0);
  await expectNotFound(page, `/account?action=revoke&app=${bobsGrant.id}`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await listFolderStatus(request, tokens.access_token, reader)).toBe(200);
});

test.describe("an admin", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("sees the user name and the button to change the password, but no list of apps", async ({ page }) => {
    const errors = collectErrors(page);

    await page.goto("/users");
    await page.getByRole("banner").getByRole("link", { name: KNOWN_ADMIN.name }).click();

    await expect(page).toHaveURL("/account");
    await expect(page.getByRole("heading", { level: 1, name: KNOWN_ADMIN.name })).toBeVisible();
    await expect(page.getByRole("link", { name: "Change password" })).toHaveAttribute(
      "href",
      "/account?action=change-password",
    );
    await expect(page.getByRole("heading", { level: 2, name: "Connected apps" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Connected apps" })).toHaveCount(0);
    await expect(page.getByText(/token|connected/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("gets the not-found page for create, for revoke and for an app", async ({ page }) => {
    // Admins have no grants; one inserted directly stands for a grant that should not exist.
    const { grant: own } = await createGrant({ owner: KNOWN_ADMIN, name: "Admin connector" });
    const { grant: users } = await createGrant({ owner: KNOWN_USER, name: "Alice's connector" });

    for (const address of [
      "/account?action=create",
      "/account?action=revoke",
      `/account?action=revoke&app=${own.id}`,
      `/account?action=revoke&app=${users.id}`,
      `/account?app=${own.id}`,
      `/account?action=revoke&token=${own.id}`,
      "/account?view=all",
    ]) {
      await expectNotFound(page, address);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await expect(page.getByText("Alice's connector")).toHaveCount(0);
    expect(await getTestDb().oAuthGrant.count()).toBe(2);
  });
});
