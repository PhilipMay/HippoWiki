// The rate limit of the MCP requests: a token bucket per user, kept in the memory of the running server. A user may
// send `burst` requests at once, and the budget gains `perMinute` requests a minute, up to `burst` again. It also
// decides which refusals are logged: the first of a user, and then at most one a minute, with the number of refusals
// since the line before. Pure: the clock is given, and nothing here reads the environment or logs.

/** A minute in milliseconds: the period of the refill and of the log of refusals. */
const MINUTE_MS = 60_000;

/**
 * What `take()` decides for a request: it may pass, or it is refused, with the milliseconds until the user's next
 * request may pass and, when this refusal is to be logged, how many refusals of the user came since the line before.
 */
type Take = { ok: true } | { ok: false; waitMs: number; log: { refusedBefore: number } | null };

/** The budget of the MCP requests per user. */
export type RateLimit = {
  /** Takes one request from the budget of the user, or refuses it. */
  take(userId: string): Take;
  /** How many users have a budget that is not full, or a refusal not logged yet; for the tests. */
  trackedUsers(): number;
};

/**
 * The budget of a user. `units` counts requests in sixty-thousandths, so that the refill of `perMinute` requests a
 * minute is a whole number of units per millisecond: one request costs `MINUTE_MS` units, and every millisecond adds
 * `perMinute`. So the budget is counted exactly, without the rounding of fractions.
 */
type Bucket = { units: number; at: number };

/** When the last refusal of a user was logged, and how many refusals of the user came since. */
type RefusalLog = { loggedAt: number; unlogged: number };

/**
 * A rate limit of `burst` requests at once, refilled at `perMinute` requests a minute, per user id. A user whose
 * budget is full again needs no entry: the entries are pruned at most once a minute, so the maps hold only the users
 * who sent requests lately and those with a refusal that is not logged yet.
 */
export function createRateLimit({
  burst,
  perMinute,
  now = Date.now,
}: {
  burst: number;
  perMinute: number;
  now?: () => number;
}): RateLimit {
  const capacity = burst * MINUTE_MS;
  const buckets = new Map<string, Bucket>();
  const refusals = new Map<string, RefusalLog>();
  let prunedAt = now();

  /** The units of the bucket at the given time, with the refill since its last request. */
  function unitsAt(bucket: Bucket, time: number): number {
    return Math.min(capacity, bucket.units + Math.max(0, time - bucket.at) * perMinute);
  }

  function prune(time: number): void {
    if (time - prunedAt < MINUTE_MS) return;
    prunedAt = time;
    for (const [userId, bucket] of buckets) {
      if (unitsAt(bucket, time) >= capacity) buckets.delete(userId);
    }
    // A refusal that is not logged yet keeps its entry, so that the next line of the user counts it.
    for (const [userId, log] of refusals) {
      if (log.unlogged === 0 && time - log.loggedAt >= MINUTE_MS) refusals.delete(userId);
    }
  }

  /** Whether this refusal of the user is logged, and with how many refusals since the line before. */
  function logDecision(userId: string, time: number): { refusedBefore: number } | null {
    const log = refusals.get(userId);
    if (log && time - log.loggedAt < MINUTE_MS) {
      log.unlogged += 1;
      return null;
    }
    refusals.set(userId, { loggedAt: time, unlogged: 0 });
    return { refusedBefore: log?.unlogged ?? 0 };
  }

  return {
    take(userId) {
      const time = now();
      prune(time);
      const bucket = buckets.get(userId);
      const units = bucket ? unitsAt(bucket, time) : capacity;
      if (units >= MINUTE_MS) {
        buckets.set(userId, { units: units - MINUTE_MS, at: time });
        return { ok: true };
      }
      buckets.set(userId, { units, at: time });
      return { ok: false, waitMs: Math.ceil((MINUTE_MS - units) / perMinute), log: logDecision(userId, time) };
    },
    trackedUsers() {
      return new Set([...buckets.keys(), ...refusals.keys()]).size;
    },
  };
}
