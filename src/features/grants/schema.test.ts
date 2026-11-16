import { describe, expect, it } from "vitest";

import { parseGrantId } from "@/features/grants/schema";

describe("parseGrantId", () => {
  it("returns a well-formed id", () => {
    const id = crypto.randomUUID();
    expect(parseGrantId(id)).toBe(id);
  });

  it("returns null for a malformed id", () => {
    for (const id of ["", "not-a-uuid", "hw_token", `${crypto.randomUUID()}x`, ` ${crypto.randomUUID()}`]) {
      expect(parseGrantId(id), id).toBeNull();
    }
  });
});
