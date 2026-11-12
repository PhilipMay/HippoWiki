import { describe, expect, it } from "vitest";

import { FIRST_PASSWORD_ALPHABET, FIRST_PASSWORD_LENGTH, generateFirstPassword } from "@/features/users/password";
import { passwordSchemaFor } from "@/features/users/schema";

describe("generateFirstPassword", () => {
  const passwords = Array.from({ length: 500 }, generateFirstPassword);

  it("generates passwords of 20 characters", () => {
    expect(FIRST_PASSWORD_LENGTH).toBe(20);
    for (const password of passwords) expect(password).toHaveLength(20);
  });

  it("uses letters and digits only, without the characters that are easy to confuse", () => {
    for (const password of passwords) {
      expect(password).toMatch(/^[A-Za-z0-9]+$/);
      expect(password).not.toMatch(/[0O1lI]/);
    }
  });

  it("draws from all letters and digits that are left", () => {
    const expected = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"]
      .filter((character) => !"0O1lI".includes(character))
      .sort();

    expect([...FIRST_PASSWORD_ALPHABET].sort()).toEqual(expected);
    expect(new Set(FIRST_PASSWORD_ALPHABET).size).toBe(FIRST_PASSWORD_ALPHABET.length);
    // 10,000 characters: each of the 57 is missing with a probability of about 1e-76.
    expect([...new Set(passwords.join(""))].sort()).toEqual(expected);
  });

  it("generates another password every time", () => {
    expect(new Set(passwords).size).toBe(passwords.length);
    expect(generateFirstPassword()).not.toBe(generateFirstPassword());
  });

  it("generates passwords that follow the password rules", () => {
    for (const password of passwords.slice(0, 20)) {
      expect(passwordSchemaFor("alice").safeParse(password).success).toBe(true);
    }
  });
});
