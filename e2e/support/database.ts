// Access to the end-to-end test database. The tests use the database `hippowiki_test` in the same PostgreSQL
// container as the development database; its URL is derived from DATABASE_URL, so no extra configuration is needed.
import { execFileSync } from "node:child_process";

import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";

import { PrismaClient, type Page, type Prisma } from "@/generated/prisma/client";
import { serverEnvSchema } from "@/lib/env";

export const TEST_DATABASE_NAME = "hippowiki_test";

/** URL of `database` on the server that DATABASE_URL points to. */
function databaseUrl(database: string): string {
  const { DATABASE_URL } = serverEnvSchema.parse(process.env);
  const url = new URL(DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

/** URL of the test database. It never equals DATABASE_URL, so tests cannot touch the development database. */
export function testDatabaseUrl(): string {
  const url = databaseUrl(TEST_DATABASE_NAME);
  if (new URL(url).pathname === new URL(serverEnvSchema.parse(process.env).DATABASE_URL).pathname) {
    throw new Error(`DATABASE_URL must not point to the test database ${TEST_DATABASE_NAME}`);
  }
  return url;
}

/** Creates the test database if it does not exist yet. */
export async function ensureTestDatabase(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl("postgres"), connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
  } catch (err) {
    throw new Error("PostgreSQL is not reachable. Start it with `npm run db:up`.", { cause: err });
  }
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DATABASE_NAME]);
    if (rowCount === 0) {
      // The name is a constant, so it is safe to put it into the statement.
      await client.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
    }
  } finally {
    await client.end();
  }
}

/** Applies all migrations to the test database. */
export function migrateTestDatabase(): void {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: "inherit",
  });
}

let testDb: PrismaClient | undefined;

/** Prisma client for the test database, created on first use. */
export function getTestDb(): PrismaClient {
  testDb ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDatabaseUrl(), connectionTimeoutMillis: 5_000 }),
  });
  return testDb;
}

/** Closes the connection of the test database client, if one was opened. */
export async function disconnectTestDb(): Promise<void> {
  await testDb?.$disconnect();
  testDb = undefined;
}

/** Deletes all rows from all tables of the test database, except the migration history. */
export async function resetTestDatabase(): Promise<void> {
  const db = getTestDb();
  const [{ current_database: current }] = await db.$queryRaw<{ current_database: string }[]>`
    SELECT current_database()`;
  if (current !== TEST_DATABASE_NAME) {
    throw new Error(`Refusing to empty database ${current}; only ${TEST_DATABASE_NAME} may be reset.`);
  }
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    const names = tables.map(({ tablename }) => `"public"."${tablename.replaceAll('"', '""')}"`).join(", ");
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${names} CASCADE`);
  }
}

/** Creates a page directly in the test database. Any field can be overridden, e.g. `updatedAt` to control ordering. */
export function createPage(data: Partial<Prisma.PageCreateInput> = {}): Promise<Page> {
  return getTestDb().page.create({ data: { title: "Test page", content: "", ...data } });
}
