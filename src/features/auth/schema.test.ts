import { describe, expect, it } from "vitest";

import { loginInputSchema } from "@/features/auth/schema";

describe("loginInputSchema", () => {
  it("accepts a valid name with a password", () => {
    expect(loginInputSchema.parse({ name: "alice", password: "secret password" })).toEqual({
      name: "alice",
      password: "secret password",
    });
  });

  it("trims the name and keeps the password as it is", () => {
    expect(loginInputSchema.parse({ name: "  alice ", password: "  spaced  " })).toEqual({
      name: "alice",
      password: "  spaced  ",
    });
  });

  it("accepts a password that is shorter than a new password may be", () => {
    // The lower limit is a rule for new passwords; a short one simply does not match a stored hash.
    expect(loginInputSchema.safeParse({ name: "alice", password: "x" }).success).toBe(true);
  });

  it("accepts a password of 128 characters and rejects one of 129", () => {
    expect(loginInputSchema.safeParse({ name: "alice", password: "p".repeat(128) }).success).toBe(true);
    expect(loginInputSchema.safeParse({ name: "alice", password: "p".repeat(129) }).success).toBe(false);
  });

  it("counts the length of the password as Better Auth does, not the code points", () => {
    expect(loginInputSchema.safeParse({ name: "alice", password: "😀".repeat(64) }).success).toBe(true);
    expect(loginInputSchema.safeParse({ name: "alice", password: "😀".repeat(65) }).success).toBe(false);
  });

  it("rejects an empty password", () => {
    expect(loginInputSchema.safeParse({ name: "alice", password: "" }).success).toBe(false);
  });

  it.each([
    ["an empty name", ""],
    ["a name of 2 characters", "ab"],
    ["a name of 31 characters", "a".repeat(31)],
    ["upper case", "Alice"],
    ["a leading hyphen", "-alice"],
    ["a trailing hyphen", "alice-"],
    ["a double hyphen", "al--ice"],
    ["an email address", "alice@users.hippowiki.invalid"],
  ])("rejects %s, which cannot be the name of a user", (_case, name) => {
    expect(loginInputSchema.safeParse({ name, password: "secret password" }).success).toBe(false);
  });
});
