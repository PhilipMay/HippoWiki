// Password hashing with Argon2id. Every hash of a server process runs through one limiter, because a hash takes 19 MiB
// of memory and a processor core for its whole run: a burst of logins must not take the server down.
import { hash, verify, type Algorithm } from "@node-rs/argon2";

/** `Algorithm.Argon2id`; the enum of the package is a `const enum`, which `isolatedModules` cannot read. */
const ARGON2ID: Algorithm = 2;

/**
 * The minimum settings of OWASP for Argon2id: 19 MiB of memory, 2 iterations, 1 lane. They are named here instead of
 * relying on the defaults of the package, which a later version could change.
 */
const HASH_OPTIONS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** How many hashes one server process runs at the same time. */
export const MAX_CONCURRENT_HASHES = 4;
/** How long a hash waits for a free slot before it gives up. */
export const MAX_HASH_WAIT_MS = 10_000;

/** A hash did not get a free slot in time: too many hashes are running. Services turn it into the code `busy`. */
export class PasswordHashBusyError extends Error {
  constructor() {
    super("too many password hashes are running");
    this.name = "PasswordHashBusyError";
  }
}

/** Runs the work once a slot is free and settles like the work. */
export type Limiter = <Value>(work: () => Promise<Value>) => Promise<Value>;

/**
 * A limiter that runs at most `maxConcurrent` pieces of work at the same time. Further callers wait for a free slot in
 * the order they came. A caller that has waited `maxWaitMs` is rejected with `PasswordHashBusyError`; its work never
 * runs and it takes no slot later. A slot is freed when its work has ended, also when it failed.
 */
export function createLimiter({ maxConcurrent, maxWaitMs }: { maxConcurrent: number; maxWaitMs: number }): Limiter {
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
        reject(new PasswordHashBusyError());
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

// One limiter per process. It lives on `globalThis`, so that a module evaluated twice (a hot reload in development, or
// two bundles of the server) still shares it.
const globalForHashes = globalThis as typeof globalThis & { hippowikiHashLimiter?: Limiter };

function limit<Value>(work: () => Promise<Value>): Promise<Value> {
  globalForHashes.hippowikiHashLimiter ??= createLimiter({
    maxConcurrent: MAX_CONCURRENT_HASHES,
    maxWaitMs: MAX_HASH_WAIT_MS,
  });
  return globalForHashes.hippowikiHashLimiter(work);
}

/**
 * The encoded Argon2id hash of the password. The password is hashed as it is: nothing is trimmed or normalised.
 * Rejects with `PasswordHashBusyError` when no slot gets free in time.
 */
export function hashPassword(password: string): Promise<string> {
  return limit(() => hash(password, HASH_OPTIONS));
}

/**
 * Whether the password belongs to the encoded hash, with the settings stored in the hash. Rejects with
 * `PasswordHashBusyError` when no slot gets free in time.
 */
export function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  return limit(() => verify(encodedHash, password));
}
