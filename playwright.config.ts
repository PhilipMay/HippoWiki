import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

import { USER_STORAGE_STATE } from "./e2e/support/auth";
import { testDatabaseUrl } from "./e2e/support/database";

// Playwright does not read `.env` by itself. Its DATABASE_URL is only read to make sure the tests never use the
// development database; the tests use their own throwaway container (see e2e/support/container.ts).
config({ quiet: true });

const port = 3100;
const baseURL = `http://localhost:${port}`;

// By default the tests run against the development server, which starts fast. With HIPPOWIKI_E2E_SERVER=production
// (`npm run test:e2e:production`) they run against a production build instead, to cover what only exists there:
// prerendering, the route cache, minified bundles, the error pages and rendering without StrictMode's double render.
const production = process.env.HIPPOWIKI_E2E_SERVER === "production";

export default defineConfig({
  testDir: "e2e",
  // All tests share one database, so they run one after another.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // A test that passes only on a retry fails the CI run, so timing problems show up early. The retries still run: the
  // report then shows the test as flaky and keeps the trace of the first retry.
  failOnFlakyTests: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never" }]],
  // The global setup starts the test database container, the global teardown removes it.
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    // Logs in once as each known user and saves the browser states (see e2e/support/auth.ts).
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    {
      name: "chromium",
      // Every test starts logged in as the known normal user. A spec that needs the admin or no user sets its own
      // storage state with `test.use()`.
      use: { ...devices["Desktop Chrome"], storageState: USER_STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // The build and the server both get `env`. The build needs no running database, because no route is prerendered.
    command: production ? `npx next build && npx next start --port ${port}` : `npx next dev --port ${port}`,
    // The server starts before the global setup starts the test database, so readiness must not depend on it. It is
    // checked on the port: a `url` check would follow the redirect from `/` to `/folders`, which needs the database.
    port,
    env: {
      DATABASE_URL: testDatabaseUrl(),
      // A separate build directory lets the test server run next to `npm run dev`.
      HIPPOWIKI_DIST_DIR: ".next-e2e",
      // One reverse proxy is trusted, so a test chooses its client address with an `X-Forwarded-For` header
      // (`extraHTTPHeaders` of a browser context). A request without the header gets the address of the connection,
      // which Next.js writes into it.
      HIPPOWIKI_TRUSTED_PROXIES: "1",
    },
    // Never attach to a server that was started by someone else and may use another database.
    reuseExistingServer: false,
    // The production server starts only after the build.
    timeout: production ? 300_000 : 120_000,
  },
});
