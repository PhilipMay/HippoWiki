// The throwaway PostgreSQL container of the end-to-end tests. The global setup creates it before each run and the
// global teardown removes it, so no database is left running after the tests. Its data lives in memory only.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const TEST_DB_CONTAINER = "hippowiki-test-db";
const TEST_DB_IMAGE = readPostgresImage();
const TEST_DB_PORT = 5433;
export const TEST_DATABASE_NAME = "hippowiki_test";
const TEST_DB_USER = "hippowiki_test";
const TEST_DB_PASSWORD = "hippowiki_test";
const READY_TIMEOUT_MS = 60_000;

/** URL of the test database in the test container. */
export const TEST_DATABASE_URL = `postgresql://${TEST_DB_USER}:${TEST_DB_PASSWORD}@localhost:${TEST_DB_PORT}/${TEST_DATABASE_NAME}`;

/**
 * Reads the PostgreSQL image from scripts/Containerfile, the one place it is pinned, so that the tests run against the
 * same version as the development database.
 */
function readPostgresImage(): string {
  const containerfile = readFileSync(new URL("../../scripts/Containerfile", import.meta.url), "utf8");
  const image = /^FROM\s+(\S+)/m.exec(containerfile)?.[1];
  if (image === undefined) {
    throw new Error("No FROM line with the PostgreSQL image found in scripts/Containerfile.");
  }
  return image;
}

function podman(args: string[]): string {
  return execFileSync("podman", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function isReady(): boolean {
  try {
    // Checks over TCP: while the image initializes the database, its temporary server only listens on the Unix socket
    // and must not count as ready.
    podman([
      "exec",
      TEST_DB_CONTAINER,
      "pg_isready",
      "-q",
      "-h",
      "127.0.0.1",
      "-U",
      TEST_DB_USER,
      "-d",
      TEST_DATABASE_NAME,
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Removes the test container if it exists, e.g. one left behind by a run that was killed. */
export function removeTestDbContainer(): void {
  podman(["rm", "--force", "--ignore", TEST_DB_CONTAINER]);
}

/** Starts a fresh test container and waits until the database accepts connections. */
export async function startTestDbContainer(): Promise<void> {
  try {
    podman(["info"]);
  } catch (err) {
    throw new Error("Podman is not reachable. Start the Podman machine with `podman machine start`.", { cause: err });
  }

  removeTestDbContainer();
  podman([
    "run",
    "--detach",
    "--rm",
    "--name",
    TEST_DB_CONTAINER,
    "--env",
    `POSTGRES_DB=${TEST_DATABASE_NAME}`,
    "--env",
    `POSTGRES_USER=${TEST_DB_USER}`,
    "--env",
    `POSTGRES_PASSWORD=${TEST_DB_PASSWORD}`,
    "--publish",
    `127.0.0.1:${TEST_DB_PORT}:5432`,
    // Keep the data in memory: nothing is written to disk and nothing survives the container.
    "--tmpfs",
    "/var/lib/postgresql",
    TEST_DB_IMAGE,
    // The data is disposable, so durability can be traded for speed.
    "-c",
    "fsync=off",
    "-c",
    "synchronous_commit=off",
  ]);

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (!isReady()) {
    if (Date.now() > deadline) {
      // PostgreSQL logs to stderr, so both streams are collected.
      const { stdout, stderr } = spawnSync("podman", ["logs", "--tail", "20", TEST_DB_CONTAINER], { encoding: "utf8" });
      const logs = `${stdout}${stderr}`;
      removeTestDbContainer();
      throw new Error(
        `Test database did not become ready within ${READY_TIMEOUT_MS / 1000}s. Last log lines:\n${logs}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
