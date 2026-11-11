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
  {
    // Imports come in groups separated by a blank line: Node.js modules, packages, `@/` modules, relative paths.
    files: ["**/*.{js,mjs,ts,tsx,mts}"],
    rules: {
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", ["parent", "sibling", "index"]],
          pathGroups: [{ pattern: "@/**", group: "internal" }],
          pathGroupsExcludedImportTypes: ["builtin"],
          "newlines-between": "always",
        },
      ],
    },
  },
  {
    // The application reads its environment only through getServerEnv() and imports Material UI components and icons
    // per path.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read the server environment through getServerEnv() from @/lib/env.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@mui/material",
              message: "Import Material UI components per path, e.g. @mui/material/Button.",
            },
            {
              name: "@mui/icons-material",
              message: "Import Material UI icons per path, e.g. @mui/icons-material/Folder.",
            },
          ],
        },
      ],
    },
  },
  {
    // The modules that validate the environment and create the logger read process.env themselves.
    files: ["src/lib/env.ts", "src/lib/logger.ts"],
    rules: {
      "no-restricted-properties": "off",
    },
  },
  {
    // Server code logs through the pino logger from @/lib/logger.
    files: ["src/features/**/actions.ts", "src/features/**/queries.ts", "src/app/api/**", "src/lib/**"],
    rules: {
      "no-console": "error",
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
