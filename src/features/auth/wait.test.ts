import { describe, expect, it } from "vitest";

import { waitAfterFailures } from "@/features/auth/wait";

const MINUTE = 60_000;

describe("waitAfterFailures", () => {
  it.each([
    [0, 0],
    [1, 0],
    [4, 0],
    [5, 1 * MINUTE],
    [6, 2 * MINUTE],
    [7, 4 * MINUTE],
    [8, 8 * MINUTE],
    [9, 15 * MINUTE],
    [10, 15 * MINUTE],
    [20, 15 * MINUTE],
    [5000, 15 * MINUTE],
  ])("after %i failures the wait is %i ms", (failures, wait) => {
    expect(waitAfterFailures(failures)).toBe(wait);
  });
});
