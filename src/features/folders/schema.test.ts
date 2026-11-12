import { describe, expect, it } from "vitest";

import { parseFolderId, parseTabId } from "@/features/folders/schema";

describe("parseFolderId", () => {
  it("returns a well-formed id", () => {
    const id = crypto.randomUUID();
    expect(parseFolderId(id)).toBe(id);
  });

  it("returns null for a malformed id", () => {
    for (const id of ["", "not-a-uuid", "handbook", `${crypto.randomUUID()}x`]) {
      expect(parseFolderId(id)).toBeNull();
    }
  });
});

describe("parseTabId", () => {
  it("returns a well-formed id", () => {
    const id = crypto.randomUUID();
    expect(parseTabId(id)).toBe(id);
  });

  it("returns null for a malformed id", () => {
    for (const id of ["", "not-a-uuid", "guides", `${crypto.randomUUID()}x`]) {
      expect(parseTabId(id)).toBeNull();
    }
  });
});
