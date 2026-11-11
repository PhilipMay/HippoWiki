import { config } from "dotenv";

import { removeTestDbContainer, startTestDbContainer } from "../e2e/support/container";
import { disconnectTestDb, migrateTestDatabase } from "../e2e/support/database";

/**
 * Prepares the test database before the integration test run: start a fresh throwaway container (the same as for the
 * end-to-end tests) and apply the migrations. The returned teardown removes the container again.
 */
export default async function globalSetup(): Promise<() => void> {
  // `.env` is only read so that `testDatabaseUrl()` can refuse a DATABASE_URL that points to the test database.
  config({ quiet: true });
  await startTestDbContainer();
  try {
    migrateTestDatabase();
  } catch (err) {
    // The teardown does not run when the setup fails, so the container is removed here.
    removeTestDbContainer();
    throw err;
  } finally {
    await disconnectTestDb();
  }
  return () => removeTestDbContainer();
}
