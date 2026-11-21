import { describe, expect, it } from "vitest";

import { createRateLimit } from "@/features/mcp/rate-limit";
import { MCP_RATE_BURST, MCP_RATE_PER_MINUTE } from "@/lib/env";

const ALICE = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002";
const BOB = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1003";

/** A rate limit with the defaults of the environment, or the given numbers, on a clock that the test moves. */
function limitWithClock(burst: number = MCP_RATE_BURST.default, perMinute: number = MCP_RATE_PER_MINUTE.default) {
  let time = 1_000_000;
  const limit = createRateLimit({ burst, perMinute, now: () => time });
  return {
    limit,
    advance(ms: number) {
      time += ms;
    },
  };
}

/** Takes `count` requests of the user and returns how many passed. */
function takeMany(limit: ReturnType<typeof createRateLimit>, userId: string, count: number): number {
  let passed = 0;
  for (let index = 0; index < count; index += 1) {
    if (limit.take(userId).ok) passed += 1;
  }
  return passed;
}

describe("createRateLimit", () => {
  it("with the defaults takes 60 requests at once and refuses the 61st with a wait of 200 ms", () => {
    const { limit } = limitWithClock();

    expect(takeMany(limit, ALICE, 60)).toBe(60);
    expect(limit.take(ALICE)).toEqual({ ok: false, waitMs: 200, log: { refusedBefore: 0 } });
  });

  it("takes exactly five more one second later", () => {
    const { limit, advance } = limitWithClock();
    takeMany(limit, ALICE, 61);

    advance(1000);

    expect(takeMany(limit, ALICE, 6)).toBe(5);
  });

  it("gives two users budgets of their own", () => {
    const { limit } = limitWithClock();
    takeMany(limit, ALICE, 60);

    expect(limit.take(ALICE).ok).toBe(false);
    expect(takeMany(limit, BOB, 60)).toBe(60);
  });

  it("with a burst of 2 and 60 a minute refuses the third request and takes one a second later", () => {
    const { limit, advance } = limitWithClock(2, 60);

    expect(takeMany(limit, ALICE, 2)).toBe(2);
    expect(limit.take(ALICE)).toMatchObject({ ok: false, waitMs: 1000 });

    advance(999);
    expect(limit.take(ALICE).ok).toBe(false);
    advance(1);
    expect(limit.take(ALICE).ok).toBe(true);
    expect(limit.take(ALICE).ok).toBe(false);
  });

  it("never fills the budget above the burst", () => {
    const { limit, advance } = limitWithClock();

    advance(60 * 60_000);

    expect(takeMany(limit, ALICE, 61)).toBe(60);
  });

  it("leaves no entry for a user whose budget is full again", () => {
    const { limit, advance } = limitWithClock();
    takeMany(limit, ALICE, 3);
    expect(limit.trackedUsers()).toBe(1);

    // The bucket is full again after 600 ms; the entries are pruned at the first request a minute or more later.
    advance(60_000);
    limit.take(BOB);

    expect(limit.trackedUsers()).toBe(1);
    advance(60_000);
    limit.take(ALICE);
    expect(limit.trackedUsers()).toBe(1);
  });

  it("logs the first refusal a minute or more after the line before, with the number of refusals since", () => {
    const { limit, advance } = limitWithClock();
    takeMany(limit, ALICE, 60);

    const first = Array.from({ length: 100 }, () => limit.take(ALICE));
    advance(59_999);
    takeMany(limit, ALICE, 60);
    const beforeTheMinute = limit.take(ALICE);
    advance(1);
    const afterTheMinute = limit.take(ALICE);
    const nextInTheMinute = limit.take(ALICE);

    expect(first.every((taken) => !taken.ok)).toBe(true);
    expect(first.filter((taken) => !taken.ok && taken.log !== null)).toEqual([
      { ok: false, waitMs: 200, log: { refusedBefore: 0 } },
    ]);
    expect(beforeTheMinute).toMatchObject({ ok: false, log: null });
    // 99 of the first 100 and the one just before the minute were not logged.
    expect(afterTheMinute).toMatchObject({ ok: false, log: { refusedBefore: 100 } });
    expect(nextInTheMinute).toMatchObject({ ok: false, log: null });
  });

  it("counts 100 refusals within one minute in one line and the 99 others in the first line a minute later", () => {
    const { limit, advance } = limitWithClock();
    takeMany(limit, ALICE, 60);
    const refusals = Array.from({ length: 100 }, () => limit.take(ALICE));

    advance(60_000);
    takeMany(limit, ALICE, 60);
    const later = limit.take(ALICE);

    expect(refusals.filter((taken) => !taken.ok && taken.log !== null)).toHaveLength(1);
    expect(later).toMatchObject({ ok: false, log: { refusedBefore: 99 } });
  });
});
