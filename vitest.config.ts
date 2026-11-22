import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolves the `@/` alias from tsconfig.json.
    tsconfigPaths: true,
  },
  test: {
    projects: [
      {
        // Unit tests next to the code; they mock the database and run in `npm run check`. The pure helpers of the
        // end-to-end tests in `e2e/support/` have unit tests as well.
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "e2e/support/**/*.test.ts"],
          exclude: ["src/**/*.cost.test.ts"],
        },
      },
      {
        // Wall-clock budgets (`npm run test:cost`). Never run with coverage, which instruments every module, the
        // dependencies included, and never next to other test files, so the time measures the code alone.
        test: {
          name: "cost",
          environment: "node",
          include: ["src/**/*.cost.test.ts"],
          // The cost test files would otherwise run side by side and share the CPU, so they run one after another.
          fileParallelism: false,
        },
      },
      {
        // Integration tests against the throwaway test database container (`npm run test:integration`).
        test: {
          name: "integration",
          environment: "node",
          include: ["integration/**/*.test.ts"],
          exclude: ["integration/**/*.cost.test.ts"],
          globalSetup: ["integration/global-setup.ts"],
          setupFiles: ["integration/setup.ts", "integration/empty-before-each.ts"],
          // All test files share one database, so they run one after another.
          fileParallelism: false,
          // Starting the container and applying the migrations takes a while on a cold machine.
          hookTimeout: 120_000,
        },
      },
      {
        // Wall-clock budgets against the test database (`npm run test:integration:cost`), such as a search in a full
        // folder. Never next to other tests, so the time measures the database and the code alone; the tables are
        // filled once per file, not emptied before every test.
        test: {
          name: "integration-cost",
          environment: "node",
          include: ["integration/**/*.cost.test.ts"],
          globalSetup: ["integration/global-setup.ts"],
          setupFiles: ["integration/setup.ts"],
          fileParallelism: false,
          // Filling a folder of thousands of pages takes minutes on a slow machine.
          hookTimeout: 600_000,
          // The budgets are asserted by the tests themselves; this only ends a test that hangs.
          testTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      // Also lists files that no unit test loads, with 0% coverage.
      include: ["src/**/*.{ts,tsx}"],
      // The helpers of the unit tests in `src/test/` are no code of the app.
      exclude: ["src/**/*.test.ts", "src/generated/**", "src/test/**"],
      // `json-summary` writes coverage/coverage-summary.json for scripts/coverage-summary.ts.
      reporter: ["text", "html", "json-summary"],
      // Also write the report when a test fails, so CI can still show and upload it.
      reportOnFailure: true,
    },
  },
});
