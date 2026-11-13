import type { Page } from "@playwright/test";

import { NO_STORAGE_STATE } from "./support/auth";
import { collectErrors } from "./support/browser";
import { createFolder, createPage, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

/** The security headers of `next.config.ts`, with the values every response must carry. */
const SECURITY_HEADERS = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "content-security-policy":
    "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; img-src 'self' data:",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

/** Fails unless the headers, with lower-case names, have the security headers and no `X-Powered-By`. */
function expectSecurityHeaders(headers: Record<string, string>) {
  expect(Object.fromEntries(Object.keys(SECURITY_HEADERS).map((name) => [name, headers[name]]))).toEqual(
    SECURITY_HEADERS,
  );
  expect(headers).not.toHaveProperty("x-powered-by");
}

/**
 * Records the violations of the Content Security Policy that the browser reports in the page, as the directive that
 * was violated and the blocked address. Must be called before the page is opened.
 */
async function collectViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { cspViolations: violations });
    document.addEventListener("securitypolicyviolation", (event) =>
      violations.push(`${event.effectiveDirective} ${event.blockedURI}`),
    );
  });
  return () => page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations);
}

test.beforeEach(async () => {
  await resetTestDatabase();
});

test.describe("without a login", () => {
  test.use({ storageState: NO_STORAGE_STATE });

  test("the login page carries the security headers", async ({ request }) => {
    const response = await request.get("/login");

    expect(response.status()).toBe(200);
    expectSecurityHeaders(response.headers());
  });

  test("the redirect to the login page carries the security headers", async ({ request }) => {
    const response = await request.get("/folders", { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expectSecurityHeaders(response.headers());
  });

  test("the health check carries the security headers", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);
    expectSecurityHeaders(response.headers());
  });

  test("a static file of the login page carries the security headers", async ({ request }) => {
    const html = await (await request.get("/login")).text();
    const asset = /\/_next\/static\/[^"\\]*/.exec(html)?.[0];
    expect(asset).toBeDefined();

    const response = await request.get(asset ?? "");

    expect(response.status()).toBe(200);
    expectSecurityHeaders(response.headers());
  });
});

test.describe("with the saved login of the normal user", () => {
  test("a page of a folder carries the security headers", async ({ page }) => {
    const folder = await createFolder({ name: "handbook" });
    await createPage({ folder, name: "overview", content: "# Overview" });

    const response = await page.goto("/folders/handbook/overview.md");

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    expectSecurityHeaders(await response!.allHeaders());
  });

  test("an image of another host in a page is not loaded", async ({ page }) => {
    const errors = collectErrors(page);
    const violations = await collectViolations(page);
    let trackerRequests = 0;
    await page.route("https://tracker.example/**", (route) => {
      trackerRequests += 1;
      return route.abort();
    });
    const folder = await createFolder({ name: "handbook" });
    await createPage({ folder, name: "tracked", content: "# Tracked\n\n![](https://tracker.example/x.png)" });

    await page.goto("/folders/handbook/tracked.md");

    await expect(page.getByRole("main").locator('img[src="https://tracker.example/x.png"]')).toHaveCount(1);
    // The browser may try to load the image more than once (while parsing and after hydration); every try is blocked
    // and reported as the same violation.
    await expect.poll(async () => (await violations()).length).toBeGreaterThan(0);
    expect(new Set(await violations())).toEqual(new Set(["img-src https://tracker.example/x.png"]));
    await expect.poll(() => errors.length).toBeGreaterThan(0);
    for (const error of errors) {
      expect(error).toContain("https://tracker.example/x.png");
      expect(error).toContain("img-src");
    }
    expect(trackerRequests).toBe(0);
  });

  test("a data: image is not shown in the page", async ({ page }) => {
    const errors = collectErrors(page);
    const violations = await collectViolations(page);
    const folder = await createFolder({ name: "handbook" });
    await createPage({
      folder,
      name: "inline",
      content:
        "# Inline\n\n![dot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==)",
    });

    await page.goto("/folders/handbook/inline.md");

    // react-markdown keeps only addresses with a safe protocol and empties the address of a `data:` image;
    // `MarkdownContent` leaves out an image without an address instead of rendering one the browser cannot show.
    await expect(page.getByRole("heading", { level: 1, name: "Inline" })).toBeVisible();
    await expect(page.getByRole("main").locator("img")).toHaveCount(0);
    expect(await violations()).toEqual([]);
    expect(errors).toEqual([]);
  });
});
