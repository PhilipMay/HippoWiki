import { collectErrors } from "./support/browser";
import { createPage, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

test("home page shows the app bar without browser errors", async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto("/");

  const banner = page.getByRole("banner");
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("link", { name: "HippoWiki" })).toHaveAttribute("href", "/");
  expect(errors).toEqual([]);
});

test("health check reports ok", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("helper creates pages in the test database", async () => {
  await resetTestDatabase();

  const created = await createPage({ title: "Smoke" });

  expect(created.title).toBe("Smoke");
  expect(await getTestDb().page.count()).toBe(1);
  await resetTestDatabase();
  expect(await getTestDb().page.count()).toBe(0);
});
