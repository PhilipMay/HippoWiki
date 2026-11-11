// Access to the end-to-end test database. It lives in its own throwaway container (see ./container.ts), so the tests
// never touch the development database.
import { execFileSync } from "node:child_process";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Page, type Prisma } from "@/generated/prisma/client";

import { TEST_DATABASE_NAME, TEST_DATABASE_URL } from "./container";

/** Host, port and database of a PostgreSQL URL, e.g. "localhost:5432/hippowiki". */
function databaseLocation(url: string): string {
  const { hostname, port, pathname } = new URL(url);
  return `${hostname}:${port || "5432"}${pathname}`;
}

/** URL of the test database. It never points to the database of DATABASE_URL, so tests cannot touch it. */
export function testDatabaseUrl(): string {
  const devUrl = process.env.DATABASE_URL;
  if (devUrl && databaseLocation(devUrl) === databaseLocation(TEST_DATABASE_URL)) {
    throw new Error(`DATABASE_URL must not point to the test database ${TEST_DATABASE_NAME}`);
  }
  return TEST_DATABASE_URL;
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

/**
 * Creates a page directly in the test database, with a unique slug unless one is given. Any field can be overridden,
 * e.g. `updatedAt` to control ordering.
 */
export function createPage(data: Partial<Prisma.PageCreateInput> = {}): Promise<Page> {
  return getTestDb().page.create({
    data: { title: "Test page", slug: `test-page-${crypto.randomUUID()}`, content: "", ...data },
  });
}
