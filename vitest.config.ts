import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolves the `@/` alias from tsconfig.json.
    tsconfigPaths: true,
  },
  test: {
    projects: [
      {
        // Unit tests next to the code; they mock the database and run in `npm run check`.
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        // Integration tests against the throwaway test database container (`npm run test:integration`).
        test: {
          name: "integration",
          environment: "node",
          include: ["integration/**/*.test.ts"],
          globalSetup: ["integration/global-setup.ts"],
          setupFiles: ["integration/setup.ts"],
          // All test files share one database, so they run one after another.
          fileParallelism: false,
          // Starting the container and applying the migrations takes a while on a cold machine.
          hookTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      // Also lists files that no unit test loads, with 0% coverage.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.ts", "src/generated/**"],
      // `json-summary` writes coverage/coverage-summary.json for scripts/coverage-summary.ts.
      reporter: ["text", "html", "json-summary"],
      // Also write the report when a test fails, so CI can still show and upload it.
      reportOnFailure: true,
    },
  },
});
