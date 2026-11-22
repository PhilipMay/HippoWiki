import type { APIRequestContext, Page } from "@playwright/test";

import { expect } from "./test";

/** Collects console errors and uncaught exceptions of the browser page. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/**
 * Opens the address and expects the not-found page: the status 404, named with the address so that a failing loop
 * over addresses says which one failed, and the heading of the page. A spec that also expects something to be absent,
 * such as a dialog, asserts it after the call.
 */
export async function expectNotFound(page: Page, address: string): Promise<void> {
  const response = await page.goto(address);

  expect(response?.status(), address).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
}

/** The digest of the error that `notFound()` throws, in the payload of the not-found page. */
const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";

/**
 * Whether the HTML is the not-found page in one of the two forms that Next.js sends: for an address that a route
 * answers with `notFound()`, the error shell, which holds no heading, with the digest of `notFound()` in its payload,
 * from which the browser renders the page; for an address that matches no route, the page rendered on the server, with
 * its heading outside the scripts. The heading alone tells nothing: the payload of every page holds the heading of the
 * not-found page.
 */
function isNotFoundPage(html: string): boolean {
  if (html.startsWith('<!DOCTYPE html><html id="__next_error__">')) return html.includes(NOT_FOUND_DIGEST);
  return /<h1\b[^>]*>Page not found<\/h1>/.test(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ""));
}

/**
 * Sends a `GET` of the address with the cookies of the page (`page.request`), without following a redirect, and
 * expects the not-found page: the status 404 and the HTML of the not-found page (see `isNotFoundPage()`), each named
 * with the address so that a failing loop over addresses says which one failed. A plain 404, such as that of a
 * missing file, fails. It renders nothing in the browser; `expectNotFound()` stays for the cases that check what the
 * page shows.
 */
export async function expectNotFoundResponse(request: APIRequestContext, address: string): Promise<void> {
  const response = await request.get(address, { maxRedirects: 0 });

  expect(response.status(), address).toBe(404);
  expect(isNotFoundPage(await response.text()), `${address} is the not-found page`).toBe(true);
}

/**
 * Text that ends with "by <user> via <channel>", as the lists and views show the last editor and the channel. `then`
 * is what follows on the same line, such as the own role in the folder list.
 */
export function by(user: string, via: "web" | "mcp" = "web", then = ""): RegExp {
  return new RegExp(`by ${user} via ${via}${then}$`);
}

/**
 * Holds the next request of a Server Action of the page, a `POST` with the header `Next-Action`, until the test
 * releases it, so that a test sees the state of a form while its submission runs. `held` resolves once the request
 * has been sent; `release()` lets it through. Every other request passes.
 */
export async function holdServerAction(page: Page): Promise<{ held: Promise<void>; release: () => void }> {
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  let markHeld = () => {};
  const held = new Promise<void>((resolve) => (markHeld = resolve));
  let holding = true;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!holding || request.method() !== "POST" || request.headers()["next-action"] === undefined) {
      await route.fallback();
      return;
    }
    holding = false;
    markHeld();
    await released;
    await route.continue();
  });
  return { held, release };
}
