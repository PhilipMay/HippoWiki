import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// The Prisma CLI does not read `.env` by itself. Commands it starts (such as the seed script) inherit these variables.
config({ quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Not `env()`, which throws when the variable is missing: `prisma generate` (run by `npm install`) needs no
    // database. Commands that connect, such as `migrate` and `studio`, report a missing URL themselves.
    url: process.env.DATABASE_URL,
  },
});
