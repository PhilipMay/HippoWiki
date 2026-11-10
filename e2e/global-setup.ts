import { disconnectTestDb, ensureTestDatabase, migrateTestDatabase, resetTestDatabase } from "./support/database";

/** Prepares the test database before the test run: create it if missing, apply the migrations, empty all tables. */
export default async function globalSetup(): Promise<void> {
  await ensureTestDatabase();
  migrateTestDatabase();
  try {
    await resetTestDatabase();
  } finally {
    await disconnectTestDb();
  }
}
