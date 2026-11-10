import { removeTestDbContainer, startTestDbContainer } from "./support/container";
import { disconnectTestDb, migrateTestDatabase, resetTestDatabase } from "./support/database";

/**
 * Prepares the test database before the test run: start a fresh throwaway container, apply the migrations, empty all
 * tables. The global teardown removes the container again.
 */
export default async function globalSetup(): Promise<void> {
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
