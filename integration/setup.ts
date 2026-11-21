// Runs before every integration test file, of the integration tests and of the integration cost tests. The application
// code reads and writes the test database through the client of e2e/support/database.ts, so `getDb()` never sees
// DATABASE_URL and never touches the development database. The integration tests also empty the tables before every
// test (`empty-before-each.ts`); the cost tests fill theirs once.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config } from "dotenv";
import { afterAll, vi } from "vitest";

import { disconnectTestDb } from "../e2e/support/database";

// Only read so that `testDatabaseUrl()` can refuse a DATABASE_URL that points to the test database.
config({ quiet: true });

// The files directory of the test file: a temporary directory of its own, which the store of the files service and
// `createFile()` use (`testFilesDir()` of e2e/support/database.ts reads its name), removed after the file. The store
// checks its directory once per process, so the state of an earlier test file is forgotten.
const filesDir = mkdtempSync(join(tmpdir(), "hippowiki-integration-files-"));
mkdirSync(join(filesDir, "tmp"));
process.env.HIPPOWIKI_TEST_FILES_DIR = filesDir;
delete (globalThis as { hippowikiFileStore?: unknown }).hippowikiFileStore;

vi.mock("@/lib/db", async () => {
  const { getTestDb } = await import("../e2e/support/database");
  return { getDb: getTestDb };
});

// `getAuth()` reads NODE_ENV through `getServerEnv()`, which also validates DATABASE_URL. CI has no `.env`, and the
// tests must not depend on the one of the development machine, so the server environment is given here. The database
// is still reached through the mocked `getDb()` above, never through this URL.
vi.mock(import("@/lib/env"), async (importOriginal) => {
  const { TEST_DATABASE_URL } = await import("../e2e/support/container");
  const original = await importOriginal();
  const { FILE_SIZE_LIMIT, MCP_BODY_LIMIT, MCP_RATE_BURST, MCP_RATE_PER_MINUTE } = original;
  return {
    ...original,
    getServerEnv: () => ({
      DATABASE_URL: TEST_DATABASE_URL,
      NODE_ENV: "test",
      HIPPOWIKI_LOG_CLIENT_ADDRESS: false,
      HIPPOWIKI_TRUSTED_PROXIES: 0,
      HIPPOWIKI_MCP_BODY_LIMIT: MCP_BODY_LIMIT.default,
      HIPPOWIKI_MCP_RATE_BURST: MCP_RATE_BURST.default,
      HIPPOWIKI_MCP_RATE_PER_MINUTE: MCP_RATE_PER_MINUTE.default,
      HIPPOWIKI_FILE_SIZE_LIMIT: FILE_SIZE_LIMIT.default,
      // The public address of the wiki, which the OAuth service needs for the address of the MCP endpoint.
      HIPPOWIKI_PUBLIC_URL: "https://wiki.example.com",
      HIPPOWIKI_FILES_DIR: process.env.HIPPOWIKI_TEST_FILES_DIR,
    }),
  };
});

afterAll(async () => {
  await disconnectTestDb();
  rmSync(filesDir, { recursive: true, force: true });
});
