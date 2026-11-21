import { describe, expect, it } from "vitest";

import { parseLockVersion, parseNumberParam, uploadInputSchema } from "@/features/files/schema";

describe("parseLockVersion", () => {
  it("accepts a whole number from 1 up to the largest of the column", () => {
    expect(parseLockVersion(1)).toBe(1);
    expect(parseLockVersion(2_147_483_647)).toBe(2_147_483_647);
  });

  it("refuses anything else", () => {
    for (const value of [0, -1, 1.5, 2_147_483_648, "1", null, undefined]) {
      expect(parseLockVersion(value), String(value)).toBeNull();
    }
  });
});

describe("parseNumberParam", () => {
  it("reads a whole number from 1 up, written with digits alone", () => {
    expect(parseNumberParam("1")).toBe(1);
    expect(parseNumberParam("42")).toBe(42);
    expect(parseNumberParam("2147483647")).toBe(2_147_483_647);
  });

  it("refuses a missing, repeated or malformed value and one too large for the column", () => {
    for (const value of [undefined, null, "", "0", "01", "-1", "+1", "1.0", "1e3", " 1", "a", "2147483648", ["1"]]) {
      expect(parseNumberParam(value), JSON.stringify(value)).toBeNull();
    }
  });
});

describe("uploadInputSchema", () => {
  it("takes the name of a file with the extension of its type", () => {
    expect(uploadInputSchema.parse({ name: "diagram.png" })).toEqual({ name: "diagram.png" });
    expect(uploadInputSchema.safeParse({ name: "diagram.jpeg" }).success).toBe(false);
  });
});
