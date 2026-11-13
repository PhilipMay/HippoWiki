import type { Page } from "@playwright/test";

import { KNOWN_ADMIN, KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, NO_STORAGE_STATE, USER_STORAGE_STATE } from "./support/auth";
import { collectErrors } from "./support/browser";
import { createFolder, createPage, createTab, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

const DELETED_PAGE_ID = "9c4d2b7e-1a3f-4c5d-8e6f-7a8b9c0d1e22";

// Content that a visitor without a login must never get to see, under every kind of address.
test.beforeEach(async () => {
  await resetTestDatabase();
  const handbook = await createFolder({ name: "handbook" });
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ folder: handbook, name: "overview", content: "# Secret overview\n\nSecret text" });
  await createPage({ tab: guides, name: "setup", content: "# Secret setup\n\nSecret text" });
  await createPage({
    id: DELETED_PAGE_ID,
    folder: handbook,
    name: "removed",
    content: "# Secret removed page\n\nSecret text",
    deletedAt: new Date(),
  });
});

/** Every kind of address that needs a login. */
const PROTECTED_ADDRESSES = [
  ["the home page", "/"],
  ["the folder list", "/folders"],
  ["a folder", "/folders/handbook"],
  ["all pages of a folder", "/folders/handbook?view=all"],
  ["a tab", "/folders/handbook/guides"],
  ["a page", "/folders/handbook/overview.md"],
  ["a page in a tab", "/folders/handbook/guides/setup.md"],
  ["the deleted pages of a folder", "/deleted-pages/handbook"],
  ["a deleted page", `/deleted-pages/handbook/${DELETED_PAGE_ID}`],
  ["the folder list with an action", "/folders?action=new"],
  ["a folder with an action", "/folders/handbook?action=rename"],
  ["a page with an action", "/folders/handbook/overview.md?action=edit"],
  ["the own account", "/account"],
  ["the own account with an action", "/account?action=create"],
  ["a deleted page with an action", `/deleted-pages/handbook/${DELETED_PAGE_ID}?action=restore`],
  ["an invalid action", "/folders?action=nothing"],
  ["an invalid folder name", "/folders/Not%20A%20Name"],
  ["a folder that does not exist", "/folders/nowhere"],
  ["an address that does not exist", "/nowhere"],
  ["an address that starts like the login page", "/login/more"],
  ["an address that starts like the health check", "/api/health/more"],
  ["an API address that does not exist", "/api/nowhere"],
  ["an address that starts like the MCP endpoint", "/mcp/more"],
  ["the consent page of OAuth", "/oauth/authorize?client_id=abc&state=x"],
  ["an OAuth address that does not exist", "/oauth/nowhere"],
  ["an address that starts like the token endpoint", "/oauth/token/more"],
  ["a well-known address that does not exist", "/.well-known/openid-configuration"],
  ["an address that starts like the metadata of the authorization server", "/.well-known/oauth-authorization-server/x"],
  ["the image optimizer", "/_next/image?url=%2Ffolders&w=64&q=75"],
] as const;

/**
 * The address of the login page that a read of the given address leads to without a session cookie: with the address
 * as the way back, except for the folder list, where a login leads anyway.
 */
function loginAddressFor(address: string): string {
  return address === "/folders" ? "/login" : `/login?next=${encodeURIComponent(address)}`;
}

/**
 * Expects the login page: without a way back, as `requireUser()` and a Server Action lead to it, or with the one of
 * the given address, as the proxy leads to it for a read without a session cookie.
 */
async function expectLoginPage(page: Page, address?: string) {
  await expect(page).toHaveURL(address === undefined ? "/login" : loginAddressFor(address));
  await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
  await expect(page.getByText(/Secret/)).toHaveCount(0);
}

/** Opens the login page and logs in as the known normal user. */
async function logIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("User name").fill(KNOWN_USER.name);
  await page.getByLabel("Password").fill(KNOWN_USER.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/folders");
}

test.describe("without a login", () => {
  test.use({ storageState: NO_STORAGE_STATE });

  for (const [what, address] of PROTECTED_ADDRESSES) {
    test(`${what} (${address}) leads to the login page`, async ({ page, request }) => {
      // The answer itself is a redirect: nothing of the page is sent, not even as HTML that a script hides.
      const response = await request.get(address, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      const location = new URL(response.headers().location ?? "", "http://localhost");
      expect(location.pathname).toBe("/login");
      // The way back is the address that was asked for.
      expect(location.searchParams.get("next")).toBe(address === "/folders" ? null : address);
      expect(await response.text()).not.toContain("Secret");

      await page.goto(address);

      await expectLoginPage(page, address);
    });
  }

  test("the login page and its static files need no login", async ({ page, request }) => {
    const errors = collectErrors(page);

    const response = await page.goto("/login");

    expect(response?.status()).toBe(200);
    const stylesheet = await page.locator('link[rel="stylesheet"]').first().getAttribute("href");
    expect(stylesheet).toMatch(/^\/_next\/static\//);
    expect((await request.get(stylesheet ?? "")).status()).toBe(200);
    expect(errors).toEqual([]);
  });

  test("the header has no menu", async ({ page }) => {
    await page.goto("/login");

    const banner = page.getByRole("banner");
    await expect(banner.getByRole("link", { name: "HippoWiki" })).toBeVisible();
    await expect(banner.getByRole("navigation")).toHaveCount(0);
    await expect(banner.getByRole("link", { name: "Folders" })).toHaveCount(0);
  });

  test("the health check answers 200", async ({ request }) => {
    const response = await request.get("/api/health", { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("the MCP endpoint is not sent to the login page: it asks for a token itself", async ({ request }) => {
    // What it does with a token is tested in mcp.spec.ts.
    const response = await request.post("/mcp", {
      data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_folders" } },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(/^Bearer\b/);
    expect(await response.text()).not.toContain("handbook");
  });

  // What they answer is tested in oauth.spec.ts.
  for (const [what, method, address, status] of [
    ["the metadata of the authorization server", "get", "/.well-known/oauth-authorization-server", 200],
    ["the metadata of the protected resource", "get", "/.well-known/oauth-protected-resource", 200],
    ["the metadata of the protected resource /mcp", "get", "/.well-known/oauth-protected-resource/mcp", 200],
    ["the registration of an OAuth client", "post", "/oauth/register", 400],
    ["the token endpoint", "post", "/oauth/token", 400],
  ] as const) {
    test(`${what} (${address}) is not sent to the login page`, async ({ request }) => {
      const response = await request[method](address, { maxRedirects: 0 });

      expect(response.status()).toBe(status);
      expect(response.headers().location).toBeUndefined();
      expect(await response.text()).not.toContain("Secret");
    });
  }

  for (const cookieName of ["better-auth.session_token", "__Secure-better-auth.session_token"]) {
    test(`with a ${cookieName} cookie that the server does not know, the folder list leads to the login page`, async ({
      page,
      context,
    }) => {
      // Past the proxy, which only looks whether the cookie is there, and stopped by the check in the database.
      await context.addCookies([
        { name: cookieName, value: "unknown-token.unknown-signature", domain: "localhost", path: "/", secure: true },
      ]);

      await page.goto("/folders");
      await expectLoginPage(page);

      await page.goto("/folders/handbook/overview.md");
      await expectLoginPage(page);
    });
  }

  test("an address that does not exist stays not found with a session cookie, also an unknown one", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "better-auth.session_token", value: "unknown-token.unknown-signature", url: "http://localhost:3100" },
    ]);

    const response = await page.goto("/nowhere");

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });

  test("after the session has ended in the database, the content leads to the login page", async ({ page }) => {
    await logIn(page);
    await page.goto("/folders/handbook/overview.md");
    await expect(page.getByRole("heading", { level: 1, name: "Secret overview" })).toBeVisible();

    await getTestDb().session.deleteMany({ where: { userId: KNOWN_USER.id } });
    await page.goto("/folders/handbook/overview.md");

    await expectLoginPage(page);
  });

  test("after a logout, the content leads to the login page", async ({ page }) => {
    await logIn(page);

    await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL("/login");
    await page.goto("/folders/handbook");

    await expectLoginPage(page, "/folders/handbook");
  });

  test("a Server Action that is submitted after the session has ended changes nothing and leads to the login page", async ({
    page,
  }) => {
    await logIn(page);
    await page.goto("/folders?action=new");
    const dialog = page.getByRole("dialog", { name: "New folder" });
    await dialog.getByLabel("Name").fill("too-late");

    await getTestDb().session.deleteMany({ where: { userId: KNOWN_USER.id } });
    await dialog.getByRole("button", { name: "Save" }).click();

    await expectLoginPage(page);
    expect(await getTestDb().folder.count({ where: { name: "too-late" } })).toBe(0);
  });

  test("a Server Action that is submitted without the session cookie changes nothing and leads to the login page", async ({
    page,
    context,
  }) => {
    await logIn(page);
    await page.goto("/folders/handbook/overview.md?action=delete");
    const dialog = page.getByRole("dialog", { name: "Delete page" });
    await expect(dialog).toBeVisible();

    await context.clearCookies();
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expectLoginPage(page);
    expect(await getTestDb().page.count({ where: { name: "overview", deletedAt: null } })).toBe(1);
  });
});

test.describe("with the saved login of the normal user", () => {
  test.use({ storageState: USER_STORAGE_STATE });

  test("the content opens", async ({ page }) => {
    const errors = collectErrors(page);

    await page.goto("/folders");
    await expect(page.getByRole("heading", { level: 1, name: "Folders" })).toBeVisible();
    await expect(page.getByRole("banner").getByText(KNOWN_USER.name, { exact: true })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Folders" })).toBeVisible();

    await page.goto("/folders/handbook/overview.md");
    await expect(page.getByRole("heading", { level: 1, name: "Secret overview" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("an address that does not exist is not found", async ({ page }) => {
    const response = await page.goto("/nowhere");

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });
});

test.describe("with the saved login of the admin", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("the content opens", async ({ page }) => {
    await page.goto("/folders");

    await expect(page.getByRole("heading", { level: 1, name: "Folders" })).toBeVisible();
    await expect(page.getByRole("banner").getByText(KNOWN_ADMIN.name, { exact: true })).toBeVisible();
  });
});
