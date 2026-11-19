import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

import { USER_STORAGE_STATE } from "./e2e/support/auth";
import { testDatabaseUrl } from "./e2e/support/database";
import {
  PRODUCTION_DIST_DIR,
  workerCount,
  workerDatabaseName,
  workerDistDir,
  workerPort,
  workerUrl,
} from "./e2e/support/workers";

// Playwright does not read `.env` by itself. Its DATABASE_URL is only read to make sure the tests never use the
// development database; the tests use their own throwaway container (see e2e/support/container.ts).
config({ quiet: true });

// By default the tests run against the development server, which starts fast. With HIPPOWIKI_E2E_SERVER=production
// (`npm run test:e2e:production`) they run against a production build instead, to cover what only exists there:
// prerendering, the route cache, minified bundles, the error pages and rendering without StrictMode's double render.
const production = process.env.HIPPOWIKI_E2E_SERVER === "production";

// The number of workers, from HIPPOWIKI_E2E_WORKERS (see e2e/support/workers.ts). Read when the configuration loads, so
// that an invalid value stops the run before any server or database starts. Each worker has its own database and its
// own server; the production run still has one worker.
const configuredWorkers = workerCount();
const workers = production ? 1 : configuredWorkers;
const workerNumbers = Array.from({ length: workers }, (_, index) => index + 1);

export default defineConfig({
  testDir: "e2e",
  // The spec files are spread over the workers; the tests of one file run one after another in one worker.
  fullyParallel: false,
  workers,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // A test that passes only on a retry fails the CI run, so timing problems show up early. The retries still run: the
  // report then shows the test as flaky and keeps the trace of the first retry.
  failOnFlakyTests: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never" }]],
  // The global setup starts the test database container, the global teardown removes it.
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // The `baseURL` of each test is the address of the server of its worker (see e2e/support/test.ts).
  use: {
    trace: "on-first-retry",
  },
  projects: [
    // Logs in once as each known user and saves the browser states (see e2e/support/auth.ts).
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    {
      name: "chromium",
      // Only the specs: the unit tests of the helpers in e2e/support/ are run by Vitest.
      testMatch: /\.spec\.ts$/,
      // Every test starts logged in as the known normal user. A spec that needs the admin or no user sets its own
      // storage state with `test.use()`.
      use: { ...devices["Desktop Chrome"], storageState: USER_STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
  // One server per worker, on its port, with its own build directory and database. Playwright starts them one after
  // another, each once the one before is ready.
  webServer: workerNumbers.map((worker) => {
    const port = workerPort(worker);
    return {
      // The build and the server both get `env`. The build needs no running database, because no route is
      // prerendered.
      command: production ? `npx next build && npx next start --port ${port}` : `npx next dev --port ${port}`,
      // The server starts before the global setup starts the test database, so readiness must not depend on it. It is
      // checked on the port: a `url` check would follow the redirect from `/` to `/folders`, which needs the database.
      port,
      env: {
        DATABASE_URL: testDatabaseUrl(workerDatabaseName(worker)),
        // A build directory of its own lets the server run next to `npm run dev` and next to the other workers.
        HIPPOWIKI_DIST_DIR: production ? PRODUCTION_DIST_DIR : workerDistDir(worker),
        // One reverse proxy is trusted, so a test chooses its client address with an `X-Forwarded-For` header
        // (`extraHTTPHeaders` of a browser context). A request without the header gets the address of the connection,
        // which Next.js writes into it.
        HIPPOWIKI_TRUSTED_PROXIES: "1",
        // The public address of the server, which switches OAuth on and makes the MCP server give out full addresses.
        HIPPOWIKI_PUBLIC_URL: workerUrl(worker),
      },
      // Never attach to a server that was started by someone else and may use another database: a taken port fails
      // the run.
      reuseExistingServer: false,
      // The production server starts only after the build.
      timeout: production ? 300_000 : 120_000,
    };
  }),
});
