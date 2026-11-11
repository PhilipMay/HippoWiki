import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import playwright from "eslint-plugin-playwright";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Rules that need type information, e.g. to report a promise that is not awaited.
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    // Playwright rules for the end-to-end tests and their helpers.
    files: ["e2e/**/*.ts"],
    plugins: { playwright },
    rules: {
      "playwright/missing-playwright-await": "error",
      "playwright/no-wait-for-timeout": "error",
      "playwright/prefer-web-first-assertions": "error",
    },
  },
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
    // Unit test coverage report:
    "coverage/**",
    // Generated Prisma client:
    "src/generated/**",
  ]),
]);

export default eslintConfig;
