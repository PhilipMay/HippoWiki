import { describe, expect, it } from "vitest";

import { NAME_MAX_LENGTH, nameSchema, parseName } from "@/lib/names";

function nameErrors(name: string): string[] {
  const result = nameSchema.safeParse(name);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("nameSchema", () => {
  it("accepts lowercase letters, digits and single hyphens", () => {
    for (const name of ["a", "a-1", "release-notes", "2026", "a".repeat(NAME_MAX_LENGTH)]) {
      expect(nameSchema.parse(name)).toBe(name);
    }
  });

  it("trims the name", () => {
    expect(nameSchema.parse(" a-1 \n")).toBe("a-1");
  });

  it("requires a name", () => {
    expect(nameErrors("")).toEqual(["Name is required"]);
    expect(nameErrors("   ")).toEqual(["Name is required"]);
  });

  it("limits the name length", () => {
    expect(nameErrors("a".repeat(NAME_MAX_LENGTH + 1))).toEqual(["Name must be at most 80 characters"]);
  });

  it("rejects uppercase letters, dots and other characters outside the pattern", () => {
    for (const name of ["A", "Guides", "guides.md", "a.b", "a_b", "a b", "ä", "a/b"]) {
      expect(nameErrors(name)).toEqual(["Use lowercase letters, digits and single hyphens"]);
    }
  });

  it("rejects double, leading and trailing hyphens", () => {
    for (const name of ["a--b", "-a", "a-", "-"]) {
      expect(nameErrors(name)).toEqual(["Use lowercase letters, digits and single hyphens"]);
    }
  });
});

describe("parseName", () => {
  it("returns a valid name", () => {
    expect(parseName("release-notes")).toBe("release-notes");
    expect(parseName("new")).toBe("new");
  });

  it("returns null for an invalid name", () => {
    for (const segment of ["", "Guides", "a--b", "guides.md", "a".repeat(NAME_MAX_LENGTH + 1)]) {
      expect(parseName(segment)).toBeNull();
    }
  });

  it("returns null for a name with surrounding whitespace", () => {
    for (const segment of [" guides", "guides ", "guides\n", "\tguides"]) {
      expect(parseName(segment)).toBeNull();
    }
  });
});
