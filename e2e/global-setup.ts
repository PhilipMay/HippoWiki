import { rmSync } from "node:fs";

import { AUTH_DIRECTORY } from "./support/auth";
import { removeTestDbContainer, startTestDbContainer } from "./support/container";
import { disconnectTestDb, migrateTestDatabase, resetTestDatabase } from "./support/database";

/**
 * Prepares the test database before the test run: start a fresh throwaway container, apply the migrations, empty all
 * tables and create the known users. The saved logins of an earlier run are removed first: their sessions belong to
 * a database that is gone. The setup project (auth.setup.ts) then logs in anew. The global teardown removes the
 * container again.
 */
export default async function globalSetup(): Promise<void> {
  rmSync(AUTH_DIRECTORY, { recursive: true, force: true });
  await startTestDbContainer();
  try {
    migrateTestDatabase();
    await resetTestDatabase();
  } catch (err) {
    // The global teardown does not run when the setup fails, so the container is removed here.
    await disconnectTestDb();
    removeTestDbContainer();
    throw err;
  } finally {
    await disconnectTestDb();
  }
}
