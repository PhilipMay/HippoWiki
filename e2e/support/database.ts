// Access to the end-to-end test database. It lives in its own throwaway container (see ./container.ts), so the tests
// never touch the development database.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";

import { PrismaPg } from "@prisma/adapter-pg";

import { titleFromContent } from "@/features/pages/derive";
import { generateToken, hashToken } from "@/features/tokens/secret";
import { newUserData, type NewUser } from "@/features/users/records";
import {
  PrismaClient,
  type ApiToken,
  type Folder,
  type Page,
  type Prisma,
  type Session,
  type Tab,
  type User,
} from "@/generated/prisma/client";
import { hashPassword } from "@/lib/password-hash";

import { KNOWN_USERS } from "../../prisma/known-users";
import { SESSIONS_FILE } from "./auth";
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

/**
 * The tables that are never emptied: the migration history, and the secret of the session cookies, which the running
 * server keeps for its whole life. Without the secret every session cookie of the run would become invalid.
 */
const KEPT_TABLES = ["_prisma_migrations", "AuthSecret"];

/**
 * The PostgreSQL errors of a `TRUNCATE` that a transaction of the server got in the way of: `40P01` when the two
 * deadlocked and PostgreSQL rolled the `TRUNCATE` back, `55P03` when it waited longer than `TRUNCATE_LOCK_TIMEOUT`
 * for a lock. A login writes `LoginAttempt` and `LoginWindow` in one transaction, and `TRUNCATE` locks the tables
 * one after another in the order of `pg_tables`, so each can hold the lock the other waits for. A fixed order would
 * not help: the order of the login is its own. Both errors go away once that transaction is over, which takes
 * milliseconds, so the reset simply tries again.
 */
const LOCK_ERROR_CODES = ["40P01", "55P03"];
/** How long the `TRUNCATE` waits for a lock before it gives up and is tried again. */
const TRUNCATE_LOCK_TIMEOUT = "2s";
/** How often the `TRUNCATE` is tried before the reset fails, and how long it waits longer after each try. */
const TRUNCATE_ATTEMPTS = 5;
const TRUNCATE_RETRY_DELAY_MS = 100;

/** The code in the message of a failed raw query, e.g. "Raw query failed. Code: `40P01`." */
const CODE_IN_MESSAGE = /Raw query failed\. Code: `([^`]+)`/;

/**
 * The PostgreSQL error code of a failed raw query. The driver adapter of `pg` puts it below `driverAdapterError`,
 * other versions and clients put it directly into `meta`, and the message carries it as well. All three are read, so
 * that the retry below does not quietly stop working when the shape of the error changes.
 */
function postgresErrorCode(error: unknown): string | undefined {
  const meta = (error as { meta?: { code?: unknown; driverAdapterError?: { cause?: { code?: unknown } } } } | null)
    ?.meta;
  const code: unknown = meta?.driverAdapterError?.cause?.code ?? meta?.code;
  if (typeof code === "string") return code;
  const message: unknown = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? CODE_IN_MESSAGE.exec(message)?.[1] : undefined;
}

/**
 * Deletes all rows from all tables of the test database, except the migration history and the secret of the session
 * cookies. The integration tests use it before every test; the end-to-end tests use `resetTestDatabase()`.
 */
export async function emptyTestDatabase(): Promise<void> {
  const db = getTestDb();
  const [row] = await db.$queryRaw<{ current_database: string }[]>`
    SELECT current_database()`;
  const current = row?.current_database;
  if (current !== TEST_DATABASE_NAME) {
    throw new Error(`Refusing to empty database ${current}; only ${TEST_DATABASE_NAME} may be reset.`);
  }
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  const names = tables
    .filter(({ tablename }) => !KEPT_TABLES.includes(tablename))
    .map(({ tablename }) => `"public"."${tablename.replaceAll('"', '""')}"`);
  if (names.length === 0) return;
  const truncate = `TRUNCATE TABLE ${names.join(", ")} CASCADE`;
  for (let attempt = 1; ; attempt++) {
    try {
      // One transaction, so that `SET LOCAL` and the `TRUNCATE` use the same connection of the pool. Without the
      // timeout the reset would wait for a lock until the test times out.
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${TRUNCATE_LOCK_TIMEOUT}'`);
        await tx.$executeRawUnsafe(truncate);
      });
      return;
    } catch (err) {
      const code = postgresErrorCode(err);
      if (attempt === TRUNCATE_ATTEMPTS || code === undefined || !LOCK_ERROR_CODES.includes(code)) throw err;
      await setTimeout(attempt * TRUNCATE_RETRY_DELAY_MS);
    }
  }
}

/** A row of `Session` as the setup project saved it: JSON has no dates, so they are strings. */
type SavedSession = { [Field in keyof Session]: Session[Field] extends Date ? string : Session[Field] };

/**
 * The sessions that the setup project saved after it had logged in as the known users (see ./auth.ts); none while
 * the file does not exist yet, i.e. when the global setup resets the database before the logins.
 */
function savedSessions(): Session[] {
  if (!existsSync(SESSIONS_FILE)) return [];
  const sessions = JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) as SavedSession[];
  return sessions.map((session) => ({
    ...session,
    expiresAt: new Date(session.expiresAt),
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
  }));
}

/**
 * Puts the test database into the state every end-to-end test starts from: all tables empty, except the two that are
 * never emptied, then the known users of `prisma/known-users.ts` with their fixed ids and the password change already
 * done, and the sessions of their saved logins. So the browser states that the tests start with stay logged in after
 * every reset.
 */
export async function resetTestDatabase(): Promise<void> {
  await emptyTestDatabase();
  for (const { id, name, password } of KNOWN_USERS) {
    await createUser({ id, name, password, mustChangePassword: false });
  }
  const sessions = savedSessions();
  if (sessions.length > 0) await getTestDb().session.createMany({ data: sessions });
}

/** The hashes of the passwords that `createUser()` has stored; a hash takes time, so each one is computed once. */
const passwordHashes = new Map<string, Promise<string>>();

function passwordHashOf(password: string): Promise<string> {
  let hash = passwordHashes.get(password);
  if (!hash) {
    hash = hashPassword(password);
    passwordHashes.set(password, hash);
  }
  return hash;
}

/** The password of the users that `createUser()` creates without one. */
export const TEST_PASSWORD = "test-password";

/** The fields of a user that `createUser()` can set: those of a new user and its password instead of the hash. */
type CreateUserData = Partial<Omit<NewUser, "passwordHash">> & { password?: string } & Partial<
    Pick<Prisma.UserCreateInput, "createdAt" | "updatedAt">
  >;

/**
 * Creates a user with its credential account directly in the test database, in the shape of `records.ts`. The user
 * gets a unique name and the password `TEST_PASSWORD` unless they are given, and has the first password still to
 * change unless `mustChangePassword` is false. Any other field can be overridden, e.g. `createdAt`.
 */
export async function createUser({
  id,
  name = `test-user-${crypto.randomUUID().slice(0, 13)}`,
  password = TEST_PASSWORD,
  mustChangePassword = true,
  ...data
}: CreateUserData = {}): Promise<User> {
  const passwordHash = await passwordHashOf(password);
  return getTestDb().user.create({ data: { ...newUserData({ id, name, passwordHash, mustChangePassword }), ...data } });
}

/** The fields of a folder that `createFolder()` can set, and the user who last edited it. */
type CreateFolderData = Partial<Omit<Prisma.FolderUncheckedCreateInput, "lastEditedById">> & { editor?: User };

/**
 * Creates a folder directly in the test database, with a unique name unless one is given. The given editor is its last
 * editor; without one, a new user is created for it, so that a test that starts from an empty database needs no user
 * of its own. Any other field can be overridden, e.g. `updatedAt`.
 */
export async function createFolder({ editor, ...data }: CreateFolderData = {}): Promise<Folder> {
  const lastEditedById = (editor ?? (await createUser())).id;
  return getTestDb().folder.create({ data: { name: `test-folder-${crypto.randomUUID()}`, ...data, lastEditedById } });
}

/** The fields of a tab that `createTab()` can set, the folder it belongs to and the user who last edited it. */
type CreateTabData = Partial<Omit<Prisma.TabUncheckedCreateInput, "folderId" | "lastEditedById">> & {
  folder?: Folder;
  editor?: User;
};

/**
 * Creates a tab directly in the test database, in the given folder; without one, a new folder is created for it. The
 * tab gets a unique name unless one is given. The given editor is its last editor, and that of a folder created for
 * it; without one, a new user is created for them.
 */
export async function createTab({ folder, editor, ...data }: CreateTabData = {}): Promise<Tab> {
  const lastEditor = editor ?? (await createUser());
  const folderId = (folder ?? (await createFolder({ editor: lastEditor }))).id;
  return getTestDb().tab.create({
    data: { name: `test-tab-${crypto.randomUUID()}`, ...data, folderId, lastEditedById: lastEditor.id },
  });
}

/** The fields of a page that `createPage()` can set, the folder or tab to place it in and the user who last edited it. */
type CreatePageData = Partial<Omit<Prisma.PageUncheckedCreateInput, "folderId" | "tabId" | "lastEditedById">> & {
  folder?: Folder;
  tab?: Tab;
  editor?: User;
};

/**
 * Creates a page directly in the test database: in the given tab, or placed directly in the given folder; without
 * either, a new folder is created for it. The page gets a unique name unless one is given. The given editor is its last
 * editor (for a deleted page, the user who deleted it), and that of a folder created for it; without one, a new user
 * is created for them. Like a save through the forms, the title is derived from the content; the content defaults to
 * `# <title>`, so `createPage({ title: "Old" })` gives a page with the content `# Old`. A title given together with
 * content is stored as is, e.g. to set up a page that was stored before titles were derived. Any other field can be
 * overridden, e.g. `updatedAt`. Setting `deletedAt` creates a deleted page; a deleted page has no tab, so it cannot be
 * combined with `tab`.
 */
export async function createPage({ folder, tab, editor, ...data }: CreatePageData = {}): Promise<Page> {
  if (tab && data.deletedAt) throw new Error("A deleted page has no tab: give a folder instead");
  const content = data.content ?? `# ${data.title ?? "Test page"}`;
  const title = data.title ?? titleFromContent(content) ?? "Test page";
  const lastEditor = editor ?? (await createUser());
  const folderId = tab ? tab.folderId : (folder ?? (await createFolder({ editor: lastEditor }))).id;
  return getTestDb().page.create({
    data: {
      name: `test-page-${crypto.randomUUID()}`,
      ...data,
      title,
      content,
      folderId,
      tabId: tab?.id ?? null,
      lastEditedById: lastEditor.id,
    },
  });
}

/** The fields of an API token that `createApiToken()` can set, and the user it belongs to. */
type CreateApiTokenData = Partial<Omit<Prisma.ApiTokenUncheckedCreateInput, "userId" | "tokenHash">> & {
  owner: { id: string };
};

/**
 * Creates an API token of the given owner directly in the test database, with a generated token of which only the
 * hash is stored, and returns the row together with the token. Without other fields it has the scope `read`, a unique
 * name and an expiry 90 days from now; any field can be set, e.g. `expiresAt` for an expired token.
 */
export async function createApiToken({
  owner,
  ...data
}: CreateApiTokenData): Promise<{ token: ApiToken; secret: string }> {
  const secret = generateToken();
  const token = await getTestDb().apiToken.create({
    data: {
      name: `test-token-${crypto.randomUUID().slice(0, 8)}`,
      scopes: ["read"],
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      ...data,
      userId: owner.id,
      tokenHash: hashToken(secret),
    },
  });
  return { token, secret };
}
