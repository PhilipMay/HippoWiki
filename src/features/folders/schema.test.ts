import { describe, expect, it } from "vitest";

import { parseFolderFormData, parseFolderId } from "@/features/folders/schema";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("parseFolderId", () => {
  it("returns a well-formed id", () => {
    const id = crypto.randomUUID();
    expect(parseFolderId(id)).toBe(id);
  });

  it("returns null for a malformed id", () => {
    for (const id of ["", "not-a-uuid", "handbook", `${crypto.randomUUID()}x`]) {
      expect(parseFolderId(id)).toBeNull();
    }
  });
});

describe("parseFolderFormData", () => {
  it("returns the trimmed name", () => {
    expect(parseFolderFormData(formData({ name: " handbook " }))).toEqual({
      success: true,
      data: { name: "handbook" },
    });
  });

  it("ignores other fields", () => {
    expect(parseFolderFormData(formData({ name: "handbook", id: "x", createdAt: "2026-01-01" }))).toEqual({
      success: true,
      data: { name: "handbook" },
    });
  });

  it("reports a missing or empty name", () => {
    const required = { success: false, fieldErrors: { name: ["Name is required"] } };
    expect(parseFolderFormData(formData({}))).toEqual(required);
    expect(parseFolderFormData(formData({ name: "  " }))).toEqual(required);
  });

  it("reports an invalid name", () => {
    expect(parseFolderFormData(formData({ name: "Hand Book" }))).toEqual({
      success: false,
      fieldErrors: { name: ["Use lowercase letters, digits and single hyphens"] },
    });
  });
});
