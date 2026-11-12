import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLimiter,
  hashPassword,
  MAX_CONCURRENT_HASHES,
  MAX_HASH_WAIT_MS,
  PasswordHashBusyError,
  verifyPassword,
} from "@/lib/password-hash";

describe("hashPassword and verifyPassword", () => {
  it("hashes with Argon2id, 19 MiB of memory, 2 iterations and 1 lane", async () => {
    expect(await hashPassword("correct horse")).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it("verifies a hash with its password and not with another one", async () => {
    const hash = await hashPassword("correct horse");

    expect(await verifyPassword(hash, "correct horse")).toBe(true);
    expect(await verifyPassword(hash, "correct horsf")).toBe(false);
  });

  it("gives two hashes of the same password different salts", async () => {
    expect(await hashPassword("correct horse")).not.toBe(await hashPassword("correct horse"));
  });

  it("keeps the spaces at both ends of a password", async () => {
    const hash = await hashPassword("  spaced out  ");

    expect(await verifyPassword(hash, "  spaced out  ")).toBe(true);
    expect(await verifyPassword(hash, "spaced out")).toBe(false);
    expect(await verifyPassword(hash, "  spaced out")).toBe(false);
  });

  it("keeps non-Latin letters as they are, without normalising them", async () => {
    // "é" as one code point; the same letter as "e" with a combining accent is another password.
    const hash = await hashPassword("пароль-密碼-é");

    expect(await verifyPassword(hash, "пароль-密碼-é")).toBe(true);
    expect(await verifyPassword(hash, "пароль-密碼-é")).toBe(false);
  });

  it("uses all 128 characters of a long password", async () => {
    const password = "a".repeat(128);
    const hash = await hashPassword(password);

    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await verifyPassword(hash, "a".repeat(127))).toBe(false);
    expect(await verifyPassword(hash, `${"a".repeat(127)}b`)).toBe(false);
  });
});

describe("the limits of the password hashing", () => {
  it("allows 4 hashes at the same time and a wait of 10 seconds", () => {
    expect(MAX_CONCURRENT_HASHES).toBe(4);
    expect(MAX_HASH_WAIT_MS).toBe(10_000);
  });
});

/** A piece of work that the test starts watching and ends by hand. */
function controlledWork() {
  let resolve!: (value: string) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const work = vi.fn(() => promise);
  return { work, resolve, reject };
}

/** Lets the pending promise callbacks run, so that a freed slot reaches the next caller. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("createLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs four callers at once and starts the fifth when one of them has ended", async () => {
    const limiter = createLimiter({ maxConcurrent: 4, maxWaitMs: 10_000 });
    const jobs = Array.from({ length: 5 }, controlledWork);
    const results = jobs.map(({ work }) => limiter(work));
    await settle();

    expect(jobs.map(({ work }) => work.mock.calls.length)).toEqual([1, 1, 1, 1, 0]);

    jobs[2]?.resolve("third");
    await settle();

    expect(jobs[4]?.work).toHaveBeenCalledTimes(1);
    await expect(results[2]).resolves.toBe("third");

    jobs[4]?.resolve("fifth");
    await expect(results[4]).resolves.toBe("fifth");
  });

  it("starts waiting callers in the order they came", async () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxWaitMs: 10_000 });
    const jobs = Array.from({ length: 4 }, controlledWork);
    const startedJobs = () => jobs.map(({ work }) => work.mock.calls.length);
    const results = jobs.map(({ work }) => limiter(work));
    await settle();
    expect(startedJobs()).toEqual([1, 0, 0, 0]);

    jobs[0]?.resolve("done");
    await settle();
    expect(startedJobs()).toEqual([1, 1, 0, 0]);

    jobs[1]?.resolve("done");
    await settle();
    expect(startedJobs()).toEqual([1, 1, 1, 0]);

    jobs[2]?.resolve("done");
    await settle();
    expect(startedJobs()).toEqual([1, 1, 1, 1]);

    jobs[3]?.resolve("done");
    await expect(Promise.all(results)).resolves.toEqual(["done", "done", "done", "done"]);
  });

  it("does not let a new caller overtake a waiting one when a slot gets free", async () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxWaitMs: 10_000 });
    const [first, second, third] = [controlledWork(), controlledWork(), controlledWork()];
    void limiter(first.work);
    void limiter(second.work);
    await settle();

    first.resolve("first");
    // The third caller comes in the same tick in which the slot gets free.
    void limiter(third.work);
    await settle();

    expect(second.work).toHaveBeenCalledTimes(1);
    expect(third.work).not.toHaveBeenCalled();
  });

  it("rejects a caller that has waited 10 seconds, and never runs its work", async () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxWaitMs: 10_000 });
    const [running, late] = [controlledWork(), controlledWork()];
    void limiter(running.work);
    const rejected = limiter(late.work);
    const outcome = expect(rejected).rejects.toBeInstanceOf(PasswordHashBusyError);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;

    // The slot that gets free later is not taken by the caller that gave up.
    running.resolve("running");
    await settle();
    expect(late.work).not.toHaveBeenCalled();

    const next = controlledWork();
    void limiter(next.work);
    await settle();
    expect(next.work).toHaveBeenCalledTimes(1);
  });

  it("keeps the order of the callers that still wait when one of them gives up", async () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxWaitMs: 10_000 });
    const [running, early, later] = [controlledWork(), controlledWork(), controlledWork()];
    void limiter(running.work);
    const gaveUp = expect(limiter(early.work)).rejects.toBeInstanceOf(PasswordHashBusyError);
    await vi.advanceTimersByTimeAsync(5_000);
    void limiter(later.work);

    await vi.advanceTimersByTimeAsync(5_000);
    await gaveUp;
    running.resolve("running");
    await settle();

    expect(early.work).not.toHaveBeenCalled();
    expect(later.work).toHaveBeenCalledTimes(1);
  });

  it("does not reject a caller that got its slot before the 10 seconds were over", async () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxWaitMs: 10_000 });
    const [running, waiting] = [controlledWork(), controlledWork()];
    void limiter(running.work);
    const result = limiter(waiting.work);
    await vi.advanceTimersByTimeAsync(9_000);

    running.resolve("running");
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    waiting.resolve("waited");

    await expect(result).resolves.toBe("waited");
  });

  it("frees the slot when the work rejects, and passes the error on", async () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxWaitMs: 10_000 });
    const [failing, next] = [controlledWork(), controlledWork()];
    const failed = expect(limiter(failing.work)).rejects.toThrow("hash failed");
    void limiter(next.work);
    await settle();
    expect(next.work).not.toHaveBeenCalled();

    failing.reject(new Error("hash failed"));
    await failed;
    await settle();

    expect(next.work).toHaveBeenCalledTimes(1);
  });

  it("frees the slot when the work throws before it returns a promise", async () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxWaitMs: 10_000 });
    const next = controlledWork();

    await expect(
      limiter(() => {
        throw new Error("thrown at once");
      }),
    ).rejects.toThrow("thrown at once");
    void limiter(next.work);
    await settle();

    expect(next.work).toHaveBeenCalledTimes(1);
  });
});
