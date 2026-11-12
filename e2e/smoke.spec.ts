import { KNOWN_ADMIN, KNOWN_USER } from "../prisma/known-users";
import { collectErrors } from "./support/browser";
import { createPage, createUser, getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

test.beforeEach(async () => {
  await resetTestDatabase();
});

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
  const created = await createPage({ title: "Smoke" });

  expect(created.title).toBe("Smoke");
  expect(await getTestDb().page.count()).toBe(1);
  await resetTestDatabase();
  expect(await getTestDb().page.count()).toBe(0);
});

test("a reset keeps the known users and the sessions of their saved logins", async () => {
  await createUser({ name: "temporary" });
  await getTestDb().session.deleteMany();

  await resetTestDatabase();

  const users = await getTestDb().user.findMany({ orderBy: { username: "asc" } });
  expect(users.map(({ id, username, mustChangePassword }) => ({ id, username, mustChangePassword }))).toEqual([
    { id: KNOWN_ADMIN.id, username: "admin", mustChangePassword: false },
    { id: KNOWN_USER.id, username: "alice", mustChangePassword: false },
  ]);
  const sessions = await getTestDb().session.findMany({ orderBy: { createdAt: "asc" } });
  expect(sessions.map(({ userId }) => userId)).toEqual([KNOWN_ADMIN.id, KNOWN_USER.id]);
});
