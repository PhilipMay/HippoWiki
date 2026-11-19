import { rmSync } from "node:fs";

import { AUTH_DIRECTORY } from "./support/auth";
import { copyTestDatabase, removeTestDbContainer, startTestDbContainer } from "./support/container";
import { disconnectTestDb, migrateTestDatabase, resetTestDatabase, storeAuthSecret } from "./support/database";
import { workerCount, workerDatabaseName } from "./support/workers";

/**
 * Prepares the test databases before the test run: start a fresh throwaway container, apply the migrations to
 * `hippowiki_test`, store the secret of the session cookies, empty all tables and create the known users. Then each
 * worker gets its own database as a copy of it, so every worker database starts from the same state and has the same
 * secret. The saved logins of an earlier run are removed first: their sessions belong to a database that is gone. The
 * setup project (auth.setup.ts) then logs in anew. The global teardown removes the container again.
 */
export default async function globalSetup(): Promise<void> {
  rmSync(AUTH_DIRECTORY, { recursive: true, force: true });
  await startTestDbContainer();
  try {
    migrateTestDatabase();
    await storeAuthSecret();
    await resetTestDatabase();
    // PostgreSQL copies a database only while nobody is connected to it.
    await disconnectTestDb();
    copyTestDatabase(Array.from({ length: workerCount() }, (_, index) => workerDatabaseName(index + 1)));
  } catch (err) {
    // The global teardown does not run when the setup fails, so the container is removed here.
    await disconnectTestDb();
    removeTestDbContainer();
    throw err;
  } finally {
    await disconnectTestDb();
  }
}
