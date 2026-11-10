import { removeTestDbContainer } from "./support/container";
import { disconnectTestDb } from "./support/database";

/** Removes the test database container after the test run, so that nothing is left running. */
export default async function globalTeardown(): Promise<void> {
  await disconnectTestDb();
  removeTestDbContainer();
}
