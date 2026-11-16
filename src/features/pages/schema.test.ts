import { describe, expect, it } from "vitest";

import { parsePageId, parsePageVersion } from "@/features/pages/schema";

describe("parsePageId", () => {
  it("accepts well-formed UUIDs", () => {
    expect(parsePageId("7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c0001")).toBe("7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c0001");
    const random = crypto.randomUUID();
    expect(parsePageId(random)).toBe(random);
  });

  it("rejects malformed ids", () => {
    for (const id of [
      "",
      "abc",
      "not-a-uuid",
      "7c0b6a2e-3f5d-4c1a-9e2b",
      "1' OR '1'='1",
      "7c0b6a2e3f5d4c1a9e2b1a4f8d6c0001",
    ]) {
      expect(parsePageId(id)).toBeNull();
    }
  });
});

describe("parsePageVersion", () => {
  it("accepts integers from 1 up to the largest value of the column", () => {
    for (const version of [1, 2, 42, 2_147_483_647]) expect(parsePageVersion(version)).toBe(version);
  });

  it("refuses everything else", () => {
    for (const version of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648, "3", "", null, undefined]) {
      expect(parsePageVersion(version)).toBeNull();
    }
  });
});
