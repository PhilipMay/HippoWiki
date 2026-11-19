// The check of the database that search needs (`prisma/migrations/20261119100000_search_database_check/`), against
// throwaway databases of the test container with the migrations applied as the global setup applies them: a database
// that search cannot work on stops the migrations with a message that names the fix, before anything of search exists.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { testContainerDatabaseUrl } from "../e2e/support/container";
import { getTestDb } from "../e2e/support/database";

const CHECK_MIGRATION = "20261119100000_search_database_check";
const C_DATABASE = "search_check_c";
const RESTRICTED_DATABASE = "search_check_restricted";
const RESTRICTED_USER = "search_check_user";
const RESTRICTED_PASSWORD = "search-check-password";

/** The URL of the database with the given name in the test container, as the given user if one is given. */
function databaseUrl(name: string, user?: { name: string; password: string }): string {
  const url = new URL(testContainerDatabaseUrl(name));
  if (user) {
    url.username = user.name;
    url.password = user.password;
  }
  return url.toString();
}

/** The migrations before the check, as an installation from before search has them. */
const EARLIER_MIGRATIONS = readdirSync(new URL("../prisma/migrations/", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name < CHECK_MIGRATION)
  .map((entry) => entry.name)
  .sort();

const restrictedUrl = databaseUrl(RESTRICTED_DATABASE, { name: RESTRICTED_USER, password: RESTRICTED_PASSWORD });

/** Runs a command of the Prisma CLI against the database of the URL, as the global setup does, with its output. */
function prisma(url: string, ...args: string[]): { status: number | null; output: string } {
  const result = spawnSync("npx", ["prisma", ...args], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** Runs the given statements as the superuser of the test container in the database with the given name. */
async function asSuperuser<T>(name: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl(name) });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Whether the database with the given name has `pg_trgm`, and the tables and columns of search it holds. */
async function searchObjects(name: string): Promise<{ trgm: boolean; objects: string[] }> {
  return asSuperuser(name, async (client) => {
    const extension = await client.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'");
    const objects = await client.query<{ name: string }>(
      `SELECT table_name AS name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name ILIKE '%search%'
       UNION ALL
       SELECT table_name || '.' || column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name ILIKE '%search%'`,
    );
    return { trgm: extension.rowCount === 1, objects: objects.rows.map((row) => row.name) };
  });
}

async function dropAll(): Promise<void> {
  const db = getTestDb();
  for (const name of [C_DATABASE, RESTRICTED_DATABASE]) {
    await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  }
  await db.$executeRawUnsafe(`DROP ROLE IF EXISTS "${RESTRICTED_USER}"`);
}

beforeAll(dropAll);
afterAll(dropAll);

describe("the check of the database for search", () => {
  it("stops on a database with the character type C, before anything of search exists", async () => {
    await getTestDb().$executeRawUnsafe(
      `CREATE DATABASE "${C_DATABASE}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`,
    );

    const { status, output } = prisma(databaseUrl(C_DATABASE), "migrate", "deploy");

    expect(status).not.toBe(0);
    expect(output).toContain(CHECK_MIGRATION);
    expect(output).toContain("a UTF-8 locale such as C.UTF-8 or en_US.utf8");
    expect(output).toContain(`prisma migrate resolve --rolled-back ${CHECK_MIGRATION}`);
    expect(await searchObjects(C_DATABASE)).toEqual({ trgm: false, objects: [] });
  }, 60_000);

  it("stops where the user may not create pg_trgm, and passes once it was created", async () => {
    const db = getTestDb();
    await db.$executeRawUnsafe(`CREATE ROLE "${RESTRICTED_USER}" LOGIN PASSWORD '${RESTRICTED_PASSWORD}'`);
    await db.$executeRawUnsafe(`CREATE DATABASE "${RESTRICTED_DATABASE}"`);
    // The init migration creates the schema `public` if it is missing, which needs the right to create objects in the
    // database, and that right also lets a user create the trusted extension `pg_trgm`. So only an installation from
    // before search can meet a user without it: its earlier migrations ran while the user had the right, which the
    // operator took away later.
    await db.$executeRawUnsafe(`GRANT CREATE ON DATABASE "${RESTRICTED_DATABASE}" TO "${RESTRICTED_USER}"`);
    await asSuperuser(RESTRICTED_DATABASE, (client) =>
      client.query(`GRANT USAGE, CREATE ON SCHEMA public TO "${RESTRICTED_USER}"`),
    );
    const user = new pg.Client({ connectionString: restrictedUrl });
    await user.connect();
    try {
      for (const name of EARLIER_MIGRATIONS) {
        await user.query(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8"));
      }
    } finally {
      await user.end();
    }
    for (const name of EARLIER_MIGRATIONS) {
      expect(prisma(restrictedUrl, "migrate", "resolve", "--applied", name).status).toBe(0);
    }
    await db.$executeRawUnsafe(`REVOKE CREATE ON DATABASE "${RESTRICTED_DATABASE}" FROM "${RESTRICTED_USER}"`);

    const stopped = prisma(restrictedUrl, "migrate", "deploy");

    expect(stopped.status).not.toBe(0);
    expect(stopped.output).toContain(CHECK_MIGRATION);
    expect(stopped.output).toContain(`the database user ${RESTRICTED_USER} may not create it`);
    expect(stopped.output).toContain("The operator must create pg_trgm in the database");
    expect(await searchObjects(RESTRICTED_DATABASE)).toEqual({ trgm: false, objects: [] });

    // The fix of the operator, then the step that the message names.
    await asSuperuser(RESTRICTED_DATABASE, (client) => client.query("CREATE EXTENSION pg_trgm"));
    expect(prisma(restrictedUrl, "migrate", "resolve", "--rolled-back", CHECK_MIGRATION).status).toBe(0);

    const passed = prisma(restrictedUrl, "migrate", "deploy");

    expect(passed.output).not.toContain("Error");
    expect(passed.status).toBe(0);
    expect((await searchObjects(RESTRICTED_DATABASE)).trgm).toBe(true);
  }, 120_000);

  it("passes on the database of the stock image and creates pg_trgm", async () => {
    // The global setup applied the migrations to `hippowiki_test`, a database of the stock image.
    const rows = await getTestDb().$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`;

    expect(rows).toEqual([{ extname: "pg_trgm" }]);
  });
});
