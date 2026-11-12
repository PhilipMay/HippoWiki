import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import playwright from "eslint-plugin-playwright";

/** Only a service reads and writes the database; everything else goes through the service of the feature. */
const restrictedDb = {
  name: "@/lib/db",
  message: "Only a service reads and writes the database: use src/features/<feature>/service.ts.",
};

/** Only the auth service uses Better Auth; everything else goes through that service. */
const restrictedAuth = {
  name: "@/lib/auth",
  message: "Only the auth service uses Better Auth: use src/features/auth/service.ts, or session.ts for the session.",
};

/** Routes and components use a service only for its types. */
const restrictedService = {
  group: ["@/features/*/service"],
  allowTypeImports: true,
  message: "Import a service only as a type here: read through queries.ts and write through actions.ts.",
};

/** What no service imports: Next.js, React and the revalidation of routes. */
const restrictedInServices = [
  { name: "next", message: "A service does not depend on Next.js; that belongs in queries.ts or actions.ts." },
  { name: "react", message: "A service does not depend on React; cache() belongs in queries.ts." },
  {
    name: "@/lib/revalidate",
    message: "A service does not revalidate routes; actions.ts calls revalidateContent().",
  },
];

const restrictedPatternsInServices = [
  { group: ["next/*"], message: "A service does not depend on Next.js; that belongs in queries.ts or actions.ts." },
  {
    group: ["@/features/*/forms"],
    message: "A service takes plain typed arguments; forms.ts is for forms and their actions.",
  },
];

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
    files: [
      "src/features/**/actions.ts",
      "src/features/**/queries.ts",
      "src/features/**/service.ts",
      "src/app/api/**",
      "src/lib/**",
    ],
    rules: {
      "no-console": "error",
    },
  },
  // The layers: a route or component calls queries.ts or actions.ts, these call service.ts, and only service.ts
  // reads and writes the database. Better Auth (@/lib/auth) is used by the auth service and src/lib/ only. A later
  // config object replaces the options of a rule instead of adding to them, so the five objects below match disjoint
  // sets of files and each one lists all restrictions of its files.
  {
    // Everything in src/ that is neither a route nor a component, a service or a module of src/lib/.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/app/**", "src/features/**/components/**", "src/features/**/service.ts", "src/lib/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { paths: [restrictedDb, restrictedAuth] }],
    },
  },
  {
    // Routes and components read through queries.ts and write through actions.ts.
    files: ["src/app/**/*.{ts,tsx}", "src/features/**/components/**/*.{ts,tsx}"],
    ignores: ["src/app/api/health/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { paths: [restrictedDb, restrictedAuth], patterns: [restrictedService] },
      ],
    },
  },
  {
    // The health route checks the database connection itself.
    files: ["src/app/api/health/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { paths: [restrictedAuth], patterns: [restrictedService] }],
    },
  },
  // A service knows nothing about Next.js, React or forms, so that it also works outside a request and for callers
  // other than the GUI. A rule of its own, so that the Material UI paths in `no-restricted-imports` stay as they are.
  {
    // Every service except the auth service, which is the one that uses Better Auth.
    files: ["src/features/**/service.ts"],
    ignores: ["src/features/auth/service.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { paths: [...restrictedInServices, restrictedAuth], patterns: restrictedPatternsInServices },
      ],
    },
  },
  {
    files: ["src/features/auth/service.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { paths: restrictedInServices, patterns: restrictedPatternsInServices },
      ],
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
