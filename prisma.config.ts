import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// The Prisma CLI does not read `.env` by itself. Commands it starts (such as the seed script) inherit these variables.
config({ quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
