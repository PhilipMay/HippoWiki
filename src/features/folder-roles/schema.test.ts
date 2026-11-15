import { describe, expect, it } from "vitest";

import { parseRole, ROLE_MESSAGE, roleSchema } from "@/features/folder-roles/schema";

describe("roleSchema", () => {
  it("accepts the four roles", () => {
    for (const role of ["reader", "writer", "manager", "owner"]) {
      expect(roleSchema.parse(role)).toBe(role);
    }
  });

  it("refuses anything else with the message", () => {
    for (const value of ["", "Owner", " owner", "admin", undefined, null, 3]) {
      const result = roleSchema.safeParse(value);
      expect(result.success, String(value)).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(ROLE_MESSAGE);
    }
  });
});

describe("parseRole", () => {
  it("returns a valid role", () => {
    expect(parseRole("manager")).toBe("manager");
  });

  it("returns null for anything else", () => {
    expect(parseRole("Manager")).toBeNull();
    expect(parseRole("")).toBeNull();
    expect(parseRole(undefined)).toBeNull();
  });
});
