// Runs before every integration test file, after `setup.ts`: the integration tests start every test from empty
// tables; the known users of the end-to-end tests are not created here. The integration cost tests leave it out, because
// they fill their tables once for all their budgets.
import { beforeEach } from "vitest";

import { emptyTestDatabase } from "../e2e/support/database";

beforeEach(async () => {
  await emptyTestDatabase();
});
