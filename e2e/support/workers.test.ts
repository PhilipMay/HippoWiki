import { describe, expect, it } from "vitest";

import {
  checkRunWorkers,
  PRODUCTION_DIST_DIR,
  processWorker,
  workerCount,
  workerDatabaseName,
  workerDistDir,
  workerPort,
  workerUrl,
} from "./workers";

describe("workerCount", () => {
  it("is 4 without HIPPOWIKI_E2E_WORKERS", () => {
    expect(workerCount({})).toBe(4);
  });

  it.each([
    ["1", 1],
    ["4", 4],
    ["8", 8],
  ])("is %s for the value %s", (value, count) => {
    expect(workerCount({ HIPPOWIKI_E2E_WORKERS: value })).toBe(count);
  });

  it.each(["0", "9", "two", "2.5", "-1", " 3", "3 ", ""])("refuses the value %j", (value) => {
    expect(() => workerCount({ HIPPOWIKI_E2E_WORKERS: value })).toThrow(
      `HIPPOWIKI_E2E_WORKERS must be a whole number from 1 to 8, but is ${JSON.stringify(value)}.`,
    );
  });
});

describe("checkRunWorkers", () => {
  it.each([
    [2, 2],
    [1, 2],
  ])("accepts %i workers when the variable sets %i", (runWorkers, configured) => {
    expect(() => checkRunWorkers(runWorkers, configured)).not.toThrow();
  });

  it("refuses more workers than the variable sets, and names the variable", () => {
    expect(() => checkRunWorkers(3, 2)).toThrow(
      "The run uses 3 workers, but there are servers for only 2. The number of workers is set with " +
        "HIPPOWIKI_E2E_WORKERS, not with --workers: e.g. HIPPOWIKI_E2E_WORKERS=3 npm run test:e2e.",
    );
  });
});

describe("the values of a worker", () => {
  it("gives worker 1 the port 3100, its address, database and build directory", () => {
    expect(workerPort(1)).toBe(3100);
    expect(workerUrl(1)).toBe("http://localhost:3100");
    expect(workerDatabaseName(1)).toBe("hippowiki_test_1");
    expect(workerDistDir(1)).toBe(".next-e2e/worker-1");
  });

  it("gives worker 8 the port 3107", () => {
    expect(workerPort(8)).toBe(3107);
  });

  it("shares one build directory of the production run", () => {
    expect(PRODUCTION_DIST_DIR).toBe(".next-e2e/production");
  });
});

describe("processWorker", () => {
  it.each([
    ["0", 1],
    ["2", 3],
  ])("is the worker counted from 1 for TEST_PARALLEL_INDEX=%s", (index, worker) => {
    expect(processWorker({ TEST_PARALLEL_INDEX: index })).toBe(worker);
  });

  it("is undefined without TEST_PARALLEL_INDEX", () => {
    expect(processWorker({})).toBeUndefined();
  });
});
