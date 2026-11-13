// Runs before every integration test file. The application code reads and writes the test database through the
// client of e2e/support/database.ts, so `getDb()` never sees DATABASE_URL and never touches the development database.
import { config } from "dotenv";
import { afterAll, beforeEach, vi } from "vitest";

import { disconnectTestDb, emptyTestDatabase } from "../e2e/support/database";

// Only read so that `testDatabaseUrl()` can refuse a DATABASE_URL that points to the test database.
config({ quiet: true });

vi.mock("@/lib/db", async () => {
  const { getTestDb } = await import("../e2e/support/database");
  return { getDb: getTestDb };
});

// `getAuth()` reads NODE_ENV through `getServerEnv()`, which also validates DATABASE_URL. CI has no `.env`, and the
// tests must not depend on the one of the development machine, so the server environment is given here. The database
// is still reached through the mocked `getDb()` above, never through this URL.
vi.mock(import("@/lib/env"), async (importOriginal) => {
  const { TEST_DATABASE_URL } = await import("../e2e/support/container");
  return {
    ...(await importOriginal()),
    getServerEnv: () => ({ DATABASE_URL: TEST_DATABASE_URL, NODE_ENV: "test", HIPPOWIKI_LOG_CLIENT_ADDRESS: false }),
  };
});

// The integration tests start from empty tables; the known users of the end-to-end tests are not created here.
beforeEach(async () => {
  await emptyTestDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});
