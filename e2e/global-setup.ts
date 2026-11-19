import { rmSync } from "node:fs";

import type { FullConfig } from "@playwright/test";

import { AUTH_DIRECTORY } from "./support/auth";
import { copyTestDatabase, removeTestDbContainer, startTestDbContainer } from "./support/container";
import { disconnectTestDb, migrateTestDatabase, resetTestDatabase, storeAuthSecret } from "./support/database";
import { checkRunWorkers, workerCount, workerDatabaseName } from "./support/workers";

/**
 * Prepares the test databases before the test run: start a fresh throwaway container, apply the migrations to
 * `hippowiki_test`, store the secret of the session cookies, empty all tables and create the known users. Then each
 * worker gets its own database as a copy of it, so every worker database starts from the same state and has the same
 * secret. A run with more workers than `HIPPOWIKI_E2E_WORKERS` sets stops before the container starts. The saved
 * logins of an earlier run are removed first: their sessions belong to a database that is gone. The setup project
 * (auth.setup.ts) then logs in anew. The global teardown removes the container again.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  // `config.workers` is the number of the run, with `--workers` applied. More workers than servers stop the run before
  // any test; Playwright stops the servers that have started.
  checkRunWorkers(config.workers, workerCount());
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
