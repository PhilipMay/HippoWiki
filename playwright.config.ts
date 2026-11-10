import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

import { testDatabaseUrl } from "./e2e/support/database";

// Playwright does not read `.env` by itself; the test database URL is derived from its DATABASE_URL.
config({ quiet: true });

const port = 3100;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  // All tests share one database, so they run one after another.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev --port ${port}`,
    // The server starts before the global setup creates the test database, so readiness must not depend on it.
    url: baseURL,
    env: {
      DATABASE_URL: testDatabaseUrl(),
      // A separate build directory lets the test server run next to `npm run dev`.
      HIPPOWIKI_DIST_DIR: ".next-e2e",
    },
    // Never attach to a server that was started by someone else and may use another database.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
