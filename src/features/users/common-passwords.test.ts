import { describe, expect, it } from "vitest";

import { COMMON_PASSWORDS, isCommonPassword } from "@/features/users/common-passwords";
import { generateFirstPassword } from "@/features/users/password";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/features/users/schema";

describe("COMMON_PASSWORDS", () => {
  it("has exactly 10,000 entries, all distinct", () => {
    expect(COMMON_PASSWORDS).toHaveLength(10_000);
    expect(new Set(COMMON_PASSWORDS).size).toBe(10_000);
  });

  it("has only lowercase entries that meet the length rule", () => {
    for (const entry of COMMON_PASSWORDS) {
      expect(entry, entry).toBe(entry.toLowerCase());
      expect(entry.length, entry).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
      expect(entry.length, entry).toBeLessThanOrEqual(PASSWORD_MAX_LENGTH);
    }
  });
});

describe("isCommonPassword", () => {
  it("is true for common passwords, in any case", () => {
    for (const password of ["password123", "qwertyuiop", "12345678", "Password123", "QWERTYUIOP"]) {
      expect(isCommonPassword(password), password).toBe(true);
    }
  });

  it("is false for a generated first password", () => {
    expect(isCommonPassword(generateFirstPassword())).toBe(false);
  });

  it("is false for a password that only contains a common one", () => {
    expect(isCommonPassword(" password123")).toBe(false);
    expect(isCommonPassword("password123-and-more")).toBe(false);
  });
});
