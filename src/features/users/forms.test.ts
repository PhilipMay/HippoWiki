import { describe, expect, it } from "vitest";

import { parseUserFormData } from "@/features/users/forms";

function formData(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const TYPE_ERROR = "Choose the type of the account";

describe("parseUserFormData", () => {
  it("returns a valid name with its type", () => {
    expect(parseUserFormData(formData({ name: "jane-doe", type: "user" }))).toEqual({
      success: true,
      data: { name: "jane-doe", type: "user" },
    });
    expect(parseUserFormData(formData({ name: "maria", type: "admin" }))).toEqual({
      success: true,
      data: { name: "maria", type: "admin" },
    });
  });

  it("trims the name", () => {
    expect(parseUserFormData(formData({ name: "  jane ", type: "user" }))).toEqual({
      success: true,
      data: { name: "jane", type: "user" },
    });
  });

  it.each([
    ["an empty name", "", "Name is required"],
    ["a name of 2 characters", "ab", "Name must be at least 3 characters"],
    ["a name of 31 characters", "a".repeat(31), "Name must be at most 30 characters"],
    ["a name in upper case", "Jane", "Use lowercase letters, digits and single hyphens"],
    ["a name with a space", "jane doe", "Use lowercase letters, digits and single hyphens"],
  ])("reports %s", (_case, name, error) => {
    expect(parseUserFormData(formData({ name, type: "user" }))).toEqual({
      success: false,
      fieldErrors: { name: [error] },
    });
  });

  it("counts a missing field and a file as an empty name", () => {
    const required = { success: false, fieldErrors: { name: ["Name is required"] } };

    expect(parseUserFormData(formData({ type: "user" }))).toEqual(required);
    expect(parseUserFormData(formData({ name: new File(["jane"], "name.txt"), type: "user" }))).toEqual(required);
  });

  it.each([
    ["a missing type", {}],
    ["an empty type", { type: "" }],
    ["an unknown type", { type: "root" }],
    ["a type in another case", { type: "Admin" }],
    ["a type with spaces", { type: " user " }],
    ["a file", { type: new File(["user"], "type.txt") }],
  ])("refuses %s and chooses no type in its place", (_case, fields) => {
    expect(parseUserFormData(formData({ name: "jane", ...fields }))).toEqual({
      success: false,
      fieldErrors: { type: [TYPE_ERROR] },
    });
  });

  it("reports the errors of the name and the type together", () => {
    expect(parseUserFormData(formData({ name: "" }))).toEqual({
      success: false,
      fieldErrors: { name: ["Name is required"], type: [TYPE_ERROR] },
    });
  });

  it("ignores other fields, such as a password that a crafted request adds", () => {
    expect(
      parseUserFormData(formData({ name: "jane", type: "user", password: "chosen", mustChangePassword: "false" })),
    ).toEqual({ success: true, data: { name: "jane", type: "user" } });
  });
});
