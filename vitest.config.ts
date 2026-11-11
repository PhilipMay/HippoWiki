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
      reporter: ["text", "html"],
    },
  },
});
