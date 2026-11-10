import { describe, expect, it } from "vitest";

import { formatDateTime } from "@/lib/format";

describe("formatDateTime", () => {
  it("formats date and time in the given time zone", () => {
    const date = new Date("2026-11-10T16:34:00Z");

    expect(formatDateTime(date, "UTC")).toMatch(/^Nov 10, 2026, 4:34\sPM$/);
    expect(formatDateTime(date, "Europe/Berlin")).toMatch(/^Nov 10, 2026, 5:34\sPM$/);
  });
});
