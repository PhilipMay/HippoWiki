import { describe, expect, it } from "vitest";

import { parseTokenFormData } from "@/features/tokens/forms";

/** A submitted form; a field given as a list is submitted once per value, like checkboxes. */
function formData(fields: Record<string, string | File | (string | File)[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const each of Array.isArray(value) ? value : [value]) data.append(key, each);
  }
  return data;
}

const VALID = { name: "MCP client", scopes: ["read"], expiry: "90d" };

describe("parseTokenFormData", () => {
  it("returns a valid input, with the name trimmed", () => {
    expect(parseTokenFormData(formData({ ...VALID, name: "  MCP client " }))).toEqual({ success: true, data: VALID });
  });

  it("reads every ticked scope", () => {
    expect(parseTokenFormData(formData({ ...VALID, scopes: ["read", "write"] }))).toEqual({
      success: true,
      data: { ...VALID, scopes: ["read", "write"] },
    });
  });

  it("reports all missing fields together", () => {
    expect(parseTokenFormData(new FormData())).toEqual({
      success: false,
      fieldErrors: {
        name: ["Name is required"],
        scopes: ["Choose at least one scope"],
        expiry: ["Choose when the token expires"],
      },
    });
  });

  it("counts a file as an empty name and expiry and as an unknown scope", () => {
    const file = new File(["read"], "field.txt");

    expect(parseTokenFormData(formData({ name: file, scopes: [file], expiry: file }))).toEqual({
      success: false,
      fieldErrors: {
        name: ["Name is required"],
        scopes: ["Unknown scope"],
        expiry: ["Choose when the token expires"],
      },
    });
  });

  it.each([
    ["an unknown scope", { scopes: ["read", "admin"] }, { scopes: ["Unknown scope"] }],
    ["a scope twice", { scopes: ["read", "read"] }, { scopes: ["Choose each scope only once"] }],
    ["an unknown expiry", { expiry: "never" }, { expiry: ["Choose when the token expires"] }],
    ["a name of 51 characters", { name: "x".repeat(51) }, { name: ["Name must be at most 50 characters"] }],
  ])("reports %s", (_case, fields, fieldErrors) => {
    expect(parseTokenFormData(formData({ ...VALID, ...fields }))).toEqual({ success: false, fieldErrors });
  });

  it("reads the first name and expiry only and ignores other fields", () => {
    const data = formData({ ...VALID, userId: "someone-else", tokenHash: "chosen" });
    data.append("name", "second");
    data.append("expiry", "30d");

    expect(parseTokenFormData(data)).toEqual({ success: true, data: VALID });
  });
});
