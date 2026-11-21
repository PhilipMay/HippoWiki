// The workers of the end-to-end tests: how many run, and the port, server address, database, build directory and files
// directory of each one. The configuration, the global setup and the helpers of the tests all take these values from here. The
// module has no side effects and does not import Playwright, so the unit tests can load it.

/** The environment variable that sets the number of workers for one run. */
const WORKERS_VARIABLE = "HIPPOWIKI_E2E_WORKERS";

/** The number of workers without the variable. */
const DEFAULT_WORKERS = 4;

/** The largest number of workers: one server per worker on the ports 3100 to 3107. */
export const MAX_WORKERS = 8;

/** The port of the server of worker 1; each further worker uses the next one. */
const FIRST_PORT = 3100;

/** The build directory of the production run, shared by the servers of all workers. */
export const PRODUCTION_DIST_DIR = ".next-e2e/production";

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * The number of workers of the run: the value of `HIPPOWIKI_E2E_WORKERS`, or 4 without it. A value that is not one of
 * the whole numbers 1 to 8, written as digits only, throws, so that a typo stops the run instead of being ignored.
 */
export function workerCount(env: Environment = process.env): number {
  const value = env[WORKERS_VARIABLE];
  if (value === undefined) return DEFAULT_WORKERS;
  if (!/^[1-8]$/.test(value)) {
    throw new Error(
      `${WORKERS_VARIABLE} must be a whole number from 1 to ${MAX_WORKERS}, but is ${JSON.stringify(value)}.`,
    );
  }
  return Number(value);
}

/**
 * Checks that the run has no more workers than `HIPPOWIKI_E2E_WORKERS` sets, because only that many servers and
 * databases are started; fewer workers are fine. Playwright's own `--workers` cannot start more of them, so a larger
 * number throws an error that says how to set the number of workers.
 */
export function checkRunWorkers(runWorkers: number, configuredWorkers: number): void {
  if (runWorkers > configuredWorkers) {
    throw new Error(
      `The run uses ${runWorkers} workers, but there are servers for only ${configuredWorkers}. The number of workers is ` +
        `set with ${WORKERS_VARIABLE}, not with --workers: e.g. ${WORKERS_VARIABLE}=${runWorkers} npm run test:e2e.`,
    );
  }
}

/** The port of the server of the worker, counted from 1. */
export function workerPort(worker: number): number {
  return FIRST_PORT + worker - 1;
}

/** The address of the server of the worker. */
export function workerUrl(worker: number): string {
  return `http://localhost:${workerPort(worker)}`;
}

/** The name of the test database of the worker, a copy of `hippowiki_test`. */
export function workerDatabaseName(worker: number): string {
  return `hippowiki_test_${worker}`;
}

/** The build directory of the development server of the worker. */
export function workerDistDir(worker: number): string {
  return `.next-e2e/worker-${worker}`;
}

/**
 * The files directory of the server of the worker (`HIPPOWIKI_FILES_DIR`), where its uploads and the files of
 * `createFile()` are kept. It is not below the build directory, which a development server may clean.
 */
export function workerFilesDir(worker: number): string {
  return `.next-e2e/files-${worker}`;
}

/**
 * The worker of the running process, counted from 1, from the `TEST_PARALLEL_INDEX` that Playwright sets in each
 * worker process (counted from 0); undefined in the main process of Playwright and outside Playwright.
 */
export function processWorker(env: Environment = process.env): number | undefined {
  const index = env.TEST_PARALLEL_INDEX;
  return index === undefined ? undefined : Number(index) + 1;
}
