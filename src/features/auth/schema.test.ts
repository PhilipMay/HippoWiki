import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loginInputSchema, passwordChangeInputSchema } from "@/features/auth/schema";

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

describe("passwordChangeInputSchema", () => {
  const VALID = {
    currentPassword: "first-password",
    newPassword: "my-own-password",
    repeatPassword: "my-own-password",
  };

  /** The field errors of a password change of the user `alexander`; empty when the input is valid. */
  function fieldErrorsOf(input: Record<string, string>) {
    const result = passwordChangeInputSchema("alexander").safeParse(input);
    return result.success ? {} : z.flattenError(result.error).fieldErrors;
  }

  it("accepts a new password that follows all rules", () => {
    expect(passwordChangeInputSchema("alexander").parse(VALID)).toEqual(VALID);
  });

  it("keeps all three passwords as they are, with their spaces", () => {
    const spaced = { currentPassword: " first ", newPassword: "  my own  ", repeatPassword: "  my own  " };

    expect(passwordChangeInputSchema("alexander").parse(spaced)).toEqual(spaced);
  });

  // Each case breaks exactly one rule.
  it.each([
    [
      "a missing current password",
      { ...VALID, currentPassword: "" },
      { currentPassword: ["Current password is required"] },
    ],
    [
      "a new password of 7 characters",
      { ...VALID, newPassword: "1234567", repeatPassword: "1234567" },
      { newPassword: ["Password must be at least 8 characters"] },
    ],
    [
      "a new password of 129 characters",
      { ...VALID, newPassword: "p".repeat(129), repeatPassword: "p".repeat(129) },
      { newPassword: ["Password must be at most 128 characters"] },
    ],
    [
      "a new password that is the user name",
      { ...VALID, newPassword: "alexander", repeatPassword: "alexander" },
      { newPassword: ["Password must not be the same as the user name"] },
    ],
    [
      "a new password that is the current one",
      { currentPassword: "first-password", newPassword: "first-password", repeatPassword: "first-password" },
      { newPassword: ["New password must differ from the current one"] },
    ],
    [
      "a repetition that differs",
      { ...VALID, repeatPassword: "my-own-passwore" },
      { repeatPassword: ["The two new passwords do not match"] },
    ],
    [
      "a repetition that differs only by a space",
      { ...VALID, repeatPassword: "my-own-password " },
      { repeatPassword: ["The two new passwords do not match"] },
    ],
    [
      "a missing repetition",
      { ...VALID, repeatPassword: "" },
      { repeatPassword: ["The two new passwords do not match"] },
    ],
  ])("rejects %s with the error at its field", (_case, input, fieldErrors) => {
    expect(fieldErrorsOf(input)).toEqual(fieldErrors);
  });

  it("accepts 8 and 128 characters, and a new password that only resembles the user name or the current one", () => {
    for (const newPassword of ["12345678", "p".repeat(128), "Alexander", "alexander1", "first-password "]) {
      expect(fieldErrorsOf({ ...VALID, newPassword, repeatPassword: newPassword }), newPassword).toEqual({});
    }
  });

  it("reports the errors of several fields together", () => {
    expect(fieldErrorsOf({ currentPassword: "", newPassword: "1234567", repeatPassword: "other" })).toEqual({
      currentPassword: ["Current password is required"],
      newPassword: ["Password must be at least 8 characters"],
      repeatPassword: ["The two new passwords do not match"],
    });
  });

  it("reports only that the new password is required for an empty form", () => {
    expect(fieldErrorsOf({ currentPassword: "", newPassword: "", repeatPassword: "" })).toEqual({
      currentPassword: ["Current password is required"],
      newPassword: ["Password is required"],
    });
  });

  it("applies the rule about the user name to the name it was built for", () => {
    const input = { ...VALID, newPassword: "alexander", repeatPassword: "alexander" };

    expect(passwordChangeInputSchema("someone-else").safeParse(input).success).toBe(true);
  });
});
