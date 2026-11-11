// Runs before every integration test file. The application code reads and writes the test database through the
// client of e2e/support/database.ts, so `getDb()` never sees DATABASE_URL and never touches the development database.
import { config } from "dotenv";
import { afterAll, beforeEach, vi } from "vitest";

import { disconnectTestDb, resetTestDatabase } from "../e2e/support/database";

// Only read so that `testDatabaseUrl()` can refuse a DATABASE_URL that points to the test database.
config({ quiet: true });

vi.mock("@/lib/db", async () => {
  const { getTestDb } = await import("../e2e/support/database");
  return { getDb: getTestDb };
});
// Outside a request, `connection()` throws; the queries only await it to opt out of prerendering.
vi.mock("next/server", () => ({ connection: async () => {} }));

beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});
