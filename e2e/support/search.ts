import { getTestDb } from "./database";
import { expect } from "./test";

/**
 * Holds the table of the words of the folders (`SearchWord`) in a transaction of the test, until the returned function
 * is called. Every search of the server of the worker then waits for it, until its time limit ends it as too broad,
 * while the reads of the other pages answer as usual. Each worker has a server and a database of its own, so a test
 * holds only the searches of its worker.
 */
export async function holdSearchWords(): Promise<{ release: () => Promise<void> }> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const isLocked = new Promise<void>((resolve) => (locked = resolve));
  const transaction = getTestDb().$transaction(
    async (tx) => {
      await tx.$executeRaw`LOCK TABLE "SearchWord" IN ACCESS EXCLUSIVE MODE`;
      locked();
      await held;
    },
    { timeout: 60_000 },
  );
  await Promise.race([isLocked, transaction]);
  return {
    release: async () => {
      release();
      await transaction;
    },
  };
}

/** Waits until the given number of searches wait for the table that `holdSearchWords()` holds. */
export async function waitForHeldSearches(count: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const [row] = await getTestDb().$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::integer AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%SearchWord%'`;
        return row?.waiting;
      },
      { timeout: 4_000, intervals: [50] },
    )
    .toBe(count);
}
