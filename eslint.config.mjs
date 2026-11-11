import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Turns off rules that conflict with Prettier; must come after the other configs.
  prettier,
  {
    // The shared test of the end-to-end tests waits for hydration after every page load.
    files: ["e2e/**/*.spec.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              importNames: ["test", "expect"],
              message: "Import test and expect from ./support/test, which waits for hydration after page loads.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build directory of the end-to-end test server and Playwright output:
    ".next-e2e/**",
    "playwright-report/**",
    "test-results/**",
    // Generated Prisma client:
    "src/generated/**",
  ]),
]);

export default eslintConfig;
