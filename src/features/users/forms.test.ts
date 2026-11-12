import { describe, expect, it } from "vitest";

import { parseUserFormData } from "@/features/users/forms";

function formData(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("parseUserFormData", () => {
  it("returns a valid name", () => {
    expect(parseUserFormData(formData({ name: "jane-doe" }))).toEqual({ success: true, data: { name: "jane-doe" } });
  });

  it("trims the name", () => {
    expect(parseUserFormData(formData({ name: "  jane " }))).toEqual({ success: true, data: { name: "jane" } });
  });

  it.each([
    ["an empty name", "", "Name is required"],
    ["a name of 2 characters", "ab", "Name must be at least 3 characters"],
    ["a name of 31 characters", "a".repeat(31), "Name must be at most 30 characters"],
    ["a name in upper case", "Jane", "Use lowercase letters, digits and single hyphens"],
    ["a name with a space", "jane doe", "Use lowercase letters, digits and single hyphens"],
  ])("reports %s", (_case, name, error) => {
    expect(parseUserFormData(formData({ name }))).toEqual({ success: false, fieldErrors: { name: [error] } });
  });

  it("counts a missing field and a file as an empty name", () => {
    const required = { success: false, fieldErrors: { name: ["Name is required"] } };

    expect(parseUserFormData(new FormData())).toEqual(required);
    expect(parseUserFormData(formData({ name: new File(["jane"], "name.txt") }))).toEqual(required);
  });

  it("ignores other fields, such as a password that a crafted request adds", () => {
    expect(parseUserFormData(formData({ name: "jane", password: "chosen", mustChangePassword: "false" }))).toEqual({
      success: true,
      data: { name: "jane" },
    });
  });
});
