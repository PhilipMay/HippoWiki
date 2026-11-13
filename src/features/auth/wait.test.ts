import { describe, expect, it } from "vitest";

import { NAME_WINDOW_MS, isWindowOver, waitAfterFailures, waitForWindow } from "@/features/auth/wait";

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

describe("waitForWindow", () => {
  const STARTED_AT = new Date("2026-11-13T10:00:00.000Z");
  /** The time the given number of milliseconds after the start of the window. */
  const after = (ms: number) => new Date(STARTED_AT.getTime() + ms);

  it("asks for no wait without a window", () => {
    expect(waitForWindow(null, STARTED_AT)).toBe(0);
  });

  it.each([0, 1, 19])("asks for no wait with %i attempts in a running hour", (attempts) => {
    expect(waitForWindow({ attempts, startedAt: STARTED_AT }, after(10 * MINUTE))).toBe(0);
  });

  it.each([20, 21])("asks for the rest of the hour with %i attempts", (attempts) => {
    expect(waitForWindow({ attempts, startedAt: STARTED_AT }, after(10 * MINUTE))).toBe(50 * MINUTE);
  });

  it("asks for the whole hour right after the window started", () => {
    expect(waitForWindow({ attempts: 20, startedAt: STARTED_AT }, STARTED_AT)).toBe(NAME_WINDOW_MS);
  });

  it("asks for 1 ms in the last millisecond of the hour", () => {
    expect(waitForWindow({ attempts: 20, startedAt: STARTED_AT }, after(NAME_WINDOW_MS - 1))).toBe(1);
  });

  it("asks for no wait once the hour is over", () => {
    expect(waitForWindow({ attempts: 20, startedAt: STARTED_AT }, after(NAME_WINDOW_MS))).toBe(0);
    expect(waitForWindow({ attempts: 20, startedAt: STARTED_AT }, after(2 * NAME_WINDOW_MS))).toBe(0);
  });
});

describe("isWindowOver", () => {
  const STARTED_AT = new Date("2026-11-13T10:00:00.000Z");

  it("is false in the last millisecond of the hour and true from the first one after it", () => {
    const window = { attempts: 1, startedAt: STARTED_AT };

    expect(isWindowOver(window, new Date(STARTED_AT.getTime() + NAME_WINDOW_MS - 1))).toBe(false);
    expect(isWindowOver(window, new Date(STARTED_AT.getTime() + NAME_WINDOW_MS))).toBe(true);
  });
});
