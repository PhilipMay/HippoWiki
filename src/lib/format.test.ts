import { describe, expect, it } from "vitest";

import { formatBytes, formatDateTime } from "@/lib/format";

describe("formatDateTime", () => {
  it("formats date and time in the given time zone", () => {
    const date = new Date("2026-11-10T16:34:00Z");

    expect(formatDateTime(date, "UTC")).toMatch(/^Nov 10, 2026, 4:34\sPM$/);
    expect(formatDateTime(date, "Europe/Berlin")).toMatch(/^Nov 10, 2026, 5:34\sPM$/);
  });
});

describe("formatBytes", () => {
  it("formats sizes in binary units with at most one decimal", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KiB");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(26_214_400)).toBe("25 MiB");
    expect(formatBytes(26_214_401)).toBe("25 MiB");
    expect(formatBytes(1_048_576)).toBe("1 MiB");
    expect(formatBytes(1_073_741_824)).toBe("1 GiB");
    expect(formatBytes(3 * 1_073_741_824 * 1024)).toBe("3072 GiB");
  });
});
