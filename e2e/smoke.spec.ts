import { expect, test } from "@playwright/test";

import { createPage, getTestDb, resetTestDatabase } from "./support/database";

test("home page shows the app bar without browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

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
