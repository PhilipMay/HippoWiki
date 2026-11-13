import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ADMIN_NAME,
  isAdmin,
  parseUserId,
  parseUserName,
  passwordSchema,
  passwordSchemaFor,
  userInputSchema,
  userNameSchema,
} from "@/features/users/schema";

/** The error messages of a value that the schema rejects; an empty list when it accepts the value. */
function errorsOf(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  return result.success ? [] : z.flattenError(result.error).formErrors;
}

describe("parseUserId", () => {
  it("returns a well-formed id", () => {
    const id = crypto.randomUUID();
    expect(parseUserId(id)).toBe(id);
  });

  it("returns null for a malformed id", () => {
    for (const id of ["", "not-a-uuid", "admin", `${crypto.randomUUID()}x`, ` ${crypto.randomUUID()}`]) {
      expect(parseUserId(id)).toBeNull();
    }
  });
});

describe("ADMIN_NAME", () => {
  it("is a valid user name", () => {
    expect(ADMIN_NAME).toBe("admin");
    expect(parseUserName(ADMIN_NAME)).toBe("admin");
  });
});

describe("isAdmin", () => {
  it("is true for the user named admin", () => {
    expect(isAdmin({ name: "admin" })).toBe(true);
  });

  it("is false for every other name", () => {
    for (const name of ["alice", "admin-2", "administrator", "Admin", " admin", ""]) {
      expect(isAdmin({ name }), name).toBe(false);
    }
  });
});

describe("userNameSchema", () => {
  it("accepts names of 3 and of 30 characters", () => {
    expect(userNameSchema.parse("abc")).toBe("abc");
    expect(userNameSchema.parse("a".repeat(30))).toBe("a".repeat(30));
  });

  it("accepts lowercase letters, digits and single hyphens", () => {
    for (const name of ["alice", "user-2", "7-of-9", "a-b-c"]) {
      expect(errorsOf(userNameSchema, name), name).toEqual([]);
    }
  });

  it("rejects a name of 2 characters", () => {
    expect(errorsOf(userNameSchema, "ab")).toEqual(["Name must be at least 3 characters"]);
  });

  it("rejects a name of 31 characters", () => {
    expect(errorsOf(userNameSchema, "a".repeat(31))).toEqual(["Name must be at most 30 characters"]);
  });

  it("reports only that the name is required for an empty name", () => {
    expect(errorsOf(userNameSchema, "")).toEqual(["Name is required"]);
    expect(errorsOf(userNameSchema, "   ")).toEqual(["Name is required"]);
  });

  it.each([
    ["upper case", "Alice"],
    ["a leading hyphen", "-alice"],
    ["a trailing hyphen", "alice-"],
    ["a double hyphen", "al--ice"],
    ["a space", "al ice"],
    ["an underscore", "al_ice"],
    ["a dot", "al.ice"],
    ["a non-Latin letter", "älice"],
    ["an at sign", "alice@example"],
  ])("rejects a name with %s", (_case, name) => {
    expect(errorsOf(userNameSchema, name)).toEqual(["Use lowercase letters, digits and single hyphens"]);
  });

  it("trims the name of a form", () => {
    expect(userNameSchema.parse("  alice ")).toBe("alice");
    expect(userInputSchema.parse({ name: " bob " })).toEqual({ name: "bob" });
  });
});

describe("parseUserName", () => {
  it("returns a valid name", () => {
    expect(parseUserName("alice")).toBe("alice");
    expect(parseUserName("a".repeat(30))).toBe("a".repeat(30));
  });

  it("returns null for a name that breaks the rule", () => {
    for (const name of ["", "ab", "a".repeat(31), "Alice", "-alice", "alice-", "al--ice"]) {
      expect(parseUserName(name), name).toBeNull();
    }
  });

  it("returns null for a name with surrounding whitespace", () => {
    expect(parseUserName(" alice")).toBeNull();
    expect(parseUserName("alice ")).toBeNull();
  });
});

describe("passwordSchema", () => {
  it("accepts passwords of 8 and of 128 characters", () => {
    expect(passwordSchema.parse("12345678")).toBe("12345678");
    expect(passwordSchema.parse("p".repeat(128))).toBe("p".repeat(128));
  });

  it("rejects a password of 7 characters", () => {
    expect(errorsOf(passwordSchema, "1234567")).toEqual(["Password must be at least 8 characters"]);
  });

  it("rejects a password of 129 characters", () => {
    expect(errorsOf(passwordSchema, "p".repeat(129))).toEqual(["Password must be at most 128 characters"]);
  });

  it("reports only that the password is required for an empty password", () => {
    expect(errorsOf(passwordSchema, "")).toEqual(["Password is required"]);
  });

  it("keeps spaces, also at both ends, and counts them", () => {
    expect(passwordSchema.parse("  ab cd  ")).toBe("  ab cd  ");
    expect(passwordSchema.parse("        ")).toBe("        ");
    expect(errorsOf(passwordSchema, "  abc  ")).toEqual(["Password must be at least 8 characters"]);
  });

  it("keeps non-Latin letters as they are", () => {
    expect(passwordSchema.parse("пароль-密碼")).toBe("пароль-密碼");
  });

  it("counts the length of the string, as Better Auth does, not the code points", () => {
    // An emoji is one code point and two UTF-16 code units: four of them have the length 8, 65 the length 130.
    expect(passwordSchema.parse("😀😀😀😀")).toBe("😀😀😀😀");
    expect(passwordSchema.parse("😀".repeat(64))).toBe("😀".repeat(64));
    expect(errorsOf(passwordSchema, "😀".repeat(65))).toEqual(["Password must be at most 128 characters"]);
  });

  it("has no composition rules", () => {
    for (const password of ["aaaaaaaa", "11111111", "password"]) {
      expect(errorsOf(passwordSchema, password), password).toEqual([]);
    }
  });
});

describe("passwordSchemaFor", () => {
  it("rejects a password that is the same as the user name", () => {
    expect(errorsOf(passwordSchemaFor("alexander"), "alexander")).toEqual([
      "Password must not be the same as the user name",
    ]);
  });

  it("accepts a password that only contains or resembles the user name", () => {
    for (const password of ["alexander1", "Alexander", " alexander"]) {
      expect(errorsOf(passwordSchemaFor("alexander"), password), password).toEqual([]);
    }
  });

  it("keeps the length rules", () => {
    expect(errorsOf(passwordSchemaFor("alice"), "1234567")).toEqual(["Password must be at least 8 characters"]);
    expect(errorsOf(passwordSchemaFor("alice"), "p".repeat(129))).toEqual(["Password must be at most 128 characters"]);
  });

  it("reports every rule that a password breaks", () => {
    expect(errorsOf(passwordSchemaFor("alice"), "alice")).toEqual([
      "Password must be at least 8 characters",
      "Password must not be the same as the user name",
    ]);
  });
});
