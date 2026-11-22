import type { Page } from "@playwright/test";

import { KNOWN_ADMIN, KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, NO_STORAGE_STATE, USER_STORAGE_STATE } from "./support/auth";
import { collectErrors, expectNotFoundResponse } from "./support/browser";
import { createFile, createFolder, createPage, createTab, getTestDb, resetTestDatabase } from "./support/database";
import { expectFileNotFound, pngBytes } from "./support/files";
import { ISSUER } from "./support/oauth";
import { expect, test } from "./support/test";

const DELETED_PAGE_ID = "9c4d2b7e-1a3f-4c5d-8e6f-7a8b9c0d1e22";

/**
 * Resets the test database and creates the content that a visitor without a login must never get to see, under every
 * kind of address. The tests that only read share it, created once in `beforeAll()` of their `describe`; the tests
 * that end sessions or submit actions get it anew in `beforeEach()`.
 */
async function createContent() {
  await resetTestDatabase();
  const handbook = await createFolder({ name: "handbook" });
  const guides = await createTab({ folder: handbook, name: "guides" });
  await createPage({ folder: handbook, name: "overview", content: "# Secret overview\n\nSecret text" });
  await createPage({ tab: guides, name: "setup", content: "# Secret setup\n\nSecret text", via: "mcp" });
  await createPage({
    id: DELETED_PAGE_ID,
    folder: handbook,
    name: "removed",
    content: "# Secret removed page\n\nSecret text",
    deletedAt: new Date(),
    via: "mcp",
  });
  await createFile({ folder: handbook, name: "diagram.png" });
  await createFile({ tab: guides, name: "manual.pdf" });
}

/** Every kind of address that needs a login. */
const PROTECTED_ADDRESSES = [
  ["the home page", "/"],
  ["the folder list", "/folders"],
  ["a folder", "/folders/handbook"],
  ["all pages of a folder", "/folders/handbook?view=all"],
  ["the roles of a folder", "/folders/handbook?view=roles"],
  ["a tab", "/folders/handbook/guides"],
  ["a page", "/folders/handbook/overview.md"],
  ["a page in a tab", "/folders/handbook/guides/setup.md"],
  ["the deleted items of a folder", "/deleted-items/handbook"],
  ["a deleted page", `/deleted-items/handbook/${DELETED_PAGE_ID}`],
  ["a file itself", "/files/handbook/diagram.png"],
  ["a file in a tab", "/files/handbook/guides/manual.pdf"],
  ["a version of a file", "/files/handbook/diagram.png?version=1"],
  ["the details page of a file", "/folders/handbook/diagram.png"],
  ["the details page of a file in a tab", "/folders/handbook/guides/manual.pdf"],
  ["the upload dialog of a folder", "/folders/handbook?action=upload"],
  ["the upload dialog of a tab with a name", "/folders/handbook/guides?action=upload&name=new.png"],
  ["a file that does not exist", "/files/handbook/missing.png"],
  ["the folder list with an action", "/folders?action=new"],
  ["a folder with an action", "/folders/handbook?action=rename"],
  ["a tab with the dialog to delete it", "/folders/handbook/guides?action=delete"],
  ["the give role dialog of a folder", "/folders/handbook?action=give-role"],
  ["the view AI apps of a folder", "/folders/handbook?view=mcp"],
  ["the results of a search in a folder", "/folders/handbook?view=search&q=backup"],
  ["the overview of the folder roles", "/folder-roles"],
  ["the user list", "/users"],
  ["the user list with the dialog of a new user", "/users?action=create"],
  ["the password change", "/change-password"],
  ["a page with an action", "/folders/handbook/overview.md?action=edit"],
  ["the history of a page", "/folders/handbook/guides/setup.md?view=history"],
  ["a revision of a page", "/folders/handbook/overview.md?view=revision&revision=1&format=raw"],
  ["a comparison of revisions of a page", "/folders/handbook/overview.md?view=compare&from=1&to=1"],
  ["the revert dialog of a page", "/folders/handbook/guides/setup.md?action=revert&revision=1"],
  ["the own account", "/account"],
  ["the own account with an action", "/account?action=revoke"],
  ["a deleted page with an action", `/deleted-items/handbook/${DELETED_PAGE_ID}?action=restore`],
  ["the history of a deleted page", `/deleted-items/handbook/${DELETED_PAGE_ID}?view=history`],
  ["an invalid action", "/folders?action=nothing"],
  ["an invalid folder name", "/folders/Not%20A%20Name"],
  ["a folder that does not exist", "/folders/nowhere"],
  ["an address that does not exist", "/nowhere"],
  ["an address that starts like the login page", "/login/more"],
  ["an address that starts like the health check", "/api/health/more"],
  ["an API address that does not exist", "/api/nowhere"],
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

/** The text of the HTML, without its scripts, styles and tags. */
function textOf(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]*>/g, " ");
}

test.describe("without a login", () => {
  test.use({ storageState: NO_STORAGE_STATE });
  test.beforeAll(createContent);

  test("every kind of address leads to the login page", async ({ request }) => {
    for (const [what, address] of PROTECTED_ADDRESSES) {
      const named = `${what} (${address})`;
      // The answer itself is a redirect: nothing of the page is sent, not even as HTML that a script hides.
      const response = await request.get(address, { maxRedirects: 0 });
      expect(response.status(), named).toBe(307);
      const location = new URL(response.headers().location ?? "", "http://localhost");
      expect(location.pathname, named).toBe("/login");
      // The way back is the address that was asked for.
      expect(location.searchParams.get("next"), named).toBe(address === "/folders" ? null : address);
      expect(await response.text(), named).not.toContain("Secret");
    }
  });

  // The login page with its way back is tested in login.spec.ts.
  test("the redirect shows the login page in the browser", async ({ page }) => {
    await page.goto("/folders/handbook/guides/setup.md");

    await expectLoginPage(page, "/folders/handbook/guides/setup.md");
  });

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

  test("the folder addresses of MCP are not sent to the login page: they ask for a token themselves", async ({
    request,
  }) => {
    // What they do with a token is tested in mcp-access.spec.ts.
    for (const role of ["reader", "writer"]) {
      const response = await request.post(`/mcp/${crypto.randomUUID()}/${role}`, {
        data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_folder" } },
        maxRedirects: 0,
      });

      expect(response.status()).toBe(401);
      expect(response.headers()["www-authenticate"]).toMatch(/^Bearer\b/);
      expect(await response.text()).not.toContain("handbook");
    }
  });

  test("the upload addresses are not sent to the login page: they answer an upload without a session with 404", async ({
    request,
  }) => {
    for (const address of ["/api/uploads/handbook/diagram.png", "/api/uploads/handbook/guides/new.png"]) {
      for (const headers of [{}, { origin: ISSUER }] as Record<string, string>[]) {
        const response = await request.post(address, { data: await pngBytes(), headers, maxRedirects: 0 });

        expect(response.status(), address).toBe(404);
        expect(response.headers().location).toBeUndefined();
      }
    }
    expect(await getTestDb().fileVersion.count()).toBe(2);
  });

  test("/mcp and the other addresses below it are not sent to the login page: they answer 404 themselves", async ({
    request,
  }) => {
    for (const address of ["/mcp", "/mcp/more", `/mcp/${crypto.randomUUID()}/owner`]) {
      for (const response of [
        await request.post(address, { data: {}, maxRedirects: 0 }),
        await request.get(address, { maxRedirects: 0 }),
      ]) {
        expect(response.status(), address).toBe(404);
        expect(response.headers().location).toBeUndefined();
      }
    }
  });

  // What they answer is tested in oauth.spec.ts.
  for (const [what, method, address, status] of [
    ["the metadata of the authorization server", "get", "/.well-known/oauth-authorization-server", 200],
    [
      "the metadata of the protected resource at a folder address",
      "get",
      "/.well-known/oauth-protected-resource/mcp/0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10/reader",
      200,
    ],
    [
      "the metadata of the protected resource /mcp, which does not exist",
      "get",
      "/.well-known/oauth-protected-resource/mcp",
      404,
    ],
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
      { name: "better-auth.session_token", value: "unknown-token.unknown-signature", url: ISSUER },
    ]);

    const response = await page.goto("/nowhere");

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });
});

// The saved login ends in these tests; the next reset of the test database puts its session back.
test.describe("after the saved login of the normal user has ended", () => {
  test.use({ storageState: USER_STORAGE_STATE });
  test.beforeEach(createContent);

  test("after the session has ended in the database, the content leads to the login page", async ({ page }) => {
    await page.goto("/folders/handbook/overview.md");
    await expect(page.getByRole("heading", { level: 1, name: "Secret overview" })).toBeVisible();

    await getTestDb().session.deleteMany({ where: { userId: KNOWN_USER.id } });
    await page.goto("/folders/handbook/overview.md");

    await expectLoginPage(page);
  });

  test("a Server Action that is submitted after the session has ended changes nothing and leads to the login page", async ({
    page,
  }) => {
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
  test.beforeAll(createContent);

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

  test("the home page leads to the folder list", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL("/folders");
  });

  test("the image optimizer is switched off: with a session it answers 404, for a page and for a static file", async ({
    page,
  }) => {
    await page.goto("/folders");
    const stylesheet = await page.locator('link[rel="stylesheet"]').first().getAttribute("href");
    expect(stylesheet).toMatch(/^\/_next\/static\//);
    expect((await page.request.get(stylesheet ?? "")).status()).toBe(200);

    // `page.request` sends the session cookie of the page. Without the option `images.unoptimized` the address of a
    // page gives 500 and that of a static file is fetched and run through the image processing.
    for (const url of ["/folders", stylesheet ?? ""]) {
      const response = await page.request.get(`/_next/image?url=${encodeURIComponent(url)}&w=64&q=75`, {
        maxRedirects: 0,
      });
      expect(response.status(), url).toBe(404);
    }
  });
});

test.describe("with the saved login of the admin", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });
  test.beforeAll(createContent);

  test("the home page leads to the user list", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL("/users");
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
  });

  // An admin sees no content: every address of it is not found, also for items that exist, so that nothing tells
  // whether an item exists.
  const CONTENT_ADDRESSES = [
    ...PROTECTED_ADDRESSES.filter(([, address]) => /^\/(folders|deleted-items)(\/|\?|$)/.test(address)),
    ["the folder list with the dialog of a new folder", "/folders?action=new"],
    ["a folder with the form of a new page", "/folders/handbook?action=new"],
    ["a folder with the dialog of a new tab", "/folders/handbook?action=new-tab"],
    ["a tab with an action", "/folders/handbook/guides?action=rename"],
    ["a tab with the form of a new page", "/folders/handbook/guides?action=new"],
    ["a page with the dialog to move or rename it", "/folders/handbook/overview.md?action=move-or-rename"],
    ["a page with the dialog to delete it", "/folders/handbook/overview.md?action=delete"],
    ["a page in a tab with an action", "/folders/handbook/guides/setup.md?action=edit"],
    ["the deleted items of a folder that does not exist", "/deleted-items/nowhere"],
  ] as const;

  test("the admin overview of the folder roles shows no last editor and no channel", async ({ page }) => {
    await page.goto("/folder-roles");

    await expect(page.getByRole("main")).toContainText("handbook");
    await expect(page.getByRole("main")).not.toContainText(/Updated|Deleted| via (web|mcp)|\bweb\b|\bmcp\b/);
  });

  /** Addresses of a folder, a page and a deleted page, which the admin opens in the browser. */
  const SHOWN_ADDRESSES = new Set<string>([
    "/folders/handbook",
    "/folders/handbook/overview.md",
    `/deleted-items/handbook/${DELETED_PAGE_ID}`,
  ]);

  test("every content address shows the not-found page in the browser", async ({ page }) => {
    for (const address of SHOWN_ADDRESSES) {
      const response = await page.goto(address);

      expect(response?.status(), address).toBe(404);
      await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
      // Neither the content nor the names of folders, tabs and pages, nor a last editor or a channel.
      await expect(page.getByText(/Secret|handbook|guides|overview|setup|removed/)).toHaveCount(0);
      await expect(page.getByText(/Updated|Deleted| via (web|mcp)/)).toHaveCount(0);
      await expect(page.getByRole("banner").getByText(KNOWN_ADMIN.name, { exact: true })).toBeVisible();
    }
  });

  test("every content address answers with the not-found page and sends nothing of the content", async ({ page }) => {
    for (const [what, address] of CONTENT_ADDRESSES.filter(([, path]) => !SHOWN_ADDRESSES.has(path))) {
      const named = `${what} (${address})`;
      await expectNotFoundResponse(page.request, address);
      const html = await (await page.request.get(address)).text();
      // The payload holds the segments of the address, so the names are looked for in the text of the HTML only.
      expect(html, named).not.toContain("Secret");
      expect(textOf(html), named).not.toMatch(/handbook|guides|overview|setup|removed|Updated|Deleted| via (web|mcp)/);
    }
  });

  // The addresses of the files themselves answer an admin with 404, like a file that does not exist.
  for (const [what, address] of PROTECTED_ADDRESSES.filter(([, path]) => path.startsWith("/files/"))) {
    test(`${what} (${address}) answers with 404`, async ({ page }) => {
      await expectFileNotFound(page, address);
    });
  }
});
