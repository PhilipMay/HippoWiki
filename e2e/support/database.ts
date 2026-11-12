// Access to the end-to-end test database. It lives in its own throwaway container (see ./container.ts), so the tests
// never touch the development database.
import { execFileSync } from "node:child_process";

import { PrismaPg } from "@prisma/adapter-pg";

import { titleFromContent } from "@/features/pages/derive";
import { PrismaClient, type Folder, type Page, type Prisma, type Tab } from "@/generated/prisma/client";

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
  const [row] = await db.$queryRaw<{ current_database: string }[]>`
    SELECT current_database()`;
  const current = row?.current_database;
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
 * Creates a folder directly in the test database, with a unique name unless one is given. Any other field can be
 * overridden, e.g. `updatedAt`.
 */
export function createFolder(data: Partial<Prisma.FolderCreateInput> = {}): Promise<Folder> {
  return getTestDb().folder.create({ data: { name: `test-folder-${crypto.randomUUID()}`, ...data } });
}

/** The fields of a tab that `createTab()` can set, and the folder it belongs to. */
type CreateTabData = Partial<Omit<Prisma.TabUncheckedCreateInput, "folderId">> & { folder?: Folder };

/**
 * Creates a tab directly in the test database, in the given folder; without one, a new folder is created for it. The
 * tab gets a unique name unless one is given.
 */
export async function createTab({ folder, ...data }: CreateTabData = {}): Promise<Tab> {
  const folderId = (folder ?? (await createFolder())).id;
  return getTestDb().tab.create({ data: { name: `test-tab-${crypto.randomUUID()}`, ...data, folderId } });
}

/** The fields of a page that `createPage()` can set, and the folder or tab to place it in. */
type CreatePageData = Partial<Omit<Prisma.PageUncheckedCreateInput, "folderId" | "tabId">> & {
  folder?: Folder;
  tab?: Tab;
};

/**
 * Creates a page directly in the test database: in the given tab, or placed directly in the given folder; without
 * either, a new folder is created for it. The page gets a unique name unless one is given. Like a save through the
 * forms, the title is derived from the content; the content defaults to `# <title>`, so `createPage({ title: "Old" })`
 * gives a page with the content `# Old`. A title given together with content is stored as is, e.g. to set up a page
 * that was stored before titles were derived. Any other field can be overridden, e.g. `updatedAt`. Setting `deletedAt`
 * creates a deleted page; a deleted page has no tab, so it cannot be combined with `tab`.
 */
export async function createPage({ folder, tab, ...data }: CreatePageData = {}): Promise<Page> {
  if (tab && data.deletedAt) throw new Error("A deleted page has no tab: give a folder instead");
  const content = data.content ?? `# ${data.title ?? "Test page"}`;
  const title = data.title ?? titleFromContent(content) ?? "Test page";
  const folderId = tab ? tab.folderId : (folder ?? (await createFolder())).id;
  return getTestDb().page.create({
    data: { name: `test-page-${crypto.randomUUID()}`, ...data, title, content, folderId, tabId: tab?.id ?? null },
  });
}
