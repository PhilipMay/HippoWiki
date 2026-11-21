// Tests written from the spec alone ("Authenticated access only" in `spec/users-and-login.md`), for the parts of the
// rule that `e2e/access.spec.ts` leaves open: `/_next/image` with other queries than the two of its acceptance.

import { NO_STORAGE_STATE } from "./support/auth";
import { expect, test } from "./support/test";

/** Addresses of the image optimizer with queries that the other tests do not send. */
const IMAGE_ADDRESSES = [
  ["without a query", "/_next/image"],
  ["with only a url", "/_next/image?url=%2Ffolders"],
  ["without a url", "/_next/image?w=64&q=75"],
  ["with the address of another host", "/_next/image?url=https%3A%2F%2Fexample.com%2Fa.png&w=64&q=75"],
  ["with the health check as url", "/_next/image?url=%2Fapi%2Fhealth&w=64&q=75"],
  ["with the largest width and quality", "/_next/image?url=%2Flogin&w=3840&q=100"],
] as const;

test.describe("the image optimizer with a session", () => {
  // users-and-login.md, "Authenticated access only": with a valid session, /_next/image answers as an address that does
  // not exist, whatever its query.
  for (const [what, address] of IMAGE_ADDRESSES) {
    test(`${what} answers 404 and no image`, async ({ page }) => {
      // `page.request` sends the session cookie of the saved login of the known user.
      const response = await page.request.get(address, { maxRedirects: 0 });

      expect(response.status()).toBe(404);
      expect(response.headers()["content-type"] ?? "").not.toMatch(/^image\//);
    });
  }
});

test.describe("the image optimizer without a session", () => {
  test.use({ storageState: NO_STORAGE_STATE });

  // users-and-login.md, "Authenticated access only": without a session cookie the address leads to the login page, as
  // every address behind the login does.
  for (const [what, address] of IMAGE_ADDRESSES) {
    test(`${what} leads to the login page`, async ({ request }) => {
      const response = await request.get(address, { maxRedirects: 0 });

      expect(response.status()).toBe(307);
      const location = new URL(response.headers().location ?? "", "http://localhost");
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe(address);
    });
  }
});
