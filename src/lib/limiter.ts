// A limit on how much work of one kind a server process runs at the same time, for work that takes a lot of memory or
// a processor core for its whole run: the password hashing and the processing of uploaded images. No other imports.

/** Runs the work once a slot is free and settles like the work. */
export type Limiter = <Value>(work: () => Promise<Value>) => Promise<Value>;

/**
 * A limiter that runs at most `maxConcurrent` pieces of work at the same time. Further callers wait for a free slot in
 * the order they came. A caller that has waited `maxWaitMs` is rejected with the error of `busyError()`, which each
 * user of a limiter declares itself, so that its callers can tell it from a failure of the work; its work never runs
 * and it takes no slot later. A slot is freed when its work has ended, also when it failed.
 */
export function createLimiter({
  maxConcurrent,
  maxWaitMs,
  busyError,
}: {
  maxConcurrent: number;
  maxWaitMs: number;
  busyError: () => Error;
}): Limiter {
  let running = 0;
  /** The callers that wait for a slot, oldest first; calling an entry gives its caller the slot. */
  const waiting: (() => void)[] = [];

  function acquire(): Promise<void> {
    if (running < maxConcurrent) {
      running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(grant), 1);
        reject(busyError());
      }, maxWaitMs);
      waiting.push(grant);
    });
  }

  function release(): void {
    // The slot goes straight to the oldest waiting caller, so a caller that comes now cannot overtake it.
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }

  return async (work) => {
    await acquire();
    try {
      return await work();
    } finally {
      release();
    }
  };
}
