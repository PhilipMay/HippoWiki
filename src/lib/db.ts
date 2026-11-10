import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getServerEnv } from "@/lib/env";

function createClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: getServerEnv().DATABASE_URL,
    // Fail fast instead of hanging when the database is not reachable.
    connectionTimeoutMillis: 5_000,
  });
  return new PrismaClient({ adapter });
}

// In development, hot reloads re-evaluate this module; keeping the client on `globalThis` avoids opening a new
// connection pool on every reload.
const globalForDb = globalThis as typeof globalThis & { hippowikiDb?: PrismaClient };

/**
 * The application's single Prisma client. It is created on first use, so importing this module neither validates the
 * environment nor connects to the database.
 */
export function getDb(): PrismaClient {
  globalForDb.hippowikiDb ??= createClient();
  return globalForDb.hippowikiDb;
}
