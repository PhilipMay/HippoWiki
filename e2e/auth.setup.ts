// The setup project of the end-to-end tests: it logs in once as each known user, through the login page, and saves
// the browser state and the rows of the sessions (see ./support/auth.ts). The `chromium` project depends on it.
import { mkdirSync, writeFileSync } from "node:fs";

import { KNOWN_ADMIN, KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, AUTH_DIRECTORY, SESSIONS_FILE, USER_STORAGE_STATE } from "./support/auth";
import { getTestDb } from "./support/database";
import { expect, test as setup } from "./support/test";

const LOGINS = [
  { user: KNOWN_ADMIN, storageState: ADMIN_STORAGE_STATE },
  { user: KNOWN_USER, storageState: USER_STORAGE_STATE },
];

for (const { user, storageState } of LOGINS) {
  setup(`log in as ${user.name}`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("User name").fill(user.name);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL("/folders");

    await page.context().storageState({ path: storageState });
  });
}

// After the logins: the global setup has emptied the tables before, so these are exactly the two sessions.
setup("save the sessions of the logins", async () => {
  const sessions = await getTestDb().session.findMany({ orderBy: { createdAt: "asc" } });
  expect(sessions.map(({ userId }) => userId)).toEqual(LOGINS.map(({ user }) => user.id));

  mkdirSync(AUTH_DIRECTORY, { recursive: true });
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
});
