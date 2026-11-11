import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolves the `@/` alias from tsconfig.json.
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
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
