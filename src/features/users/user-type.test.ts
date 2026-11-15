import { describe, expect, it } from "vitest";

import { isAdmin, isUserType, USER_TYPES } from "@/features/users/user-type";

describe("USER_TYPES", () => {
  it("are user and admin, user first", () => {
    expect(USER_TYPES).toEqual(["user", "admin"]);
  });
});

describe("isUserType", () => {
  it("is true for the two types", () => {
    expect(isUserType("admin")).toBe(true);
    expect(isUserType("user")).toBe(true);
  });

  it("is false for anything else", () => {
    for (const value of ["", "Admin", "USER", " admin", "root", null, undefined, 1, {}]) {
      expect(isUserType(value), String(value)).toBe(false);
    }
  });
});

describe("isAdmin", () => {
  it("decides by the type, not by the name", () => {
    expect(isAdmin({ type: "admin" })).toBe(true);
    expect(isAdmin({ type: "user" })).toBe(false);
    expect(isAdmin({ name: "maria", type: "admin" } as { type: "admin" })).toBe(true);
    expect(isAdmin({ name: "admin", type: "user" } as { type: "user" })).toBe(false);
  });
});
