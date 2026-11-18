import type { Page } from "@playwright/test";

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

/**
 * Text that ends with "by <user> via <channel>", as the lists and views show the last editor and the channel. `then`
 * is what follows on the same line, such as the own role in the folder list.
 */
export function by(user: string, via: "web" | "mcp" = "web", then = ""): RegExp {
  return new RegExp(`by ${user} via ${via}${then}$`);
}
